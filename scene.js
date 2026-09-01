import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import GUI from 'lil-gui';
import { createNoise2D } from 'simplex-noise';

const container = document.getElementById('threejs-container');
const canvas = document.getElementById('threejs-canvas');

// --- Scene ---
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100);
camera.position.set(7.5, 6.25, 10);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x001233);

// --- Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;
controls.enablePan = false;
controls.minDistance = 5;
controls.maxDistance = 25;

// --- Grid ---
const grid = new THREE.GridHelper(20, 20, 0x333333, 0x222222);
grid.position.y = -1;
scene.add(grid);

// --- Ground ---
const groundGeo = new THREE.PlaneGeometry(4, 4);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x0a1a33,
  roughness: 0.9,
  metalness: 0.1,
  side: THREE.DoubleSide,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1;
ground.visible = false;
scene.add(ground);

// --- Box ---
const geometry = new THREE.BoxGeometry(1, 1, 1);

const edgesGeo = new THREE.EdgesGeometry(geometry);
const edgesMat = new THREE.LineBasicMaterial({ color: 0x4f8ef7 });
const box = new THREE.LineSegments(edgesGeo, edgesMat);
box.position.x = 2;
scene.add(box);

// --- Arc ---
const totalPoints = 64;
const params = {
  radius: 5,
  slices: 10,
  noiseFrequency: 0.3,
  noiseSpeed: 0.2,
  noiseOffset: 0,
  spread: 1,
  radiusFill: 0.9,
  minCircleRadius: 0.05,
  maxCircleRadius: 1,
  crossSections: 5,
  crossSpread: 2,
  crossFrequencyStep: 0,
  crossSpreadStep: 0,
};

// One checkbox per drawn line color, plus one checkbox for all cubes
// (the small radius cubes and the big wireframe box). Declared here,
// ahead of the first rebuildCrossSections() call below, so that call
// can apply current visibility to the objects it creates. Only white
// and red are visible by default.
const viewParams = {
  showWhite: true,
  showGreen: false,
  showBlue: false,
  showRed: true,
  showOrange: false,
  showCubes: false,
  showSkin: true,
};
const noise2D = createNoise2D();

// Every drawn line (white/green/blue/red/orange) belongs to one cross
// section, stacked vertically -- cross section 0 sits at CROSS_BASE_Y
// (the top), each following index stacks further down by crossSpread
// units. Cross sections can each have a different noise frequency
// (crossFrequencyStep added per index) and angular spread (crossSpreadStep
// scales a simplex sample keyed by cross index, an organic per-level
// wobble rather than a straight ramp), so unlike the shared white circle,
// every other line's geometry is computed independently per cross
// section, every frame.
function computeArcPoints(r) {
  const points = [];
  for (let i = 0; i < totalPoints; i++) {
    const t = i / totalPoints;
    const angle = t * Math.PI * 2;
    points.push(new THREE.Vector3(r * Math.cos(angle), 0, r * Math.sin(angle)));
  }
  return points;
}

// The white circle's shape depends only on radius, so it's the one
// piece of geometry every cross section can still share.
const arcGeo = new THREE.BufferGeometry().setFromPoints(computeArcPoints(params.radius));
const arcMat = new THREE.LineBasicMaterial({ color: 0xffffff });

// --- Radius Cubes ---
const radiusCubeGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const radiusCubeEdgesGeo = new THREE.EdgesGeometry(radiusCubeGeo);
const radiusCubeMat = new THREE.LineBasicMaterial({ color: 0x00ff00 });

// --- Slice Circles ---
// Unit circle (radius 1); each instance is scaled per-frame to its
// computed radius, so no geometry rebuilding is needed.
function computeUnitCircleGeometry() {
  const segs = 32;
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}
const sliceCircleGeo = computeUnitCircleGeometry();
const sliceCircleMat = new THREE.LineBasicMaterial({ color: 0x00ff00 });

// --- Slice Line ---
// Connects each slice's live position to the next, forming a closed
// loop that follows the noise-driven drift every frame.
const sliceLineMat = new THREE.LineBasicMaterial({ color: 0x4f8ef7 });

