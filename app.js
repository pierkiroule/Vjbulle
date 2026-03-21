import * as THREE from 'three';

const STORAGE_KEY = 'echo-bubble-loop::bubble-set';
const MAX_BUBBLES = 10;
const MAX_LIBRARY_ITEMS = 24;
const RING_RADIUS = 1.5;
const STICK_DISTANCE = 0.5;
const FORWARD_PLACE_DISTANCE = 0.4;
const FLOAT_SPEED = 0.75;
const FLOAT_HEIGHT = 0.08;
const FADE_SECONDS = 0.3;
const BOUNCE_SECONDS = 0.7;
const CAMERA_HEIGHT = 1.55;
const HUD_FADE_MS = 2600;
const LOOK_SENSITIVITY = 0.0032;
const PAN_LIMIT = Math.PI * 0.32;

const scratch = {
  forward: new THREE.Vector3(0, 0, -1),
  up: new THREE.Vector3(0, 1, 0),
  cameraWorld: new THREE.Vector3(),
  bubbleWorld: new THREE.Vector3(),
  cameraQuaternion: new THREE.Quaternion(),
  matrix: new THREE.Matrix4(),
  pointer: new THREE.Vector2(),
  raycaster: new THREE.Raycaster(),
};

const state = {
  bubbleSet: [],
  selectedIds: new Set(),
  bubbles: [],
  bubbleCount: 4,
  renderer: null,
  scene: null,
  camera: null,
  clock: new THREE.Clock(),
  audioContext: null,
  masterGain: null,
  xrSession: null,
  hudFaded: false,
  hudTimer: 0,
  dragging: false,
  dragPointerId: null,
  dragMoved: false,
  lastPointer: { x: 0, y: 0 },
  yaw: 0,
  pitch: 0,
  bubbleSerial: 0,
  toastTimer: 0,
  carouselIndex: 0,
};

const dom = {
  overlay: document.querySelector('#app'),
  intro: document.querySelector('#intro'),
  scene: document.querySelector('#scene'),
  enterArButton: document.querySelector('#enterArButton'),
  exitArButton: document.querySelector('#exitArButton'),
  importButton: document.querySelector('#importButton'),
  importInlineButton: document.querySelector('#importInlineButton'),
  fileInput: document.querySelector('#fileInput'),
  sessionChip: document.querySelector('#sessionChip'),
  focusChip: document.querySelector('#focusChip'),
  panelShell: document.querySelector('#panelShell'),
  controlPanel: document.querySelector('#controlPanel'),
  dockButton: document.querySelector('#dockButton'),
  statusLine: document.querySelector('#statusLine'),
  libraryCount: document.querySelector('#libraryCount'),
  assetList: document.querySelector('#assetList'),
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
  carouselTrack: document.querySelector('#carouselTrack'),
  prevSlideButton: document.querySelector('#prevSlideButton'),
  nextSlideButton: document.querySelector('#nextSlideButton'),
  carouselLabel: document.querySelector('#carouselLabel'),
  carouselDots: document.querySelector('#carouselDots'),
};

const carouselSlides = [
  'Bubble set',
  'Generation',
  'Active bubbles',
];

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

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clampBubbleCount(value) {
  return Math.min(MAX_BUBBLES, Math.max(1, Number(value) || 1));
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
      .slice(0, MAX_LIBRARY_ITEMS);
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
    showToast('Only mp3 and wav files can be imported.');
    return;
  }

  state.bubbleSet = [...state.bubbleSet, ...imported].slice(-MAX_LIBRARY_ITEMS);
  const nextSelected = new Set(state.selectedIds);
  imported.forEach((asset) => {
    if (nextSelected.size < MAX_BUBBLES) {
      nextSelected.add(asset.id);
    }
  });
  state.selectedIds = nextSelected;

  try {
    saveBubbleSet();
  } catch (error) {
    console.error(error);
    state.bubbleSet = state.bubbleSet.filter((asset) => !imported.some((item) => item.id === asset.id));
    imported.forEach((item) => nextSelected.delete(item.id));
    state.selectedIds = nextSelected;
    showToast('Storage is full. Import fewer or shorter files.');
    renderBubbleSet();
    return;
  }

  renderBubbleSet();
  updateStatus('Bubble set ready. Enter AR to generate your ring.');
  showToast(`${imported.length} sound${imported.length > 1 ? 's' : ''} imported.`);
}

