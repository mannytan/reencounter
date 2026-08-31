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
scene.fog = new THREE.Fog(0x001233, 10, 30);

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
};
const noise2D = createNoise2D();

function computeArcPoints(r) {
  const points = [];
  for (let i = 0; i < totalPoints; i++) {
    const t = i / totalPoints;
    const angle = t * Math.PI * 2;
    points.push(new THREE.Vector3(r * Math.cos(angle), -1, r * Math.sin(angle)));
  }
  return points;
}

const arcGeo = new THREE.BufferGeometry().setFromPoints(computeArcPoints(params.radius));
const arcMat = new THREE.LineBasicMaterial({ color: 0xffffff });
const arc = new THREE.LineLoop(arcGeo, arcMat);
arc.name = 'main circle';
scene.add(arc);

// --- Radius Cubes ---
const radiusCubeGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const radiusCubeEdgesGeo = new THREE.EdgesGeometry(radiusCubeGeo);
const radiusCubeMat = new THREE.LineBasicMaterial({ color: 0x00ff00 });
let radiusCubes = [];

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
let sliceCircles = [];

// --- Slice Line ---
// Connects each slice's live position to the next, forming a closed
// loop that follows the noise-driven drift every frame.
const sliceLineMat = new THREE.LineBasicMaterial({ color: 0x4f8ef7 });
let sliceLineGeo;
let sliceLine;

function rebuildSliceLine(count) {
  if (sliceLine) {
    scene.remove(sliceLine);
    sliceLineGeo.dispose();
  }
  sliceLineGeo = new THREE.BufferGeometry();
  sliceLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
  sliceLine = new THREE.LineSegments(sliceLineGeo, sliceLineMat);
  scene.add(sliceLine);
}

// --- Segment Circles ---
// One blue circle per line segment: diameter equal to the segment's
// length, centered on the segment's midpoint.
const segmentCircleMat = new THREE.LineBasicMaterial({ color: 0x4f8ef7 });
let segmentCircles = [];

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
  linewidth: 5,
  transparent: false,
  opacity: 1,
});
redPathMat.resolution.set(container.clientWidth, container.clientHeight);
let redPathGeo;
let redPath;
let redPathFlat; // reused each frame: [x0,y0,z0, x1,y1,z1, ..., x0,y0,z0] (closed)

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

