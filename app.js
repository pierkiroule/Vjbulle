import * as THREE from 'three';

const APP_STORAGE_KEY = 'echo-bubble-loop::pads';
const MAX_PADS = 8;
const MAX_BUBBLES = 8;
const DEFAULT_BPM = 90;
const SPAWN_DISTANCE = 0.4;
const STUCK_DISTANCE = 0.6;
const LONG_PRESS_MS = 520;

const dom = {
  xrRoot: document.querySelector('#xr-root'),
  enterAr: document.querySelector('#enter-ar'),
  configToggle: document.querySelector('#config-toggle'),
  configPanel: document.querySelector('#config-panel'),
  supportBanner: document.querySelector('#support-banner'),
  statusText: document.querySelector('#status-text'),
  tempoText: document.querySelector('#tempo-text'),
  configBpm: document.querySelector('#config-bpm'),
  bubbleCount: document.querySelector('#bubble-count'),
  importAudio: document.querySelector('#import-audio'),
  clearPads: document.querySelector('#clear-pads'),
  clearBubbles: document.querySelector('#clear-bubbles'),
  bubblePanel: document.querySelector('#bubble-panel'),
  bubbleTitle: document.querySelector('#bubble-title'),
  bubbleStick: document.querySelector('#bubble-stick'),
  rangeSlider: document.querySelector('#range-slider'),
  rangeValue: document.querySelector('#range-value'),
  gainSlider: document.querySelector('#gain-slider'),
  gainValue: document.querySelector('#gain-value'),
  sourceSheet: document.querySelector('#source-sheet'),
  sourceTitle: document.querySelector('#source-title'),
  closeSource: document.querySelector('#close-source'),
  sourceImport: document.querySelector('#source-import'),
  sourceRecord: document.querySelector('#source-record'),
  recordingNote: document.querySelector('#recording-note'),
  padCarousel: document.querySelector('#pad-carousel'),
  undoBtn: document.querySelector('#undo-btn'),
  fileInput: document.querySelector('#file-input'),
};

const shared = {
  tempVecA: new THREE.Vector3(),
  tempVecB: new THREE.Vector3(),
  tempQuat: new THREE.Quaternion(),
  raycaster: new THREE.Raycaster(),
  rayDirection: new THREE.Vector3(),
};

const state = {
  renderer: null,
  scene: null,
  camera: null,
  xrSession: null,
  xrController: null,
  xrReferenceSpace: null,
  audioContext: null,
  listenerReady: false,
  masterGain: null,
  tempo: {
    bpm: DEFAULT_BPM,
    beatDuration: 60 / DEFAULT_BPM,
  },
  pads: Array.from({ length: MAX_PADS }, (_, index) => createEmptyPad(index)),
  bubbles: [],
  lastCreatedBubbleIds: [],
  selectedBubbleId: null,
  sourcePadIndex: null,
  recorder: null,
  recordingChunks: [],
  recordingStream: null,
  longPressTimer: 0,
  controllerPressed: false,
  supportChecked: false,
  arSupported: false,
};

bootstrap();

async function bootstrap() {
  setupThree();
  loadPads();
  renderPads();
  syncTempoUi();
  bindUi();
  await checkArSupport();
  animate();
}

function setupThree() {
  state.scene = new THREE.Scene();
  state.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);
  state.scene.add(state.camera);

  const ambient = new THREE.HemisphereLight(0xdff5ff, 0x14233f, 1.5);
  state.scene.add(ambient);

  const fill = new THREE.PointLight(0x9fe8ff, 2.4, 6, 2);
  fill.position.set(0.8, 1.3, -1);
  state.scene.add(fill);

  state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  state.renderer.xr.enabled = true;
  state.domOverlayRoot = document.body;
  dom.xrRoot.appendChild(state.renderer.domElement);

  state.xrController = state.renderer.xr.getController(0);
  state.xrController.addEventListener('selectstart', onSelectStart);
  state.xrController.addEventListener('selectend', onSelectEnd);
  state.scene.add(state.xrController);

  window.addEventListener('resize', onResize);
}

