import * as THREE from 'three';

const APP_STORAGE_KEY = 'echo-bubble-loop::pads';
const MAX_PADS = 8;
const MAX_BUBBLES = 8;
const DEFAULT_BPM = 90;
const SPAWN_DISTANCE = 0.4;
const STUCK_DISTANCE = 0.6;
const LONG_PRESS_MS = 520;
const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

const dom = {
  xrRoot: document.querySelector('#xr-root'),
  topBar: document.querySelector('#top-bar'),
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
  bubbleToggle: document.querySelector('#bubble-toggle'),
  bubblePanel: document.querySelector('#bubble-panel'),
  bubbleTitle: document.querySelector('#bubble-title'),
  bubbleStick: document.querySelector('#bubble-stick'),
  rangeSlider: document.querySelector('#range-slider'),
  rangeValue: document.querySelector('#range-value'),
  gainSlider: document.querySelector('#gain-slider'),
  gainValue: document.querySelector('#gain-value'),
  sourceToggle: document.querySelector('#source-toggle'),
  sourceSheet: document.querySelector('#source-sheet'),
  sourceTitle: document.querySelector('#source-title'),
  closeSource: document.querySelector('#close-source'),
  sourceImport: document.querySelector('#source-import'),
  sourceRecord: document.querySelector('#source-record'),
  recordingNote: document.querySelector('#recording-note'),
  padCarousel: document.querySelector('#pad-carousel'),
  bottomDock: document.querySelector('#bottom-dock'),
  dockToggle: document.querySelector('#dock-toggle'),
  dockBody: document.querySelector('#dock-body'),
  undoBtn: document.querySelector('#undo-btn'),
  fileInput: document.querySelector('#file-input'),
};

const shared = {
  raycaster: new THREE.Raycaster(),
  origin: new THREE.Vector3(),
  direction: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
};

const state = {
  renderer: null,
  scene: null,
  camera: null,
  xrSession: null,
  lastXRFrame: null,
  audioContext: null,
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
  arSupported: false,
  sessionUsesDomOverlay: false,
  bufferCache: new Map(),
  ui: {
    configOpen: false,
    sourceOpen: false,
    bubbleOpen: false,
    dockOpen: false,
  },
};

bootstrap();

async function bootstrap() {
  setupThree();
  loadPads();
  renderPads();
  syncTempoUi();
  syncOverlayUi();
  bindUi();
  await checkArSupport();
  state.renderer.setAnimationLoop(renderFrame);
}

function setupThree() {
  state.scene = new THREE.Scene();
  state.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);
  state.scene.add(state.camera);

  state.scene.add(new THREE.HemisphereLight(0xe9f7ff, 0x122036, 1.8));

  const glow = new THREE.PointLight(0x95e9ff, 1.8, 8, 2);
  glow.position.set(0.4, 1.4, -0.8);
  state.scene.add(glow);

  state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
  state.renderer.xr.enabled = true;
  state.renderer.xr.setReferenceSpaceType('local');
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  state.renderer.setClearColor(0x000000, 0);
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  dom.xrRoot.appendChild(state.renderer.domElement);

  window.addEventListener('resize', onResize);
}

function bindUi() {
  dom.enterAr.addEventListener('click', startArSession);
  dom.configToggle.addEventListener('click', () => togglePanel('config'));
  dom.importAudio.addEventListener('click', () => {
    state.sourcePadIndex = null;
    dom.fileInput.click();
  });
  dom.clearPads.addEventListener('click', clearPads);
  dom.clearBubbles.addEventListener('click', clearBubbles);
  dom.undoBtn.addEventListener('click', undoLastBubble);
  dom.dockToggle.addEventListener('click', () => togglePanel('dock'));
  dom.sourceToggle.addEventListener('click', () => togglePanel('source'));
  dom.bubbleToggle.addEventListener('click', () => togglePanel('bubble'));
  dom.bubbleStick.addEventListener('click', toggleSelectedStickiness);
  dom.rangeSlider.addEventListener('input', updateSelectedBubbleUi);
  dom.gainSlider.addEventListener('input', updateSelectedBubbleUi);
  dom.closeSource.addEventListener('click', minimizeSourceSheet);
  dom.sourceImport.addEventListener('click', () => dom.fileInput.click());
  dom.sourceRecord.addEventListener('click', toggleRecording);
  dom.fileInput.addEventListener('change', onFilePicked);

  const canRecord = Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia && AudioContextCtor);
  dom.sourceRecord.disabled = !canRecord;
}

