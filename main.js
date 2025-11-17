// Cek apakah THREE sudah dimuat dari CDN
if (
  typeof THREE === "undefined" ||
  typeof THREE.OrbitControls === "undefined" ||
  typeof THREE.Water === "undefined" ||
  typeof THREE.GLTFLoader === "undefined" // Cek loader
) {
  alert(
    "Gagal memuat library Three.js, OrbitControls, Water, atau GLTFLoader! Cek koneksi internet atau script tag."
  );
}

// *** Perpustakaan Model ***
const MODELS = {
  'duck': {
    path: './assets/duck.glb',
    scale: 8,
    rotationY: Math.PI / 2 // Hadap kanan
  },
  'car': {
    path: './assets/car.glb', // Anda menggunakan toy_car.glb di file, pastikan ini benar
    scale: 10,
    rotationY: -Math.PI / 2 // Hadap kanan
  },
  'sphere': {
    path: null, // path null berarti gunakan bola fisika
    scale: 1,
    rotationY: 0
  },
  'ufo': {
    path: './assets/ufo.glb', // PASTIKAN ANDA PUNYA FILE INI
    scale: 3, // Anda mungkin perlu menyesuaikan skala ini
    rotationY: 0
  }
};
// *****************************


// Menunggu sampai semua HTML selesai dimuat
window.addEventListener("DOMContentLoaded", () => {
  // --- Variabel Global untuk Scene ---
  let scene, camera, renderer, object, velocity, inWater;
  let controls;
  let water;
  const clock = new THREE.Clock();
  let animationId = null;
  let simTime = 0;

  let loadedModel = null; // Variabel untuk model 3D

  // *** Variabel untuk Tekstur Pasir ***
  let sandColorTexture, sandNormalTexture;
  
  // *** Variabel Tema & Cahaya ***
  let isNightMode = false; // Mulai dari mode malam
  let ambient, dir, rimLight; // Jadikan lampu global
  
  // --- Variabel untuk Jalur Lintasan ---
  let pathPoints = [];
  let pathLine = null;
  let predictionLine = null;
  const maxPathPoints = 500;
  let isThrown = false;
  let lastRecordedPos = new THREE.Vector3();
  const minDistanceToRecord = 0.1;

  // --- Variabel untuk Efek ---
  let wasInWater = false;
  const splashRings = [];
  const dropletEmitters = [];
  // *** BARU: Variabel untuk Semburan Pasir ***
  const sandClouds = [];
  // *****************************************

  // --- Parameter Fisika (tetap sama) ---
  const rhoAir = 1.225;
  const CdSphere = 0.47;
  const waterCurrent = new THREE.Vector3(0.25, 0.0, 0.0);
  const waves = {
    amp1: 0.12, amp2: 0.07,
    dir1: new THREE.Vector2(1, 0).normalize(),
    dir2: new THREE.Vector2(0.3, 0.7).normalize(),
    wl1: 6.0, wl2: 3.5,
    sp1: 1.2, sp2: 0.8,
  };
  function waterSurfaceHeightAt(x, z, t) {
    const k1 = (2 * Math.PI) / waves.wl1;
    const k2 = (2 * Math.PI) / waves.wl2;
    const phase1 = k1 * (waves.dir1.x * x + waves.dir1.y * z) - waves.sp1 * k1 * t;
    const phase2 = k2 * (waves.dir2.x * x + waves.dir2.y * z) - waves.sp2 * k2 * t;
    return waves.amp1 * Math.sin(phase1) + waves.amp2 * Math.sin(phase2);
  }
  const g = -9.81;
  const rhoWater = 1000;
  // **********************************

  // --- Ambil Elemen UI dari HTML ---
  const ui = {
    container: document.getElementById("scene-container"),
    modelSelect: document.getElementById("modelSelect"),
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    massSlider: document.getElementById("mass"),
    massValue: document.getElementById("massValue"),
    massResetBtn: document.getElementById("massReset"),
    initHeightSlider: document.getElementById("initHeight"),
    initHeightValue: document.getElementById("initHeightValue"),
    initHeightResetBtn: document.getElementById("initHeightReset"),
    airDragScaleSlider: document.getElementById("airDragScale"),
    airDragScaleValue: document.getElementById("airDragScaleValue"),
    airDragScaleResetBtn: document.getElementById("airDragScaleReset"),
    airBuoyScaleSlider: document.getElementById("airBuoyScale"),
    airBuoyScaleValue: document.getElementById("airBuoyScaleValue"),
    airBuoyScaleResetBtn: document.getElementById("airBuoyScaleReset"),
    angleSlider: document.getElementById("angle"),
    angleValue: document.getElementById("angleValue"),
    angleResetBtn: document.getElementById("angleReset"),
    speedSlider: document.getElementById("speed"),
    speedValue: document.getElementById("speedValue"),
    speedResetBtn: document.getElementById("speedReset"),
    throwBtn: document.getElementById("throwBtn"),
    resetBtn: document.getElementById("resetBtn"),
    status: document.getElementById("status"),
    densityValue: document.getElementById("densityValue"),
    currentSpeed: document.getElementById("currentSpeed"),
    bcValue: document.getElementById("bcValue"),
  };

  // --- Variabel Kontrol (State) ---
  let currentModelKey = ui.modelSelect.value; 
  let currentAngle = 45;
  let currentSpeed = 20;
  let currentMass =
    (document.getElementById("mass") &&
      parseFloat(document.getElementById("mass").value)) ||
    113.1;
  let currentRadius = 0.3; // Jari-jari tetap untuk fisika
  let currentInitHeight =
    (document.getElementById("initHeight") &&
      parseFloat(document.getElementById("initHeight").value)) ||
    2.0;
  let airDragScale =
    (document.getElementById("airDragScale") &&
      parseFloat(document.getElementById("airDragScale").value)) ||
    1.0;
  let airBuoyScale =
    (document.getElementById("airBuoyScale") &&
      parseFloat(document.getElementById("airBuoyScale").value)) ||
    0.0;

  // Default values for quick reset buttons
  const defaults = {
    mass: 113.1,
    initHeight: 2.0,
    angle: 45,
    speed: 20,
    airDragScale: 1.0,
    airBuoyScale: 0.0,
    model: 'sphere' // Default model
  };

  // --- (Fungsi helper UI tetap sama) ---
  function getColorForDensity(density) {
    if (density < rhoWater * 0.97) return 0x00ff88; // float
    if (density > rhoWater * 1.03) return 0xff5555; // sink
    return 0xffee66; // neutral
  }
  function updateDensityUI() {
    const V = (4 / 3) * Math.PI * Math.pow(currentRadius, 3);
    const rho = currentMass / V;
    if (ui.densityValue) ui.densityValue.textContent = rho.toFixed(1);
  }
  function updateMassUI() {
    if (ui.massSlider) ui.massSlider.value = String(currentMass);
    if (ui.massValue) ui.massValue.textContent = Number(currentMass).toFixed(1);
    updateDensityUI();
    updateDerivedUI();
  }
  function updateInitHeightUI() {
    if (ui.initHeightSlider)
      ui.initHeightSlider.value = String(currentInitHeight.toFixed(2));
    if (ui.initHeightValue)
      ui.initHeightValue.textContent = Number(currentInitHeight).toFixed(2);
  }
  function updateDerivedUI() {
    const A = Math.PI * currentRadius * currentRadius;
    const bc = currentMass / (CdSphere * Math.max(A, 1e-6));
    if (ui.bcValue) ui.bcValue.textContent = bc.toFixed(2);
    if (ui.airDragScaleValue)
      ui.airDragScaleValue.textContent = airDragScale.toFixed(2);
    if (ui.airBuoyScaleValue)
      ui.airBuoyScaleValue.textContent = airBuoyScale.toFixed(2);
  }
  function updateObjectColor() {
    if (!object) return;
    const V = (4 / 3) * Math.PI * Math.pow(object.radius, 3);
    const rho = object.mass / V;
    const color = getColorForDensity(rho);
    if (object.mesh && object.mesh.material) {
      object.mesh.material.color.setHex(color);
      if (object.mesh.material.emissive) {
        object.mesh.material.emissive.setHex(color);
      }
    }
  }
  // **********************************

  // *** Fungsi untuk mengubah tema (VERSI PERBAIKAN BUG KABUT) ***
  function setTheme(isNight) {
    if (isNight) {
      // --- Atur ke Malam ---
      scene.background.setHex(0x0a0a1a);
      
      if (scene.fog) {
        scene.fog.color.setHex(0x0a0a1a); // Kabut jadi hitam
        scene.fog.near = 30;
        scene.fog.far = 150;
      }
      
      // Lampu
      ambient.intensity = 0.2;
      dir.intensity = 0.3;
      dir.color.setHex(0xbbccff); 
      rimLight.intensity = 0.3; 
      
      // Air
      if (water) {
        water.material.uniforms.sunColor.value.setHex(0xbbccff);
        water.material.uniforms.waterColor.value.setHex(0x0f5aa6); // Biru gelap
      }
      
      if (ui.themeToggleBtn) ui.themeToggleBtn.textContent = "Malam 🌙";

    } else {
      // --- Atur ke Siang ---
      scene.background.setHex(0x87CEEB); // Langit biru
      
      if (scene.fog) {
        scene.fog.color.setHex(0x87CEEB); // <<< PERBAIKAN: Kabut jadi biru
        scene.fog.near = 30;
        scene.fog.far = 150;
      }
      
      // Lampu
      ambient.intensity = 0.6;
      dir.intensity = 1.0;
      dir.color.setHex(0xffffff);
      rimLight.intensity = 0.1; 
      
      // Air
      if (water) {
        water.material.uniforms.sunColor.value.setHex(0xffffff);
        water.material.uniforms.waterColor.value.setHex(0x3AAACF); // Biru lebih jernih
      }
      
      if (ui.themeToggleBtn) ui.themeToggleBtn.textContent = "Siang ☀️";
    }
  }
  // ***************************************************************

  // --- Fungsi Load Model (tetap sama) ---
  function loadModel(modelKey, onLoadedCallback) {
    if (!MODELS[modelKey]) {
        console.error("Model key tidak ditemukan di MODELS:", modelKey);
        if (onLoadedCallback) onLoadedCallback();
        return;
    }
    const modelInfo = MODELS[modelKey];
    if (!modelInfo.path) {
      if (onLoadedCallback) onLoadedCallback();
      return;
    }
    const loader = new THREE.GLTFLoader();
    loader.load(
      modelInfo.path, 
      function (gltf) {
        if (loadedModel) {
            scene.remove(loadedModel);
        }
        loadedModel = gltf.scene;
        loadedModel.scale.set(modelInfo.scale, modelInfo.scale, modelInfo.scale); 
        loadedModel.traverse(function (node) {
          if (node.isMesh) {
            node.castShadow = true;
          }
        });
        scene.add(loadedModel);
        if (onLoadedCallback) onLoadedCallback();
      },
      undefined,
      function (error) {
        console.error('Error memuat model 3D:', error);
        alert('Gagal memuat file: ' + modelInfo.path + "\n\nPastikan file ada di folder /assets/ dan server sudah berjalan.");
        if (onLoadedCallback) onLoadedCallback();
      }
    );
  }
  // ****************************************************


  // --- Setup Awal Scene ---
  function init() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(); // Inisialisasi background
    scene.fog = new THREE.Fog(0x0a0a1a, 30, 150); // Default, akan ditimpa setTheme

    // Camera
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    camera.position.set(0, 5, 12);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antalias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    ui.container.appendChild(renderer.domElement);

    // Kontrol Kamera
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.dampingFactor = 0.0;
    controls.screenSpacePanning = false;
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controls.maxPolarAngle = Math.PI / 2;

    // Lampu Global
    ambient = new THREE.AmbientLight(0xffffff, 0.5);
    dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7);
    dir.castShadow = true;
    rimLight = new THREE.DirectionalLight(0x4477ff, 0.3);
    rimLight.position.set(-5, 5, -5);
    scene.add(ambient, dir, rimLight);
    
    // --- Ground, Grid, and Water (Blok yang Diperbarui) ---
    
    // 1. Buat SATU texture loader
    const textureLoader = new THREE.TextureLoader();

    // 2. Muat tekstur yang akan dipakai bersama (waternormals)
    const sharedWaterNormals = textureLoader.load(
      "https://threejs.org/examples/textures/waternormals.jpg",
      function (texture) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      }
    );

    // 3. Muat tekstur warna pasir
    sandColorTexture = textureLoader.load(
      'https://threejs.org/examples/textures/terrain/sand-512.jpg',
      undefined,
      () => { console.warn("Gagal memuat sand_color.jpg dari URL"); }
    );
    
    sandColorTexture.wrapS = THREE.RepeatWrapping;
    sandColorTexture.wrapT = THREE.RepeatWrapping;
    sandColorTexture.repeat.set(10, 10);
    
    // 4. Buat Material & Mesh Dasar Laut (Pasir)
    // *** PERBAIKAN: Menggunakan MeshBasicMaterial agar selalu terlihat ***
    sandNormalTexture = sharedWaterNormals; // (Kita tetap siapkan normal map-nya)
    sandNormalTexture.repeat.copy(sandColorTexture.repeat);
    
    const groundGeo = new THREE.PlaneGeometry(500, 500);
    const groundMat = new THREE.MeshBasicMaterial({ // <<< PERBAIKAN
      map: sandColorTexture,      // Warna pasir
      // normalMap: sandNormalTexture, // MeshBasicMaterial tidak pakai ini
    });
    
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -20; // Kedalaman laut
    ground.receiveShadow = true; // (tetap bisa menerima, walau tidak bereaksi)
    scene.add(ground);

    // 5. Tambahkan Grid (tidak berubah)
    const gridHelper = new THREE.GridHelper(500, 50, 0xaaaaaa, 0xaaaaaa);
    gridHelper.position.y = -19.9; 
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.25;
    scene.add(gridHelper);

    // 6. Buat Tampilan Laut (tidak berubah)
    const waterGeo = new THREE.PlaneGeometry(500, 500);
    water = new THREE.Water(waterGeo, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: sharedWaterNormals,
      alpha: 0.9,
      sunDirection: dir.position.clone().normalize(),
      sunColor: 0xffffff,
      waterColor: 0x0f5aa6,
      distortionScale: 2.6,
      fog: scene.fog !== undefined,
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    if (water.material.uniforms.size) {
      water.material.uniforms.size.value = 2.0;
    }
    water.material.side = THREE.DoubleSide;
    scene.add(water);
    
    // --- Akhir Blok yang Diperbarui ---

    // Jalur Sejarah
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xff6b35,
      linewidth: 2,
      transparent: true,
      opacity: 0.8,
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
      opacity: 0.7,
    });
    const predictionGeometry = new THREE.BufferGeometry();
    predictionLine = new THREE.Line(predictionGeometry, predictionMaterial);
    scene.add(predictionLine);

    // Logika load awal
    createObject();
    loadModel(currentModelKey, () => {
      resetPhysics();
      updatePredictionPath();
    });

    // Tambahkan Event Listeners
    setupEventListeners();

    // Atur tema awal
    setTheme(isNightMode);

    // Mulai animasi
    animate();
  }

  // --- Fungsi Pembuatan Objek (tetap sama) ---
  function createObject() {
    if (object) {
      scene.remove(object.mesh);
      object.mesh.geometry.dispose();
      object.mesh.material.dispose();
    }
    const mass = currentMass;
    const radius = currentRadius;
    const V = (4 / 3) * Math.PI * Math.pow(radius, 3);
    const rho = mass / V;
    const color = getColorForDensity(rho);
    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const isSphereVisible = (currentModelKey === 'sphere');
    const material = new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.6,
      roughness: 0.2,
      emissive: color,
      emissiveIntensity: 0.2,
      visible: isSphereVisible
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, currentInitHeight, 0);
    mesh.castShadow = isSphereVisible;
    object = { mesh, mass, radius, color };
    scene.add(mesh);
  }

  // --- Fungsi Reset Fisika (tetap sama) ---
  function resetPhysics() {
    velocity = new THREE.Vector3(0, 0, 0);
    inWater = false;
    wasInWater = false;
    isThrown = false;
    if(object) {
      object.mesh.position.set(0, currentInitHeight, 0);
      object.mesh.rotation.set(0, 0, 0);
    }
    if (loadedModel) {
      loadedModel.position.set(0, currentInitHeight, 0);
      const initialRotation = (MODELS[currentModelKey] && MODELS[currentModelKey].rotationY) ? MODELS[currentModelKey].rotationY : 0;
      loadedModel.rotation.set(0, initialRotation, 0);
    }
    setStatus("Status: diam");
    resetPath();
  }

  // --- Fungsi Jalur (tetap sama) ---
  function resetPath() {
    pathPoints = [];
    lastRecordedPos.set(0, 2, 0);
    if (pathLine) {
      pathLine.geometry.dispose();
      pathLine.geometry = new THREE.BufferGeometry();
    }
  }
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
  function updatePredictionPath() {
    if (!predictionLine || !object) return;
    predictionLine.visible = true;
    const predictionPoints = [];
    const simVelocity = new THREE.Vector3();
    const simPosition = object.mesh.position.clone();
    const simMass = currentMass;
    const simRadius = currentRadius;
    const simV = (4 / 3) * Math.PI * Math.pow(simRadius, 3);
    const angleRad = (currentAngle * Math.PI) / 180;
    simVelocity.x = currentSpeed * Math.cos(angleRad);
    simVelocity.y = currentSpeed * Math.sin(angleRad);
    simVelocity.z = 0;
    const simDelta = 0.05;
    const k_drag_air = 0.5 * airDragScale;
    predictionPoints.push(simPosition.clone());
    for (let i = 0; i < 300; i++) {
      const F_g = new THREE.Vector3(0, g * simMass, 0);
      const speedSq = simVelocity.lengthSq();
      const F_drag = simVelocity.clone().normalize().multiplyScalar(-k_drag_air * speedSq);
      const F_b_air = new THREE.Vector3(0, rhoAir * simV * -g * airBuoyScale, 0);
      const F_total = F_g.add(F_drag).add(F_b_air);
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
  function hidePredictionPath() {
    if (predictionLine) {
      predictionLine.visible = false;
    }
  }
  function setStatus(text) {
    ui.status.textContent = text;
  }
  
  // --- Fungsi Fisika (tetap sama) ---
  function computeSubmerged(radius, centerY, surfaceY) {
    const h = THREE.MathUtils.clamp(radius - (centerY - surfaceY), 0, 2 * radius);
    const V_sub = (Math.PI * h * h * (3 * radius - h)) / 3;
    const V_total = (4 / 3) * Math.PI * radius ** 3;
    return { V_sub, fraction: THREE.MathUtils.clamp(V_sub / V_total, 0, 1) };
  }
  function computeBuoyantForce(radius, centerY, surfaceY) {
    const { V_sub } = computeSubmerged(radius, centerY, surfaceY);
    return rhoWater * V_sub * -g;
  }
  
  // --- Fungsi Update Fisika (DENGAN TAMBAHAN) ---
  function updatePhysics(delta) {
    if (!isThrown) { return; }
    if (!object || !velocity) return;
    const { mesh, radius, mass } = object;
    const V_total = (4 / 3) * Math.PI * radius ** 3;
    const rhoObject = mass / V_total;
    let statusText = "di udara";
    const surfaceY = waterSurfaceHeightAt(mesh.position.x, mesh.position.z, simTime);
    const bottomOfBallY = mesh.position.y - radius;
    if (bottomOfBallY <= surfaceY) { inWater = true; } else { inWater = false; }
    if (inWater) {
      if (rhoObject > rhoWater * 1.01) statusText = "tenggelam";
      else if (rhoObject < rhoWater * 0.99) statusText = "mengapung";
      else statusText = "melayang";
    }
    setStatus("Status: " + statusText);
    let F_total = new THREE.Vector3(0, mass * g, 0);
    if (!wasInWater && inWater) {
      const hitPos = new THREE.Vector3(mesh.position.x, surfaceY + 0.01, mesh.position.z);
      const impactSpeed = Math.max(0, -velocity.y);
      triggerSplash(hitPos, impactSpeed, radius);
    }
    if (inWater) {
      if (bottomOfBallY < surfaceY) {
        const F_b = computeBuoyantForce(radius, mesh.position.y, surfaceY);
        F_total.y += F_b;
      }
    }
    const A = Math.PI * radius * radius;
    const { V_sub, fraction: f_sub } = computeSubmerged(radius, mesh.position.y, surfaceY);
    const f_air = 1 - f_sub;
    const v_rel_water = velocity.clone();
    v_rel_water.x -= waterCurrent.x;
    v_rel_water.z -= waterCurrent.z;
    const eps = 1e-5;
    if (velocity.lengthSq() > eps) {
      if (f_air > 0) {
        const v = velocity.length();
        const Fd_air_mag = 0.5 * rhoAir * CdSphere * A * v * v * f_air * airDragScale;
        const Fd_air = velocity.clone().normalize().multiplyScalar(-Fd_air_mag);
        F_total.add(Fd_air);
      }
      if (f_sub > 0) {
        const vW = v_rel_water.length();
        const Fd_water_mag = 0.5 * rhoWater * CdSphere * A * vW * vW * f_sub;
        const Fd_water = v_rel_water.clone().normalize().multiplyScalar(-Fd_water_mag);
        F_total.add(Fd_water);
      }
    }
    if (f_air > 0) {
      const F_b_air = rhoAir * V_total * -g * airBuoyScale * f_air;
      F_total.y += F_b_air;
    }
    const acceleration = F_total.clone().divideScalar(mass);
    velocity.addScaledVector(acceleration, delta);
    mesh.position.addScaledVector(velocity, delta);
    
    // Safeguard: Buoyant objects cannot sink below equilibrium depth
    if (rhoObject < rhoWater && inWater) {
      // Calculate theoretical equilibrium depth for buoyant objects
      const equilibriumSubmersion = rhoObject / rhoWater; // Fraction that should be submerged
      const minY = surfaceY - (radius * equilibriumSubmersion * 2) + radius; // Minimum Y position
      
      if (mesh.position.y < minY) {
        mesh.position.y = minY;
        if (velocity.y < 0) velocity.y = 0; // Stop downward motion
      }
    }
    
    // Fisika Dasar Laut (sudah diatur ke -20)
    const bottomLimit = -20 + radius;

    // *** BARU: Logika deteksi benturan dasar laut ***
    if (mesh.position.y < bottomLimit) {
      const impactSpeedY = Math.abs(velocity.y); // Cek kecepatan *sebelum* memantul
      
      mesh.position.y = bottomLimit;
      velocity.y *= -0.3; // Memantul
      velocity.x *= 0.8;
      
      // Hanya picu semburan jika benturan cukup keras
      if (impactSpeedY > 0.5) {
        triggerSandPoof(new THREE.Vector3(mesh.position.x, bottomLimit + 0.1, mesh.position.z), impactSpeedY);
      }
    }
    // ***********************************************

    if (mesh.position.y === bottomLimit && velocity.lengthSq() < 0.01) {
      velocity.x = 0;
      velocity.z = 0;
    }
    // Improved floating equilibrium logic
    if (statusText === "mengapung" && inWater) {
      // Calculate if object should be in equilibrium (buoyant)
      const netForceY = F_total.y;
      const isNearEquilibrium = Math.abs(velocity.y) < 0.3;
      
      if (isNearEquilibrium) {
        // Dampen vertical motion strongly when near equilibrium
        velocity.y *= 0.92;
        
        // If net force is pushing up (buoyant), maintain equilibrium
        if (netForceY > 0) {
          // Directly adjust position to maintain buoyancy without accumulating drift
          const targetAdjustment = netForceY / (mass * 50); // Gentle position correction
          mesh.position.y += targetAdjustment;
          
          // Lock velocity if very close to equilibrium
          if (Math.abs(velocity.y) < 0.02) {
            velocity.y = 0;
          }
        }
      }
    }
    mesh.position.z = 0;
    velocity.z = 0;
    wasInWater = inWater;
  }
  // **********************************
  
  // --- (Fungsi Splash tetap sama) ---
  function triggerSplash(position, impactSpeed, radius) {
    const m = object ? object.mass : currentMass;
    const KE = 0.5 * m * impactSpeed * impactSpeed;
    const intensity = THREE.MathUtils.clamp(Math.sqrt(KE) / 8 + radius * 1.5, 0.3, 5.0);
    createSplashRing(position, intensity);
    spawnDroplets(position, impactSpeed, radius, m, KE, intensity);
  }
  function createSplashRing(position, intensity) {
    const innerR = 0.2 * intensity;
    const outerR = 0.25 * intensity;
    const geo = new THREE.RingGeometry(innerR, outerR, 64);
    const mat = new THREE.MeshBasicMaterial({ color: 0x8ec8ff, transparent: true, opacity: 0.9, depthWrite: false });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(position);
    ring.position.y += 0.01;
    scene.add(ring);
    splashRings.push({ mesh: ring, elapsed: 0, duration: 1.2, startScale: 1, endScale: 5 * intensity });
  }
  function updateSplashRings(delta) {
    for (let i = splashRings.length - 1; i >= 0; i--) {
      const r = splashRings[i];
      r.elapsed += delta;
      const t = r.elapsed / r.duration;
      if (t >= 1) {
        scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        splashRings.splice(i, 1);
        continue;
      }
      const s = THREE.MathUtils.lerp(r.startScale, r.endScale, t);
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = 0.9 * (1 - t);
    }
  }
  function spawnDroplets(position, impactSpeed, radius, mass, KE, intensity) {
    const count = THREE.MathUtils.clamp(Math.floor(20 + 0.02 * KE + radius * 120), 30, 400);
    const positions = new Float32Array(count * 3);
    const velocities = new Array(count);
    const baseSpeed = 1.0 + impactSpeed * 0.5 + intensity * 0.2;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const rad = Math.random() * (0.15 + radius * 0.2);
      const offset = new THREE.Vector3(Math.cos(angle) * rad, 0, Math.sin(angle) * rad);
      const px = position.x + offset.x;
      const py = position.y + 0.02;
      const pz = position.z + offset.z;
      positions[i * 3 + 0] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;
      const dir = new THREE.Vector3(Math.cos(angle), 0.8 + Math.random() * 0.4, Math.sin(angle)).normalize();
      const speed = baseSpeed * (0.6 + Math.random() * 0.7);
      velocities[i] = dir.multiplyScalar(speed);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xaeddff, size: 0.05 + radius * 0.06, transparent: true, opacity: 0.95, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    dropletEmitters.push({ points, velocities, elapsed: 0, duration: 1.6 });
  }
  function updateDropletEmitters(delta) {
    const gravity = -9.81;
    for (let e = dropletEmitters.length - 1; e >= 0; e--) {
      const emitter = dropletEmitters[e];
      emitter.elapsed += delta;
      const lifeT = emitter.elapsed / emitter.duration;
      const posAttr = emitter.points.geometry.getAttribute("position");
      const arr = posAttr.array;
      for (let i = 0; i < emitter.velocities.length; i++) {
        const idx = i * 3;
        emitter.velocities[i].y += gravity * delta * 0.7;
        arr[idx + 0] += emitter.velocities[i].x * delta;
        arr[idx + 1] += emitter.velocities[i].y * delta;
        arr[idx + 2] += emitter.velocities[i].z * delta;
        const surf = waterSurfaceHeightAt(arr[idx + 0], arr[idx + 2], simTime);
        if (arr[idx + 1] <= surf) {
          arr[idx + 1] = -9999;
          emitter.velocities[i].set(0, 0, 0);
        }
      }
      posAttr.needsUpdate = true;
      emitter.points.material.opacity = 0.95 * (1 - lifeT);
      if (lifeT >= 1) {
        scene.remove(emitter.points);
        emitter.points.geometry.dispose();
        emitter.points.material.dispose();
        dropletEmitters.splice(e, 1);
      }
    }
  }
  // **********************************

  // *** BARU: Fungsi untuk Semburan Pasir ***
  function triggerSandPoof(position, impactSpeed) {
    const intensity = THREE.MathUtils.clamp(impactSpeed / 2, 1, 5);
    spawnSandCloud(position, intensity);
  }

  function spawnSandCloud(position, intensity) {
    const count = THREE.MathUtils.clamp(Math.floor(intensity * 50), 50, 200);
    const positions = new Float32Array(count * 3);
    const velocities = new Array(count);
    const baseSpeed = 2.0 + intensity * 0.1;

    for (let i = 0; i < count; i++) {
      const _idx = i * 3;
      // Mulai dari posisi benturan
      positions[_idx + 0] = position.x + (Math.random() - 0.5) * 0.1;
      positions[_idx + 1] = position.y + (Math.random()) * 0.1;
      positions[_idx + 2] = position.z + (Math.random() - 0.5) * 0.1;
      
      // Kecepatan: menyebar ke samping dan sedikit ke atas
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 2, // x
        Math.random() * 0.6,        // y (selalu sedikit ke atas)
        (Math.random() - 0.5) * 2  // z
      ).normalize();
      const speed = baseSpeed * (0.5 + Math.random() * 0.5);
      velocities[i] = dir.multiplyScalar(speed);
    }
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xAD956F, // Warna coklat pasir
      size: 0.5,
      transparent: true,
      opacity: 0.7,
      depthWrite: false // Agar tidak bentrok dengan partikel lain
    });
    
    const points = new THREE.Points(geo, mat);
    scene.add(points);
    // Simpan untuk dianimasikan, durasi lebih lama dari percikan air
    sandClouds.push({ points, velocities, elapsed: 0, duration: 2.5 });
  }

  function updateSandClouds(delta) {
    // Fisika partikel pasir: melambat (drag) dan naik sedikit (lift)
    const drag = 0.96; // 4% lebih lambat setiap frame
    const lift = 0.0005; // Gaya angkat kecil

    for (let e = sandClouds.length - 1; e >= 0; e--) {
      const emitter = sandClouds[e];
      emitter.elapsed += delta;
      const lifeT = emitter.elapsed / emitter.duration;
      const posAttr = emitter.points.geometry.getAttribute("position");
      const arr = posAttr.array;

      for (let i = 0; i < emitter.velocities.length; i++) {
        const idx = i * 3;
        
        // Terapkan fisika pasir
        emitter.velocities[i].multiplyScalar(drag);
        emitter.velocities[i].y += lift;

        // Gerakkan partikel
        arr[idx + 0] += emitter.velocities[i].x * delta;
        arr[idx + 1] += emitter.velocities[i].y * delta;
        arr[idx + 2] += emitter.velocities[i].z * delta;
      }
      posAttr.needsUpdate = true;
      emitter.points.material.opacity = 0.7 * (1 - lifeT); // Pudar seiring waktu

      // Hapus jika sudah selesai
      if (lifeT >= 1) {
        scene.remove(emitter.points);
        emitter.points.geometry.dispose();
        emitter.points.material.dispose();
        sandClouds.splice(e, 1);
      }
    }
  }
  // ****************************************


  // --- Loop Animasi ---
  function animate() {
    animationId = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    simTime += delta;

    // Animasi Tekstur Pasir (tetap sama)
    if (sandColorTexture) {
      sandColorTexture.offset.x += delta * 0.005;
      sandColorTexture.offset.y += delta * 0.002;
      
      // Pastikan tekstur normal map bergerak bersamaan (jika ada)
      // (Meskipun MeshBasicMaterial tidak menampilkannya, offset-nya tetap kita samakan)
      if(sandNormalTexture) sandNormalTexture.offset.copy(sandColorTexture.offset);
    }

    if (object) {
      updatePhysics(delta);
      updatePath();

      // Rotasi (tetap sama)
      if (loadedModel) {
        loadedModel.position.copy(object.mesh.position);
        loadedModel.rotation.x = object.mesh.rotation.x;
        loadedModel.rotation.z = object.mesh.rotation.z;
        const initialRotation = (MODELS[currentModelKey] && MODELS[currentModelKey].rotationY) ? MODELS[currentModelKey].rotationY : 0;
        loadedModel.rotation.y = object.mesh.rotation.y + initialRotation;
      }

      // Target Kamera (tetap sama)
      if (isThrown) {
        controls.target.copy(object.mesh.position);
      } else {
        const targetPos = loadedModel ? loadedModel.position : object.mesh.position;
        controls.target.copy(targetPos);
      }

      controls.update();

      // Rotasi bola fisika (tetap sama)
      if (isThrown && velocity.length() > 0.1) {
        if (currentModelKey === 'sphere') {
          object.mesh.rotation.x += velocity.x * delta * 0.5;
          object.mesh.rotation.z -= velocity.y * delta * 0.5;
        } else {

          object.mesh.rotation.x += delta * 1.5; 
          object.mesh.rotation.y += delta * 0.8; 
          object.mesh.rotation.z += delta * 1.1;
        }
      }
    }

    // Update air (tetap sama)
    if (water) {
      water.material.uniforms["time"].value = simTime * 0.5;
    }

    // *** BARU: Update semua sistem partikel ***
    updateSplashRings(delta);
    updateDropletEmitters(delta);
    updateSandClouds(delta); // <-- TAMBAHKAN INI
    // *****************************************

    renderer.render(scene, camera);

    if (ui.currentSpeed) {
      const v = velocity ? velocity.length() : 0;
      ui.currentSpeed.textContent = v.toFixed(2);
    }
  }

  // --- Setup Event Listeners (TETAP SAMA) ---
  function setupEventListeners() {
    
    if (ui.themeToggleBtn) {
      ui.themeToggleBtn.addEventListener('click', () => {
          isNightMode = !isNightMode;
          setTheme(isNightMode);
      });
    }

    ui.modelSelect.addEventListener('change', () => {
        currentModelKey = ui.modelSelect.value;
        if (loadedModel) {
            scene.remove(loadedModel);
            loadedModel = null;
        }
        createObject();
        loadModel(currentModelKey, () => {
            resetPhysics();
            updatePredictionPath();
        });
    });

    ui.angleSlider.addEventListener("input", (e) => {
      currentAngle = Number(e.target.value);
      ui.angleValue.textContent = currentAngle;
      updatePredictionPath();
    });
    ui.speedSlider.addEventListener("input", (e) => {
      currentSpeed = Number(e.target.value);
      ui.speedValue.textContent = currentSpeed;
      updatePredictionPath();
    });
    ui.massSlider.addEventListener("input", (e) => {
      currentMass = Number(e.target.value);
      ui.massValue.textContent = currentMass.toFixed(1);
      updateDensityUI();
      updateDerivedUI();
      if (object) {
        object.mass = currentMass;
        if (currentModelKey === 'sphere') updateObjectColor();
      }
      updatePredictionPath();
    });
    if (ui.airDragScaleSlider) {
      ui.airDragScaleSlider.addEventListener("input", (e) => {
        airDragScale = Number(e.target.value);
        if (ui.airDragScaleValue) ui.airDragScaleValue.textContent = airDragScale.toFixed(2);
        updatePredictionPath();
      });
    }
    if (ui.airBuoyScaleSlider) {
      ui.airBuoyScaleSlider.addEventListener("input", (e) => {
        airBuoyScale = Number(e.target.value);
        if (ui.airBuoyScaleValue) ui.airBuoyScaleValue.textContent = airBuoyScale.toFixed(2);
        updatePredictionPath();
      });
    }
    ui.initHeightSlider.addEventListener("input", (e) => {
      currentInitHeight = Number(e.target.value);
      ui.initHeightValue.textContent = currentInitHeight.toFixed(2);
      if (!isThrown && object) {
        const prevTarget = controls ? controls.target.clone() : new THREE.Vector3();
        const offset = camera && prevTarget ? camera.position.clone().sub(prevTarget) : new THREE.Vector3(0, 5, 12);
        object.mesh.position.set(0, currentInitHeight, 0);
        if(loadedModel) {
            loadedModel.position.set(0, currentInitHeight, 0);
        }
        lastRecordedPos.set(0, currentInitHeight, 0);
        resetPath();
        if (controls && camera) {
          const targetPos = loadedModel ? loadedModel.position : object.mesh.position;
          controls.target.copy(targetPos);
          camera.position.copy(targetPos.clone().add(offset));
          controls.update();
        }
      }
      updatePredictionPath();
    });
    
    // --- (Tombol Reset Default tetap sama) ---
    if (ui.massResetBtn) {
      ui.massResetBtn.addEventListener("click", () => {
        currentMass = defaults.mass;
        if (ui.massSlider) ui.massSlider.value = String(currentMass);
        if (ui.massValue) ui.massValue.textContent = currentMass.toFixed(1);
        updateDensityUI();
        updateDerivedUI();
        if (object) {
          object.mass = currentMass;
          if (currentModelKey === 'sphere') updateObjectColor();
        }
        updatePredictionPath();
      });
    }
    if (ui.initHeightResetBtn) {
      ui.initHeightResetBtn.addEventListener("click", () => {
        currentInitHeight = defaults.initHeight;
        if (ui.initHeightSlider) ui.initHeightSlider.value = String(currentInitHeight.toFixed(2));
        if (ui.initHeightValue) ui.initHeightValue.textContent = currentInitHeight.toFixed(2);
        if (!isThrown && object) {
          const prevTarget = controls ? controls.target.clone() : new THREE.Vector3();
          const offset = camera && prevTarget ? camera.position.clone().sub(prevTarget) : new THREE.Vector3(0, 5, 12);
          object.mesh.position.set(0, currentInitHeight, 0);
          if(loadedModel) {
            loadedModel.position.set(0, currentInitHeight, 0);
          }
          lastRecordedPos.set(0, currentInitHeight, 0);
          resetPath();
          if (controls && camera) {
            const targetPos = loadedModel ? loadedModel.position : object.mesh.position;
            controls.target.copy(targetPos);
            camera.position.copy(targetPos.clone().add(offset));
            controls.update();
          }
        }
        updatePredictionPath();
      });
    }
    if (ui.angleResetBtn) {
      ui.angleResetBtn.addEventListener("click", () => {
        currentAngle = defaults.angle;
        if (ui.angleSlider) ui.angleSlider.value = String(currentAngle);
        if (ui.angleValue) ui.angleValue.textContent = String(currentAngle);
        updatePredictionPath();
      });
    }
    if (ui.speedResetBtn) {
      ui.speedResetBtn.addEventListener("click", () => {
        currentSpeed = defaults.speed;
        if (ui.speedSlider) ui.speedSlider.value = String(currentSpeed);
        if (ui.speedValue) ui.speedValue.textContent = String(currentSpeed);
        updatePredictionPath();
      });
    }
    if (ui.airDragScaleResetBtn) {
      ui.airDragScaleResetBtn.addEventListener("click", () => {
        airDragScale = defaults.airDragScale;
        if (ui.airDragScaleSlider) ui.airDragScaleSlider.value = String(airDragScale.toFixed(2));
        if (ui.airDragScaleValue) ui.airDragScaleValue.textContent = airDragScale.toFixed(2);
        updatePredictionPath();
      });
    }
    if (ui.airBuoyScaleResetBtn) {
      ui.airBuoyScaleResetBtn.addEventListener("click", () => {
        airBuoyScale = defaults.airBuoyScale;
        if (ui.airBuoyScaleSlider) ui.airBuoyScaleSlider.value = String(airBuoyScale.toFixed(2));
        if (ui.airBuoyScaleValue) ui.airBuoyScaleValue.textContent = airBuoyScale.toFixed(2);
        updatePredictionPath();
      });
    }

    // Tombol Lempar (tetap sama)
    ui.throwBtn.addEventListener("click", () => {
      resetPhysics();
      const angleRad = (currentAngle * Math.PI) / 180;
      velocity.x = currentSpeed * Math.cos(angleRad);
      velocity.y = currentSpeed * Math.sin(angleRad);
      lastRecordedPos.set(0, currentInitHeight, 0);
      inWater = false;
      wasInWater = false;
      isThrown = true;
      setStatus("Status: terlempar");
      hidePredictionPath();
    });

    // Tombol Reset (tetap sama)
    ui.resetBtn.addEventListener("click", () => {
      ui.modelSelect.value = defaults.model;
      currentModelKey = defaults.model;
      if (loadedModel) {
          scene.remove(loadedModel);
          loadedModel = null;
      }
      createObject();
      loadModel(currentModelKey, () => {
        resetPhysics();
        updatePredictionPath();
        camera.position.set(0, 5, 12);
        const targetPos = loadedModel ? loadedModel.position : object.mesh.position;
        controls.target.copy(targetPos);
      });
    });

    // Handle Resize (tetap sama)
    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // --- Mulai Inisialisasi ---
  init();
  // Sinkronkan UI awal
  updateMassUI();
  updateInitHeightUI();
  updateDerivedUI();
}); 