function bindUi() {
  dom.enterAr.addEventListener('click', startArSession);
  dom.configToggle.addEventListener('click', () => dom.configPanel.classList.toggle('hidden'));
  dom.importAudio.addEventListener('click', () => {
    state.sourcePadIndex = null;
    dom.fileInput.click();
  });
  dom.clearPads.addEventListener('click', clearPads);
  dom.clearBubbles.addEventListener('click', clearBubbles);
  dom.undoBtn.addEventListener('click', undoLastBubble);
  dom.bubbleStick.addEventListener('click', toggleSelectedStickiness);
  dom.rangeSlider.addEventListener('input', updateSelectedBubbleUi);
  dom.gainSlider.addEventListener('input', updateSelectedBubbleUi);
  dom.closeSource.addEventListener('click', closeSourceSheet);
  dom.sourceImport.addEventListener('click', () => dom.fileInput.click());
  dom.sourceRecord.addEventListener('click', toggleRecording);
  dom.fileInput.addEventListener('change', onFilePicked);
}

function createEmptyPad(index) {
  return {
    id: `pad-${index + 1}`,
    slot: index,
    name: `Pad ${index + 1}`,
    url: '',
    bpm: DEFAULT_BPM,
    loopStart: 0,
    loopEnd: 0,
    gain: 0.8,
  };
}

function loadPads() {
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    state.pads = Array.from({ length: MAX_PADS }, (_, index) => ({
      ...createEmptyPad(index),
      ...(parsed[index] || {}),
      slot: index,
      id: parsed[index]?.id || `pad-${index + 1}`,
    }));
  } catch (error) {
    console.warn('Unable to restore pads.', error);
  }
}

function savePads() {
  localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state.pads));
}

function syncTempoUi() {
  const bpmLabel = `${state.tempo.bpm} BPM`;
  dom.tempoText.textContent = bpmLabel;
  dom.configBpm.textContent = bpmLabel;
  syncBubbleCount();
}

function syncBubbleCount() {
  dom.bubbleCount.textContent = `${state.bubbles.length} / ${MAX_BUBBLES}`;
}

function setStatus(text) {
  dom.statusText.textContent = text;
}

function renderPads() {
  dom.padCarousel.innerHTML = '';

  state.pads.forEach((pad, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `pad ${pad.url ? 'is-filled' : ''} ${state.sourcePadIndex === index ? 'is-active' : ''}`;
    button.innerHTML = `
      <span class="pad-index">Pad ${index + 1}</span>
      <span class="pad-name">${escapeHtml(pad.url ? pad.name : 'Empty')}</span>
      <span class="pad-meta">${pad.url ? `${pad.bpm} BPM · ${formatLoopLength(pad.loopEnd)} loop` : 'Tap to load sound'}</span>
    `;

    let pressTimer = 0;
    button.addEventListener('pointerdown', () => {
      if (!pad.url) return;
      pressTimer = window.setTimeout(() => {
        state.sourcePadIndex = index;
        openSourceSheet(index, true);
      }, LONG_PRESS_MS);
    });
    button.addEventListener('pointerup', () => window.clearTimeout(pressTimer));
    button.addEventListener('pointerleave', () => window.clearTimeout(pressTimer));
    button.addEventListener('click', () => handlePadTap(index));
    dom.padCarousel.appendChild(button);
  });
}

function handlePadTap(index) {
  const pad = state.pads[index];
  if (!pad.url) {
    openSourceSheet(index, false);
    return;
  }
  createBubbleFromPad(pad);
}

function openSourceSheet(index, replacing) {
  state.sourcePadIndex = index;
  dom.sourceTitle.textContent = replacing ? `Replace ${state.pads[index].name}` : `Load Pad ${index + 1}`;
  dom.sourceSheet.classList.remove('hidden');
  renderPads();
}

function closeSourceSheet() {
  state.sourcePadIndex = null;
  dom.sourceSheet.classList.add('hidden');
  dom.recordingNote.classList.add('hidden');
  dom.sourceRecord.textContent = 'Record mic';
  renderPads();
}

async function onFilePicked(event) {
  const [file] = event.target.files || [];
  dom.fileInput.value = '';
  if (!file) return;

  const slot = state.sourcePadIndex ?? firstEmptyPadIndex();
  if (slot === -1) {
    setStatus('All pads are full. Long press a filled pad to replace it.');
    closeSourceSheet();
    return;
  }

  const pad = await createPadFromFile(file, slot);
  state.pads[slot] = pad;
  savePads();
  closeSourceSheet();
  renderPads();
  setStatus(`${pad.name} is ready. Tap the pad to place a bubble.`);
}