function renderBubbleSet() {
  dom.assetList.innerHTML = '';
  dom.libraryCount.textContent = `${state.bubbleSet.length} sound${state.bubbleSet.length === 1 ? '' : 's'}`;
  dom.emptyLibrary.classList.toggle('hidden', state.bubbleSet.length > 0);

  for (const asset of state.bubbleSet) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `asset-toggle${state.selectedIds.has(asset.id) ? ' is-active' : ''}`;
    button.dataset.assetId = asset.id;
    button.innerHTML = `
      <div class="asset-meta">
        <div class="asset-name">${escapeHtml(asset.name)}</div>
        <span>${state.selectedIds.has(asset.id) ? 'Selected' : 'Select'}</span>
      </div>
      <div class="asset-sub">Ready for circular generation and forward placement.</div>
    `;
    dom.assetList.append(button);
  }

  updateSelectionSummary();
}

function updateSelectionSummary() {
  const selectedCount = state.selectedIds.size;
  dom.selectionSummary.textContent = selectedCount
    ? `${selectedCount} sound${selectedCount > 1 ? 's' : ''} selected`
    : 'Select at least one sound';
  dom.bubbleSliderMeta.textContent = `${state.bubbleCount} bubble${state.bubbleCount > 1 ? 's' : ''}`;
}

function renderActiveBubbles() {
  dom.bubbleList.innerHTML = '';
  dom.activeCount.textContent = `${state.bubbles.length} live`;
  dom.emptyScene.classList.toggle('hidden', state.bubbles.length > 0);

  for (const bubble of state.bubbles) {
    const card = document.createElement('article');
    card.className = `bubble-card${bubble.stuck ? ' is-stuck' : ''}${bubble.isUnlocked ? '' : ' is-silent'}`;
    card.innerHTML = `
      <div class="bubble-meta">
        <div class="bubble-title">${escapeHtml(bubble.name)}</div>
        <button class="mini-btn" type="button" data-focus-bubble="${bubble.id}">${bubble.isUnlocked ? 'Live' : 'Touch to wake'}</button>
      </div>
      <div class="bubble-sub">
        <span class="tag ${bubble.isUnlocked ? 'live' : 'silent'}">${bubble.isUnlocked ? 'Audio live' : 'Silent'}</span>
        <span class="tag ${bubble.stuck ? 'stuck' : 'free'}">${bubble.stuck ? 'Collé' : 'Décollé'}</span>
        <span>Range ${bubble.range.toFixed(1)} m</span>
      </div>
    `;
    dom.bubbleList.append(card);
  }
}


function syncCarousel() {
  const index = state.carouselIndex;
  dom.carouselTrack.style.transform = `translateX(calc(${-index * 100}% - ${index * 12}px))`;
  dom.carouselLabel.textContent = carouselSlides[index];
  dom.prevSlideButton.disabled = index === 0;
  dom.nextSlideButton.disabled = index === carouselSlides.length - 1;

  [...dom.carouselDots.children].forEach((dot, dotIndex) => {
    dot.classList.toggle('is-active', dotIndex === index);
  });
}

function setCarouselIndex(nextIndex) {
  state.carouselIndex = Math.min(carouselSlides.length - 1, Math.max(0, nextIndex));
  syncCarousel();
}