// --- Segment Circles ---
// One blue circle per line segment: diameter equal to the segment's
// length, centered on the segment's midpoint.
const segmentCircleMat = new THREE.LineBasicMaterial({ color: 0x4f8ef7 });

// --- Red Path ---
// Alternates between each green circle's outward-facing arc (outside
// the white circle) and each blue circle's inward-facing arc (inside
// the white circle). Since the blue circle's diameter is exactly the
// segment between two green circles' edges, blue is tangent to both
// neighboring green circles at those edge points -- so those points
// double as the transition points, no intersection math required.
const RED_ARC_SEGMENTS = 10;
// Fat-line material: real pixel-width lines (LineBasicMaterial.linewidth
// is ignored by almost all browsers due to a WebGL limitation).
//
// The path is drawn in two arc segments per slice (green arc + blue arc)
// via Line2, which extends each segment slightly at the joints so there
// are no gaps between segments. With transparent+opacity<1 those tiny
// joint overlaps blend on top of each other and double up the alpha,
// making the joints look darker/more opaque than the rest of the line.
// Fix: render the path fully opaque into an offscreen render target
// (overlapping opaque draws just overwrite each other, no compounding),
// then composite that flattened result onto the scene once at the
// target opacity, so the opacity is uniform everywhere.
const redPathMat = new LineMaterial({
  color: 0xff0000,
  linewidth: 1,
  transparent: false,
  opacity: 1,
});
redPathMat.resolution.set(container.clientWidth, container.clientHeight);

// Offscreen scene + render target that the red path is drawn into.
const redOnlyScene = new THREE.Scene();
const RED_PATH_OPACITY = 0.4;
const redRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
  format: THREE.RGBAFormat,
});

// Full-screen NDC quad that composites the red-path render target onto
// the main scene in a single blended pass.
const compositeScene = new THREE.Scene();
const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const compositeMat = new THREE.MeshBasicMaterial({
  map: redRenderTarget.texture,
  transparent: true,
  opacity: RED_PATH_OPACITY,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
});
const compositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMat);
compositeScene.add(compositeQuad);

function resizeRedRenderTarget() {
  const pr = renderer.getPixelRatio();
  redRenderTarget.setSize(
    Math.max(1, Math.round(container.clientWidth * pr)),
    Math.max(1, Math.round(container.clientHeight * pr))
  );
}
resizeRedRenderTarget();

// --- Orange Path ---
// The inverse of the red path: green's inward-facing arc (inside the
// white circle) alternating with blue's outward-facing arc (outside
// the white circle). Same tangent points as red, opposite arc on each
// circle. Uses the same offscreen-render-target compositing technique
// as the red path, for the same uniform-opacity reason.
const ORANGE_ARC_SEGMENTS = RED_ARC_SEGMENTS;
const orangePathMat = new LineMaterial({
  color: 0xff8800,
  linewidth: 1,
  transparent: false,
  opacity: 1,
});
orangePathMat.resolution.set(container.clientWidth, container.clientHeight);

const orangeOnlyScene = new THREE.Scene();
const ORANGE_PATH_OPACITY = 0.4;
const orangeRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
  format: THREE.RGBAFormat,
});

const compositeMatOrange = new THREE.MeshBasicMaterial({
  map: orangeRenderTarget.texture,
  transparent: true,
  opacity: ORANGE_PATH_OPACITY,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
});
const compositeQuadOrange = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMatOrange);
compositeScene.add(compositeQuadOrange);

function resizeOrangeRenderTarget() {
  const pr = renderer.getPixelRatio();
  orangeRenderTarget.setSize(
    Math.max(1, Math.round(container.clientWidth * pr)),
    Math.max(1, Math.round(container.clientHeight * pr))
  );
}
resizeOrangeRenderTarget();