function normalizeAngle(a) {
  const twoPi = Math.PI * 2;
  a = a % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

function rebuildRedPath(count) {
  if (redPath) {
    redOnlyScene.remove(redPath);
    redPathGeo.dispose();
  }
  const pointsPerSlice = 2 * (RED_ARC_SEGMENTS + 1);
  const pointCount = count * pointsPerSlice + 1; // +1 to close the loop
  redPathFlat = new Float32Array(pointCount * 3);
  redPathGeo = new LineGeometry();
  redPathGeo.setPositions(redPathFlat);
  redPath = new Line2(redPathGeo, redPathMat);
  redPath.computeLineDistances();
  redOnlyScene.add(redPath);
}

function rebuildRadiusCubes(count) {
  radiusCubes.forEach((cube) => scene.remove(cube));
  sliceCircles.forEach((circle) => scene.remove(circle));
  segmentCircles.forEach((circle) => scene.remove(circle));
  radiusCubes = [];
  sliceCircles = [];
  segmentCircles = [];
  for (let i = 0; i < count; i++) {
    const radiusCube = new THREE.LineSegments(radiusCubeEdgesGeo, radiusCubeMat);
    radiusCube.scale.setScalar(0.2);
    radiusCubes.push(radiusCube);
    scene.add(radiusCube);

    const sliceCircle = new THREE.LineLoop(sliceCircleGeo, sliceCircleMat);
    sliceCircles.push(sliceCircle);
    scene.add(sliceCircle);

    const segmentCircle = new THREE.LineLoop(sliceCircleGeo, segmentCircleMat);
    segmentCircles.push(segmentCircle);
    scene.add(segmentCircle);
  }
  rebuildSliceLine(count);
  rebuildRedPath(count);
}
rebuildRadiusCubes(params.slices);

// Noise-driven slice angle: normalized simplex noise blended within each
// slice's angular slot, so cubes can drift but never cross a neighbor.
function computeSliceAngle(i, count, t) {
  const baseAngle = (i / count) * Math.PI * 2;
  const slotWidth = (Math.PI * 2) / count;
  const margin = slotWidth * 0.5 * params.spread;
  const n = noise2D(i * params.noiseFrequency + params.noiseOffset, t * params.noiseSpeed);
  const normalized = (n + 1) / 2;
  return baseAngle - margin + normalized * (2 * margin);
}

function updateRadiusCubePositions(t) {
  const r = params.radius;
  const count = params.slices;

  const positions = [];
  const sliceAngles = [];
  for (let i = 0; i < count; i++) {
    const angle = computeSliceAngle(i, count, t);
    sliceAngles.push(angle);
    positions.push({ x: r * Math.cos(angle), z: r * Math.sin(angle) });
  }

  const radii = [];
  for (let i = 0; i < count; i++) {
    const { x, z } = positions[i];
    radiusCubes[i].position.set(x, -1, z);
    sliceCircles[i].position.set(x, -1, z);

    // Circle radius is driven by proximity to whichever neighbor is
    // closer, so it can never grow large enough to touch either one.
    const prev = positions[(i - 1 + count) % count];
    const next = positions[(i + 1) % count];
    const distPrev = Math.hypot(x - prev.x, z - prev.z);
    const distNext = Math.hypot(x - next.x, z - next.z);
    const minDist = Math.min(distPrev, distNext);
    const safeRadius = (minDist / 2) * params.radiusFill;
    const clamped = THREE.MathUtils.clamp(safeRadius, params.minCircleRadius, params.maxCircleRadius);
    sliceCircles[i].scale.setScalar(clamped);
    radii.push(clamped);
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

  const linePos = sliceLine.geometry.attributes.position;
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
    linePos.setXYZ(i * 2, startX, -1, startZ);
    linePos.setXYZ(i * 2 + 1, endX, -1, endZ);

    // Blue circle per segment: diameter = segment length, centered on
    // the segment's midpoint.
    const segLength = Math.hypot(endX - startX, endZ - startZ);
    const midX = (startX + endX) / 2;
    const midZ = (startZ + endZ) / 2;
    segmentCircles[i].position.set(midX, -1, midZ);
    segmentCircles[i].scale.setScalar(segLength / 2);

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
  let w = 0;
  function pushRedPoint(x, z) {
    redPathFlat[w * 3] = x;
    redPathFlat[w * 3 + 1] = -1;
    redPathFlat[w * 3 + 2] = z;
    w++;
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
  }
  // Close the loop by repeating the first point.
  redPathFlat[w * 3] = redPathFlat[0];
  redPathFlat[w * 3 + 1] = redPathFlat[1];
  redPathFlat[w * 3 + 2] = redPathFlat[2];
  redPath.geometry.setPositions(redPathFlat);
  redPath.computeLineDistances();
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
  arc.geometry.dispose();
  arc.geometry = new THREE.BufferGeometry().setFromPoints(computeArcPoints(r));
  debugText.position.x = -(r + 0.5);
}

function updateSlices(count) {
  rebuildRadiusCubes(count);
}

const gui = new GUI({ width: 400 });
const mainFolder = gui.addFolder('Main');
mainFolder.add(params, 'radius', 1, 10, 0.1).name('Radius').onChange(updateRadius);

const slicesFolder = gui.addFolder('Slices');
slicesFolder.add(params, 'slices', 3, 30, 1).name('Slices').onChange(updateSlices);
slicesFolder.add(params, 'noiseFrequency', 0.05, 2, 0.01).name('Frequency');
slicesFolder.add(params, 'noiseSpeed', 0, 2, 0.01).name('Speed');
slicesFolder.add(params, 'noiseOffset', 0, 10, 0.1).name('Offset');
slicesFolder.add(params, 'spread', 0, 1, 0.01).name('Spread');
slicesFolder.add(params, 'radiusFill', 0, 1, 0.01).name('Fill');
slicesFolder.add(params, 'minCircleRadius', 0.01, 1, 0.01).name('Min Radius');
slicesFolder.add(params, 'maxCircleRadius', 0.1, 3, 0.01).name('Max Radius');

// --- Box ---
const geometry = new THREE.BoxGeometry(1, 1, 1);

const edgesGeo = new THREE.EdgesGeometry(geometry);
const edgesMat = new THREE.LineBasicMaterial({ color: 0x4f8ef7 });
const box = new THREE.LineSegments(edgesGeo, edgesMat);
box.position.x = 2;
scene.add(box);

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