function firstEmptyPadIndex() {
  return state.pads.findIndex((pad) => !pad.url);
}

async function createPadFromFile(file, slot) {
  const dataUrl = await fileToDataUrl(file);
  const arrayBuffer = await file.arrayBuffer();
  const context = new AudioContext();
  const buffer = await context.decodeAudioData(arrayBuffer.slice(0));
  await context.close();

  const analysis = analyzeLoop(buffer.duration);
  return {
    id: crypto.randomUUID(),
    slot,
    name: file.name.replace(/\.[^.]+$/, ''),
    url: dataUrl,
    bpm: analysis.bpm,
    loopStart: 0,
    loopEnd: analysis.loopEnd,
    gain: 0.8,
  };
}

function analyzeLoop(duration) {
  let best = { score: Number.POSITIVE_INFINITY, bpm: DEFAULT_BPM, bars: 1, ideal: duration };
  for (let bpm = 70; bpm <= 140; bpm += 1) {
    for (const bars of [1, 2, 4]) {
      const ideal = (60 / bpm) * 4 * bars;
      const score = Math.abs(ideal - duration);
      if (score < best.score) {
        best = { score, bpm, bars, ideal };
      }
    }
  }

  return {
    bpm: best.bpm,
    bars: best.bars,
    loopEnd: Math.min(duration, best.ideal),
  };
}

async function ensureAudio() {
  if (!state.audioContext) {
    state.audioContext = new AudioContext();
    state.masterGain = state.audioContext.createGain();
    state.masterGain.gain.value = 0.95;
    state.masterGain.connect(state.audioContext.destination);
  }
  if (state.audioContext.state !== 'running') {
    await state.audioContext.resume();
  }
}

async function createBubbleFromPad(pad) {
  if (!state.xrSession) {
    setStatus('Enter AR to place bubbles in space.');
    return;
  }
  if (state.bubbles.length >= MAX_BUBBLES) {
    setStatus('Maximum of 8 active bubbles reached.');
    return;
  }

  await ensureAudio();
  const buffer = await loadAudioBuffer(pad.url);
  const { position, forward } = getPlacementPose();
  const range = mapLoopToRange(pad.loopEnd);
  const bubble = buildBubbleVisual(range);
  bubble.group.position.copy(position.clone().add(forward.multiplyScalar(SPAWN_DISTANCE)));
  bubble.group.scale.setScalar(0.01);
  bubble.group.userData.bubbleId = bubble.id;
  state.scene.add(bubble.group);

  const source = state.audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = pad.loopStart;
  source.loopEnd = Math.min(buffer.duration, pad.loopEnd || buffer.duration);

  const gainNode = state.audioContext.createGain();
  gainNode.gain.value = 0;

  const panner = new PannerNode(state.audioContext, {
    panningModel: 'HRTF',
    distanceModel: 'linear',
    refDistance: 0.4,
    maxDistance: Math.max(range * 2, 6),
    rolloffFactor: 1,
    coneInnerAngle: 360,
    coneOuterAngle: 360,
  });

  source.connect(gainNode);
  gainNode.connect(panner);
  panner.connect(state.masterGain);

  const nextBeat = Math.ceil(state.audioContext.currentTime / state.tempo.beatDuration) * state.tempo.beatDuration;
  source.start(nextBeat);

  const item = {
    id: bubble.id,
    padId: pad.id,
    name: pad.name,
    mesh: bubble.core,
    aura: bubble.aura,
    group: bubble.group,
    audio: { source, gainNode, panner, buffer },
    range,
    gainMax: pad.gain,
    currentGain: 0,
    targetGain: 0,
    stuck: false,
    stuckDistance: STUCK_DISTANCE,
    baseY: bubble.group.position.y,
    driftSeed: Math.random() * Math.PI * 2,
    spawnAt: performance.now(),
    fadeOut: false,
  };

  source.onended = () => {
    if (state.scene && item.group.parent) {
      item.group.parent.remove(item.group);
    }
  };

  state.bubbles.push(item);
  state.lastCreatedBubbleIds.push(item.id);
  selectBubble(item.id);
  syncBubbleCount();
  setStatus(`${pad.name} joins on the next beat.`);
}