// --- Red Skin ---
// A double-sided surface stitched between the red paths of every stacked
// cross section. Grid rows = cross sections; grid columns = the red
// path's own vertices within one cross section (wrapped around, since
// the path is a closed loop -- the duplicate closing point the Line2
// geometry carries is excluded here so the wrap uses modulo instead of
// a degenerate zero-width seam quad). No render-target trick needed
// here (unlike the red/orange lines): this is one continuous mesh, not
// overlapping line segments, so ordinary alpha blending is fine.
//
// Fully opaque and lit (MeshStandardMaterial) rather than flat-shaded,
// so it picks up the scene's directional lights -- visible highlights
// and shadowed folds across the surface's curvature. Since the surface
// reshapes every frame, vertex normals are recomputed every frame too
// (in updateRedSkin), not just once at build time.
const redSkinMat = new THREE.MeshStandardMaterial({
  color: 0xff0000,
  roughness: 0.5,
  metalness: 0.1,
  side: THREE.DoubleSide,
});
let redSkinGeo;
let redSkinMesh;
let redSkinCols = 0; // vertices per row, i.e. per cross section's red path

function rebuildRedSkin() {
  if (redSkinMesh) {
    scene.remove(redSkinMesh);
    redSkinGeo.dispose();
  }
  const pointsPerSlice = 2 * (RED_ARC_SEGMENTS + 1);
  redSkinCols = params.slices * pointsPerSlice;
  const rows = params.crossSections;

  redSkinGeo = new THREE.BufferGeometry();
  redSkinGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rows * redSkinCols * 3), 3));

  const indices = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < redSkinCols; c++) {
      const cNext = (c + 1) % redSkinCols;
      const a = r * redSkinCols + c;
      const b = r * redSkinCols + cNext;
      const nextRowA = (r + 1) * redSkinCols + c;
      const nextRowB = (r + 1) * redSkinCols + cNext;
      indices.push(a, b, nextRowA);
      indices.push(b, nextRowB, nextRowA);
    }
  }
  redSkinGeo.setIndex(indices);

  redSkinMesh = new THREE.Mesh(redSkinGeo, redSkinMat);
  scene.add(redSkinMesh);
}

// Reuses this frame's already-computed per-cross-section red path data
// (crossRedPathFlats) and group Y offsets -- no extra geometry math.
function updateRedSkin() {
  if (!redSkinMesh) return;
  const pos = redSkinGeo.attributes.position;
  for (let r = 0; r < crossRedPathFlats.length; r++) {
    const flat = crossRedPathFlats[r];
    const y = crossRedGroups[r].position.y;
    const base = r * redSkinCols;
    for (let c = 0; c < redSkinCols; c++) {
      pos.setXYZ(base + c, flat[c * 3], y, flat[c * 3 + 2]);
    }
  }
  pos.needsUpdate = true;
  redSkinGeo.computeVertexNormals();
}

