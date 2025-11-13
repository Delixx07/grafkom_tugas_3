// Cek apakah THREE sudah dimuat dari CDN
if (typeof THREE === 'undefined' || typeof THREE.OrbitControls === 'undefined' || typeof THREE.Water === 'undefined') {
  alert('Gagal memuat library Three.js, OrbitControls, atau Water! Cek koneksi internet atau script tag.');
}

// Menunggu sampai semua HTML selesai dimuat
window.addEventListener('DOMContentLoaded', () => {
  // --- Variabel Global untuk Scene ---
  let scene, camera, renderer, object, velocity, inWater;
  let controls; // Variabel untuk OrbitControls
  let water; // Variabel untuk Objek Air BARU
  const clock = new THREE.Clock();
  let animationId = null;

  // --- Variabel untuk Jalur Lintasan ---
  let pathPoints = [];
  let pathLine = null;
  let predictionLine = null;
  const maxPathPoints = 500;
  let isThrown = false; // Flag untuk menandai apakah bola sedang dilempar
  let lastRecordedPos = new THREE.Vector3();
  const minDistanceToRecord = 0.1;

  // --- Konstanta Fisika ---
  const g = -9.81;
  const rhoWater = 1000;
  const objects = {
    heavy: { mass: 150, radius: 0.3, color: 0xff0000 },
    medium: { mass: 113.097, radius: 0.3, color: 0xffff00 },
    light: { mass: 50, radius: 0.3, color: 0x00ff00 },
  };

  // --- Ambil Elemen UI dari HTML ---
  const ui = {
    container: document.getElementById('scene-container'),
    objectSelect: document.getElementById('objectSelect'),
    angleSlider: document.getElementById('angle'),
    angleValue: document.getElementById('angleValue'),
    speedSlider: document.getElementById('speed'),
    speedValue: document.getElementById('speedValue'),
    throwBtn: document.getElementById('throwBtn'),
    resetBtn: document.getElementById('resetBtn'),
    status: document.getElementById('status'),
  };

  // --- Variabel Kontrol (State) ---
  let currentObjectType = 'medium';
  let currentAngle = 45;
  let currentSpeed = 20;

  // --- Setup Awal Scene ---
  function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a1a);
    scene.fog = new THREE.Fog(0x0a0a1a, 20, 100);

    // Camera
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    camera.position.set(0, 5, 12);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    ui.container.appendChild(renderer.domElement);

    // Kontrol Kamera
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controls.maxPolarAngle = Math.PI / 2;
    
    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7);
    dir.castShadow = true;
    const rimLight = new THREE.DirectionalLight(0x4477ff, 0.3);
    rimLight.position.set(-5, 5, -5);
    scene.add(ambient, dir, rimLight);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(500, 500);
    const groundMat = new THREE.MeshPhongMaterial({ 
      color: 0x1a1a2a,
      shininess: 10
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -5;
    ground.receiveShadow = true;
    scene.add(ground);

    // *** TAMPILAN LAUT BARU ***
    // Hapus kode waterGeo dan waterMat yang lama
    
    // 1. Load tekstur normal untuk gelombang
    const waterNormals = new THREE.TextureLoader().load( 'https://threejs.org/examples/textures/waternormals.jpg', function ( texture ) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    } );
    
    // 2. Buat geometri (tetap Plane, tapi akan dianimasikan oleh shader)
    const waterGeo = new THREE.PlaneGeometry( 500, 500 );
    
    // 3. Buat objek Water
    water = new THREE.Water(
        waterGeo,
        {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals: waterNormals,
            alpha: 0.8, // Sedikit lebih transparan
            sunDirection: dir.position.clone().normalize(),
            sunColor: 0xffffff,
            waterColor: 0x1a5fd8, // Warna air Anda
            distortionScale: 3.7, // Seberapa besar gelombangnya
            fog: scene.fog !== undefined
        }
    );

    water.rotation.x = - Math.PI / 2;
    water.position.y = 0; // Posisikan di permukaan
    scene.add( water );
    // **************************

    // Jalur Sejarah
    const lineMaterial = new THREE.LineBasicMaterial({ 
      color: 0xff6b35,
      linewidth: 2,
      transparent: true,
      opacity: 0.8
    });
    const lineGeometry = new THREE.BufferGeometry();
    pathLine = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(pathLine);

    // Jalur Prediksi
    const predictionMaterial = new THREE.LineDashedMaterial({
        color: 0x00ffff,
        dashSize: 0.3,
        gapSize: 0.15,
        linewidth: 1,
        transparent: true,
        opacity: 0.7
    });
    const predictionGeometry = new THREE.BufferGeometry();
    predictionLine = new THREE.Line(predictionGeometry, predictionMaterial);
    scene.add(predictionLine);

    // Buat objek awal
    createObject(currentObjectType);

    // Tambahkan Event Listeners
    setupEventListeners();

    // Mulai animasi
    animate();
    
    // Tampilkan prediksi awal
    updatePredictionPath();
  }

  // --- Fungsi Pembuatan Objek ---
  function createObject(type) {
    if (object) {
      scene.remove(object.mesh);
      object.mesh.geometry.dispose();
      object.mesh.material.dispose();
    }
    const { mass, radius, color } = objects[type];
    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const material = new THREE.MeshStandardMaterial({
        color: color,
        metalness: 0.6,
        roughness: 0.2,
        emissive: color,
        emissiveIntensity: 0.2
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 2, 0);
    mesh.castShadow = true;
    
    object = { mesh, mass, radius, color };
    scene.add(mesh);
    resetPhysics();
  }

  // --- Fungsi Reset Fisika ---
  function resetPhysics() {
    velocity = new THREE.Vector3(0, 0, 0);
    inWater = false;
    isThrown = false;
    object.mesh.position.set(0, 2, 0);
    setStatus('Status: diam');
    resetPath();
    updatePredictionPath();
  }

  // --- Fungsi Reset Jalur Sejarah ---
  function resetPath() {
    pathPoints = [];
    lastRecordedPos.set(0, 2, 0);
    if (pathLine) {
        pathLine.geometry.dispose();
        pathLine.geometry = new THREE.BufferGeometry();
    }
  }

  // --- Fungsi Update Jalur Sejarah ---
  function updatePath() {
    if (!object || !pathLine || !isThrown) return;
    
    const currentPos = object.mesh.position;
    const distanceFromLast = currentPos.distanceTo(lastRecordedPos);
    
    const isMovingSignificantly = velocity.length() > 0.1;
    const isDistanceEnough = distanceFromLast > minDistanceToRecord;
    
    if (isMovingSignificantly && isDistanceEnough) {
        pathPoints.push(currentPos.clone());
        lastRecordedPos.copy(currentPos);
        
        if (pathPoints.length > maxPathPoints) {
            pathPoints.shift();
        }
        
        pathLine.geometry.dispose();
        pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pathPoints);
    }
  }
  
  // --- FUNGSI: Update Jalur Prediksi ---
  function updatePredictionPath() {
    if (!predictionLine) return;

    predictionLine.visible = true;
    const predictionPoints = [];
    const simVelocity = new THREE.Vector3();
    const simPosition = new THREE.Vector3(0, 2, 0);
    const simMass = objects[currentObjectType].mass;

    const angleRad = (currentAngle * Math.PI) / 180;
    simVelocity.x = currentSpeed * Math.cos(angleRad);
    simVelocity.y = currentSpeed * Math.sin(angleRad);
    simVelocity.z = 0;

    const simDelta = 0.05;
    const k_drag_air = 0.5;

    predictionPoints.push(simPosition.clone());

    for (let i = 0; i < 300; i++) {
        const F_g = new THREE.Vector3(0, g * simMass, 0);
        const speedSq = simVelocity.lengthSq();
        const F_drag = simVelocity.clone().normalize().multiplyScalar(-k_drag_air * speedSq);
        const F_total = F_g.add(F_drag);
        const simAcceleration = F_total.divideScalar(simMass);

        simVelocity.addScaledVector(simAcceleration, simDelta);
        simPosition.addScaledVector(simVelocity, simDelta);
        predictionPoints.push(simPosition.clone());

        if (simPosition.y <= 0) {
            break;
        }
    }

    predictionLine.geometry.dispose();
    predictionLine.geometry = new THREE.BufferGeometry().setFromPoints(predictionPoints);
    predictionLine.computeLineDistances();
  }

  // --- FUNGSI: Sembunyikan Jalur Prediksi ---
  function hidePredictionPath() {
    if (predictionLine) {
        predictionLine.visible = false;
    }
  }

  // --- Fungsi Update Status UI ---
  function setStatus(text) {
    ui.status.textContent = text;
  }

  // --- Fungsi Perhitungan Gaya Apung ---
  function computeBuoyantForce(radius) {
    const h_immersed_fraction = Math.min(1, Math.max(0, (radius - object.mesh.position.y) / (2 * radius)));
    const actual_depth_from_top = h_immersed_fraction * (2 * radius);
    const V_sub = (Math.PI * actual_depth_from_top ** 2 * (3 * radius - actual_depth_from_top)) / 3;
    return rhoWater * V_sub * -g;
  }

  // --- Fungsi Update Fisika Setiap Frame ---
  function updatePhysics(delta) {
    // Penjaga: Hanya jalankan fisika jika bola sudah dilempar
    if (!isThrown) {
      return;
    }
    
    if (!object || !velocity) return;

    const { mesh, radius, mass } = object;
    const V_total = (4 / 3) * Math.PI * radius ** 3;
    const rhoObject = mass / V_total;

    let statusText = 'di udara';
    const surfaceY = 0;
    const bottomOfBallY = mesh.position.y - radius;

    if (bottomOfBallY <= surfaceY) {
      inWater = true;
    } else {
      inWater = false;
    }

    if (inWater) {
      if (rhoObject > rhoWater * 1.01) statusText = 'tenggelam';
      else if (rhoObject < rhoWater * 0.99) statusText = 'mengapung';
      else statusText = 'melayang';
    }
    setStatus('Status: ' + statusText);

    let F_total = new THREE.Vector3(0, mass * g, 0);

    if (inWater) {
        if (bottomOfBallY < surfaceY) {
            const F_b = computeBuoyantForce(radius);
            F_total.y += F_b;
        }
    }

    const k_drag_air = 0.5;
    const k_drag_water = 5.0;
    const current_k_drag = inWater ? k_drag_water : k_drag_air;
    
    const speedSq = velocity.lengthSq();
    if (speedSq > 0.001) {
      const F_drag_magnitude = current_k_drag * speedSq;
      const F_drag = velocity.clone().normalize().multiplyScalar(-F_drag_magnitude);
      F_total.add(F_drag);
    }

    const acceleration = F_total.clone().divideScalar(mass);

    velocity.addScaledVector(acceleration, delta);
    mesh.position.addScaledVector(velocity, delta);

    const bottomLimit = -5 + radius;
    if (mesh.position.y < bottomLimit) {
      mesh.position.y = bottomLimit;
      velocity.y *= -0.3;
      velocity.x *= 0.8;
    }
    
    if (mesh.position.y === bottomLimit && velocity.lengthSq() < 0.01) {
        velocity.x = 0;
        velocity.z = 0;
    }

    if (statusText === 'mengapung' && inWater) {
        if (Math.abs(velocity.y) < 0.05 && Math.abs(acceleration.y) < 0.05) {
            velocity.y = 0;
            acceleration.y = 0;
            mesh.position.y += F_total.y * 0.001; 
        }
    }

    mesh.position.z = 0;
    velocity.z = 0;
  }

  // --- Loop Animasi (DIPERBAIKI) ---
  function animate() {
    animationId = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05); 

    if (object) {
      updatePhysics(delta);
      updatePath();
      
      if (isThrown) {
        controls.target.copy(object.mesh.position);
      } else {
        controls.target.set(0, 2, 0); 
      }
      
      controls.update();
      
      if (isThrown && velocity.length() > 0.1) {
        object.mesh.rotation.x += velocity.x * delta * 0.5;
        object.mesh.rotation.z -= velocity.y * delta * 0.5;
      }
    }
    
    // *** ANIMASIKAN AIR ***
    // Perbarui 'waktu' shader air agar gelombangnya bergerak
    if (water) {
        water.material.uniforms[ 'time' ].value += delta * 0.5; // Sesuaikan kecepatan (0.5)
    }
    // **********************
    
    renderer.render(scene, camera);
  }

  // --- Setup Event Listeners ---
  function setupEventListeners() {
    // Pilihan Benda
    ui.objectSelect.addEventListener('change', (e) => {
      currentObjectType = e.target.value;
      updatePredictionPath();
    });

    // Slider Sudut
    ui.angleSlider.addEventListener('input', (e) => {
      currentAngle = Number(e.target.value);
      ui.angleValue.textContent = currentAngle;
      updatePredictionPath(); // Update prediksi
    });

    // Slider Kecepatan
    ui.speedSlider.addEventListener('input', (e) => {
      currentSpeed = Number(e.target.value);
      ui.speedValue.textContent = currentSpeed;
      updatePredictionPath(); // Update prediksi
    });

    // Tombol Lempar
    ui.throwBtn.addEventListener('click', () => {
      createObject(currentObjectType);
      
      const angleRad = (currentAngle * Math.PI) / 180;
      velocity.x = currentSpeed * Math.cos(angleRad);
      velocity.y = currentSpeed * Math.sin(angleRad);
      
      object.mesh.position.set(0, 2, 0);
      lastRecordedPos.set(0, 2, 0);
      inWater = false;
      isThrown = true; // Set flag saat melempar
      setStatus('Status: terlempar');
      
      hidePredictionPath();
    });

    // Tombol Reset
    ui.resetBtn.addEventListener('click', () => {
      createObject(currentObjectType);
      camera.position.set(0, 5, 12); // Reset posisi kamera
      controls.target.set(0, 0, 0); // Reset target kontrol
    });

    // Handle Resize
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // --- Mulai Inisialisasi ---
  init();
});