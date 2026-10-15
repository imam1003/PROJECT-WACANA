
import * as THREE from
  "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

const startButton = document.querySelector("#startAR");
const placeButton = document.querySelector("#placeAgain");
const resetButton = document.querySelector("#reset");
const fileInput = document.querySelector("#menuFile");
const preview = document.querySelector("#preview");
const statusText = document.querySelector("#status");
const message = document.querySelector("#message");
const hint = document.querySelector("#arHint");

let renderer;
let scene;
let camera;
let reticle;
let hitTestSource = null;
let currentTexture = null;
let placedMenus = [];
let hitPoseAvailable = false;
let arSession = null;
let localSpace = null;

const textureLoader = new THREE.TextureLoader();

function setMessage(text) {
  message.textContent = text;
}

function setStatus(text) {
  statusText.textContent = text;
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    textureLoader.load(url, resolve, undefined, reject);
  });
}

async function loadMenu(url) {
  try {
    const texture = await loadTexture(url);
    texture.colorSpace = THREE.SRGBColorSpace;

    if (currentTexture) currentTexture.dispose();
    currentTexture = texture;

    preview.src = url;
    setMessage("Gambar menu berhasil dimuat.");
  } catch (error) {
    console.error(error);
    setMessage(
      "Gambar gagal dimuat. Periksa file di folder assets."
    );
  }
}

// Gambar bawaan
loadMenu("./assets/menu-burger.png");

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    setMessage("Pilih file gambar PNG atau JPG.");
    return;
  }

  const url = URL.createObjectURL(file);
  await loadMenu(url);
  // Jangan revoke URL sebelum tekstur selesai digunakan.
});

function createRenderer() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.01,
    20
  );

  renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true
  });

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 2)
  );
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  renderer.setClearColor(0x000000, 0);

  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.zIndex = "1";

  document.body.appendChild(renderer.domElement);

  // Penanda lokasi permukaan yang terdeteksi.
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.09, 32),
    new THREE.MeshBasicMaterial({
      color: 0x63ff9a,
      side: THREE.DoubleSide
    })
  );

  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  renderer.setAnimationLoop(renderFrame);
}

function renderFrame(time, frame) {
  if (frame && hitTestSource && localSpace) {
    const results = frame.getHitTestResults(hitTestSource);

    if (results.length > 0) {
      const pose = results[0].getPose(localSpace);

      if (pose) {
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
        hitPoseAvailable = true;
      }
    } else {
      reticle.visible = false;
      hitPoseAvailable = false;
    }
  }

  renderer.render(scene, camera);
}

function makeMenuAtReticle() {
  if (!currentTexture) {
    setMessage("Pilih gambar menu terlebih dahulu.");
    return;
  }

  if (!hitPoseAvailable || !reticle.visible) {
    setMessage(
      "Permukaan belum terdeteksi. Arahkan kamera ke meja dan gerakkan HP perlahan."
    );
    return;
  }

  const image = currentTexture.image;
  const aspect = image?.width && image?.height
    ? image.width / image.height
    : 1;

  // Lebar awal 25 cm; tinggi mengikuti rasio gambar.
  const width = 0.25;
  const height = width / aspect;

  const material = new THREE.MeshBasicMaterial({
    map: currentTexture,
    side: THREE.DoubleSide,
    transparent: true
  });

  const menuPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    material
  );

  menuPlane.matrixAutoUpdate = false;
  menuPlane.matrix.copy(reticle.matrix);
  menuPlane.matrixAutoUpdate = true;
  menuPlane.position.setFromMatrixPosition(reticle.matrix);
  menuPlane.quaternion.setFromRotationMatrix(reticle.matrix);

  scene.add(menuPlane);
  placedMenus.push(menuPlane);

  setMessage("Menu 2D berhasil diletakkan di permukaan.");
  resetButton.disabled = false;
}

async function startAR() {
  if (!navigator.xr) {
    setMessage(
      "Browser ini tidak menyediakan WebXR. Coba Chrome Android pada perangkat yang mendukung ARCore."
    );
    return;
  }

  try {
    const supported = await navigator.xr.isSessionSupported(
      "immersive-ar"
    );

    if (!supported) {
      setMessage(
        "Mode immersive-ar tidak didukung browser/perangkat ini. Periksa dukungan ARCore dan coba Chrome Android."
      );
      return;
    }

    if (!renderer) createRenderer();

    const session = await navigator.xr.requestSession(
      "immersive-ar",
      {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["dom-overlay"],
        domOverlay: { root: document.body }
      }
    );

    arSession = session;
    await renderer.xr.setSession(session);

    localSpace = await session.requestReferenceSpace("local");
    const viewerSpace = await session.requestReferenceSpace("viewer");

    hitTestSource = await session.requestHitTestSource({
      space: viewerSpace
    });

    document.body.classList.add("ar-active");
    hint.hidden = false;
    startButton.disabled = true;
    placeButton.disabled = false;
    setStatus("AR aktif");
    setMessage(
      "Arahkan kamera ke meja. Ketuk layar untuk menempatkan gambar."
    );

    session.addEventListener("select", makeMenuAtReticle);

    session.addEventListener("end", () => {
      hitTestSource = null;
      localSpace = null;
      arSession = null;
      hitPoseAvailable = false;
      reticle.visible = false;
      hint.hidden = true;
      startButton.disabled = false;
      placeButton.disabled = true;
      document.body.classList.remove("ar-active");
      setStatus("Siap");
      setMessage("Sesi AR berakhir.");

      if (renderer) {
        renderer.setAnimationLoop(null);
        renderer.domElement.remove();
        renderer.dispose();
        renderer = null;
      }

      scene = null;
      camera = null;
      reticle = null;
      placedMenus = [];
      resetButton.disabled = true;
    });
  } catch (error) {
    console.error(error);
    setMessage(
      "AR gagal dimulai: " + (error.message || "periksa izin kamera dan dukungan perangkat.")
    );
    setStatus("Gagal");
  }
}

startButton.addEventListener("click", startAR);

placeButton.addEventListener("click", () => {
  makeMenuAtReticle();
});

resetButton.addEventListener("click", () => {
  for (const menu of placedMenus) {
    scene?.remove(menu);
    menu.geometry.dispose();
    menu.material.dispose();
  }

  placedMenus = [];
  resetButton.disabled = true;
  setMessage("Semua menu yang diletakkan telah dihapus.");
});

window.addEventListener("resize", () => {
  if (!renderer || !camera) return;

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
