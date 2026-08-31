import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const container = document.getElementById('threejs-container');
const canvas = document.getElementById('threejs-canvas');

// --- Scene ---
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x001233, 10, 30);

const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100);
camera.position.set(3, 2.5, 4);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x001233);

// --- Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.5;
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 10;

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
const totalPoints = 24;
const radius = 2;
const arcPoints = [];
for (let i = 0; i < totalPoints; i++) {
  const t = i / totalPoints;
  const angle = t * Math.PI * 2;
  const x = radius * Math.cos(angle);
  const z = radius * Math.sin(angle);
  arcPoints.push(new THREE.Vector3(x, -1, z));
}
const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
const arcMat = new THREE.LineBasicMaterial({ color: 0xffffff });
const arc = new THREE.LineLoop(arcGeo, arcMat);
scene.add(arc);

// --- Radius Cubes ---
const radiusCubeCount = 10;
const radiusCubeGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
const radiusCubeEdgesGeo = new THREE.EdgesGeometry(radiusCubeGeo);
const radiusCubeMat = new THREE.LineBasicMaterial({ color: 0x00ff00 });
for (let i = 0; i < radiusCubeCount; i++) {
  const angle = (i / radiusCubeCount) * Math.PI * 2;
  const radiusCube = new THREE.LineSegments(radiusCubeEdgesGeo, radiusCubeMat);
  radiusCube.scale.setScalar(0.2);
  radiusCube.position.set(radius * Math.cos(angle), -1, radius * Math.sin(angle));
  scene.add(radiusCube);
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
debugText.position.set(-2.5, -0.99, 0);
debugText.add(debugPlane);
scene.add(debugText);

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
}).observe(container);

// --- Animate ---
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
