import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

const MAX_PADS = 3;
const MAX_BUBBLES = 8;
const DEFAULT_RANGE = 6;
const DEFAULT_GAIN = 0.3;
const DEFAULT_BPM = 90;
const PLACE_DISTANCE = 0.4;
const LONG_PRESS_MS = 420;
const FADE_TIME = 0.18;
const FLOAT_RISE = 0.018;
const FLOAT_SWAY = 0.012;
const BUBBLE_RADIUS = 0.088;

const listenerPosition = new THREE.Vector3();
const listenerQuaternion = new THREE.Quaternion();
const listenerForward = new THREE.Vector3(0, 0, -1);
const listenerUp = new THREE.Vector3(0, 1, 0);
const tempForward = new THREE.Vector3();
const tempUp = new THREE.Vector3();
const tempPosition = new THREE.Vector3();
const tempTarget = new THREE.Vector3();
const bubbleVisualOffset = new THREE.Vector3();
const bubbleWorldPosition = new THREE.Vector3();
const analysisBuffer = new Float32Array(2048);
const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

function createToast(id, tone, message) {
  return { id, tone, message };
}

function createPad(index) {
  return {
    id: `pad-${index + 1}`,
    label: `${index + 1}`,
    name: '',
    url: '',
    buffer: null,
    bpm: DEFAULT_BPM,
    loopEnd: 0,
    gain: DEFAULT_GAIN,
    duration: 0,
    bars: 1,
    sourceType: '',
  };
}

function estimateSampleBpm(buffer) {
  const sampleRate = buffer.sampleRate || 44100;
  const channelData = buffer.getChannelData(0);
  if (!channelData?.length) {
    return DEFAULT_BPM;
  }

  const stride = Math.max(1, Math.floor(channelData.length / analysisBuffer.length));
  const frameLength = analysisBuffer.length;

  for (let index = 0; index < frameLength; index += 1) {
    let sum = 0;
    let count = 0;
    const start = index * stride;
    const end = Math.min(start + stride, channelData.length);

    for (let cursor = start; cursor < end; cursor += 1) {
      sum += Math.abs(channelData[cursor]);
      count += 1;
    }

    analysisBuffer[index] = count ? sum / count : 0;
  }

  const meanEnergy = analysisBuffer.reduce((total, value) => total + value, 0) / frameLength;
  const threshold = meanEnergy * 1.45;
  const peaks = [];

  for (let index = 1; index < frameLength - 1; index += 1) {
    const value = analysisBuffer[index];
    if (value > threshold && value >= analysisBuffer[index - 1] && value > analysisBuffer[index + 1]) {
      peaks.push(index);
    }
  }

  if (peaks.length < 2) {
    return DEFAULT_BPM;
  }

  const secondsPerFrame = (channelData.length / sampleRate) / frameLength;
  const candidates = [];

  for (let index = 1; index < peaks.length; index += 1) {
    const deltaFrames = peaks[index] - peaks[index - 1];
    const interval = deltaFrames * secondsPerFrame;
    if (!interval) {
      continue;
    }

    let bpm = 60 / interval;
    while (bpm < 70) bpm *= 2;
    while (bpm > 160) bpm /= 2;
    if (bpm >= 70 && bpm <= 160) {
      candidates.push(bpm);
    }
  }

  if (!candidates.length) {
    return DEFAULT_BPM;
  }

  candidates.sort((left, right) => left - right);
  return Math.round(candidates[Math.floor(candidates.length / 2)]);
}

function normalizeSampleGain(buffer) {
  const channelData = buffer.getChannelData(0);
  if (!channelData?.length) {
    return DEFAULT_GAIN;
  }

  let peak = 0;
  let energy = 0;

  for (let index = 0; index < channelData.length; index += 64) {
    const sample = channelData[index];
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    energy += sample * sample;
  }

  const sampleCount = Math.max(1, Math.ceil(channelData.length / 64));
  const rms = Math.sqrt(energy / sampleCount);
  const peakSafe = Math.max(peak, 0.0001);
  const rmsSafe = Math.max(rms, 0.0001);
  const targetPeak = 0.72;
  const targetRms = 0.22;
  const peakScale = targetPeak / peakSafe;
  const rmsScale = targetRms / rmsSafe;
  const normalized = DEFAULT_GAIN * Math.min(peakScale, rmsScale, 1.4);

  return Number(Math.min(0.42, Math.max(0.18, normalized)).toFixed(3));
}

