import * as THREE from 'three';

const STORAGE_KEY = 'echo-bubble-loop::bubble-set';
const MAX_BUBBLES = 10;
const RING_RADIUS = 1.5;
const STICK_DISTANCE = 0.5;
const FORWARD_PLACE_DISTANCE = 0.4;
const FLOAT_SPEED = 0.85;
const FLOAT_HEIGHT = 0.08;
const FADE_SECONDS = 0.3;
const BOUNCE_SECONDS = 0.7;
const CAMERA_HEIGHT = 1.55;
const LOOK_SENSITIVITY = 0.0032;
const PAN_LIMIT = Math.PI * 0.32;

const scratch = {
  forward: new THREE.Vector3(0, 0, -1),
  cameraWorld: new THREE.Vector3(),
  bubbleWorld: new THREE.Vector3(),
  cameraQuaternion: new THREE.Quaternion(),
  raycaster: new THREE.Raycaster(),
  pointer: new THREE.Vector2(),
};

const state = {
  bubbleSet: [],
  selectedIds: new Set(),
  bubbles: [],
  bubbleCount: 4,
  audioContext: null,
  masterGain: null,
  renderer: null,
  scene: null,
  camera: null,
  clock: new THREE.Clock(),
  orientationPermissionGranted: false,
  orientationActive: false,
  yaw: 0,
  pitch: 0,
  dragging: false,
  dragPointerId: null,
  dragMoved: false,
  lastPointer: { x: 0, y: 0 },
  deviceEuler: new THREE.Euler(0, 0, 0, 'YXZ'),
  deviceQuaternion: new THREE.Quaternion(),
  deviceAlphaOffset: 0,
  hasAlphaOffset: false,
  bubbleSerial: 0,
  toastTimer: 0,
  resizeObserver: null,
};

const dom = {
  scene: document.querySelector('#scene'),
  fileInput: document.querySelector('#fileInput'),
  importButton: document.querySelector('#importButton'),
  permissionButton: document.querySelector('#permissionButton'),
  togglePanelButton: document.querySelector('#togglePanelButton'),
  controlPanel: document.querySelector('#controlPanel'),
  statusLine: document.querySelector('#statusLine'),
  libraryCount: document.querySelector('#libraryCount'),
  selectedList: document.querySelector('#selectedList'),
  emptyLibrary: document.querySelector('#emptyLibrary'),
  selectionSummary: document.querySelector('#selectionSummary'),
  bubbleSlider: document.querySelector('#bubbleCount'),
  bubbleSliderMeta: document.querySelector('#bubbleSliderMeta'),
  generateButton: document.querySelector('#generateButton'),
  addForwardButton: document.querySelector('#addForwardButton'),
  undoButton: document.querySelector('#undoButton'),
  clearButton: document.querySelector('#clearButton'),
  activeCount: document.querySelector('#activeCount'),
  bubbleList: document.querySelector('#bubbleList'),
  emptyScene: document.querySelector('#emptyScene'),
  toast: document.querySelector('#toast'),
};

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');
  state.toastTimer = window.setTimeout(() => {
    dom.toast.classList.remove('is-visible');
  }, 2200);
}

function updateStatus(message) {
  dom.statusLine.textContent = message;
}

function clampBubbleCount(value) {
  return Math.min(MAX_BUBBLES, Math.max(1, Number(value) || 1));
}

function updateSelectionSummary() {
  const count = state.selectedIds.size;
  dom.selectionSummary.textContent = count
    ? `${count} sound${count > 1 ? 's' : ''} selected for generation`
    : 'Select at least one sound';
  dom.bubbleSliderMeta.textContent = `${state.bubbleCount} bubble${state.bubbleCount > 1 ? 's' : ''}`;
}

function saveBubbleSet() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.bubbleSet));
}

function loadBubbleSet() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return;
    }
    state.bubbleSet = parsed
      .filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.url === 'string')
      .slice(0, 24);
    state.selectedIds = new Set(state.bubbleSet.slice(0, Math.min(4, state.bubbleSet.length)).map((item) => item.id));
  } catch (error) {
    console.warn('Failed to restore bubble set.', error);
    localStorage.removeItem(STORAGE_KEY);
  }
}

function toDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Unable to read file.'));
    reader.readAsDataURL(file);
  });
}