function buildBubbleVisual(range) {
  const id = crypto.randomUUID();
  const group = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 32, 32),
    new THREE.MeshPhysicalMaterial({
      color: 0x8fe8ff,
      transparent: true,
      opacity: 0.7,
      roughness: 0.08,
      metalness: 0.02,
      transmission: 0.55,
      thickness: 0.4,
      emissive: 0x6ed9ff,
      emissiveIntensity: 0.6,
    }),
  );

  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(range, 24, 24),
    new THREE.MeshBasicMaterial({
      color: 0x8fe8ff,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );

  group.add(aura);
  group.add(core);

  return { id, group, core, aura };
}

function mapLoopToRange(loopEnd) {
  return THREE.MathUtils.clamp(1.4 + loopEnd * 0.45, 1.4, 4.8);
}

function getPlacementPose() {
  const camera = state.renderer.xr.isPresenting ? state.renderer.xr.getCamera() : state.camera;
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  camera.getWorldPosition(position);
  camera.getWorldQuaternion(quaternion);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
  return { position, quaternion, forward };
}

async function loadAudioBuffer(url) {
  await ensureAudio();
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return state.audioContext.decodeAudioData(arrayBuffer.slice(0));
}

async function startArSession() {
  if (!state.arSupported) {
    dom.supportBanner.classList.remove('hidden');
    return;
  }

  if (state.xrSession) {
    await state.xrSession.end();
    return;
  }

  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['local'],
    optionalFeatures: ['dom-overlay'],
    domOverlay: { root: document.body },
  });

  state.xrSession = session;
  session.addEventListener('end', onSessionEnd);
  await state.renderer.xr.setSession(session);
  dom.enterAr.textContent = 'Exit AR';
  setStatus('Tap a filled pad to place a loop bubble in front of you.');
  await ensureAudio();
}

function onSessionEnd() {
  state.xrSession = null;
  dom.enterAr.textContent = 'Enter AR';
  setStatus('AR session ended. Re-enter to sculpt more sound.');
}

async function checkArSupport() {
  if (!navigator.xr) {
    dom.supportBanner.classList.remove('hidden');
    return;
  }

  state.arSupported = await navigator.xr.isSessionSupported('immersive-ar');
  dom.supportBanner.classList.toggle('hidden', state.arSupported);
  dom.enterAr.disabled = !state.arSupported;
  state.supportChecked = true;
}

function selectBubble(bubbleId) {
  state.selectedBubbleId = bubbleId;
  const bubble = state.bubbles.find((item) => item.id === bubbleId);
  if (!bubble) {
    dom.bubblePanel.classList.add('hidden');
    return;
  }

  dom.bubblePanel.classList.remove('hidden');
  dom.bubbleTitle.textContent = bubble.name;
  dom.bubbleStick.textContent = bubble.stuck ? 'Décoller' : 'Coller';
  dom.rangeSlider.value = String(bubble.range);
  dom.gainSlider.value = String(bubble.gainMax);
  dom.rangeValue.textContent = `${bubble.range.toFixed(2)} m`;
  dom.gainValue.textContent = bubble.gainMax.toFixed(2);

  state.bubbles.forEach((item) => {
    const selected = item.id === bubbleId;
    item.mesh.material.emissiveIntensity = selected ? 1.0 : 0.6;
    item.aura.material.opacity = selected ? 0.1 : 0.05;
  });
}

function updateSelectedBubbleUi() {
  const bubble = getSelectedBubble();
  if (!bubble) return;
  bubble.range = Number(dom.rangeSlider.value);
  bubble.gainMax = Number(dom.gainSlider.value);
  bubble.aura.scale.setScalar(bubble.range / bubble.aura.geometry.parameters.radius);
  dom.rangeValue.textContent = `${bubble.range.toFixed(2)} m`;
  dom.gainValue.textContent = bubble.gainMax.toFixed(2);
}