function initCarousel() {
  dom.carouselDots.innerHTML = '';
  carouselSlides.forEach((label, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `carousel-dot${index === 0 ? ' is-active' : ''}`;
    dot.setAttribute('aria-label', label);
    dot.addEventListener('click', () => {
      setCarouselIndex(index);
      wakeHud();
    });
    dom.carouselDots.append(dot);
  });
  syncCarousel();
}

function markSessionChip(active, text) {
  dom.sessionChip.classList.toggle('active', active);
  dom.sessionChip.classList.toggle('idle', !active);
  dom.sessionChip.textContent = text;
}

function markFocusChip(active, text) {
  dom.focusChip.classList.toggle('active', active);
  dom.focusChip.classList.toggle('idle', !active);
  dom.focusChip.textContent = text;
}

function wakeHud() {
  state.hudFaded = false;
  dom.panelShell.classList.remove('is-faded');
  dom.dockButton.classList.remove('hidden');
  window.clearTimeout(state.hudTimer);
  if (state.xrSession) {
    state.hudTimer = window.setTimeout(() => {
      state.hudFaded = true;
      dom.panelShell.classList.add('is-faded');
    }, HUD_FADE_MS);
  }
}

function closeHudSoon() {
  if (!state.xrSession) {
    return;
  }
  window.clearTimeout(state.hudTimer);
  state.hudTimer = window.setTimeout(() => {
    state.hudFaded = true;
    dom.panelShell.classList.add('is-faded');
  }, HUD_FADE_MS);
}

async function ensureAudioContext() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Web Audio API is unavailable.');
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
  return {
    visualRadius: THREE.MathUtils.lerp(0.16, 0.3, normalized),
    range: THREE.MathUtils.lerp(1.9, 3.8, normalized),
    gainMax: THREE.MathUtils.lerp(0.25, 0.82, normalized),
  };
}

function createBubbleVisual(radius, isUnlocked) {
  const group = new THREE.Group();

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.38, 28, 28),
    new THREE.MeshBasicMaterial({ color: 0x74dbff, transparent: true, opacity: 0.08 }),
  );

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 34, 34),
    new THREE.MeshPhysicalMaterial({
      color: 0x8be4ff,
      transparent: true,
      opacity: 0.34,
      roughness: 0.14,
      metalness: 0.02,
      transmission: 0.08,
      ior: 1.12,
      thickness: 0.28,
      emissive: isUnlocked ? 0x4fd5ff : 0x3b5265,
      emissiveIntensity: isUnlocked ? 1.05 : 0.4,
    }),
  );

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.46, 24, 24),
    new THREE.MeshBasicMaterial({ color: isUnlocked ? 0xf8fdff : 0x8fa7bd, transparent: true, opacity: 0.82 }),
  );

  group.add(halo, shell, core);
  group.userData.shell = shell;
  group.userData.core = core;
  return group;
}

function setBubbleVisualState(bubble) {
  const shell = bubble.root.userData.shell;
  const core = bubble.root.userData.core;
  if (!shell || !core) {
    return;
  }
  shell.material.emissive.setHex(bubble.isUnlocked ? 0x4fd5ff : 0x3b5265);
  shell.material.emissiveIntensity = bubble.isUnlocked ? 1.05 : 0.4;
  core.material.color.setHex(bubble.isUnlocked ? 0xf8fdff : 0x8fa7bd);
}