async function importFiles(files) {
  if (!files.length) {
    return;
  }

  const imported = [];
  for (const file of files) {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav)$/i.test(file.name)) {
      continue;
    }

    const url = await toDataUrl(file);
    imported.push({
      id: crypto.randomUUID(),
      name: file.name,
      url,
    });
  }

  if (!imported.length) {
    showToast('Only mp3 and wav files can be imported here.');
    return;
  }

  state.bubbleSet = [...state.bubbleSet, ...imported].slice(-24);
  const nextSelected = new Set(state.selectedIds);
  imported.forEach((item) => {
    if (nextSelected.size < MAX_BUBBLES) {
      nextSelected.add(item.id);
    }
  });
  state.selectedIds = nextSelected;

  try {
    saveBubbleSet();
  } catch (error) {
    console.error(error);
    showToast('Storage is full. Try importing fewer or shorter files.');
    state.bubbleSet = state.bubbleSet.filter((item) => !imported.some((added) => added.id === item.id));
    imported.forEach((item) => nextSelected.delete(item.id));
    state.selectedIds = nextSelected;
  }

  renderBubbleSet();
  updateStatus('Bubble set updated. Generate to hear the loop ring.');
  showToast(`${imported.length} sound${imported.length > 1 ? 's' : ''} imported.`);
}

function renderBubbleSet() {
  dom.selectedList.innerHTML = '';
  dom.libraryCount.textContent = `${state.bubbleSet.length} sound${state.bubbleSet.length === 1 ? '' : 's'} saved`;
  dom.emptyLibrary.classList.toggle('hidden', state.bubbleSet.length > 0);

  for (const asset of state.bubbleSet) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `sound-toggle${state.selectedIds.has(asset.id) ? ' is-active' : ''}`;
    button.dataset.assetId = asset.id;
    button.innerHTML = `
      <span class="sound-toggle__text">
        <div class="sound-toggle__name">${escapeHtml(asset.name)}</div>
      </span>
      <span>${state.selectedIds.has(asset.id) ? 'Selected' : 'Select'}</span>
    `;
    dom.selectedList.append(button);
  }

  updateSelectionSummary();
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function ensureAudio() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Web Audio API is unavailable in this browser.');
    }
    state.audioContext = new AudioContextClass({ latencyHint: 'interactive' });
    state.masterGain = state.audioContext.createGain();
    state.masterGain.gain.value = 0.92;
    state.masterGain.connect(state.audioContext.destination);
  }

  if (state.audioContext.state === 'suspended') {
    await state.audioContext.resume();
  }
}

function buildBubbleProfile(index, total) {
  const normalized = total <= 1 ? 0.5 : index / (total - 1);
  const visualRadius = THREE.MathUtils.lerp(0.15, 0.3, normalized);
  const range = THREE.MathUtils.lerp(1.8, 3.8, normalized);
  const gainMax = THREE.MathUtils.lerp(0.25, 0.78, normalized);
  return { visualRadius, range, gainMax };
}

function createBubbleVisual(radius) {
  const group = new THREE.Group();
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 36, 36),
    new THREE.MeshPhysicalMaterial({
      color: 0x88dcff,
      transparent: true,
      opacity: 0.32,
      roughness: 0.18,
      metalness: 0.02,
      transmission: 0.08,
      ior: 1.12,
      thickness: 0.3,
      emissive: 0x4fc4ff,
      emissiveIntensity: 0.9,
    }),
  );

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.48, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }),
  );

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.36, 28, 28),
    new THREE.MeshBasicMaterial({ color: 0x71d7ff, transparent: true, opacity: 0.07 }),
  );

  group.add(halo, glow, core);
  group.userData.hitMesh = glow;
  return group;
}

function createBubbleAudio(asset, bubble) {
  const context = state.audioContext;
  const element = document.createElement('audio');
  element.src = asset.url;
  element.loop = true;
  element.preload = 'auto';
  element.crossOrigin = 'anonymous';
  element.playsInline = true;

  const source = context.createMediaElementSource(element);
  const gain = context.createGain();
  const panner = context.createPanner();

  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.rolloffFactor = 0;
  panner.refDistance = 1;
  panner.maxDistance = 1000;
  panner.coneInnerAngle = 360;
  panner.coneOuterAngle = 0;

  gain.gain.setValueAtTime(0.0001, context.currentTime);
  source.connect(gain);
  gain.connect(panner);
  panner.connect(state.masterGain);

  bubble.audio = { element, source, gain, panner };

  element.play().then(() => {
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.0001, now + 0.02);
  }).catch((error) => {
    console.warn('Playback could not start yet.', error);
    showToast('Tap Enable motion + audio to unlock playback.');
  });
}