function pickSmartLoop(buffer) {
  const safeDuration = Math.max(buffer?.duration || 0, 0.01);
  const estimatedBpm = estimateSampleBpm(buffer);
  const options = [];

  for (const bpm of [estimatedBpm - 2, estimatedBpm - 1, estimatedBpm, estimatedBpm + 1, estimatedBpm + 2, DEFAULT_BPM]) {
    if (bpm < 70 || bpm > 160) {
      continue;
    }

    const beatDuration = 60 / bpm;
    for (const bars of [1, 2, 4]) {
      const loopDuration = bars * 4 * beatDuration;
      const diff = Math.abs(safeDuration - loopDuration);
      const overPenalty = loopDuration > safeDuration ? (loopDuration - safeDuration) * 1.4 : 0;
      options.push({ bpm, bars, loopDuration, score: diff + overPenalty });
    }
  }

  if (!options.length) {
    options.push({ bpm: DEFAULT_BPM, bars: 1, loopDuration: Math.min(safeDuration, (60 / DEFAULT_BPM) * 4), score: 0 });
  }

  options.sort((left, right) => left.score - right.score);
  const best = options[0];

  return {
    bpm: best.bpm,
    bars: best.bars,
    loopEnd: Number(Math.min(safeDuration, best.loopDuration).toFixed(3)),
    gain: normalizeSampleGain(buffer),
    duration: Number(safeDuration.toFixed(3)),
  };
}

async function decodeAudioFile(file, audioContext) {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  return buffer;
}