function toggleSelectedStickiness() {
  const bubble = getSelectedBubble();
  if (!bubble) return;
  bubble.stuck = !bubble.stuck;
  dom.bubbleStick.textContent = bubble.stuck ? 'Décoller' : 'Coller';
  setStatus(bubble.stuck ? 'Bubble collée to your forward space.' : 'Bubble décollée into world space.');
}

function getSelectedBubble() {
  return state.bubbles.find((item) => item.id === state.selectedBubbleId) || null;
}

async function toggleRecording() {
  if (state.recorder?.state === 'recording') {
    state.recorder.stop();
    return;
  }

  try {
    state.recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recordingChunks = [];
    state.recorder = new MediaRecorder(state.recordingStream);
    state.recorder.ondataavailable = (event) => {
      if (event.data.size) state.recordingChunks.push(event.data);
    };
    state.recorder.onstop = finishRecording;
    state.recorder.start();
    dom.recordingNote.classList.remove('hidden');
    dom.sourceRecord.textContent = 'Stop recording';
    setStatus('Recording microphone loop…');
  } catch (error) {
    console.error(error);
    setStatus('Microphone recording is unavailable.');
  }
}

async function finishRecording() {
  const slot = state.sourcePadIndex ?? firstEmptyPadIndex();
  if (slot === -1) {
    closeSourceSheet();
    setStatus('All pads are full. Long press a filled pad to replace it.');
    state.recordingStream?.getTracks().forEach((track) => track.stop());
    state.recordingStream = null;
    return;
  }

  const blob = new Blob(state.recordingChunks, { type: state.recorder.mimeType || 'audio/webm' });
  const file = new File([blob], `Mic Loop ${slot + 1}.webm`, { type: blob.type });
  const pad = await createPadFromFile(file, slot);
  pad.name = `Mic Loop ${slot + 1}`;
  state.pads[slot] = pad;
  savePads();
  renderPads();
  closeSourceSheet();
  dom.sourceRecord.textContent = 'Record mic';
  state.recordingStream?.getTracks().forEach((track) => track.stop());
  state.recordingStream = null;
  setStatus(`${pad.name} captured and ready.`);
}

function clearPads() {
  state.pads = Array.from({ length: MAX_PADS }, (_, index) => createEmptyPad(index));
  savePads();
  renderPads();
  closeSourceSheet();
  setStatus('All pads cleared.');
}

function clearBubbles() {
  const bubbles = [...state.bubbles];
  bubbles.forEach((bubble) => fadeOutAndRemoveBubble(bubble));
  state.lastCreatedBubbleIds = [];
  selectBubble(null);
  syncBubbleCount();
  setStatus('All active bubbles are fading out.');
}

function undoLastBubble() {
  const bubbleId = state.lastCreatedBubbleIds.pop();
  if (!bubbleId) {
    setStatus('Nothing to undo.');
    return;
  }
  const bubble = state.bubbles.find((item) => item.id === bubbleId);
  if (!bubble) return;
  fadeOutAndRemoveBubble(bubble);
  setStatus('Last bubble undone.');
}

function fadeOutAndRemoveBubble(bubble) {
  bubble.fadeOut = true;
  bubble.fadeStartedAt = state.audioContext?.currentTime || 0;
  bubble.fadeFrom = bubble.audio?.gainNode.gain.value || 0;
  window.setTimeout(() => {
    try {
      bubble.audio?.source.stop();
    } catch (error) {
      // noop
    }
    bubble.audio?.source.disconnect();
    bubble.audio?.gainNode.disconnect();
    bubble.audio?.panner.disconnect();
    bubble.group.parent?.remove(bubble.group);
    state.bubbles = state.bubbles.filter((item) => item.id !== bubble.id);
    state.lastCreatedBubbleIds = state.lastCreatedBubbleIds.filter((id) => id !== bubble.id);
    if (state.selectedBubbleId === bubble.id) {
      state.selectedBubbleId = null;
      dom.bubblePanel.classList.add('hidden');
    }
    syncBubbleCount();
  }, 260);
}

function onSelectStart() {
  state.controllerPressed = true;
  const hit = pickBubble();
  if (!hit) return;
  selectBubble(hit.id);
  state.longPressTimer = window.setTimeout(() => {
    const selected = getSelectedBubble();
    if (selected?.id === hit.id) {
      fadeOutAndRemoveBubble(selected);
      setStatus(`${selected.name} popped.`);
    }
  }, LONG_PRESS_MS);
}