function disposeBubbleAudio(bubble) {
  if (!bubble.audio) {
    return;
  }
  const { element, source, gain, panner } = bubble.audio;
  try {
    element.pause();
    element.src = '';
    source.disconnect();
    gain.disconnect();
    panner.disconnect();
  } catch (error) {
    console.warn('Bubble audio cleanup warning.', error);
  }
  bubble.audio = null;
}

function disposeBubbleVisual(root) {
  root.traverse((object) => {
    if (object.geometry) {
      object.geometry.dispose();
    }
    if (object.material) {
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose());
      } else {
        object.material.dispose();
      }
    }
  });
}

function getForwardPosition(distance) {
  scratch.forward.set(0, 0, -1).applyQuaternion(state.camera.quaternion).normalize();
  return state.camera.position.clone().add(scratch.forward.multiplyScalar(distance));
}

async function spawnBubble(asset, position, profile, options = {}) {
  await ensureAudio();

  const root = createBubbleVisual(profile.visualRadius);
  root.position.copy(position);
  root.scale.setScalar(0.0001);
  state.scene.add(root);

  const bubble = {
    id: `bubble-${++state.bubbleSerial}`,
    assetId: asset.id,
    name: asset.name,
    root,
    visualRadius: profile.visualRadius,
    range: profile.range,
    gainMax: profile.gainMax,
    basePosition: root.position.clone(),
    floatOffset: Math.random() * Math.PI * 2,
    driftPhase: Math.random() * Math.PI * 2,
    createdAt: performance.now(),
    stuck: Boolean(options.stuck),
    removed: false,
    animatingOut: false,
    releasePosition: root.position.clone(),
    audio: null,
  };

  root.userData.bubbleId = bubble.id;
  createBubbleAudio(asset, bubble);

  state.bubbles.push(bubble);
  renderActiveBubbles();
  updateStatus('Scene is live. Move, look, and tap bubbles to reshape the loop.');
}

function getSelectedAssets() {
  return state.bubbleSet.filter((asset) => state.selectedIds.has(asset.id));
}

async function generateScene() {
  const assets = getSelectedAssets();
  if (!assets.length) {
    showToast('Select at least one imported sound first.');
    return;
  }

  await ensureAudio();
  await clearBubbles(false);

  const count = clampBubbleCount(state.bubbleCount);
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const x = Math.cos(angle) * RING_RADIUS;
    const z = Math.sin(angle) * RING_RADIUS;
    const position = new THREE.Vector3(x, 0, z);
    const asset = assets[i % assets.length];
    const profile = buildBubbleProfile(i, count);
    await spawnBubble(asset, position, profile, { stuck: false });
  }

  showToast(`Generated ${count} bubble${count > 1 ? 's' : ''} in a circle around you.`);
}

async function addBubbleAhead() {
  const assets = getSelectedAssets();
  if (!assets.length) {
    showToast('Select at least one sound before placing a bubble ahead.');
    return;
  }
  if (state.bubbles.length >= MAX_BUBBLES) {
    showToast('Maximum of 10 bubbles reached.');
    return;
  }

  const asset = assets[state.bubbles.length % assets.length];
  const profile = buildBubbleProfile(state.bubbles.length, MAX_BUBBLES);
  const position = getForwardPosition(FORWARD_PLACE_DISTANCE);
  await spawnBubble(asset, position, profile, { stuck: true });
  showToast('Bubble placed ahead and collé to your forward direction.');
}