function createBubbleAudio(asset) {
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

  return { element, source, gain, panner, hasStarted: false };
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

function getActiveCamera() {
  return state.xrSession ? state.renderer.xr.getCamera(state.camera) : state.camera;
}

function getCameraWorldPosition() {
  const activeCamera = getActiveCamera();
  activeCamera.getWorldPosition(scratch.cameraWorld);
  return scratch.cameraWorld.clone();
}

function getCameraWorldQuaternion() {
  const activeCamera = getActiveCamera();
  activeCamera.getWorldQuaternion(scratch.cameraQuaternion);
  return scratch.cameraQuaternion.clone();
}

function getForwardPosition(distance) {
  const cameraPosition = getCameraWorldPosition();
  const cameraQuaternion = getCameraWorldQuaternion();
  scratch.forward.set(0, 0, -1).applyQuaternion(cameraQuaternion).normalize();
  return cameraPosition.add(scratch.forward.multiplyScalar(distance));
}

async function spawnBubble(asset, position, profile, options = {}) {
  await ensureAudioContext();

  const root = createBubbleVisual(profile.visualRadius, false);
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
    floatOffset: Math.random() * Math.PI * 2,
    driftPhase: Math.random() * Math.PI * 2,
    createdAt: performance.now(),
    stuck: Boolean(options.stuck),
    releasePosition: root.position.clone(),
    isUnlocked: false,
    animatingOut: false,
    audio: createBubbleAudio(asset),
  };

  root.userData.bubbleId = bubble.id;
  state.bubbles.push(bubble);
  renderActiveBubbles();
  markFocusChip(false, 'Touch bubbles to wake sound');
  updateStatus('Scene is live. Tap bubbles in AR to wake their audio.');
  wakeHud();
}

async function unlockBubbleAudio(bubble) {
  if (!bubble || bubble.isUnlocked || !bubble.audio) {
    return;
  }

  await ensureAudioContext();
  bubble.isUnlocked = true;
  setBubbleVisualState(bubble);

  if (!bubble.audio.hasStarted) {
    try {
      await bubble.audio.element.play();
      bubble.audio.hasStarted = true;
    } catch (error) {
      bubble.isUnlocked = false;
      setBubbleVisualState(bubble);
      console.warn('Unable to start bubble audio.', error);
      showToast('Audio wake failed. Tap the bubble again.');
      return;
    }
  }

  const now = state.audioContext.currentTime;
  bubble.audio.gain.gain.cancelScheduledValues(now);
  bubble.audio.gain.gain.setValueAtTime(0.0001, now);
  bubble.audio.gain.gain.linearRampToValueAtTime(0.0001, now + FADE_SECONDS);
  renderActiveBubbles();
}

function getSelectedAssets() {
  return state.bubbleSet.filter((asset) => state.selectedIds.has(asset.id));
}

async function generateScene() {
  if (!state.xrSession) {
    showToast('Enter AR first for the fullscreen live scene.');
    return;
  }

  const assets = getSelectedAssets();
  if (!assets.length) {
    showToast('Select at least one sound first.');
    return;
  }

  await ensureAudioContext();
  await clearBubbles(false);

  const count = clampBubbleCount(state.bubbleCount);
  const cameraPosition = getCameraWorldPosition();

  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const x = Math.cos(angle) * RING_RADIUS;
    const z = Math.sin(angle) * RING_RADIUS;
    const position = new THREE.Vector3(cameraPosition.x + x, 0, cameraPosition.z + z);
    const profile = buildBubbleProfile(i, count);
    await spawnBubble(assets[i % assets.length], position, profile, { stuck: false });
  }

  showToast(`Generated ${count} silent bubbles around you. Touch them to wake the sound.`);
}