function togglePanel(panel) {
  if (panel === 'config') {
    const next = !state.ui.configOpen;
    state.ui.configOpen = next;
    if (next) {
      state.ui.sourceOpen = false;
      state.ui.bubbleOpen = false;
    }
  }

  if (panel === 'source' && state.sourcePadIndex !== null) {
    const next = !state.ui.sourceOpen;
    state.ui.sourceOpen = next;
    if (next) {
      state.ui.configOpen = false;
      state.ui.bubbleOpen = false;
    }
  }

  if (panel === 'bubble' && state.selectedBubbleId) {
    const next = !state.ui.bubbleOpen;
    state.ui.bubbleOpen = next;
    if (next) {
      state.ui.configOpen = false;
      state.ui.sourceOpen = false;
    }
  }

  if (panel === 'dock') {
    state.ui.dockOpen = !state.ui.dockOpen;
  }

  syncOverlayUi();
}

function syncOverlayUi() {
  dom.configPanel.classList.toggle('hidden', !state.ui.configOpen);

  const hasSourceContext = state.sourcePadIndex !== null;
  dom.sourceToggle.classList.toggle('hidden', !hasSourceContext);
  dom.sourceSheet.classList.toggle('hidden', !(hasSourceContext && state.ui.sourceOpen));

  const hasBubbleContext = Boolean(state.selectedBubbleId);
  dom.bubbleToggle.classList.toggle('hidden', !hasBubbleContext);
  dom.bubblePanel.classList.toggle('hidden', !(hasBubbleContext && state.ui.bubbleOpen));

  dom.bottomDock.classList.toggle('is-collapsed', !state.ui.dockOpen);
  dom.dockBody.classList.toggle('hidden', !state.ui.dockOpen);
  dom.dockToggle.textContent = state.ui.dockOpen ? 'Hide pads' : 'Pads';
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
  const label = `${state.tempo.bpm} BPM`;
  dom.tempoText.textContent = label;
  dom.configBpm.textContent = label;
  syncBubbleCount();
}

function syncBubbleCount() {
  dom.bubbleCount.textContent = `${state.bubbles.length} / ${MAX_BUBBLES}`;
}

function setStatus(message) {
  dom.statusText.textContent = message;
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
      pressTimer = window.setTimeout(() => openSourceSheet(index, true), LONG_PRESS_MS);
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
  void createBubbleFromPad(pad);
}

function openSourceSheet(index, replacing) {
  state.sourcePadIndex = index;
  state.ui.sourceOpen = true;
  state.ui.configOpen = false;
  state.ui.bubbleOpen = false;
  dom.sourceTitle.textContent = replacing ? `Replace ${state.pads[index].name}` : `Load Pad ${index + 1}`;
  syncOverlayUi();
  renderPads();
}

function minimizeSourceSheet() {
  state.ui.sourceOpen = false;
  syncOverlayUi();
}

function closeSourceSheet() {
  state.sourcePadIndex = null;
  state.ui.sourceOpen = false;
  dom.recordingNote.classList.add('hidden');
  dom.sourceRecord.textContent = 'Record mic';
  syncOverlayUi();
  renderPads();
}

async function onFilePicked(event) {
  const [file] = event.target.files || [];
  dom.fileInput.value = '';
  if (!file) return;

  const slot = state.sourcePadIndex ?? firstEmptyPadIndex();
  if (slot === -1) {
    closeSourceSheet();
    setStatus('All pads are full. Long press a filled pad to replace one.');
    return;
  }

  try {
    const pad = await createPadFromFile(file, slot);
    state.pads[slot] = pad;
    savePads();
    closeSourceSheet();
    renderPads();
    setStatus(`${pad.name} is ready. Tap the pad to place a bubble.`);
    state.ui.dockOpen = true;
    syncOverlayUi();
  } catch (error) {
    console.error(error);
    setStatus('Audio import failed on this device.');
  }
}

function firstEmptyPadIndex() {
  return state.pads.findIndex((pad) => !pad.url);
}