function animateBubbleIn(bubble, elapsed) {
  const t = Math.min(1, elapsed / BOUNCE_SECONDS);
  const eased = easeOutBack(t);
  bubble.root.scale.setScalar(Math.max(0.0001, eased));
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function updateAudioBubble(bubble) {
  if (!bubble.audio || !state.audioContext) {
    return;
  }

  state.camera.getWorldPosition(scratch.cameraWorld);
  bubble.root.getWorldPosition(scratch.bubbleWorld);

  const distance = scratch.cameraWorld.distanceTo(scratch.bubbleWorld);
  const gainValue = distance < bubble.range ? ((1 - distance / bubble.range) ** 2) * bubble.gainMax : 0;
  const now = state.audioContext.currentTime;

  bubble.audio.gain.gain.cancelScheduledValues(now);
  bubble.audio.gain.gain.linearRampToValueAtTime(Math.max(0.0001, gainValue), now + 0.08);

  bubble.audio.panner.positionX.value = scratch.bubbleWorld.x;
  bubble.audio.panner.positionY.value = scratch.bubbleWorld.y + CAMERA_HEIGHT;
  bubble.audio.panner.positionZ.value = scratch.bubbleWorld.z;
}

function updateListener() {
  if (!state.audioContext) {
    return;
  }

  const listener = state.audioContext.listener;
  state.camera.getWorldPosition(scratch.cameraWorld);
  state.camera.getWorldQuaternion(scratch.cameraQuaternion);
  scratch.forward.set(0, 0, -1).applyQuaternion(scratch.cameraQuaternion).normalize();

  if (listener.positionX) {
    listener.positionX.value = scratch.cameraWorld.x;
    listener.positionY.value = scratch.cameraWorld.y + CAMERA_HEIGHT;
    listener.positionZ.value = scratch.cameraWorld.z;
    listener.forwardX.value = scratch.forward.x;
    listener.forwardY.value = scratch.forward.y;
    listener.forwardZ.value = scratch.forward.z;
    listener.upX.value = 0;
    listener.upY.value = 1;
    listener.upZ.value = 0;
  } else {
    listener.setPosition(scratch.cameraWorld.x, scratch.cameraWorld.y + CAMERA_HEIGHT, scratch.cameraWorld.z);
    listener.setOrientation(scratch.forward.x, scratch.forward.y, scratch.forward.z, 0, 1, 0);
  }
}

function updateBubbles(time, delta) {
  for (const bubble of state.bubbles) {
    const age = (time - bubble.createdAt) / 1000;
    animateBubbleIn(bubble, age);

    if (bubble.stuck) {
      const target = getForwardPosition(STICK_DISTANCE);
      bubble.root.position.lerp(target, 1 - Math.exp(-delta * 10));
      bubble.releasePosition.copy(bubble.root.position);
    } else {
      bubble.root.position.copy(bubble.releasePosition);
      bubble.root.position.y += Math.sin(time * 0.001 * FLOAT_SPEED + bubble.floatOffset) * FLOAT_HEIGHT;
      bubble.root.position.x += Math.cos(time * 0.0007 + bubble.driftPhase) * 0.01;
      bubble.root.position.z += Math.sin(time * 0.0009 + bubble.driftPhase) * 0.012;
    }

    bubble.root.rotation.y += delta * 0.22;
    updateAudioBubble(bubble);
  }
}

function renderActiveBubbles() {
  dom.bubbleList.innerHTML = '';
  dom.activeCount.textContent = `${state.bubbles.length} live`;
  dom.emptyScene.classList.toggle('hidden', state.bubbles.length > 0);

  for (const bubble of state.bubbles) {
    const item = document.createElement('article');
    item.className = `bubble-chip${bubble.stuck ? ' is-stuck' : ''}`;
    item.innerHTML = `
      <div class="bubble-chip__head">
        <div class="bubble-chip__title">${escapeHtml(bubble.name)}</div>
        <button class="mini-btn" type="button" data-toggle-bubble="${bubble.id}">${bubble.stuck ? 'Décoller' : 'Coller'}</button>
      </div>
      <div class="bubble-chip__sub">
        <span class="bubble-chip__dot ${bubble.stuck ? 'stuck' : 'free'}">${bubble.stuck ? 'Stuck' : 'Free'}</span>
        <span>Range ${bubble.range.toFixed(1)} m</span>
        <span>Gain ${bubble.gainMax.toFixed(2)}</span>
      </div>
    `;
    dom.bubbleList.append(item);
  }
}

function setBubbleStuck(bubble, nextValue) {
  bubble.stuck = nextValue;
  if (!nextValue) {
    bubble.releasePosition.copy(bubble.root.position);
  }
  renderActiveBubbles();
}

function toggleBubbleById(id) {
  const bubble = state.bubbles.find((item) => item.id === id);
  if (!bubble) {
    return;
  }
  setBubbleStuck(bubble, !bubble.stuck);
  showToast(bubble.stuck ? 'Bubble collé to your forward movement.' : 'Bubble released into the scene.');
}

function fadeOutAndRemoveBubble(bubble) {
  if (!bubble || bubble.animatingOut || !bubble.audio || !state.audioContext) {
    return Promise.resolve();
  }

  bubble.animatingOut = true;
  const now = state.audioContext.currentTime;
  bubble.audio.gain.gain.cancelScheduledValues(now);
  bubble.audio.gain.gain.setValueAtTime(bubble.audio.gain.gain.value || 0.0001, now);
  bubble.audio.gain.gain.linearRampToValueAtTime(0.0001, now + FADE_SECONDS);

  return new Promise((resolve) => {
    window.setTimeout(() => {
      state.scene.remove(bubble.root);
      disposeBubbleVisual(bubble.root);
      disposeBubbleAudio(bubble);
      state.bubbles = state.bubbles.filter((item) => item.id !== bubble.id);
      renderActiveBubbles();
      resolve();
    }, FADE_SECONDS * 1000 + 30);
  });
}

async function undoBubble() {
  const bubble = state.bubbles.at(-1);
  if (!bubble) {
    showToast('Nothing to undo yet.');
    return;
  }
  await fadeOutAndRemoveBubble(bubble);
  showToast('Last bubble removed.');
}

async function clearBubbles(notify = true) {
  const current = [...state.bubbles].reverse();
  for (const bubble of current) {
    await fadeOutAndRemoveBubble(bubble);
  }
  if (notify) {
    showToast('Scene cleared.');
  }
}

function handleCanvasTap(event) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  scratch.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  scratch.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  scratch.raycaster.setFromCamera(scratch.pointer, state.camera);

  const hits = scratch.raycaster.intersectObjects(state.scene.children, true);
  const hit = hits.find((entry) => entry.object.parent?.userData?.bubbleId || entry.object.userData?.bubbleId);
  if (!hit) {
    return;
  }
  const bubbleId = hit.object.userData?.bubbleId || hit.object.parent?.userData?.bubbleId;
  if (bubbleId) {
    toggleBubbleById(bubbleId);
  }
}