function normalizeAngle(a) {
  const twoPi = Math.PI * 2;
  a = a % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

// --- Cross Sections ---
// Per-cross-section instances (Object3D wrappers). crossRadiusCubes/
// crossSliceCircles/crossSegmentCircles are arrays of arrays (one inner
// array of per-slice instances per cross section); everything else is
// one instance (and, for slice line / red / orange, one owned geometry)
// per cross section, since frequency/spread can differ per cross
// section and each therefore needs its own position data.
let crossGroups = [];
let crossRedGroups = [];
let crossOrangeGroups = [];
let crossArcs = [];
let crossRadiusCubes = [];
let crossSliceCircles = [];
let crossSegmentCircles = [];
let crossSliceLines = [];
let crossSliceLineGeos = [];
let crossRedPaths = [];
let crossRedPathGeos = [];
let crossRedPathFlats = [];
let crossOrangePaths = [];
let crossOrangePathGeos = [];
let crossOrangePathFlats = [];

const CROSS_BASE_Y = -1;

function updateCrossPositions() {
  const spread = params.crossSpread;
  for (let c = 0; c < crossGroups.length; c++) {
    const y = CROSS_BASE_Y - c * spread;
    crossGroups[c].position.y = y;
    crossRedGroups[c].position.y = y;
    crossOrangeGroups[c].position.y = y;
  }
}

function clearCrossSections() {
  crossGroups.forEach((g) => scene.remove(g));
  crossRedGroups.forEach((g) => redOnlyScene.remove(g));
  crossOrangeGroups.forEach((g) => orangeOnlyScene.remove(g));
  crossSliceLineGeos.forEach((g) => g.dispose());
  crossRedPathGeos.forEach((g) => g.dispose());
  crossOrangePathGeos.forEach((g) => g.dispose());

  crossGroups = [];
  crossRedGroups = [];
  crossOrangeGroups = [];
  crossArcs = [];
  crossRadiusCubes = [];
  crossSliceCircles = [];
  crossSegmentCircles = [];
  crossSliceLines = [];
  crossSliceLineGeos = [];
  crossRedPaths = [];
  crossRedPathGeos = [];
  crossRedPathFlats = [];
  crossOrangePaths = [];
  crossOrangePathGeos = [];
  crossOrangePathFlats = [];
}

function rebuildCrossSections() {
  const slices = params.slices;
  const crossSections = params.crossSections;

  clearCrossSections();

  for (let c = 0; c < crossSections; c++) {
    const group = new THREE.Group();
    scene.add(group);
    crossGroups.push(group);

    const crossArc = new THREE.LineLoop(arcGeo, arcMat);
    crossArc.name = 'main circle';
    group.add(crossArc);
    crossArcs.push(crossArc);

    const cubes = [];
    const circles = [];
    const segCircles = [];
    for (let i = 0; i < slices; i++) {
      const radiusCube = new THREE.LineSegments(radiusCubeEdgesGeo, radiusCubeMat);
      radiusCube.scale.setScalar(0.2);
      group.add(radiusCube);
      cubes.push(radiusCube);

      const sliceCircle = new THREE.LineLoop(sliceCircleGeo, sliceCircleMat);
      group.add(sliceCircle);
      circles.push(sliceCircle);

      const segmentCircle = new THREE.LineLoop(sliceCircleGeo, segmentCircleMat);
      group.add(segmentCircle);
      segCircles.push(segmentCircle);
    }
    crossRadiusCubes.push(cubes);
    crossSliceCircles.push(circles);
    crossSegmentCircles.push(segCircles);

    const sliceLineGeo = new THREE.BufferGeometry();
    sliceLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(slices * 2 * 3), 3));
    const sliceLine = new THREE.LineSegments(sliceLineGeo, sliceLineMat);
    group.add(sliceLine);
    crossSliceLines.push(sliceLine);
    crossSliceLineGeos.push(sliceLineGeo);

    const redPointsPerSlice = 2 * (RED_ARC_SEGMENTS + 1);
    const redPointCount = slices * redPointsPerSlice + 1; // +1 to close the loop
    const redPathFlat = new Float32Array(redPointCount * 3);
    const redPathGeo = new LineGeometry();
    redPathGeo.setPositions(redPathFlat);
    const redGroup = new THREE.Group();
    redOnlyScene.add(redGroup);
    crossRedGroups.push(redGroup);
    const redPathInstance = new Line2(redPathGeo, redPathMat);
    redGroup.add(redPathInstance);
    crossRedPaths.push(redPathInstance);
    crossRedPathGeos.push(redPathGeo);
    crossRedPathFlats.push(redPathFlat);

    const orangePointsPerSlice = 2 * (ORANGE_ARC_SEGMENTS + 1);
    const orangePointCount = slices * orangePointsPerSlice + 1; // +1 to close the loop
    const orangePathFlat = new Float32Array(orangePointCount * 3);
    const orangePathGeo = new LineGeometry();
    orangePathGeo.setPositions(orangePathFlat);
    const orangeGroup = new THREE.Group();
    orangeOnlyScene.add(orangeGroup);
    crossOrangeGroups.push(orangeGroup);
    const orangePathInstance = new Line2(orangePathGeo, orangePathMat);
    orangeGroup.add(orangePathInstance);
    crossOrangePaths.push(orangePathInstance);
    crossOrangePathGeos.push(orangePathGeo);
    crossOrangePathFlats.push(orangePathFlat);
  }

  rebuildRedSkin();
  applyViewVisibility();
  updateCrossPositions();
}