async function addBubbleAhead() {
  if (!state.xrSession) {
    showToast('Enter AR first to place a forward bubble.');
    return;
  }

  const assets = getSelectedAssets();
  if (!assets.length) {
    showToast('Select at least one sound first.');
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
  showToast('Forward bubble added. Touch it in AR to wake its audio.');
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function animateBubbleIn(bubble, ageSeconds) {
  const t = Math.min(1, ageSeconds / BOUNCE_SECONDS);
  bubble.root.scale.setScalar(Math.max(0.0001, easeOutBack(t)));
}

function updateListener() {
  if (!state.audioContext) {
    return;
  }

  const listener = state.audioContext.listener;
  const activeCamera = getActiveCamera();
  activeCamera.getWorldPosition(scratch.cameraWorld);
  activeCamera.getWorldQuaternion(scratch.cameraQuaternion);
  scratch.forward.set(0, 0, -1).applyQuaternion(scratch.cameraQuaternion).normalize();

  if (listener.positionX) {
    listener.positionX.value = scratch.cameraWorld.x;
    listener.positionY.value = scratch.cameraWorld.y + (state.xrSession ? 0 : CAMERA_HEIGHT);
    listener.positionZ.value = scratch.cameraWorld.z;
    listener.forwardX.value = scratch.forward.x;
    listener.forwardY.value = scratch.forward.y;
    listener.forwardZ.value = scratch.forward.z;
    listener.upX.value = scratch.up.x;
    listener.upY.value = scratch.up.y;
    listener.upZ.value = scratch.up.z;
  } else {
    listener.setPosition(
      scratch.cameraWorld.x,
      scratch.cameraWorld.y + (state.xrSession ? 0 : CAMERA_HEIGHT),
      scratch.cameraWorld.z,
    );
    listener.setOrientation(scratch.forward.x, scratch.forward.y, scratch.forward.z, scratch.up.x, scratch.up.y, scratch.up.z);
  }
}

function updateAudioBubble(bubble) {
  if (!bubble.audio || !state.audioContext) {
    return;
  }

  const activeCamera = getActiveCamera();
  activeCamera.getWorldPosition(scratch.cameraWorld);
  bubble.root.getWorldPosition(scratch.bubbleWorld);

  const distance = scratch.cameraWorld.distanceTo(scratch.bubbleWorld);
  const desiredGain = bubble.isUnlocked && distance < bubble.range
    ? ((1 - distance / bubble.range) ** 2) * bubble.gainMax
    : 0;

  const now = state.audioContext.currentTime;
  bubble.audio.gain.gain.cancelScheduledValues(now);
  bubble.audio.gain.gain.linearRampToValueAtTime(Math.max(0.0001, desiredGain), now + 0.08);

  bubble.audio.panner.positionX.value = scratch.bubbleWorld.x;
  bubble.audio.panner.positionY.value = scratch.bubbleWorld.y + (state.xrSession ? 0 : CAMERA_HEIGHT);
  bubble.audio.panner.positionZ.value = scratch.bubbleWorld.z;
}

function updateBubbles(time, delta) {
  for (const bubble of state.bubbles) {
    const ageSeconds = (time - bubble.createdAt) / 1000;
    animateBubbleIn(bubble, ageSeconds);

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

    bubble.root.rotation.y += delta * 0.24;
    updateAudioBubble(bubble);
  }
}

function setBubbleStuck(bubble, nextValue) {
  bubble.stuck = nextValue;
  if (!nextValue) {
    bubble.releasePosition.copy(bubble.root.position);
  }
  renderActiveBubbles();
}

async function touchBubbleById(id) {
  const bubble = state.bubbles.find((item) => item.id === id);
  if (!bubble) {
    return;
  }

  if (!bubble.isUnlocked) {
    await unlockBubbleAudio(bubble);
    if (!bubble.isUnlocked) {
      return;
    }
    showToast('Bubble awakened. Its sound is now live.');
    markFocusChip(true, 'Bubble audio is now waking on touch');
  }

  setBubbleStuck(bubble, !bubble.stuck);
  showToast(bubble.stuck ? 'Bubble collé to your movement.' : 'Bubble décollé into the world.');
  wakeHud();
}

function fadeOutAndRemoveBubble(bubble) {
  if (!bubble || bubble.animatingOut) {
    return Promise.resolve();
  }

  bubble.animatingOut = true;

  if (bubble.audio && state.audioContext) {
    const now = state.audioContext.currentTime;
    bubble.audio.gain.gain.cancelScheduledValues(now);
    bubble.audio.gain.gain.setValueAtTime(bubble.audio.gain.gain.value || 0.0001, now);
    bubble.audio.gain.gain.linearRampToValueAtTime(0.0001, now + FADE_SECONDS);
  }

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

function performPointerRaycast(clientX, clientY) {
  const rect = state.renderer.domElement.getBoundingClientRect();
  scratch.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  scratch.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  scratch.raycaster.setFromCamera(scratch.pointer, state.camera);
  const hits = scratch.raycaster.intersectObjects(state.scene.children, true);
  const hit = hits.find((entry) => entry.object.userData?.bubbleId || entry.object.parent?.userData?.bubbleId);
  return hit ? hit.object.userData?.bubbleId || hit.object.parent?.userData?.bubbleId : '';
}

async function handleCanvasTap(event) {
  const bubbleId = performPointerRaycast(event.clientX, event.clientY);
  if (bubbleId) {
    await touchBubbleById(bubbleId);
  }
}

async function handleXRSelect() {
  scratch.matrix.identity().extractRotation(state.renderer.xr.getController(0).matrixWorld);
  scratch.raycaster.ray.origin.setFromMatrixPosition(state.renderer.xr.getController(0).matrixWorld);
  scratch.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(scratch.matrix).normalize();
  const hits = scratch.raycaster.intersectObjects(state.scene.children, true);
  const hit = hits.find((entry) => entry.object.userData?.bubbleId || entry.object.parent?.userData?.bubbleId);
  if (!hit) {
    return;
  }
  const bubbleId = hit.object.userData?.bubbleId || hit.object.parent?.userData?.bubbleId;
  if (bubbleId) {
    await touchBubbleById(bubbleId);
  }
}

function updateFallbackLook() {
  if (state.xrSession) {
    return;
  }
  state.camera.rotation.order = 'YXZ';
  state.camera.rotation.y = state.yaw;
  state.camera.rotation.x = state.pitch;
}

function initThree() {
  state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  state.renderer.xr.enabled = true;
  dom.scene.append(state.renderer.domElement);

  state.scene = new THREE.Scene();
  state.scene.fog = new THREE.Fog(0x060813, 3.5, 12);

  state.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.01, 50);
  state.camera.position.set(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xb6e8ff, 0x04060e, 1.25);
  const key = new THREE.PointLight(0x81e2ff, 24, 14, 1.8);
  key.position.set(0, 2, 0.8);
  const rim = new THREE.PointLight(0x9388ff, 10, 8, 2.1);
  rim.position.set(-1.2, 1.4, -1.3);
  state.scene.add(hemi, key, rim);

  const starsGeometry = new THREE.BufferGeometry();
  const starCount = 280;
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const radius = THREE.MathUtils.randFloat(4, 10);
    const theta = THREE.MathUtils.randFloat(0, Math.PI * 2);
    const phi = THREE.MathUtils.randFloat(0.15, Math.PI - 0.2);
    starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = radius * Math.cos(phi);
    starPositions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starsGeometry,
    new THREE.PointsMaterial({ color: 0xc7ecff, size: 0.03, transparent: true, opacity: 0.82 }),
  );
  state.scene.add(stars);

  const controller = state.renderer.xr.getController(0);
  controller.addEventListener('select', () => {
    handleXRSelect();
  });
  state.scene.add(controller);
}

async function checkArSupport() {
  if (!navigator.xr?.isSessionSupported) {
    dom.enterArButton.disabled = true;
    markSessionChip(false, 'AR unavailable');
    updateStatus('This browser does not support immersive AR.');
    return;
  }

  try {
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (supported) {
      markSessionChip(false, 'AR ready');
      updateStatus('Import sounds, then enter AR for the fullscreen live scene.');
    } else {
      dom.enterArButton.disabled = true;
      markSessionChip(false, 'AR unavailable');
      updateStatus('Immersive AR is not available on this device.');
    }
  } catch (error) {
    console.warn(error);
    dom.enterArButton.disabled = true;
    markSessionChip(false, 'AR check failed');
    updateStatus('Unable to verify AR support.');
  }
}

async function enterAr() {
  if (!navigator.xr || state.xrSession) {
    return;
  }

  try {
    await ensureAudioContext();
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: dom.overlay },
    });

    session.addEventListener('end', handleSessionEnd);
    await state.renderer.xr.setSession(session);
    state.xrSession = session;
    dom.overlay.classList.add('is-ar');
    dom.dockButton.classList.remove('hidden');
    dom.exitArButton.classList.remove('hidden');
    dom.enterArButton.textContent = 'AR active';
    dom.enterArButton.disabled = true;
    markSessionChip(true, 'AR live');
    markFocusChip(false, 'Touch bubbles to wake sound');
    updateStatus('AR is live. Generate bubbles and touch them to wake audio.');
    wakeHud();
    closeHudSoon();
  } catch (error) {
    console.warn(error);
    showToast('Unable to start AR on this device.');
  }
}