function updateFallbackLook() {
  if (state.orientationActive) {
    return;
  }
  state.camera.rotation.order = 'YXZ';
  state.camera.rotation.y = state.yaw;
  state.camera.rotation.x = state.pitch;
}

function applyDeviceOrientation(alpha, beta, gamma) {
  if (!Number.isFinite(alpha) || !Number.isFinite(beta) || !Number.isFinite(gamma)) {
    return;
  }

  const alphaRad = THREE.MathUtils.degToRad(alpha);
  const betaRad = THREE.MathUtils.degToRad(beta);
  const gammaRad = THREE.MathUtils.degToRad(gamma);

  if (!state.hasAlphaOffset) {
    state.deviceAlphaOffset = alphaRad;
    state.hasAlphaOffset = true;
  }

  state.deviceEuler.set(betaRad, alphaRad - state.deviceAlphaOffset, -gammaRad, 'YXZ');
  state.deviceQuaternion.setFromEuler(state.deviceEuler);
  state.camera.quaternion.slerp(state.deviceQuaternion, 0.18);
  state.orientationActive = true;
}

async function requestPermissions() {
  try {
    await ensureAudio();
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const result = await DeviceOrientationEvent.requestPermission();
      state.orientationPermissionGranted = result === 'granted';
    } else {
      state.orientationPermissionGranted = true;
    }

    if (state.orientationPermissionGranted) {
      dom.permissionButton.textContent = 'Motion + audio enabled';
      updateStatus('Motion and audio unlocked. Generate bubbles and move through the mix.');
      showToast('Audio and motion access enabled.');
    } else {
      showToast('Motion permission denied. Drag to look around instead.');
    }
  } catch (error) {
    console.warn(error);
    showToast('Could not unlock motion. Drag to look and tap again for audio.');
  }
}

function initThree() {
  state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  dom.scene.append(state.renderer.domElement);

  state.scene = new THREE.Scene();
  state.scene.fog = new THREE.Fog(0x050814, 3.5, 12);

  state.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.01, 40);
  state.camera.position.set(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xaadfff, 0x050814, 1.2);
  const key = new THREE.PointLight(0x86ebff, 24, 12, 1.8);
  key.position.set(0, 1.8, 0.8);
  const rim = new THREE.PointLight(0x8b81ff, 10, 8, 2.2);
  rim.position.set(-1.4, 1.2, -1.2);
  state.scene.add(hemi, key, rim);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(RING_RADIUS, 0.008, 16, 180),
    new THREE.MeshBasicMaterial({ color: 0x31425f, transparent: true, opacity: 0.35 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.02;
  state.scene.add(ring);

  const starGeometry = new THREE.BufferGeometry();
  const starCount = 320;
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const radius = THREE.MathUtils.randFloat(3.8, 9.5);
    const theta = THREE.MathUtils.randFloat(0, Math.PI * 2);
    const phi = THREE.MathUtils.randFloat(0.15, Math.PI - 0.2);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xbfe7ff, size: 0.03, transparent: true, opacity: 0.8 }),
  );
  state.scene.add(stars);
}