export function useEchoBubbleLoop() {
  const sceneHostRef = useRef(null);
  const overlayRootRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const frameClockRef = useRef(new THREE.Clock());
  const bubblesRef = useRef([]);
  const xrSessionRef = useRef(null);
  const audioContextRef = useRef(null);
  const masterGainRef = useRef(null);
  const dismissTimerRef = useRef(0);
  const toastCounterRef = useRef(0);
  const bubbleCounterRef = useRef(0);
  const selectStartTimeRef = useRef(0);
  const inputTargetPadRef = useRef('');
  const mediaRecorderRef = useRef(null);
  const micStreamRef = useRef(null);
  const micChunksRef = useRef([]);

  const [pads, setPads] = useState(() => Array.from({ length: MAX_PADS }, (_, index) => createPad(index)));
  const [isArSupported, setIsArSupported] = useState(true);
  const [availabilityMessage, setAvailabilityMessage] = useState('');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [bubbleCount, setBubbleCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [pendingPadId, setPendingPadId] = useState('');
  const [isRecordingMic, setIsRecordingMic] = useState(false);
  const [placedBubbleRevision, setPlacedBubbleRevision] = useState(0);

  const bpm = DEFAULT_BPM;
  const beatDuration = 60 / bpm;

  const postToast = useCallback((message, tone = 'neutral') => {
    const id = ++toastCounterRef.current;
    setToasts((current) => [...current.slice(-1), createToast(id, tone, message)]);

    window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2200);
  }, []);

  const pingHud = useCallback(() => {}, []);

  const ensureAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('Web Audio API unavailable.');
      }

      const context = new AudioContextClass({ latencyHint: 'interactive' });
      const masterGain = context.createGain();
      masterGain.gain.value = 0.92;
      masterGain.connect(context.destination);
      audioContextRef.current = context;
      masterGainRef.current = masterGain;
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }, []);

  const updatePad = useCallback((padId, patch) => {
    setPads((current) => current.map((pad) => (pad.id === padId ? { ...pad, ...patch } : pad)));
  }, []);

  const disposeBubbleAudio = useCallback((audio, stopAt) => {
    if (!audio) {
      return;
    }

    const { source, gain, panner } = audio;
    try {
      source.stop(stopAt);
    } catch {
      source.stop();
    }
    source.disconnect();
    gain.disconnect();
    panner.disconnect();
  }, []);

  const destroyBubble = useCallback((bubble, fadeOut = false) => {
    if (!bubble) {
      return;
    }

    const scene = sceneRef.current;
    const context = audioContextRef.current;
    const now = context?.currentTime ?? 0;

    if (fadeOut && bubble.audio?.gain && context) {
      bubble.audio.gain.gain.cancelScheduledValues(now);
      bubble.audio.gain.gain.setTargetAtTime(0.0001, now, FADE_TIME);
    }

    scene?.remove(bubble.root);
    bubble.root.traverse((object) => {
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

    window.setTimeout(() => {
      disposeBubbleAudio(bubble.audio, fadeOut && context ? now + FADE_TIME * 3 : undefined);
    }, fadeOut ? 220 : 0);
  }, [disposeBubbleAudio]);

  const clearAllBubbles = useCallback((notify = true) => {
    const bubbles = bubblesRef.current.splice(0, bubblesRef.current.length);
    bubbles.forEach((bubble) => destroyBubble(bubble, true));
    setBubbleCount(0);
    setPlacedBubbleRevision((current) => current + 1);
    if (notify) {
      postToast('Bulles audio supprimées.', 'neutral');
    }
  }, [destroyBubble, postToast]);

  const assignDecodedSampleToPad = useCallback((padId, { name, url, buffer, sourceType }) => {
    const smartSample = pickSmartLoop(buffer);
    updatePad(padId, {
      name,
      url,
      buffer,
      duration: smartSample.duration,
      sourceType,
      bpm: smartSample.bpm,
      bars: smartSample.bars,
      loopEnd: smartSample.loopEnd,
      gain: smartSample.gain,
    });

    setPendingPadId('');
    postToast(`${name} → pad ${padId.split('-').at(-1)} · auto ${smartSample.bars} bar · ${smartSample.bpm} BPM.`, 'success');
  }, [postToast, updatePad]);

  const importAudioFileToPad = useCallback(async (padId, file) => {
    if (!file) {
      return;
    }

    try {
      const context = await ensureAudioContext();
      const buffer = await decodeAudioFile(file, context);
      const url = URL.createObjectURL(file);
      const previous = pads.find((pad) => pad.id === padId);
      if (previous?.url) {
        URL.revokeObjectURL(previous.url);
      }
      assignDecodedSampleToPad(padId, {
        name: file.name,
        url,
        buffer,
        sourceType: 'file',
      });
    } catch (error) {
      postToast(`Import impossible: ${error.message}`, 'warning');
    }
  }, [assignDecodedSampleToPad, ensureAudioContext, pads, postToast]);

  const handleImportedFiles = useCallback(async (files) => {
    const [file] = files;
    if (!file || !inputTargetPadRef.current) {
      return;
    }

    await importAudioFileToPad(inputTargetPadRef.current, file);
    inputTargetPadRef.current = '';
  }, [importAudioFileToPad]);

  const toggleMicRecording = useCallback(async (padId) => {
    if (!isRecordingMic) {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        postToast('Micro indisponible.', 'warning');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        micStreamRef.current = stream;
        mediaRecorderRef.current = recorder;
        micChunksRef.current = [];
        inputTargetPadRef.current = padId;

        recorder.addEventListener('dataavailable', (event) => {
          if (event.data?.size) {
            micChunksRef.current.push(event.data);
          }
        });

        recorder.addEventListener('stop', async () => {
          const targetPadId = inputTargetPadRef.current;
          const chunks = micChunksRef.current;
          micChunksRef.current = [];
          setIsRecordingMic(false);

          if (!chunks.length || !targetPadId) {
            stream.getTracks().forEach((track) => track.stop());
            inputTargetPadRef.current = '';
            return;
          }

          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const file = new File([blob], `mic-loop-${Date.now()}.webm`, { type: blob.type });
          await importAudioFileToPad(targetPadId, file);

          stream.getTracks().forEach((track) => track.stop());
          micStreamRef.current = null;
          mediaRecorderRef.current = null;
          inputTargetPadRef.current = '';
        });

        recorder.start();
        setPendingPadId(padId);
        setIsRecordingMic(true);
        postToast('Enregistrement micro lancé.', 'success');
      } catch (error) {
        postToast(`Micro bloqué: ${error.message}`, 'warning');
      }
      return;
    }

    mediaRecorderRef.current?.stop();
  }, [importAudioFileToPad, isRecordingMic, postToast]);

  const beginPadImport = useCallback((padId) => {
    setPendingPadId(padId);
    pingHud();
  }, [pingHud]);

  const openFilePickerForPad = useCallback((padId, fileInput) => {
    inputTargetPadRef.current = padId;
    fileInput?.click();
  }, []);

  const createBubbleAudio = useCallback((pad) => {
    const context = audioContextRef.current;
    if (!context || !masterGainRef.current || !pad.buffer) {
      throw new Error('Loop audio indisponible.');
    }

    const source = context.createBufferSource();
    source.buffer = pad.buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = Math.max(0.05, Math.min(pad.loopEnd || pad.buffer.duration, pad.buffer.duration));

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);

    const panner = context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = Math.max(0.35, DEFAULT_RANGE * 0.08);
    panner.maxDistance = DEFAULT_RANGE;
    panner.rolloffFactor = 1.15;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 0;

    source.connect(gain);
    gain.connect(panner);
    panner.connect(masterGainRef.current);

    const nextBeat = Math.ceil(context.currentTime / beatDuration) * beatDuration;
    source.start(nextBeat);

    return { source, gain, panner, nextBeat };
  }, [beatDuration]);

  const createBubble = useCallback((pad) => {
    const root = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(BUBBLE_RADIUS, 24, 24),
      new THREE.MeshPhongMaterial({
        color: 0x8ce5ff,
        transparent: true,
        opacity: 0.35,
        shininess: 100,
        emissive: 0x14465d,
        emissiveIntensity: 0.52,
        specular: 0xd7f7ff,
      }),
    );

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(BUBBLE_RADIUS * 1.28, 20, 20),
      new THREE.MeshBasicMaterial({
        color: 0x9be9ff,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
      }),
    );

    root.add(glow);
    root.add(shell);

    const audio = createBubbleAudio(pad);

    return {
      id: `bubble-${++bubbleCounterRef.current}`,
      padId: pad.id,
      label: pad.name || `Pad ${pad.label}`,
      root,
      shell,
      glow,
      audio,
      range: DEFAULT_RANGE,
      gainMax: pad.gain,
      createdAt: performance.now() * 0.001,
      seed: Math.random() * Math.PI * 2,
      attached: false,
      basePosition: new THREE.Vector3(),
      visualPosition: new THREE.Vector3(),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 0.004,
        FLOAT_RISE + Math.random() * 0.004,
        (Math.random() - 0.5) * 0.004,
      ),
    };
  }, [createBubbleAudio]);

  const placeBubbleFromPad = useCallback(async (padId) => {
    const pad = pads.find((item) => item.id === padId);
    const scene = sceneRef.current;
    const camera = cameraRef.current;

    if (!pad?.buffer) {
      beginPadImport(padId);
      return;
    }

    if (!isSessionActive) {
      postToast('Entrez en AR pour souffler la loop.', 'warning');
      return;
    }

    if (!scene || !camera) {
      return;
    }

    try {
      await ensureAudioContext();
      const bubble = createBubble(pad);

      camera.getWorldPosition(tempPosition);
      camera.getWorldQuaternion(listenerQuaternion);
      tempForward.copy(listenerForward).applyQuaternion(listenerQuaternion).normalize();

      bubble.basePosition.copy(tempPosition).addScaledVector(tempForward, PLACE_DISTANCE);
      bubble.visualPosition.copy(bubble.basePosition);
      bubble.root.position.copy(bubble.basePosition);
      bubble.root.scale.setScalar(0.001);
      bubble.shell.userData.bubbleId = bubble.id;
      bubble.glow.userData.bubbleId = bubble.id;

      scene.add(bubble.root);
      bubblesRef.current.push(bubble);

      if (bubblesRef.current.length > MAX_BUBBLES) {
        const removed = bubblesRef.current.shift();
        destroyBubble(removed, true);
      }

      setBubbleCount(bubblesRef.current.length);
      setPlacedBubbleRevision((current) => current + 1);
      setPendingPadId('');
      pingHud();
      postToast(`Bulle ${pad.label} soufflée · start quantifié au prochain beat.`, 'success');
    } catch (error) {
      postToast(error.message, 'warning');
    }
  }, [beginPadImport, createBubble, destroyBubble, ensureAudioContext, isSessionActive, pads, pingHud, postToast]);

  const toggleBubbleAttachment = useCallback((bubbleId) => {
    const bubble = bubblesRef.current.find((item) => item.id === bubbleId);
    if (!bubble) {
      return;
    }

    bubble.attached = !bubble.attached;
    setPlacedBubbleRevision((current) => current + 1);
    postToast(bubble.attached ? 'Bulle collée à la caméra.' : 'Bulle décollée.', 'neutral');
  }, [postToast]);

  const popBubble = useCallback((bubbleId) => {
    const index = bubblesRef.current.findIndex((item) => item.id === bubbleId);
    if (index === -1) {
      return;
    }

    const [bubble] = bubblesRef.current.splice(index, 1);
    destroyBubble(bubble, true);
    setBubbleCount(bubblesRef.current.length);
    setPlacedBubbleRevision((current) => current + 1);
    postToast('Bulle pop.', 'neutral');
  }, [destroyBubble, postToast]);

  const pickBubbleAtCameraCenter = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera || !bubblesRef.current.length) {
      return null;
    }

    camera.getWorldPosition(rayOrigin);
    camera.getWorldQuaternion(listenerQuaternion);
    rayDirection.copy(listenerForward).applyQuaternion(listenerQuaternion).normalize();
    raycaster.set(rayOrigin, rayDirection);

    const intersects = raycaster.intersectObjects(
      bubblesRef.current.flatMap((bubble) => [bubble.shell, bubble.glow]),
      false,
    );

    const bubbleId = intersects[0]?.object?.userData?.bubbleId;
    return bubbleId ? bubblesRef.current.find((bubble) => bubble.id === bubbleId) ?? null : null;
  }, []);

  const handleSelectStart = useCallback(() => {
    selectStartTimeRef.current = performance.now();
  }, []);

  const handleSelectEnd = useCallback(() => {
    const pressedMs = performance.now() - selectStartTimeRef.current;
    const hitBubble = pickBubbleAtCameraCenter();

    if (!hitBubble) {
      return;
    }

    if (pressedMs >= LONG_PRESS_MS) {
      popBubble(hitBubble.id);
      return;
    }

    toggleBubbleAttachment(hitBubble.id);
  }, [pickBubbleAtCameraCenter, popBubble, toggleBubbleAttachment]);

  const onSessionEnd = useCallback(() => {
    xrSessionRef.current?.removeEventListener('end', onSessionEnd);
    xrSessionRef.current?.removeEventListener('selectstart', handleSelectStart);
    xrSessionRef.current?.removeEventListener('selectend', handleSelectEnd);
    xrSessionRef.current = null;
    setIsSessionActive(false);
    postToast('Session AR terminée.', 'neutral');
  }, [handleSelectEnd, handleSelectStart, postToast]);

  const enterAr = useCallback(async () => {
    if (!navigator.xr) {
      postToast('WebXR indisponible.', 'warning');
      return;
    }

    if (xrSessionRef.current) {
      await xrSessionRef.current.end();
      return;
    }

    setIsBusy(true);
    try {
      await ensureAudioContext();
      const session = await navigator.xr.requestSession('immersive-ar', {
        optionalFeatures: ['dom-overlay', 'local-floor'],
        domOverlay: { root: overlayRootRef.current },
      });

      xrSessionRef.current = session;
      session.addEventListener('end', onSessionEnd);
      session.addEventListener('selectstart', handleSelectStart);
      session.addEventListener('selectend', handleSelectEnd);

      rendererRef.current.xr.setReferenceSpaceType('local');
      await rendererRef.current.xr.setSession(session);

      setIsSessionActive(true);
      pingHud();
      postToast('AR prête · tape une bulle pour coller, appui long pour la percer.', 'success');
    } catch (error) {
      postToast(`AR impossible: ${error.message}`, 'warning');
    } finally {
      setIsBusy(false);
    }
  }, [ensureAudioContext, handleSelectEnd, handleSelectStart, onSessionEnd, pingHud, postToast]);

  const placedBubbles = useMemo(() => bubblesRef.current.map((bubble) => ({
    id: bubble.id,
    label: bubble.label,
    attached: bubble.attached,
  })), [bubbleCount, placedBubbleRevision]);

  const readiness = useMemo(() => {
    if (!isArSupported) {
      return availabilityMessage;
    }
    if (!pads.some((pad) => pad.buffer)) {
      return 'Charge un sample puis souffle une bulle.';
    }
    if (!isSessionActive) {
      return 'Entre en AR puis tape un pad.';
    }
    return 'Pad = souffler · panneau = éditer · tap bulle = coller.';
  }, [availabilityMessage, isArSupported, isSessionActive, pads]);

  useEffect(() => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    scene.add(camera);
    scene.add(new THREE.HemisphereLight(0xc8edff, 0x26344c, 1.45));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.48);
    keyLight.position.set(1, 2, 1);
    scene.add(keyLight);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;

    if (sceneHostRef.current) {
      sceneHostRef.current.innerHTML = '';
      sceneHostRef.current.append(renderer.domElement);
    }

    const renderLoop = (timestamp) => {
      const delta = frameClockRef.current.getDelta();
      const elapsed = timestamp ? timestamp * 0.001 : frameClockRef.current.elapsedTime;
      const context = audioContextRef.current;
      const cameraInstance = cameraRef.current;

      if (context && cameraInstance) {
        cameraInstance.getWorldPosition(listenerPosition);
        cameraInstance.getWorldQuaternion(listenerQuaternion);
        tempForward.copy(listenerForward).applyQuaternion(listenerQuaternion).normalize();
        tempUp.copy(listenerUp).applyQuaternion(listenerQuaternion).normalize();

        const listener = context.listener;
        const now = context.currentTime;

        if (listener.positionX) {
          listener.positionX.setValueAtTime(listenerPosition.x, now);
          listener.positionY.setValueAtTime(listenerPosition.y, now);
          listener.positionZ.setValueAtTime(listenerPosition.z, now);
          listener.forwardX.setValueAtTime(tempForward.x, now);
          listener.forwardY.setValueAtTime(tempForward.y, now);
          listener.forwardZ.setValueAtTime(tempForward.z, now);
          listener.upX.setValueAtTime(tempUp.x, now);
          listener.upY.setValueAtTime(tempUp.y, now);
          listener.upZ.setValueAtTime(tempUp.z, now);
        } else {
          listener.setPosition(listenerPosition.x, listenerPosition.y, listenerPosition.z);
          listener.setOrientation(tempForward.x, tempForward.y, tempForward.z, tempUp.x, tempUp.y, tempUp.z);
        }
      }

      for (const bubble of bubblesRef.current) {
        if (bubble.attached && cameraInstance) {
          cameraInstance.getWorldPosition(tempTarget);
          cameraInstance.getWorldQuaternion(listenerQuaternion);
          tempForward.copy(listenerForward).applyQuaternion(listenerQuaternion).normalize();
          bubble.basePosition.copy(tempTarget).addScaledVector(tempForward, PLACE_DISTANCE);
        } else {
          bubble.basePosition.addScaledVector(bubble.velocity, delta);
          bubble.basePosition.x += Math.sin(elapsed * 0.7 + bubble.seed) * FLOAT_SWAY * delta;
          bubble.basePosition.z += Math.cos(elapsed * 0.62 + bubble.seed * 1.7) * FLOAT_SWAY * delta;
        }

        bubbleVisualOffset.set(
          Math.sin(elapsed * 0.9 + bubble.seed) * 0.015,
          Math.sin(elapsed * 1.2 + bubble.seed * 1.4) * 0.022,
          Math.cos(elapsed * 0.8 + bubble.seed) * 0.015,
        );

        bubble.visualPosition.copy(bubble.basePosition).add(bubbleVisualOffset);
        bubble.root.position.lerp(bubble.visualPosition, bubble.attached ? 0.22 : 0.08);
        const scale = bubble.root.scale.x + (1 - bubble.root.scale.x) * 0.12;
        bubble.root.scale.setScalar(scale);
        bubble.root.rotation.y += delta * 0.16;
        bubble.glow.scale.setScalar(1 + Math.sin(elapsed * 0.7 + bubble.seed) * 0.06);
        bubble.shell.scale.setScalar(1 + Math.sin(elapsed * 1.1 + bubble.seed) * 0.02);
        bubble.shell.material.emissiveIntensity = 0.5 + Math.sin(elapsed * 0.9 + bubble.seed) * 0.07;
        bubble.glow.material.opacity = 0.08 + Math.sin(elapsed * 0.65 + bubble.seed) * 0.02;

        bubble.root.getWorldPosition(bubbleWorldPosition);

        if (context && bubble.audio?.panner) {
          const distance = bubbleWorldPosition.distanceTo(listenerPosition);
          const targetGain = distance < bubble.range
            ? ((1 - distance / bubble.range) ** 2) * bubble.gainMax
            : 0;
          bubble.audio.gain.gain.setTargetAtTime(Math.max(targetGain, 0.0001), context.currentTime, 0.12);

          if (bubble.audio.panner.positionX) {
            bubble.audio.panner.positionX.setValueAtTime(bubbleWorldPosition.x, context.currentTime);
            bubble.audio.panner.positionY.setValueAtTime(bubbleWorldPosition.y, context.currentTime);
            bubble.audio.panner.positionZ.setValueAtTime(bubbleWorldPosition.z, context.currentTime);
          } else {
            bubble.audio.panner.setPosition(bubbleWorldPosition.x, bubbleWorldPosition.y, bubbleWorldPosition.z);
          }
        }
      }

      renderer.render(scene, camera);
    };

    renderer.setAnimationLoop(renderLoop);

    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current) {
        return;
      }

      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };

    const checkArAvailability = async () => {
      if (!navigator.xr) {
        setIsArSupported(false);
        setAvailabilityMessage('WebXR immersive-ar indisponible sur cet appareil.');
        return;
      }

      try {
        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        setIsArSupported(supported);
        if (!supported) {
          setAvailabilityMessage('L’AR immersive n’est pas disponible ici.');
        }
      } catch (error) {
        setIsArSupported(false);
        setAvailabilityMessage(`Vérification AR impossible: ${error.message}`);
      }
    };

    checkArAvailability();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.setAnimationLoop(null);
      window.clearTimeout(dismissTimerRef.current);

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      micStreamRef.current?.getTracks().forEach((track) => track.stop());

      if (xrSessionRef.current) {
        xrSessionRef.current.end().catch(() => {});
      }

      clearAllBubbles(false);
      pads.forEach((pad) => {
        if (pad.url) {
          URL.revokeObjectURL(pad.url);
        }
      });
      masterGainRef.current?.disconnect();
      audioContextRef.current?.close().catch(() => {});
      renderer.dispose();
      sceneHostRef.current?.replaceChildren();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activePadCount = useMemo(() => pads.filter((pad) => pad.buffer).length, [pads]);

  return {
    sceneHostRef,
    overlayRootRef,
    pads,
    bpm,
    beatDuration,
    bubbleCount,
    placedBubbles,
    isArSupported,
    availabilityMessage,
    isSessionActive,
    isBusy,
    pendingPadId,
    isRecordingMic,
    activePadCount,
    readiness,
    toasts,
    enterAr,
    pingHud,
    beginPadImport,
    openFilePickerForPad,
    handleImportedFiles,
    toggleMicRecording,
    placeBubbleFromPad,
    toggleBubbleAttachment,
    popBubble,
    clearAllBubbles,
    setPendingPadId,
  };
}
