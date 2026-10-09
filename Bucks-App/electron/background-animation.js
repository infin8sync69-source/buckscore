// background-animation.js - Space Theme
try {
  console.log('[Animation] Starting Space Theme...');
  const scene = new THREE.Scene();
  // We want the camera to look straight at the scene
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.z = 1000;

  // Render to the specific canvas
  const canvas = document.getElementById('three-bg-canvas');
  if (!canvas) console.error('[Animation] Canvas not found!');
  
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  } catch (e) {
    console.warn('[Animation] Failed with antialias, trying without...', e);
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: false });
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Particles / Stars
  const starCount = 3000;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);

  const color1 = new THREE.Color(0xa978ff); // Purple
  const color2 = new THREE.Color(0x78a9ff); // Blue
  const color3 = new THREE.Color(0xffffff); // White

  for (let i = 0; i < starCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 4000;     // x
    positions[i * 3 + 1] = (Math.random() - 0.5) * 4000; // y
    positions[i * 3 + 2] = (Math.random() - 0.5) * 4000; // z

    const mixedColor = [color1, color2, color3][Math.floor(Math.random() * 3)];
    colors[i * 3] = mixedColor.r;
    colors[i * 3 + 1] = mixedColor.g;
    colors[i * 3 + 2] = mixedColor.b;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 3,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true
  });

  const stars = new THREE.Points(geometry, material);
  scene.add(stars);

  let mouseX = 0;
  let mouseY = 0;
  let targetX = 0;
  let targetY = 0;
  const windowHalfX = window.innerWidth / 2;
  const windowHalfY = window.innerHeight / 2;

  document.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX - windowHalfX);
    mouseY = (event.clientY - windowHalfY);
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }, false);

  function animate() {
    requestAnimationFrame(animate);

    targetX = mouseX * 0.25;
    targetY = mouseY * 0.25;

    camera.position.x += (targetX - camera.position.x) * 0.05;
    camera.position.y += (-targetY - camera.position.y) * 0.05;
    camera.lookAt(scene.position);

    const positions = stars.geometry.attributes.position.array;
    for (let i = 0; i < starCount; i++) {
      // Move stars towards camera to simulate flight
      positions[i * 3 + 2] += 2;
      
      // If star passes camera, reset it far back
      if (positions[i * 3 + 2] > 1000) {
        positions[i * 3 + 2] -= 4000;
      }
    }
    stars.geometry.attributes.position.needsUpdate = true;
    stars.rotation.z -= 0.0005;

    renderer.render(scene, camera);
  }

  animate();
} catch (e) {
  console.error('[Animation Error]', e.message, e.stack);
}