function applyViewVisibility() {
  crossArcs.forEach((a) => (a.visible = viewParams.showWhite));
  crossSliceCircles.forEach((arr) => arr.forEach((c) => (c.visible = viewParams.showGreen)));
  crossSliceLines.forEach((l) => (l.visible = viewParams.showBlue));
  crossSegmentCircles.forEach((arr) => arr.forEach((c) => (c.visible = viewParams.showBlue)));
  crossRedPaths.forEach((p) => (p.visible = viewParams.showRed));
  crossOrangePaths.forEach((p) => (p.visible = viewParams.showOrange));
  crossRadiusCubes.forEach((arr) => arr.forEach((c) => (c.visible = viewParams.showCubes)));
  box.visible = viewParams.showCubes;
  if (redSkinMesh) redSkinMesh.visible = viewParams.showSkin;
}

rebuildCrossSections();

// Noise-driven slice angle: normalized simplex noise blended within each
// slice's angular slot, so cubes can drift but never cross a neighbor.
// freq/spreadParam are passed in (rather than read from params directly)
// since each cross section computes its own, offset by its index.
function computeSliceAngle(i, count, t, freq, spreadParam) {
  const baseAngle = (i / count) * Math.PI * 2;
  const slotWidth = (Math.PI * 2) / count;
  const margin = slotWidth * 0.5 * spreadParam;
  const n = noise2D(i * freq + params.noiseOffset, t * params.noiseSpeed);
  const normalized = (n + 1) / 2;
  return baseAngle - margin + normalized * (2 * margin);
}

// Cross sections sample a second, independent noise channel (offset far
// from the per-slice noise's input range so the two don't correlate) to
// drive spread per level -- an organic per-level wobble instead of a
// straight c * crossSpreadStep ramp.
const CROSS_SPREAD_NOISE_OFFSET = 1000;