function onSelectEnd() {
  state.controllerPressed = false;
  window.clearTimeout(state.longPressTimer);
  const hit = pickBubble();
  if (hit) {
    selectBubble(hit.id);
  }
}

function pickBubble() {
  if (!state.bubbles.length) return null;
  const camera = state.renderer.xr.isPresenting ? state.renderer.xr.getCamera() : state.camera;
  const origin = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  camera.getWorldPosition(origin);
  camera.getWorldQuaternion(quaternion);
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
  shared.raycaster.set(origin, direction);
  const hits = shared.raycaster.intersectObjects(state.bubbles.map((bubble) => bubble.mesh), false);
  if (!hits.length) return null;
  return state.bubbles.find((bubble) => bubble.mesh === hits[0].object) || null;
}

function animate() {
  state.renderer.setAnimationLoop(renderFrame);
}

function renderFrame() {
  const now = performance.now();

  updateListener();
  updateBubbles(now);
  state.renderer.render(state.scene, state.camera);
}

function updateListener() {
  if (!state.audioContext) return;
  const listener = state.audioContext.listener;
  const { position, quaternion } = getPlacementPose();
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
  const t = state.audioContext.currentTime;

  if (listener.positionX) {
    listener.positionX.linearRampToValueAtTime(position.x, t + 0.05);
    listener.positionY.linearRampToValueAtTime(position.y, t + 0.05);
    listener.positionZ.linearRampToValueAtTime(position.z, t + 0.05);
    listener.forwardX.linearRampToValueAtTime(forward.x, t + 0.05);
    listener.forwardY.linearRampToValueAtTime(forward.y, t + 0.05);
    listener.forwardZ.linearRampToValueAtTime(forward.z, t + 0.05);
    listener.upX.linearRampToValueAtTime(up.x, t + 0.05);
    listener.upY.linearRampToValueAtTime(up.y, t + 0.05);
    listener.upZ.linearRampToValueAtTime(up.z, t + 0.05);
  }
}

function updateBubbles(now) {
  const pose = getPlacementPose();

  state.bubbles.forEach((bubble) => {
    if (bubble.stuck) {
      bubble.group.position.copy(pose.position).add(pose.forward.clone().multiplyScalar(bubble.stuckDistance));
      bubble.baseY = bubble.group.position.y;
    }

    const floatOffset = Math.sin(now * 0.0012 + bubble.driftSeed) * 0.018;
    bubble.group.position.y = bubble.baseY + floatOffset;
    bubble.group.rotation.y += 0.0025;

    const spawnProgress = Math.min(1, (now - bubble.spawnAt) / 520);
    const eased = 1 - Math.pow(1 - spawnProgress, 3);
    const bounce = 1 + Math.sin(Math.min(Math.PI, spawnProgress * Math.PI)) * 0.08 * (1 - spawnProgress);
    bubble.group.scale.setScalar(Math.max(0.01, eased * bounce));

    const distance = bubble.group.position.distanceTo(pose.position);
    bubble.targetGain = distance < bubble.range ? Math.pow(1 - distance / bubble.range, 2) * bubble.gainMax : 0;
    bubble.currentGain += (bubble.targetGain - bubble.currentGain) * 0.08;

    if (bubble.fadeOut) {
      bubble.currentGain *= 0.78;
    }

    if (bubble.audio?.gainNode?.gain) {
      bubble.audio.gainNode.gain.linearRampToValueAtTime(bubble.currentGain, state.audioContext.currentTime + 0.05);
      bubble.audio.panner.positionX.linearRampToValueAtTime(bubble.group.position.x, state.audioContext.currentTime + 0.05);
      bubble.audio.panner.positionY.linearRampToValueAtTime(bubble.group.position.y, state.audioContext.currentTime + 0.05);
      bubble.audio.panner.positionZ.linearRampToValueAtTime(bubble.group.position.z, state.audioContext.currentTime + 0.05);
    }
  });
}

function onResize() {
  state.camera.aspect = window.innerWidth / window.innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(window.innerWidth, window.innerHeight);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatLoopLength(seconds) {
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