function attachEvents() {
  dom.importButton.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await importFiles(files);
  });

  dom.selectedList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-asset-id]');
    if (!button) {
      return;
    }
    const { assetId } = button.dataset;
    if (state.selectedIds.has(assetId)) {
      state.selectedIds.delete(assetId);
    } else if (state.selectedIds.size < MAX_BUBBLES) {
      state.selectedIds.add(assetId);
    }
    renderBubbleSet();
  });

  dom.bubbleSlider.addEventListener('input', (event) => {
    state.bubbleCount = clampBubbleCount(event.target.value);
    updateSelectionSummary();
  });

  dom.generateButton.addEventListener('click', () => generateScene());
  dom.addForwardButton.addEventListener('click', () => addBubbleAhead());
  dom.undoButton.addEventListener('click', () => undoBubble());
  dom.clearButton.addEventListener('click', () => clearBubbles());
  dom.permissionButton.addEventListener('click', () => requestPermissions());

  dom.togglePanelButton.addEventListener('click', () => {
    const collapsed = dom.controlPanel.classList.toggle('is-collapsed');
    dom.togglePanelButton.textContent = collapsed ? 'Show controls' : 'Hide controls';
    dom.togglePanelButton.setAttribute('aria-expanded', String(!collapsed));
  });

  dom.bubbleList.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-toggle-bubble]');
    if (!toggle) {
      return;
    }
    toggleBubbleById(toggle.dataset.toggleBubble);
  });

  state.renderer.domElement.addEventListener('click', (event) => {
    if (state.dragging || state.dragMoved) {
      return;
    }
    handleCanvasTap(event);
  });

  state.renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || event.pointerType === 'touch') {
      state.dragging = true;
      state.dragPointerId = event.pointerId;
      state.dragMoved = false;
      state.lastPointer.x = event.clientX;
      state.lastPointer.y = event.clientY;
      state.renderer.domElement.setPointerCapture(event.pointerId);
    }
  });

  state.renderer.domElement.addEventListener('pointermove', (event) => {
    if (!state.dragging || state.dragPointerId !== event.pointerId || state.orientationActive) {
      return;
    }
    const dx = event.clientX - state.lastPointer.x;
    const dy = event.clientY - state.lastPointer.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      state.dragMoved = true;
    }
    state.lastPointer.x = event.clientX;
    state.lastPointer.y = event.clientY;
    state.yaw -= dx * LOOK_SENSITIVITY;
    state.pitch = THREE.MathUtils.clamp(state.pitch - dy * LOOK_SENSITIVITY, -PAN_LIMIT, PAN_LIMIT);
  });

  const releaseDrag = (event) => {
    if (state.dragPointerId !== event.pointerId) {
      return;
    }
    state.dragging = false;
    state.dragPointerId = null;
    window.setTimeout(() => {
      state.dragMoved = false;
    }, 0);
    state.renderer.domElement.releasePointerCapture(event.pointerId);
  };

  state.renderer.domElement.addEventListener('pointerup', releaseDrag);
  state.renderer.domElement.addEventListener('pointercancel', releaseDrag);

  window.addEventListener('resize', () => {
    state.camera.aspect = window.innerWidth / window.innerHeight;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(window.innerWidth, window.innerHeight);
  });

  window.addEventListener('deviceorientation', (event) => {
    if (!state.orientationPermissionGranted) {
      return;
    }
    applyDeviceOrientation(event.alpha, event.beta, event.gamma);
  });
}

function animate() {
  requestAnimationFrame(animate);
  const time = performance.now();
  const delta = state.clock.getDelta();
  updateFallbackLook();
  updateListener();
  updateBubbles(time, delta);
  state.renderer.render(state.scene, state.camera);
}

async function init() {
  loadBubbleSet();
  initThree();
  attachEvents();
  renderBubbleSet();
  renderActiveBubbles();
  updateSelectionSummary();
  animate();

  if (state.bubbleSet.length) {
    updateStatus('Your bubble set is ready. Select sounds and generate a scene.');
  }
}

init();