// Computes and applies one cross section's full geometry for this frame:
// slice positions/radii, connecting segments, and the red/orange paths.
function updateCrossSectionGeometry(c, t) {
  const r = params.radius;
  const count = params.slices;
  const freq = params.noiseFrequency + c * params.crossFrequencyStep;
  const spreadNoise = noise2D(CROSS_SPREAD_NOISE_OFFSET + c, t * params.noiseSpeed);
  const spreadParam = params.spread + ((spreadNoise + 1) / 2) * params.crossSpreadStep;

  const positions = [];
  const sliceAngles = [];
  for (let i = 0; i < count; i++) {
    const angle = computeSliceAngle(i, count, t, freq, spreadParam);
    sliceAngles.push(angle);
    positions.push({ x: r * Math.cos(angle), z: r * Math.sin(angle) });
  }

  const cubes = crossRadiusCubes[c];
  const circles = crossSliceCircles[c];
  const radii = [];
  for (let i = 0; i < count; i++) {
    const { x, z } = positions[i];

    // Circle radius is driven by proximity to whichever neighbor is
    // closer, so it can never grow large enough to touch either one.
    const prev = positions[(i - 1 + count) % count];
    const next = positions[(i + 1) % count];
    const distPrev = Math.hypot(x - prev.x, z - prev.z);
    const distNext = Math.hypot(x - next.x, z - next.z);
    const minDist = Math.min(distPrev, distNext);
    const safeRadius = (minDist / 2) * params.radiusFill;
    const clamped = THREE.MathUtils.clamp(safeRadius, params.minCircleRadius, params.maxCircleRadius);
    radii.push(clamped);

    cubes[i].position.set(x, 0, z);
    circles[i].position.set(x, 0, z);
    circles[i].scale.setScalar(clamped);
  }

  // Each segment runs from one circle's edge to the next circle's edge
  // (along the line between their centers), not center-to-center.
  const segStartX = new Array(count);
  const segStartZ = new Array(count);
  const segEndX = new Array(count);
  const segEndZ = new Array(count);
  const segMidX = new Array(count);
  const segMidZ = new Array(count);
  const segRadius = new Array(count);

  const segCircles = crossSegmentCircles[c];
  const linePos = crossSliceLineGeos[c].attributes.position;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    const a = positions[i];
    const b = positions[next];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz) || 1;
    const dirX = dx / dist;
    const dirZ = dz / dist;
    const startX = a.x + dirX * radii[i];
    const startZ = a.z + dirZ * radii[i];
    const endX = b.x - dirX * radii[next];
    const endZ = b.z - dirZ * radii[next];
    linePos.setXYZ(i * 2, startX, 0, startZ);
    linePos.setXYZ(i * 2 + 1, endX, 0, endZ);

    // Blue circle per segment: diameter = segment length, centered on
    // the segment's midpoint.
    const segLength = Math.hypot(endX - startX, endZ - startZ);
    const midX = (startX + endX) / 2;
    const midZ = (startZ + endZ) / 2;
    segCircles[i].position.set(midX, 0, midZ);
    segCircles[i].scale.setScalar(segLength / 2);

    segStartX[i] = startX;
    segStartZ[i] = startZ;
    segEndX[i] = endX;
    segEndZ[i] = endZ;
    segMidX[i] = midX;
    segMidZ[i] = midZ;
    segRadius[i] = segLength / 2;
  }
  linePos.needsUpdate = true;

  // --- Red Path ---
  // Per slice: green's outward arc (from the tangent point with the
  // previous blue circle to the tangent point with the next blue
  // circle, taking the side away from the white circle's center),
  // then that same blue circle's inward arc (taking the side toward
  // the center).
  const redPathFlat = crossRedPathFlats[c];
  let w = 0;
  function pushRedPoint(x, z) {
    redPathFlat[w * 3] = x;
    redPathFlat[w * 3 + 1] = 0;
    redPathFlat[w * 3 + 2] = z;
    w++;
  }
  // --- Orange Path ---
  // The inverse of red: same tangent points, but green's inward arc
  // (toward the center) then blue's outward arc (away from the center).
  const orangePathFlat = crossOrangePathFlats[c];
  let wOrange = 0;
  function pushOrangePoint(x, z) {
    orangePathFlat[wOrange * 3] = x;
    orangePathFlat[wOrange * 3 + 1] = 0;
    orangePathFlat[wOrange * 3 + 2] = z;
    wOrange++;
  }
  for (let i = 0; i < count; i++) {
    const prevSeg = (i - 1 + count) % count;
    const gcx = positions[i].x;
    const gcz = positions[i].z;
    const gr = radii[i];
    const entryX = segEndX[prevSeg];
    const entryZ = segEndZ[prevSeg];
    const exitX = segStartX[i];
    const exitZ = segStartZ[i];
    const gAngleA = Math.atan2(entryZ - gcz, entryX - gcx);
    const gAngleB = Math.atan2(exitZ - gcz, exitX - gcx);
    const gPreferAngle = sliceAngles[i]; // outward direction from origin
    const gDiffAB = normalizeAngle(gAngleB - gAngleA);
    const gDiffAP = normalizeAngle(gPreferAngle - gAngleA);
    const gExtent = gDiffAP <= gDiffAB ? gDiffAB : gDiffAB - Math.PI * 2;
    for (let s = 0; s <= RED_ARC_SEGMENTS; s++) {
      const ang = gAngleA + (gExtent * s) / RED_ARC_SEGMENTS;
      pushRedPoint(gcx + gr * Math.cos(ang), gcz + gr * Math.sin(ang));
    }

    // Green's complementary arc: same tangent points, opposite side
    // (toward the center instead of away from it).
    const gPreferAngleOrange = normalizeAngle(gPreferAngle + Math.PI);
    const gDiffAPOrange = normalizeAngle(gPreferAngleOrange - gAngleA);
    const gExtentOrange = gDiffAPOrange <= gDiffAB ? gDiffAB : gDiffAB - Math.PI * 2;
    for (let s = 0; s <= ORANGE_ARC_SEGMENTS; s++) {
      const ang = gAngleA + (gExtentOrange * s) / ORANGE_ARC_SEGMENTS;
      pushOrangePoint(gcx + gr * Math.cos(ang), gcz + gr * Math.sin(ang));
    }

    const bcx = segMidX[i];
    const bcz = segMidZ[i];
    const br = segRadius[i];
    const bAngleA = Math.atan2(segStartZ[i] - bcz, segStartX[i] - bcx);
    const bAngleB = Math.atan2(segEndZ[i] - bcz, segEndX[i] - bcx);
    const bPreferAngle = Math.atan2(bcz, bcx) + Math.PI; // toward origin
    const bDiffAB = normalizeAngle(bAngleB - bAngleA);
    const bDiffAP = normalizeAngle(bPreferAngle - bAngleA);
    const bExtent = bDiffAP <= bDiffAB ? bDiffAB : bDiffAB - Math.PI * 2;
    for (let s = 0; s <= RED_ARC_SEGMENTS; s++) {
      const ang = bAngleA + (bExtent * s) / RED_ARC_SEGMENTS;
      pushRedPoint(bcx + br * Math.cos(ang), bcz + br * Math.sin(ang));
    }

    // Blue's complementary arc: same tangent points, opposite side
    // (away from the center instead of toward it).
    const bPreferAngleOrange = normalizeAngle(bPreferAngle + Math.PI);
    const bDiffAPOrange = normalizeAngle(bPreferAngleOrange - bAngleA);
    const bExtentOrange = bDiffAPOrange <= bDiffAB ? bDiffAB : bDiffAB - Math.PI * 2;
    for (let s = 0; s <= ORANGE_ARC_SEGMENTS; s++) {
      const ang = bAngleA + (bExtentOrange * s) / ORANGE_ARC_SEGMENTS;
      pushOrangePoint(bcx + br * Math.cos(ang), bcz + br * Math.sin(ang));
    }
  }
  // Close the loop by repeating the first point.
  redPathFlat[w * 3] = redPathFlat[0];
  redPathFlat[w * 3 + 1] = redPathFlat[1];
  redPathFlat[w * 3 + 2] = redPathFlat[2];
  crossRedPathGeos[c].setPositions(redPathFlat);
  crossRedPaths[c].computeLineDistances();

  orangePathFlat[wOrange * 3] = orangePathFlat[0];
  orangePathFlat[wOrange * 3 + 1] = orangePathFlat[1];
  orangePathFlat[wOrange * 3 + 2] = orangePathFlat[2];
  crossOrangePathGeos[c].setPositions(orangePathFlat);
  crossOrangePaths[c].computeLineDistances();
}