async function createPadFromFile(file, slot) {
  if (!AudioContextCtor) {
    throw new Error('Web Audio unavailable');
  }

  const dataUrl = await fileToDataUrl(file);
  const arrayBuffer = await file.arrayBuffer();
  const context = new AudioContextCtor();
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
  if (!AudioContextCtor) {
    throw new Error('Web Audio unavailable');
  }

  if (!state.audioContext) {
    state.audioContext = new AudioContextCtor();
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

  try {
    await ensureAudio();
    const buffer = await loadAudioBuffer(pad.url);
    const pose = getPlacementPose();
    const range = mapLoopToRange(pad.loopEnd);
    const bubbleVisual = buildBubbleVisual(range);
    bubbleVisual.group.position.copy(pose.position).addScaledVector(pose.forward, SPAWN_DISTANCE);
    bubbleVisual.group.scale.setScalar(0.01);
    state.scene.add(bubbleVisual.group);

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

    const bubble = {
      id: bubbleVisual.id,
      padId: pad.id,
      name: pad.name,
      mesh: bubbleVisual.core,
      aura: bubbleVisual.aura,
      group: bubbleVisual.group,
      audio: { source, gainNode, panner },
      range,
      gainMax: pad.gain,
      currentGain: 0,
      targetGain: 0,
      stuck: false,
      stuckDistance: STUCK_DISTANCE,
      baseY: bubbleVisual.group.position.y,
      driftSeed: Math.random() * Math.PI * 2,
      spawnAt: performance.now(),
      fadeOut: false,
    };

    source.onended = () => bubble.group.parent?.remove(bubble.group);

    state.bubbles.push(bubble);
    state.lastCreatedBubbleIds.push(bubble.id);
    selectBubble(bubble.id);
    syncBubbleCount();
    setStatus(`${pad.name} joins on the next beat.`);
  } catch (error) {
    console.error(error);
    setStatus('Bubble creation failed in AR.');
  }
}

function buildBubbleVisual(range) {
  const group = new THREE.Group();

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 32, 32),
    new THREE.MeshPhysicalMaterial({
      color: 0x8fe8ff,
      transparent: true,
      opacity: 0.72,
      roughness: 0.08,
      metalness: 0.02,
      transmission: 0.58,
      thickness: 0.35,
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

  group.add(aura, core);

  return {
    id: crypto.randomUUID(),
    group,
    core,
    aura,
  };
}

function mapLoopToRange(loopEnd) {
  return THREE.MathUtils.clamp(1.4 + loopEnd * 0.45, 1.4, 4.8);
}

function getPlacementPose() {
  const xrCamera = state.renderer.xr.isPresenting ? state.renderer.xr.getCamera() : state.camera;
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const forward = new THREE.Vector3(0, 0, -1);

  xrCamera.getWorldPosition(position);
  xrCamera.getWorldQuaternion(quaternion);
  forward.applyQuaternion(quaternion).normalize();

  return { position, quaternion, forward };
}

async function loadAudioBuffer(url) {
  if (state.bufferCache.has(url)) {
    return state.bufferCache.get(url);
  }

  await ensureAudio();
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = await state.audioContext.decodeAudioData(arrayBuffer.slice(0));
  state.bufferCache.set(url, buffer);
  return buffer;
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

  try {
    let session;
    try {
      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: document.body },
      });
    } catch (overlayError) {
      console.warn('Retrying immersive-ar without DOM overlay.', overlayError);
      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local'],
      });
    }

    await attachSession(session);
    setStatus('Tap a filled pad to place a loop bubble in front of you.');
  } catch (error) {
    console.error(error);
    setStatus('Unable to start AR on this device.');
  }
}

async function attachSession(session) {
  state.xrSession = session;
  state.sessionUsesDomOverlay = Boolean(session.domOverlayState);

  session.addEventListener('end', onSessionEnd);
  session.addEventListener('selectstart', onSessionSelectStart);
  session.addEventListener('selectend', onSessionSelectEnd);

  await state.renderer.xr.setSession(session);
  await ensureAudio();

  dom.enterAr.textContent = 'Exit AR';
  document.body.classList.add('is-ar-active');
  state.ui.dockOpen = false;
  syncOverlayUi();
  if (!state.sessionUsesDomOverlay) {
    setStatus('AR started. Device DOM overlay is unavailable, so UI may be limited inside the session.');
  }
}

function onSessionEnd(event) {
  const session = event?.target || state.xrSession;
  session?.removeEventListener('end', onSessionEnd);
  session?.removeEventListener('selectstart', onSessionSelectStart);
  session?.removeEventListener('selectend', onSessionSelectEnd);

  state.xrSession = null;
  state.lastXRFrame = null;
  state.sessionUsesDomOverlay = false;
  document.body.classList.remove('is-ar-active');
  dom.enterAr.textContent = 'Enter AR';
  window.clearTimeout(state.longPressTimer);
  setStatus('AR session ended. Re-enter to sculpt more sound.');
}

