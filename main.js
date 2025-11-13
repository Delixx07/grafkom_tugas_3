// Cek apakah THREE sudah dimuat dari CDN
if (
  typeof THREE === "undefined" ||
  typeof THREE.OrbitControls === "undefined" ||
  typeof THREE.Water === "undefined"
) {
  alert(
    "Gagal memuat library Three.js, OrbitControls, atau Water! Cek koneksi internet atau script tag."
  );
}

// Menunggu sampai semua HTML selesai dimuat
window.addEventListener("DOMContentLoaded", () => {
  // --- Variabel Global untuk Scene ---
  let scene, camera, renderer, object, velocity, inWater;
  let controls; // Variabel untuk OrbitControls
  let water; // Variabel untuk Objek Air BARU
  const clock = new THREE.Clock();
  let animationId = null;
  let simTime = 0; // waktu simulasi terakumulasi

  // --- Variabel untuk Jalur Lintasan ---
  let pathPoints = [];
  let pathLine = null;
  let predictionLine = null;
  const maxPathPoints = 500;
  let isThrown = false; // Flag untuk menandai apakah bola sedang dilempar
  let lastRecordedPos = new THREE.Vector3();
  const minDistanceToRecord = 0.1;

  // --- Variabel untuk Splash (Ripple + Partikel) ---
  let wasInWater = false; // untuk deteksi transisi udara -> air
  const splashRings = []; // array objek { mesh, elapsed, duration }
  const dropletEmitters = []; // array objek { points, velocities[], elapsed, duration }

  // --- Parameter Air & Drag Lebih Realistis ---
  const rhoAir = 1.225; // kg/m^3
  const CdSphere = 0.47; // koefisien drag untuk bola
  const waterCurrent = new THREE.Vector3(0.25, 0.0, 0.0); // arus air sederhana (m/s)

  // --- Gelombang Permukaan (untuk fisika) ---
  const waves = {
    amp1: 0.12, // amplitudo gelombang 1 (meter)
    amp2: 0.07, // amplitudo gelombang 2
    dir1: new THREE.Vector2(1, 0).normalize(), // arah propagasi (x,z)
    dir2: new THREE.Vector2(0.3, 0.7).normalize(),
    wl1: 6.0, // panjang gelombang (m)
    wl2: 3.5,
    sp1: 1.2, // kecepatan fasa (m/s)
    sp2: 0.8,
  };

  function waterSurfaceHeightAt(x, z, t) {
    // Model gelombang sinus sederhana (superposisi 2 gelombang)
    const k1 = (2 * Math.PI) / waves.wl1;
    const k2 = (2 * Math.PI) / waves.wl2;
    const phase1 =
      k1 * (waves.dir1.x * x + waves.dir1.y * z) - waves.sp1 * k1 * t;
    const phase2 =
      k2 * (waves.dir2.x * x + waves.dir2.y * z) - waves.sp2 * k2 * t;
    return waves.amp1 * Math.sin(phase1) + waves.amp2 * Math.sin(phase2);
  }

  // --- Konstanta Fisika ---
  const g = -9.81;
  const rhoWater = 1000;

  // --- Ambil Elemen UI dari HTML ---
  const ui = {
    container: document.getElementById("scene-container"),
    massSlider: document.getElementById("mass"),
    massValue: document.getElementById("massValue"),
    massResetBtn: document.getElementById("massReset"),
    radiusSlider: document.getElementById("radius"),
    radiusValue: document.getElementById("radiusValue"),
    radiusResetBtn: document.getElementById("radiusReset"),
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
  let currentAngle = 45;
  let currentSpeed = 20;
  let currentMass =
    (document.getElementById("mass") &&
      parseFloat(document.getElementById("mass").value)) ||
    113.1;
  let currentRadius =
    (document.getElementById("radius") &&
      parseFloat(document.getElementById("radius").value)) ||
    0.3;
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
    radius: 0.3,
    initHeight: 2.0,
    angle: 45,
    speed: 20,
    airDragScale: 1.0,
    airBuoyScale: 0.0,
  };

  function getColorForDensity(density) {
    if (density < rhoWater * 0.97) return 0x00ff88; // float
    if (density > rhoWater * 1.03) return 0xff5555; // sink
    return 0xffee66; // neutral
  }

  // --- Helper tampilkan angka ---
  function updateDensityUI() {
    const V = (4 / 3) * Math.PI * Math.pow(currentRadius, 3);
    const rho = currentMass / V;
    if (ui.densityValue) ui.densityValue.textContent = rho.toFixed(1);
  }

  function updateMassRadiusUI() {
    if (ui.massSlider) ui.massSlider.value = String(currentMass);
    if (ui.massValue) ui.massValue.textContent = Number(currentMass).toFixed(1);
    if (ui.radiusSlider)
      ui.radiusSlider.value = String(currentRadius.toFixed(2));
    if (ui.radiusValue)
      ui.radiusValue.textContent = Number(currentRadius).toFixed(2);
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
    // Ballistic coefficient: m / (Cd * A)
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
    // Disable damping so camera drag stops immediately (not slidey)
    controls.enableDamping = false;
    controls.dampingFactor = 0.0;
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
      shininess: 10,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -5;
    ground.receiveShadow = true;
    scene.add(ground);

    // *** TAMPILAN LAUT BARU ***
    // Hapus kode waterGeo dan waterMat yang lama

    // 1. Load tekstur normal untuk gelombang
    const waterNormals = new THREE.TextureLoader().load(
      "https://threejs.org/examples/textures/waternormals.jpg",
      function (texture) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      }
    );

    // 2. Buat geometri (tetap Plane, tapi akan dianimasikan oleh shader)
    const waterGeo = new THREE.PlaneGeometry(500, 500);

    // 3. Buat objek Water
    water = new THREE.Water(waterGeo, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: waterNormals,
      alpha: 0.9, // sedikit lebih transparan dan reflective
      sunDirection: dir.position.clone().normalize(),
      sunColor: 0xffffff,
      waterColor: 0x0f5aa6, // warna air lebih dalam
      distortionScale: 2.6, // gelombang lebih halus/realistis
      fog: scene.fog !== undefined,
    });

    water.rotation.x = -Math.PI / 2;
    water.position.y = 0; // ketinggian rata-rata permukaan
    // Sesuaikan skala normal agar gelombang visual lebih besar
    if (
      water.material &&
      water.material.uniforms &&
      water.material.uniforms.size
    ) {
      water.material.uniforms.size.value = 2.0;
    }
    scene.add(water);
    // **************************

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

    // Buat objek awal
    createObject();

    // Tambahkan Event Listeners
    setupEventListeners();

    // Mulai animasi
    animate();

    // Tampilkan prediksi awal
    updatePredictionPath();
  }

  // --- Fungsi Pembuatan Objek ---
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
    const material = new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.6,
      roughness: 0.2,
      emissive: color,
      emissiveIntensity: 0.2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, currentInitHeight, 0);
    mesh.castShadow = true;

    object = { mesh, mass, radius, color };
    scene.add(mesh);
    resetPhysics();
  }

  // --- Fungsi Reset Fisika ---
  function resetPhysics() {
    velocity = new THREE.Vector3(0, 0, 0);
    inWater = false;
    wasInWater = false;
    isThrown = false;
    object.mesh.position.set(0, currentInitHeight, 0);
    setStatus("Status: diam");
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
    const simPosition = new THREE.Vector3(0, currentInitHeight, 0);
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
      const F_drag = simVelocity
        .clone()
        .normalize()
        .multiplyScalar(-k_drag_air * speedSq);
      const F_b_air = new THREE.Vector3(
        0,
        rhoAir * simV * -g * airBuoyScale,
        0
      );
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
    predictionLine.geometry = new THREE.BufferGeometry().setFromPoints(
      predictionPoints
    );
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

  // --- Submerged volume & buoyancy (dengan permukaan dinamis) ---
  function computeSubmerged(radius, centerY, surfaceY) {
    // h adalah tinggi "cap" terendam dari puncak bola ke bidang permukaan
    const h = THREE.MathUtils.clamp(
      radius - (centerY - surfaceY),
      0,
      2 * radius
    );
    const V_sub = (Math.PI * h * h * (3 * radius - h)) / 3;
    const V_total = (4 / 3) * Math.PI * radius ** 3;
    return { V_sub, fraction: THREE.MathUtils.clamp(V_sub / V_total, 0, 1) };
  }
  function computeBuoyantForce(radius, centerY, surfaceY) {
    const { V_sub } = computeSubmerged(radius, centerY, surfaceY);
    return rhoWater * V_sub * -g; // arah ke atas (karena g negatif)
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

    let statusText = "di udara";
    const surfaceY = waterSurfaceHeightAt(
      mesh.position.x,
      mesh.position.z,
      simTime
    );
    const bottomOfBallY = mesh.position.y - radius;

    if (bottomOfBallY <= surfaceY) {
      inWater = true;
    } else {
      inWater = false;
    }

    if (inWater) {
      if (rhoObject > rhoWater * 1.01) statusText = "tenggelam";
      else if (rhoObject < rhoWater * 0.99) statusText = "mengapung";
      else statusText = "melayang";
    }
    setStatus("Status: " + statusText);

    let F_total = new THREE.Vector3(0, mass * g, 0);

    // Deteksi momen bola pertama kali menyentuh permukaan air (udara -> air)
    if (!wasInWater && inWater) {
      // Estimasi titik tumbukan di permukaan air
      const hitPos = new THREE.Vector3(
        mesh.position.x,
        surfaceY + 0.01,
        mesh.position.z
      );
      const impactSpeed = Math.max(0, -velocity.y);
      triggerSplash(hitPos, impactSpeed, radius);
    }

    if (inWater) {
      if (bottomOfBallY < surfaceY) {
        const F_b = computeBuoyantForce(radius, mesh.position.y, surfaceY);
        F_total.y += F_b;
      }
    }

    // Drag lebih fisik: F = 0.5 * rho * Cd * A * v^2
    const A = Math.PI * radius * radius; // luas penampang bola
    const { V_sub, fraction: f_sub } = computeSubmerged(
      radius,
      mesh.position.y,
      surfaceY
    );
    const f_air = 1 - f_sub;

    // Kecepatan relatif terhadap arus air (hanya horizontal)
    const v_rel_water = velocity.clone();
    v_rel_water.x -= waterCurrent.x;
    v_rel_water.z -= waterCurrent.z;

    const eps = 1e-5;
    if (velocity.lengthSq() > eps) {
      if (f_air > 0) {
        const v = velocity.length();
        const Fd_air_mag =
          0.5 * rhoAir * CdSphere * A * v * v * f_air * airDragScale;
        const Fd_air = velocity.clone().normalize().multiplyScalar(-Fd_air_mag);
        F_total.add(Fd_air);
      }
      if (f_sub > 0) {
        const vW = v_rel_water.length();
        const Fd_water_mag = 0.5 * rhoWater * CdSphere * A * vW * vW * f_sub;
        const Fd_water = v_rel_water
          .clone()
          .normalize()
          .multiplyScalar(-Fd_water_mag);
        F_total.add(Fd_water);
      }
    }

    // Air buoyancy (only for the portion in air)
    if (f_air > 0) {
      const F_b_air = rhoAir * V_total * -g * airBuoyScale * f_air;
      F_total.y += F_b_air;
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

    if (statusText === "mengapung" && inWater) {
      if (Math.abs(velocity.y) < 0.05 && Math.abs(acceleration.y) < 0.05) {
        velocity.y = 0;
        acceleration.y = 0;
        mesh.position.y += F_total.y * 0.001;
      }
    }

    mesh.position.z = 0;
    velocity.z = 0;

    // Update flag transisi air
    wasInWater = inWater;
  }

  // --- Loop Animasi (DIPERBAIKI) ---
  function animate() {
    animationId = requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.05);
    simTime += delta;

    if (object) {
      updatePhysics(delta);
      updatePath();

      if (isThrown) {
        controls.target.copy(object.mesh.position);
      } else {
        // Saat belum dilempar, kunci target kamera ke bola juga
        controls.target.copy(object.mesh.position);
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
      // sinkronkan kecepatan gelombang shader dengan waktu simulasi
      water.material.uniforms["time"].value = simTime * 0.5;
    }
    // **********************

    // Update animasi splash (ring + partikel)
    updateSplashRings(delta);
    updateDropletEmitters(delta);

    renderer.render(scene, camera);

    // Update UI kecepatan saat ini
    if (ui.currentSpeed) {
      const v = velocity ? velocity.length() : 0;
      ui.currentSpeed.textContent = v.toFixed(2);
    }
  }

  // --- Trigger Splash: ripple ring + droplets ---
  function triggerSplash(position, impactSpeed, radius) {
    // Parameter intensitas berdasarkan energi kinetik dan ukuran bola
    const m = object ? object.mass : currentMass;
    const KE = 0.5 * m * impactSpeed * impactSpeed;
    const intensity = THREE.MathUtils.clamp(
      Math.sqrt(KE) / 8 + radius * 1.5,
      0.3,
      5.0
    );
    createSplashRing(position, intensity);
    spawnDroplets(position, impactSpeed, radius, m, KE, intensity);
  }

  // --- Ripple Ring ---
  function createSplashRing(position, intensity) {
    const innerR = 0.2 * intensity;
    const outerR = 0.25 * intensity;
    const geo = new THREE.RingGeometry(innerR, outerR, 64);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8ec8ff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(position);
    // posisinya sudah diberi surfaceY + 0.01 saat trigger, cukup tambah offset kecil
    ring.position.y += 0.01; // hindari z-fighting dengan permukaan air
    scene.add(ring);

    splashRings.push({
      mesh: ring,
      elapsed: 0,
      duration: 1.2, // detik
      startScale: 1,
      endScale: 5 * intensity,
    });
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

  // --- Particle Droplets ---
  function spawnDroplets(position, impactSpeed, radius, mass, KE, intensity) {
    // Tentukan jumlah partikel berdasarkan kecepatan tumbukan dan ukuran
    const count = THREE.MathUtils.clamp(
      Math.floor(20 + 0.02 * KE + radius * 120),
      30,
      400
    );
    const positions = new Float32Array(count * 3);
    const velocities = new Array(count);

    // Arah dasar ke atas + sebaran horizontal mengikuti arah kecepatan objek (jika ada)
    const up = new THREE.Vector3(0, 1, 0);
    const baseSpeed = 1.0 + impactSpeed * 0.5 + intensity * 0.2; // kecepatan awal rata-rata tetesan

    for (let i = 0; i < count; i++) {
      // Posisi awal disekitar titik tumbukan (dalam radius kecil)
      const angle = Math.random() * Math.PI * 2;
      const rad = Math.random() * (0.15 + radius * 0.2);
      const offset = new THREE.Vector3(
        Math.cos(angle) * rad,
        0,
        Math.sin(angle) * rad
      );
      const px = position.x + offset.x;
      const py = position.y + 0.02; // sedikit di atas permukaan
      const pz = position.z + offset.z;
      positions[i * 3 + 0] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;

      // Kecepatan awal: dominan ke atas + sedikit menyebar horizontal
      const dir = new THREE.Vector3(
        Math.cos(angle),
        0.8 + Math.random() * 0.4,
        Math.sin(angle)
      ).normalize();
      const speed = baseSpeed * (0.6 + Math.random() * 0.7);
      velocities[i] = dir.multiplyScalar(speed);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaeddff,
      size: 0.05 + radius * 0.06,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    dropletEmitters.push({
      points,
      velocities,
      elapsed: 0,
      duration: 1.6, // detik hidup rata-rata tetesan
    });
  }

  function updateDropletEmitters(delta) {
    const gravity = -9.81; // m/s^2
    for (let e = dropletEmitters.length - 1; e >= 0; e--) {
      const emitter = dropletEmitters[e];
      emitter.elapsed += delta;
      const lifeT = emitter.elapsed / emitter.duration;

      const posAttr = emitter.points.geometry.getAttribute("position");
      const arr = posAttr.array;

      for (let i = 0; i < emitter.velocities.length; i++) {
        const idx = i * 3;
        // Update velocity oleh gravitasi
        emitter.velocities[i].y += gravity * delta * 0.7; // sedikit lebih ringan daripada gravitasi penuh

        // Update posisi
        arr[idx + 0] += emitter.velocities[i].x * delta;
        arr[idx + 1] += emitter.velocities[i].y * delta;
        arr[idx + 2] += emitter.velocities[i].z * delta;

        // Jika jatuh kembali ke air (permukaan dinamis), hapus/"matikan" partikel
        const surf = waterSurfaceHeightAt(arr[idx + 0], arr[idx + 2], simTime);
        if (arr[idx + 1] <= surf) {
          arr[idx + 1] = -9999; // sembunyikan jauh di bawah agar tidak dirender
          emitter.velocities[i].set(0, 0, 0);
        }
      }

      posAttr.needsUpdate = true;
      // Fade-out material seiring waktu hidup emitter
      emitter.points.material.opacity = 0.95 * (1 - lifeT);

      if (lifeT >= 1) {
        scene.remove(emitter.points);
        emitter.points.geometry.dispose();
        emitter.points.material.dispose();
        dropletEmitters.splice(e, 1);
      }
    }
  }

  // --- Setup Event Listeners ---
  function setupEventListeners() {
    // (Dropdown benda dihapus; objek sepenuhnya dikustom via massa & jari-jari)

    // Slider Sudut
    ui.angleSlider.addEventListener("input", (e) => {
      currentAngle = Number(e.target.value);
      ui.angleValue.textContent = currentAngle;
      updatePredictionPath(); // Update prediksi
    });

    // Slider Kecepatan
    ui.speedSlider.addEventListener("input", (e) => {
      currentSpeed = Number(e.target.value);
      ui.speedValue.textContent = currentSpeed;
      updatePredictionPath(); // Update prediksi
    });

    // Slider Massa
    ui.massSlider.addEventListener("input", (e) => {
      currentMass = Number(e.target.value);
      ui.massValue.textContent = currentMass.toFixed(1);
      updateDensityUI();
      updateDerivedUI();
      if (object) {
        object.mass = currentMass; // update mass on the fly
        updateObjectColor();
      }
      updatePredictionPath();
    });

    // Slider Radius
    ui.radiusSlider.addEventListener("input", (e) => {
      const newR = Number(e.target.value);
      currentRadius = newR;
      ui.radiusValue.textContent = newR.toFixed(2);
      updateDensityUI();
      updateDerivedUI();
      if (object) {
        // Ganti geometri tanpa reset fisika
        const pos = object.mesh.position.clone();
        object.mesh.geometry.dispose();
        object.mesh.geometry = new THREE.SphereGeometry(newR, 32, 32);
        object.mesh.position.copy(pos);
        object.radius = newR;
        updateObjectColor();
      }
      updatePredictionPath();
    });

    // Slider Skala Hambatan Udara
    if (ui.airDragScaleSlider) {
      ui.airDragScaleSlider.addEventListener("input", (e) => {
        airDragScale = Number(e.target.value);
        if (ui.airDragScaleValue)
          ui.airDragScaleValue.textContent = airDragScale.toFixed(2);
        updatePredictionPath();
      });
    }

    // Slider Skala Gaya Apung Udara
    if (ui.airBuoyScaleSlider) {
      ui.airBuoyScaleSlider.addEventListener("input", (e) => {
        airBuoyScale = Number(e.target.value);
        if (ui.airBuoyScaleValue)
          ui.airBuoyScaleValue.textContent = airBuoyScale.toFixed(2);
        updatePredictionPath();
      });
    }

    // Slider Ketinggian Awal
    ui.initHeightSlider.addEventListener("input", (e) => {
      currentInitHeight = Number(e.target.value);
      ui.initHeightValue.textContent = currentInitHeight.toFixed(2);
      if (!isThrown && object) {
        // Simpan offset kamera relatif ke target sebelum perubahan
        const prevTarget = controls
          ? controls.target.clone()
          : new THREE.Vector3();
        const offset =
          camera && prevTarget
            ? camera.position.clone().sub(prevTarget)
            : new THREE.Vector3(0, 5, 12);

        object.mesh.position.set(0, currentInitHeight, 0);
        lastRecordedPos.set(0, currentInitHeight, 0);
        resetPath();

        // Kunci kamera ke bola dengan menjaga offset sebelumnya
        if (controls && camera) {
          controls.target.copy(object.mesh.position);
          camera.position.copy(object.mesh.position.clone().add(offset));
          controls.update();
        }
      }
      updatePredictionPath();
    });

    // --- Default Buttons ---
    if (ui.massResetBtn) {
      ui.massResetBtn.addEventListener("click", () => {
        currentMass = defaults.mass;
        if (ui.massSlider) ui.massSlider.value = String(currentMass);
        if (ui.massValue) ui.massValue.textContent = currentMass.toFixed(1);
        updateDensityUI();
        updateDerivedUI();
        if (object) {
          object.mass = currentMass;
          updateObjectColor();
        }
        updatePredictionPath();
      });
    }

    if (ui.radiusResetBtn) {
      ui.radiusResetBtn.addEventListener("click", () => {
        const newR = defaults.radius;
        currentRadius = newR;
        if (ui.radiusSlider) ui.radiusSlider.value = String(newR.toFixed(2));
        if (ui.radiusValue) ui.radiusValue.textContent = newR.toFixed(2);
        updateDensityUI();
        updateDerivedUI();
        if (object) {
          const pos = object.mesh.position.clone();
          object.mesh.geometry.dispose();
          object.mesh.geometry = new THREE.SphereGeometry(newR, 32, 32);
          object.mesh.position.copy(pos);
          object.radius = newR;
          updateObjectColor();
        }
        updatePredictionPath();
      });
    }

    if (ui.initHeightResetBtn) {
      ui.initHeightResetBtn.addEventListener("click", () => {
        currentInitHeight = defaults.initHeight;
        if (ui.initHeightSlider)
          ui.initHeightSlider.value = String(currentInitHeight.toFixed(2));
        if (ui.initHeightValue)
          ui.initHeightValue.textContent = currentInitHeight.toFixed(2);
        if (!isThrown && object) {
          const prevTarget = controls
            ? controls.target.clone()
            : new THREE.Vector3();
          const offset =
            camera && prevTarget
              ? camera.position.clone().sub(prevTarget)
              : new THREE.Vector3(0, 5, 12);
          object.mesh.position.set(0, currentInitHeight, 0);
          lastRecordedPos.set(0, currentInitHeight, 0);
          resetPath();
          if (controls && camera) {
            controls.target.copy(object.mesh.position);
            camera.position.copy(object.mesh.position.clone().add(offset));
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
        if (ui.airDragScaleSlider)
          ui.airDragScaleSlider.value = String(airDragScale.toFixed(2));
        if (ui.airDragScaleValue)
          ui.airDragScaleValue.textContent = airDragScale.toFixed(2);
        updatePredictionPath();
      });
    }

    if (ui.airBuoyScaleResetBtn) {
      ui.airBuoyScaleResetBtn.addEventListener("click", () => {
        airBuoyScale = defaults.airBuoyScale;
        if (ui.airBuoyScaleSlider)
          ui.airBuoyScaleSlider.value = String(airBuoyScale.toFixed(2));
        if (ui.airBuoyScaleValue)
          ui.airBuoyScaleValue.textContent = airBuoyScale.toFixed(2);
        updatePredictionPath();
      });
    }

    // Tombol Lempar
    ui.throwBtn.addEventListener("click", () => {
      createObject();

      const angleRad = (currentAngle * Math.PI) / 180;
      velocity.x = currentSpeed * Math.cos(angleRad);
      velocity.y = currentSpeed * Math.sin(angleRad);

      object.mesh.position.set(0, currentInitHeight, 0);
      lastRecordedPos.set(0, currentInitHeight, 0);
      inWater = false;
      wasInWater = false;
      isThrown = true; // Set flag saat melempar
      setStatus("Status: terlempar");

      hidePredictionPath();
    });

    // Tombol Reset
    ui.resetBtn.addEventListener("click", () => {
      createObject();
      // Reset kamera namun tetap mengarah ke bola
      camera.position.set(0, 5, 12);
      if (controls && object) {
        controls.target.copy(object.mesh.position);
      }
    });

    // Handle Resize
    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // --- Mulai Inisialisasi ---
  init();
  // Sinkronkan UI awal untuk massa & radius & densitas
  updateMassRadiusUI();
  updateInitHeightUI();
  updateDerivedUI();
});