function handleSessionEnd() {
  state.xrSession = null;
  dom.overlay.classList.remove('is-ar');
  dom.panelShell.classList.remove('is-faded');
  dom.dockButton.classList.add('hidden');
  dom.exitArButton.classList.add('hidden');
  dom.enterArButton.textContent = 'Enter AR';
  dom.enterArButton.disabled = false;
  markSessionChip(false, 'AR ended');
  markFocusChip(false, 'Touch bubbles to wake sound');
  updateStatus('AR ended. You can re-enter at any time.');
  window.clearTimeout(state.hudTimer);
}

async function exitAr() {
  if (state.xrSession) {
    await state.xrSession.end();
  }
}

function attachEvents() {
  dom.importButton.addEventListener('click', () => dom.fileInput.click());
  dom.importInlineButton.addEventListener('click', () => dom.fileInput.click());
  dom.fileInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    await importFiles(files);
  });

  dom.enterArButton.addEventListener('click', () => enterAr());
  dom.exitArButton.addEventListener('click', () => exitAr());
  dom.dockButton.addEventListener('click', () => {
    wakeHud();
  });

  dom.prevSlideButton.addEventListener('click', () => {
    setCarouselIndex(state.carouselIndex - 1);
    wakeHud();
  });

  dom.nextSlideButton.addEventListener('click', () => {
    setCarouselIndex(state.carouselIndex + 1);
    wakeHud();
  });

  dom.assetList.addEventListener('click', (event) => {
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
    wakeHud();
  });

  dom.bubbleSlider.addEventListener('input', (event) => {
    state.bubbleCount = clampBubbleCount(event.target.value);
    updateSelectionSummary();
    wakeHud();
  });

  dom.generateButton.addEventListener('click', () => generateScene());
  dom.addForwardButton.addEventListener('click', () => addBubbleAhead());
  dom.undoButton.addEventListener('click', () => undoBubble());
  dom.clearButton.addEventListener('click', () => clearBubbles());

  dom.bubbleList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-focus-bubble]');
    if (!button) {
      return;
    }
    touchBubbleById(button.dataset.focusBubble);
  });

  dom.overlay.addEventListener('pointerdown', () => wakeHud());
  dom.overlay.addEventListener('pointerup', () => closeHudSoon());

  state.renderer.domElement.addEventListener('click', async (event) => {
    if (state.dragging || state.dragMoved) {
      return;
    }
    await handleCanvasTap(event);
  });

  state.renderer.domElement.addEventListener('pointerdown', (event) => {
    if (state.xrSession) {
      return;
    }
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
    if (state.xrSession || !state.dragging || state.dragPointerId !== event.pointerId) {
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
}

function renderLoop(time) {
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
  initCarousel();
  await checkArSupport();
  state.renderer.setAnimationLoop(renderLoop);

  if (state.bubbleSet.length) {
    updateStatus('Bubble set restored. Enter AR when you are ready.');
  }
}

init();