async function checkArSupport() {
  if (!navigator.xr) {
    dom.supportBanner.classList.remove('hidden');
    dom.enterAr.disabled = true;
    return;
  }

  try {
    state.arSupported = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (error) {
    console.error(error);
    state.arSupported = false;
  }

  dom.supportBanner.classList.toggle('hidden', state.arSupported);
  dom.enterAr.disabled = !state.arSupported;
}

function selectBubble(bubbleId) {
  state.selectedBubbleId = bubbleId;
  const bubble = state.bubbles.find((item) => item.id === bubbleId);
  if (!bubble) {
    state.ui.bubbleOpen = false;
    syncOverlayUi();
    state.bubbles.forEach((item) => {
      item.mesh.material.emissiveIntensity = 0.6;
      item.aura.material.opacity = 0.05;
    });
    return;
  }

  state.ui.bubbleOpen = true;
  state.ui.configOpen = false;
  state.ui.sourceOpen = false;
  syncOverlayUi();
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

function getSelectedBubble() {
  return state.bubbles.find((item) => item.id === state.selectedBubbleId) || null;
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

async function toggleRecording() {
  if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    setStatus('Microphone recording is unavailable on this device.');
    return;
  }

  if (state.recorder?.state === 'recording') {
    state.recorder.stop();
    return;
  }

  try {
    state.recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recordingChunks = [];
    state.recorder = new MediaRecorder(state.recordingStream);
    state.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        state.recordingChunks.push(event.data);
      }
    };
    state.recorder.onstop = finishRecording;
    state.recorder.start();
    dom.recordingNote.classList.remove('hidden');
    dom.sourceRecord.textContent = 'Stop recording';
    setStatus('Recording microphone loop…');
  } catch (error) {
    console.error(error);
    setStatus('Microphone recording is unavailable on this device.');
  }
}

async function finishRecording() {
  const slot = state.sourcePadIndex ?? firstEmptyPadIndex();
  if (slot === -1) {
    cleanupRecorder();
    closeSourceSheet();
    setStatus('All pads are full. Long press a filled pad to replace one.');
    return;
  }

  try {
    const mimeType = state.recorder?.mimeType || 'audio/webm';
    const blob = new Blob(state.recordingChunks, { type: mimeType });
    const file = new File([blob], `Mic Loop ${slot + 1}.webm`, { type: blob.type });
    const pad = await createPadFromFile(file, slot);
    pad.name = `Mic Loop ${slot + 1}`;
    state.pads[slot] = pad;
    savePads();
    closeSourceSheet();
    renderPads();
    setStatus(`${pad.name} captured and ready.`);
    state.ui.dockOpen = true;
    syncOverlayUi();
  } catch (error) {
    console.error(error);
    setStatus('Recorded audio could not be decoded on this device.');
  } finally {
    cleanupRecorder();
  }
}

function cleanupRecorder() {
  dom.sourceRecord.textContent = 'Record mic';
  dom.recordingNote.classList.add('hidden');
  state.recordingStream?.getTracks().forEach((track) => track.stop());
  state.recordingStream = null;
  state.recorder = null;
  state.recordingChunks = [];
}

function clearPads() {
  state.pads = Array.from({ length: MAX_PADS }, (_, index) => createEmptyPad(index));
  state.bufferCache.clear();
  savePads();
  closeSourceSheet();
  renderPads();
  setStatus('All pads cleared.');
  syncOverlayUi();
}

function clearBubbles() {
  [...state.bubbles].forEach((bubble) => fadeOutAndRemoveBubble(bubble));
  state.lastCreatedBubbleIds = [];
  selectBubble(null);
  syncBubbleCount();
  setStatus('All active bubbles are fading out.');
  syncOverlayUi();
}

function undoLastBubble() {
  const bubbleId = state.lastCreatedBubbleIds.pop();
  if (!bubbleId) {
    setStatus('Nothing to undo.');
    return;
  }

  const bubble = state.bubbles.find((item) => item.id === bubbleId);
  if (bubble) {
    fadeOutAndRemoveBubble(bubble);
    setStatus('Last bubble undone.');
  }
}

function fadeOutAndRemoveBubble(bubble) {
  bubble.fadeOut = true;

  if (state.audioContext) {
    const now = state.audioContext.currentTime;
    bubble.audio.gainNode.gain.cancelScheduledValues(now);
    bubble.audio.gainNode.gain.setValueAtTime(bubble.currentGain, now);
    bubble.audio.gainNode.gain.linearRampToValueAtTime(0, now + 0.25);
  }

  window.setTimeout(() => {
    try {
      bubble.audio.source.stop();
    } catch (error) {
      // ignore redundant stops
    }

    bubble.audio.source.disconnect();
    bubble.audio.gainNode.disconnect();
    bubble.audio.panner.disconnect();
    bubble.group.parent?.remove(bubble.group);

    state.bubbles = state.bubbles.filter((item) => item.id !== bubble.id);
    state.lastCreatedBubbleIds = state.lastCreatedBubbleIds.filter((id) => id !== bubble.id);
    if (state.selectedBubbleId === bubble.id) {
      selectBubble(null);
    }
    syncBubbleCount();
    syncOverlayUi();
  }, 260);
}