function updateRadiusCubePositions(t) {
  for (let c = 0; c < crossGroups.length; c++) {
    updateCrossSectionGeometry(c, t);
  }
  updateRedSkin();
}

// --- Debug Text ---
const debugCanvas = document.createElement('canvas');
debugCanvas.width = 256;
debugCanvas.height = 128;
const debugCtx = debugCanvas.getContext('2d');
debugCtx.font = 'bold 64px monospace';
debugCtx.fillStyle = '#ffffff';
debugCtx.textAlign = 'center';
debugCtx.textBaseline = 'middle';
debugCtx.fillText('main', debugCanvas.width / 2, debugCanvas.height / 2);

const debugTexture = new THREE.CanvasTexture(debugCanvas);
const debugPlaneGeo = new THREE.PlaneGeometry(1, 0.5);
const debugPlaneMat = new THREE.MeshBasicMaterial({
  map: debugTexture,
  transparent: true,
  side: THREE.DoubleSide,
});
const debugPlane = new THREE.Mesh(debugPlaneGeo, debugPlaneMat);
debugPlane.rotation.x = -Math.PI / 2;

const debugText = new THREE.Group();
debugText.name = 'debug text';
debugText.position.set(-(params.radius + 0.5), -0.99, 0);
debugText.add(debugPlane);
scene.add(debugText);

// --- GUI ---
function updateRadius(r) {
  arcGeo.setFromPoints(computeArcPoints(r));
  debugText.position.x = -(r + 0.5);
}

function updateSlices() {
  rebuildCrossSections();
}

function updateCrossSectionsCount() {
  rebuildCrossSections();
}

