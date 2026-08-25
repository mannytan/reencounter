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
scene.add(ground);

// --- Box ---
const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);

const material = new THREE.MeshStandardMaterial({
  color: 0x1a1a2e,
  roughness: 0.4,
  metalness: 0.8,
});
const box = new THREE.Mesh(geometry, material);
box.position.x = 2;
box.scale.setScalar(0.25);
scene.add(box);

const edgesGeo = new THREE.EdgesGeometry(geometry);
const edgesMat = new THREE.LineBasicMaterial({ color: 0x4f8ef7 });
const wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
box.add(wireframe);

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