function onSessionSelectStart(event) {
  const hit = pickBubble(event.frame, event.inputSource);
  if (!hit) return;

  selectBubble(hit.id);
  window.clearTimeout(state.longPressTimer);
  state.longPressTimer = window.setTimeout(() => {
    const selected = getSelectedBubble();
    if (selected?.id === hit.id) {
      fadeOutAndRemoveBubble(selected);
      setStatus(`${selected.name} popped.`);
    }
  }, LONG_PRESS_MS);
}

function onSessionSelectEnd(event) {
  window.clearTimeout(state.longPressTimer);
  const hit = pickBubble(event.frame, event.inputSource);
  if (hit) {
    selectBubble(hit.id);
  }
}

function pickBubble(frame = state.lastXRFrame, inputSource = null) {
  if (!state.bubbles.length) return null;

  const ray = getTargetRay(frame, inputSource);
  if (!ray) return null;

  shared.raycaster.set(ray.origin, ray.direction);
  const hits = shared.raycaster.intersectObjects(state.bubbles.map((bubble) => bubble.mesh), false);
  if (!hits.length) return null;

  return state.bubbles.find((bubble) => bubble.mesh === hits[0].object) || null;
}

function getTargetRay(frame = state.lastXRFrame, inputSource = null) {
  const referenceSpace = state.renderer.xr.getReferenceSpace?.();
  if (frame && inputSource?.targetRaySpace && referenceSpace) {
    const pose = frame.getPose(inputSource.targetRaySpace, referenceSpace);
    if (pose) {
      shared.origin.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);
      shared.quaternion.set(
        pose.transform.orientation.x,
        pose.transform.orientation.y,
        pose.transform.orientation.z,
        pose.transform.orientation.w,
      );
      shared.direction.set(0, 0, -1).applyQuaternion(shared.quaternion).normalize();
      return { origin: shared.origin.clone(), direction: shared.direction.clone() };
    }
  }

  const pose = getPlacementPose();
  return { origin: pose.position, direction: pose.forward };
}

function renderFrame(_time, frame) {
  state.lastXRFrame = frame || null;
  updateListener();
  updateBubbles(performance.now());
  state.renderer.render(state.scene, state.camera);
}

function updateListener() {
  if (!state.audioContext) return;

  const listener = state.audioContext.listener;
  const pose = getPlacementPose();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quaternion).normalize();
  const t = state.audioContext.currentTime;

  if (listener.positionX) {
    listener.positionX.linearRampToValueAtTime(pose.position.x, t + 0.05);
    listener.positionY.linearRampToValueAtTime(pose.position.y, t + 0.05);
    listener.positionZ.linearRampToValueAtTime(pose.position.z, t + 0.05);
    listener.forwardX.linearRampToValueAtTime(pose.forward.x, t + 0.05);
    listener.forwardY.linearRampToValueAtTime(pose.forward.y, t + 0.05);
    listener.forwardZ.linearRampToValueAtTime(pose.forward.z, t + 0.05);
    listener.upX.linearRampToValueAtTime(up.x, t + 0.05);
    listener.upY.linearRampToValueAtTime(up.y, t + 0.05);
    listener.upZ.linearRampToValueAtTime(up.z, t + 0.05);
  }
}

function updateBubbles(now) {
  const pose = getPlacementPose();

  state.bubbles.forEach((bubble) => {
    if (bubble.stuck) {
      bubble.group.position.copy(pose.position).addScaledVector(pose.forward, bubble.stuckDistance);
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

    if (!state.audioContext) return;
    const t = state.audioContext.currentTime + 0.05;
    bubble.audio.gainNode.gain.linearRampToValueAtTime(bubble.currentGain, t);
    bubble.audio.panner.positionX.linearRampToValueAtTime(bubble.group.position.x, t);
    bubble.audio.panner.positionY.linearRampToValueAtTime(bubble.group.position.y, t);
    bubble.audio.panner.positionZ.linearRampToValueAtTime(bubble.group.position.z, t);
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