const gui = new GUI({ width: 400 });
const mainFolder = gui.addFolder('Main');
mainFolder.add(params, 'radius', 1, 10, 0.1).name('Radius').onChange(updateRadius);
mainFolder.add(params, 'slices', 3, 30, 1).name('Slices').onChange(updateSlices);
mainFolder.add(params, 'crossSections', 3, 30, 1).name('Total Cross Sections').onChange(updateCrossSectionsCount);

const slicesFolder = gui.addFolder('Slices');
slicesFolder.add(params, 'noiseFrequency', 0.05, 2, 0.01).name('Frequency');
slicesFolder.add(params, 'noiseSpeed', 0, 2, 0.01).name('Speed');
slicesFolder.add(params, 'noiseOffset', 0, 10, 0.1).name('Offset');
slicesFolder.add(params, 'spread', 0, 1, 0.01).name('Spread');
slicesFolder.add(params, 'radiusFill', 0, 1, 0.01).name('Fill');
slicesFolder.add(params, 'minCircleRadius', 0.01, 1, 0.01).name('Min Radius');
slicesFolder.add(params, 'maxCircleRadius', 0.1, 3, 0.01).name('Max Radius');

// --- Crosses ---
const crossesFolder = gui.addFolder('Crosses');
crossesFolder.add(params, 'crossSpread', 0, 5, 0.01).name('Spread').onChange(updateCrossPositions);
// Per-cross-section variation: cross section c uses
// (noiseFrequency + c * crossFrequencyStep) for frequency (a straight
// ramp up the stack) and (spread + simplex(c) * crossSpreadStep) for
// spread (an organic per-level wobble, not a ramp).
crossesFolder.add(params, 'crossFrequencyStep', 0, 5, 0.01).name('Frequency Step');
crossesFolder.add(params, 'crossSpreadStep', 0, 5, 0.01).name('Spread Step');

// --- Views ---
const viewsFolder = gui.addFolder('Views');
viewsFolder.add(viewParams, 'showWhite').name('White (Main Circle)').onChange(applyViewVisibility);
viewsFolder.add(viewParams, 'showGreen').name('Green (Slice Circles)').onChange(applyViewVisibility);
viewsFolder.add(viewParams, 'showBlue').name('Blue (Segments)').onChange(applyViewVisibility);
viewsFolder.add(viewParams, 'showRed').name('Red (Path)').onChange(applyViewVisibility);
viewsFolder.add(viewParams, 'showSkin').name('Red Skin').onChange(applyViewVisibility);
viewsFolder.add(viewParams, 'showOrange').name('Orange (Inverse Path)').onChange(applyViewVisibility);
viewsFolder.add(viewParams, 'showCubes').name('Cubes').onChange(applyViewVisibility);

// --- Lighting ---
scene.add(new THREE.AmbientLight(0xffffff, 0.4));

const dirLight = new THREE.DirectionalLight(0x4f8ef7, 2);
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
backLight.position.set(-5, -2, -5);
scene.add(backLight);

// --- Resize ---
new ResizeObserver(() => {
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  redPathMat.resolution.set(w, h);
  resizeRedRenderTarget();
  orangePathMat.resolution.set(w, h);
  resizeOrangeRenderTarget();
}).observe(container);

// --- Animate ---
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  updateRadiusCubePositions(clock.getElapsedTime());
  controls.update();

  // Pass 1: draw the red path, fully opaque, into an offscreen target.
  // Overlapping joint geometry just overwrites itself here -- no alpha
  // compounding since the material is not transparent.
  renderer.setRenderTarget(redRenderTarget);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);
  renderer.render(redOnlyScene, camera);

  renderer.setRenderTarget(orangeRenderTarget);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);
  renderer.render(orangeOnlyScene, camera);

  // Pass 2: draw the main scene normally.
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x001233, 1);
  renderer.render(scene, camera);

  // Pass 3: composite the flattened red path on top at uniform opacity.
  renderer.autoClear = false;
  renderer.render(compositeScene, compositeCamera);
  renderer.autoClear = true;
}
animate();
