import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

const MAX_BUBBLES = 8;
const MAX_SET_BUBBLES = 8;
const FLOAT_SPEED = 0.68;
const FLOAT_HEIGHT = 0.028;
const DRIFT_AMOUNT = 0.013;
const DEFAULT_RANGE = 6;
const MIN_RANGE = 2;
const MAX_RANGE = 18;
const DEFAULT_VOLUME = 70;
const PLACE_DISTANCE = 0.4;
const FADE_TIME = 0.12;
const ENTRY_DURATION = 0.72;
const AUTO_HIDE_MS = 2600;

const listenerPosition = new THREE.Vector3();
const listenerQuaternion = new THREE.Quaternion();
const listenerForward = new THREE.Vector3(0, 0, -1);
const listenerUp = new THREE.Vector3(0, 1, 0);
const tempForward = new THREE.Vector3();
const tempUp = new THREE.Vector3();
const placementOrigin = new THREE.Vector3();
const bubbleOffset = new THREE.Vector3();
const bubblePosition = new THREE.Vector3();

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function createToast(id, tone, message) {
  return { id, tone, message };
}

function clampRange(value) {
  return THREE.MathUtils.clamp(Number(value) || DEFAULT_RANGE, MIN_RANGE, MAX_RANGE);
}

function clampVolume(value) {
  return THREE.MathUtils.clamp(Number(value) || DEFAULT_VOLUME, 0, 100);
}

function createSetBubbleDefinition(id, assetId = '') {
  return {
    id,
    label: `Bulle ${id.split('-').at(-1)}`,
    assetId,
    range: DEFAULT_RANGE,
    volume: DEFAULT_VOLUME,
  };
}

export function useEchoBubbleLoop() {
  const sceneHostRef = useRef(null);
  const overlayRootRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const frameClockRef = useRef(new THREE.Clock());
  const bubblesRef = useRef([]);
  const audioContextRef = useRef(null);
  const masterGainRef = useRef(null);
  const xrSessionRef = useRef(null);
  const previewAudioRef = useRef(null);
  const previewStopTimerRef = useRef(0);
  const assetCounterRef = useRef(0);
  const bubbleCounterRef = useRef(0);
  const setBubbleCounterRef = useRef(0);
  const toastCounterRef = useRef(0);
  const dismissTimerRef = useRef(0);
  const hideHudTimerRef = useRef(0);
  const audioLibraryRef = useRef([]);

  const [audioLibrary, setAudioLibrary] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [setBubbles, setSetBubbles] = useState([]);
  const [activeSetBubbleId, setActiveSetBubbleId] = useState('');
  const [isSetValidated, setIsSetValidated] = useState(false);
  const [isListeningMode, setIsListeningMode] = useState(false);
  const [isArSupported, setIsArSupported] = useState(true);
  const [availabilityMessage, setAvailabilityMessage] = useState('');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [bubbleCount, setBubbleCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [isHudVisible, setIsHudVisible] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isPlacementArmed, setIsPlacementArmed] = useState(false);
  const [previewingId, setPreviewingId] = useState('');
  const [playingBubbleId, setPlayingBubbleId] = useState('');

  const selectedAsset = useMemo(
    () => audioLibrary.find((asset) => asset.id === selectedAssetId) ?? null,
    [audioLibrary, selectedAssetId],
  );

  const selectedSetBubble = useMemo(
    () => setBubbles.find((bubble) => bubble.id === activeSetBubbleId) ?? null,
    [activeSetBubbleId, setBubbles],
  );

  const placedBubbles = useMemo(
    () => bubblesRef.current.map((bubble) => ({
      id: bubble.id,
      label: bubble.label,
      assetName: bubble.assetName,
      range: bubble.range,
      volume: bubble.volume,
      isPlaying: !bubble.audio?.element?.paused,
    })),
    [bubbleCount, playingBubbleId],
  );

  const postToast = useCallback((message, tone = 'neutral') => {
    const id = ++toastCounterRef.current;
    setToasts((current) => [...current.slice(-1), createToast(id, tone, message)]);

    window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2400);
  }, []);

  const pingHud = useCallback(() => {
    setIsHudVisible(true);
    window.clearTimeout(hideHudTimerRef.current);

    if (xrSessionRef.current && !isMenuOpen) {
      hideHudTimerRef.current = window.setTimeout(() => {
        setIsHudVisible(false);
      }, AUTO_HIDE_MS);
    }
  }, [isMenuOpen]);

  const ensureAudioContext = useCallback(async () => {
    if (!audioContextRef.current) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error('Web Audio API is unavailable in this browser.');
      }

      const context = new AudioContextClass({ latencyHint: 'interactive' });
      const masterGain = context.createGain();
      masterGain.gain.value = 0.88;
      masterGain.connect(context.destination);

      audioContextRef.current = context;
      masterGainRef.current = masterGain;
    }

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }, []);

  const stopPreview = useCallback(() => {
    window.clearTimeout(previewStopTimerRef.current);
    previewStopTimerRef.current = 0;

    const previewAudio = previewAudioRef.current;
    if (!previewAudio) {
      return;
    }

    try {
      previewAudio.pause();
      previewAudio.currentTime = 0;
      previewAudio.src = '';
    } catch {
      // Ignore preview cleanup errors.
    }

    previewAudioRef.current = null;
    setPreviewingId('');
  }, []);

  const playLibraryPreview = useCallback((asset, previewId = asset?.id ?? '') => {
    stopPreview();

    if (!asset) {
      return false;
    }

    const preview = new Audio(asset.url);
    preview.preload = 'auto';
    preview.playsInline = true;
    preview.volume = 0.8;

    previewAudioRef.current = preview;
    setPreviewingId(previewId);
    previewStopTimerRef.current = window.setTimeout(() => {
      stopPreview();
    }, 1600);

    preview.play().catch(() => {
      stopPreview();
      postToast(`Preview unavailable for ${asset.name}.`, 'warning');
    });

    return true;
  }, [postToast, stopPreview]);

  const disposeBubbleAudio = useCallback((audio) => {
    if (!audio) {
      return;
    }

    const { element, source, gain, panner } = audio;

    try {
      element.pause();
      element.src = '';
      element.load();
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    } catch {
      // Ignore already-disconnected nodes.
    }
  }, []);

  const destroyBubble = useCallback((bubble, fadeOut = false) => {
    if (!bubble) {
      return;
    }

    const scene = sceneRef.current;
    const context = audioContextRef.current;
    const now = context ? context.currentTime : 0;

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

    if (playingBubbleId === bubble.id) {
      setPlayingBubbleId('');
    }

    window.setTimeout(() => disposeBubbleAudio(bubble.audio), fadeOut ? 180 : 0);
  }, [disposeBubbleAudio, playingBubbleId]);

  const clearAllBubbles = useCallback((notify = true) => {
    const existing = bubblesRef.current.splice(0, bubblesRef.current.length);
    existing.forEach((bubble) => destroyBubble(bubble, true));
    setBubbleCount(0);
    setPlayingBubbleId('');
    setIsPlacementArmed(false);

    if (notify) {
      postToast('Toutes les bulles de la composition ont été supprimées.', 'neutral');
    }
  }, [destroyBubble, postToast]);

  const createBubbleAudio = useCallback((asset, volume, range) => {
    const context = audioContextRef.current;
    if (!context || !masterGainRef.current) {
      throw new Error('Audio context is not ready.');
    }

    const element = document.createElement('audio');
    element.src = asset.url;
    element.loop = true;
    element.preload = 'auto';
    element.playsInline = true;

    const source = context.createMediaElementSource(element);
    const gain = context.createGain();
    const panner = context.createPanner();

    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = Math.max(0.35, range * 0.08);
    panner.maxDistance = range;
    panner.rolloffFactor = 1.25;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 0;

    gain.gain.setValueAtTime(0.0001, context.currentTime);

    source.connect(gain);
    gain.connect(panner);
    panner.connect(masterGainRef.current);

    element.volume = clampVolume(volume) / 100;
    element.play().catch(() => {
      postToast(`Playback blocked for ${asset.name}. Tap again to resume.`, 'warning');
    });

    return { element, source, gain, panner };
  }, [postToast]);

  const createBubble = useCallback((setBubble, asset) => {
    const root = new THREE.Group();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.088, 24, 24),
      new THREE.MeshPhongMaterial({
        color: 0x84dfff,
        transparent: true,
        opacity: 0.38,
        shininess: 95,
        emissive: 0x174760,
        emissiveIntensity: 0.6,
        specular: 0xcaf6ff,
      }),
    );

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.112, 20, 20),
      new THREE.MeshBasicMaterial({
        color: 0x8ee7ff,
        transparent: true,
        opacity: 0.09,
        depthWrite: false,
      }),
    );

    root.add(glow);
    root.add(sphere);

    return {
      id: `bubble-${++bubbleCounterRef.current}`,
      setBubbleId: setBubble.id,
      label: setBubble.label,
      assetId: asset.id,
      assetName: asset.name,
      range: clampRange(setBubble.range),
      volume: clampVolume(setBubble.volume),
      createdAt: performance.now() * 0.001,
      seed: Math.random() * Math.PI * 2,
      root,
      sphere,
      glow,
      audio: createBubbleAudio(asset, setBubble.volume, setBubble.range),
    };
  }, [createBubbleAudio]);

  const placeBubble = useCallback((setBubble, asset) => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) {
      return;
    }

    const bubble = createBubble(setBubble, asset);

    camera.getWorldPosition(placementOrigin);
    camera.getWorldQuaternion(listenerQuaternion);
    tempForward.copy(listenerForward).applyQuaternion(listenerQuaternion).normalize();

    bubble.root.position.copy(placementOrigin).addScaledVector(tempForward, PLACE_DISTANCE);
    bubble.root.quaternion.copy(listenerQuaternion);
    bubble.root.scale.setScalar(0.001);

    scene.add(bubble.root);
    bubblesRef.current.push(bubble);

    if (bubblesRef.current.length > MAX_BUBBLES) {
      destroyBubble(bubblesRef.current.shift(), true);
    }

    setBubbleCount(bubblesRef.current.length);
    setIsPlacementArmed(false);
    postToast(`${setBubble.label} placée. ${bubblesRef.current.length}/${MAX_BUBBLES} actives.`, 'success');
  }, [createBubble, destroyBubble, postToast]);

  const validateSet = useCallback(() => {
    if (!setBubbles.length) {
      postToast('Ajoutez au moins une bulle au set avant validation.', 'warning');
      return false;
    }

    const hasMissingSource = setBubbles.some((bubble) => !bubble.assetId);
    if (hasMissingSource) {
      postToast('Chaque bulle du set doit avoir une source audio.', 'warning');
      return false;
    }

    setIsSetValidated(true);
    postToast('Set validé et sauvegardé. Vous pouvez passer à la composition.', 'success');
    return true;
  }, [postToast, setBubbles]);

  const addSetBubble = useCallback(() => {
    if (setBubbles.length >= MAX_SET_BUBBLES) {
      postToast(`Le set est limité à ${MAX_SET_BUBBLES} bulles.`, 'warning');
      return;
    }

    const nextId = `set-bubble-${++setBubbleCounterRef.current}`;
    const bubble = createSetBubbleDefinition(nextId, selectedAssetId);
    setSetBubbles((current) => [...current, bubble]);
    setActiveSetBubbleId(nextId);
    setIsSetValidated(false);
    postToast('Nouvelle bulle ajoutée au set. Réglez sa source, sa portée et son volume.', 'neutral');
  }, [postToast, selectedAssetId, setBubbles.length]);

  const updateSetBubble = useCallback((bubbleId, patch) => {
    setSetBubbles((current) => current.map((bubble) => {
      if (bubble.id !== bubbleId) {
        return bubble;
      }

      return {
        ...bubble,
        ...patch,
        range: patch.range !== undefined ? clampRange(patch.range) : bubble.range,
        volume: patch.volume !== undefined ? clampVolume(patch.volume) : bubble.volume,
      };
    }));
    setIsSetValidated(false);
  }, []);

  const removeSetBubble = useCallback((bubbleId) => {
    setSetBubbles((current) => current.filter((bubble) => bubble.id !== bubbleId));
    setIsSetValidated(false);
    setActiveSetBubbleId((current) => (current === bubbleId ? '' : current));
    postToast('Bulle retirée du set.', 'neutral');
  }, [postToast]);

  const playSetBubblePreview = useCallback((bubbleId) => {
    const setBubble = setBubbles.find((bubble) => bubble.id === bubbleId);
    if (!setBubble?.assetId) {
      postToast('Choisissez une source audio avant lecture.', 'warning');
      return;
    }

    const asset = audioLibrary.find((item) => item.id === setBubble.assetId);
    if (!asset) {
      postToast('Source audio introuvable.', 'warning');
      return;
    }

    playLibraryPreview(asset, bubbleId);
  }, [audioLibrary, playLibraryPreview, postToast, setBubbles]);

  const togglePlacedBubbleAudio = useCallback((bubbleId) => {
    const bubble = bubblesRef.current.find((item) => item.id === bubbleId);
    const element = bubble?.audio?.element;
    if (!bubble || !element) {
      return;
    }

    if (element.paused) {
      element.play().then(() => {
        setPlayingBubbleId(bubbleId);
      }).catch(() => {
        postToast(`Impossible de relancer ${bubble.label}.`, 'warning');
      });
      return;
    }

    element.pause();
    setPlayingBubbleId('');
  }, [postToast]);

  const armPlacement = useCallback(() => {
    if (!isSessionActive) {
      postToast('La composition est disponible uniquement en AR.', 'warning');
      return;
    }
    if (isListeningMode) {
      postToast('Repassez en mode création pour préparer une pose.', 'warning');
      return;
    }
    if (!isSetValidated) {
      postToast('Validez et sauvegardez votre set avant de composer.', 'warning');
      return;
    }
    if (!selectedSetBubble) {
      postToast('Sélectionnez une bulle du set.', 'warning');
      return;
    }

    setIsPlacementArmed(true);
    postToast(`Pose prête pour ${selectedSetBubble.label}. Touchez la scène pour confirmer.`, 'success');
    pingHud();
  }, [isListeningMode, isSessionActive, isSetValidated, pingHud, postToast, selectedSetBubble]);

  const cancelPlacement = useCallback(() => {
    setIsPlacementArmed(false);
    postToast('Pose annulée.', 'neutral');
  }, [postToast]);

  const onSelect = useCallback(async () => {
    if (isListeningMode) {
      postToast('Listening mode is active.', 'neutral');
      return;
    }

    if (!isPlacementArmed) {
      postToast('Préparez la pose depuis le menu avant de toucher la scène.', 'warning');
      return;
    }

    if (!isSetValidated) {
      postToast('Validez votre set avant de poser une bulle.', 'warning');
      setIsPlacementArmed(false);
      return;
    }

    if (!selectedSetBubble) {
      postToast('Sélectionnez une bulle du set avant la pose.', 'warning');
      setIsPlacementArmed(false);
      return;
    }

    const asset = audioLibrary.find((item) => item.id === selectedSetBubble.assetId);
    if (!asset) {
      postToast('La source audio de cette bulle est introuvable.', 'warning');
      setIsPlacementArmed(false);
      return;
    }

    try {
      await ensureAudioContext();
      stopPreview();
      placeBubble(selectedSetBubble, asset);
      pingHud();
    } catch (error) {
      postToast(error.message, 'warning');
    }
  }, [audioLibrary, ensureAudioContext, isListeningMode, isPlacementArmed, isSetValidated, pingHud, placeBubble, postToast, selectedSetBubble, stopPreview]);

  const onSessionEnd = useCallback(() => {
    xrSessionRef.current?.removeEventListener('end', onSessionEnd);
    xrSessionRef.current?.removeEventListener('select', onSelect);
    xrSessionRef.current = null;
    setIsSessionActive(false);
    setIsMenuOpen(false);
    setIsHudVisible(true);
    setIsPlacementArmed(false);
    window.clearTimeout(hideHudTimerRef.current);
    postToast('AR session ended.', 'neutral');
  }, [onSelect, postToast]);

  const enterAr = useCallback(async () => {
    if (!navigator.xr) {
      postToast('WebXR is unavailable in this browser.', 'warning');
      return;
    }

    if (xrSessionRef.current) {
      await xrSessionRef.current.end();
      return;
    }

    if (!isSetValidated) {
      postToast('Définissez, validez et sauvegardez votre set avant de passer en AR.', 'warning');
      return;
    }

    if (!overlayRootRef.current || !rendererRef.current) {
      postToast('AR overlay is not ready yet.', 'warning');
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
      session.addEventListener('select', onSelect);

      rendererRef.current.xr.setReferenceSpaceType('local');
      await rendererRef.current.xr.setSession(session);

      setIsSessionActive(true);
      setIsHudVisible(true);
      setIsMenuOpen(false);
      pingHud();
      postToast('AR ready. Préparez une pose depuis le menu puis touchez la scène.', 'success');
    } catch (error) {
      postToast(`Failed to start AR: ${error.message}`, 'warning');
    } finally {
      setIsBusy(false);
    }
  }, [ensureAudioContext, isSetValidated, onSelect, onSessionEnd, pingHud, postToast]);

  const importAudioFiles = useCallback(async (files) => {
    if (!files.length) {
      return;
    }

    try {
      await ensureAudioContext();
    } catch (error) {
      postToast(`Audio initialization failed: ${error.message}`, 'warning');
      return;
    }

    const importedAssets = files.map((file) => ({
      id: `asset-${++assetCounterRef.current}`,
      name: file.name,
      url: URL.createObjectURL(file),
    }));

    setAudioLibrary((current) => [...current, ...importedAssets]);
    setSelectedAssetId((current) => current || importedAssets.at(0)?.id || '');

    const latestAsset = importedAssets.at(-1);
    if (latestAsset) {
      playLibraryPreview(latestAsset);
      postToast(`${importedAssets.length} son${importedAssets.length > 1 ? 's importés' : ' importé'}.`, 'success');
    }
  }, [ensureAudioContext, playLibraryPreview, postToast]);

  const selectAsset = useCallback((assetId) => {
    setSelectedAssetId(assetId);
    const asset = audioLibrary.find((item) => item.id === assetId);
    if (!asset) {
      return;
    }

    playLibraryPreview(asset);
    postToast(`Source active : ${asset.name}.`, 'neutral');
    pingHud();
  }, [audioLibrary, pingHud, playLibraryPreview, postToast]);

  const toggleMode = useCallback(() => {
    setIsListeningMode((current) => {
      const next = !current;
      if (next) {
        setIsPlacementArmed(false);
      }
      postToast(next ? 'Listening mode active.' : 'Creation mode active.', 'neutral');
      return next;
    });
    pingHud();
  }, [pingHud, postToast]);

  const toggleMenu = useCallback(() => {
    setIsMenuOpen((current) => {
      const next = !current;
      setIsHudVisible(true);
      if (!next) {
        pingHud();
      } else {
        window.clearTimeout(hideHudTimerRef.current);
      }
      return next;
    });
  }, [pingHud]);

  const dismissMenu = useCallback(() => {
    setIsMenuOpen(false);
    pingHud();
  }, [pingHud]);

  useEffect(() => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

    sceneRef.current = scene;
    cameraRef.current = camera;
    rendererRef.current = renderer;

    scene.add(camera);
    scene.add(new THREE.HemisphereLight(0xc5ecff, 0x25344f, 1.45));

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.55);
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
      const elapsedTime = timestamp ? timestamp * 0.001 : frameClockRef.current.elapsedTime;
      const context = audioContextRef.current;

      if (context && cameraRef.current) {
        cameraRef.current.getWorldPosition(listenerPosition);
        cameraRef.current.getWorldQuaternion(listenerQuaternion);
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
        const age = elapsedTime - bubble.createdAt;
        const entryProgress = THREE.MathUtils.clamp(age / ENTRY_DURATION, 0, 1);
        const easedScale = easeOutBack(entryProgress);

        const bob = Math.sin(elapsedTime * FLOAT_SPEED + bubble.seed) * FLOAT_HEIGHT;
        const driftX = Math.sin(elapsedTime * 0.31 + bubble.seed * 1.6) * DRIFT_AMOUNT;
        const driftZ = Math.cos(elapsedTime * 0.26 + bubble.seed * 1.35) * DRIFT_AMOUNT;

        bubbleOffset.set(driftX, bob, driftZ);
        bubble.root.scale.setScalar(Math.max(0.001, easedScale));
        bubble.root.rotation.y += delta * 0.18;

        bubble.sphere.position.copy(bubbleOffset);
        bubble.glow.position.copy(bubbleOffset);
        bubble.sphere.scale.setScalar(1 + Math.sin(elapsedTime * 1.05 + bubble.seed) * 0.02);
        bubble.glow.scale.setScalar(1 + Math.sin(elapsedTime * 0.72 + bubble.seed) * 0.08);
        bubble.sphere.material.emissiveIntensity = 0.52 + Math.sin(elapsedTime * 0.9 + bubble.seed) * 0.08;
        bubble.glow.material.opacity = 0.08 + Math.sin(elapsedTime * 0.88 + bubble.seed) * 0.02;

        bubble.root.getWorldPosition(bubblePosition);
        bubblePosition.add(bubbleOffset);

        if (context && bubble.audio?.gain) {
          const distance = bubblePosition.distanceTo(listenerPosition);
          const targetGain = THREE.MathUtils.clamp(1 - distance / bubble.range, 0.02, 1) * (bubble.volume / 100);
          bubble.audio.gain.gain.setTargetAtTime(targetGain, context.currentTime, age < 0.8 ? 0.18 : 0.12);
        }

        const panner = bubble.audio?.panner;
        if (!panner || !context) {
          continue;
        }

        if (panner.positionX) {
          panner.positionX.setValueAtTime(bubblePosition.x, context.currentTime);
          panner.positionY.setValueAtTime(bubblePosition.y, context.currentTime);
          panner.positionZ.setValueAtTime(bubblePosition.z, context.currentTime);
        } else {
          panner.setPosition(bubblePosition.x, bubblePosition.y, bubblePosition.z);
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
        setAvailabilityMessage('WebXR is unavailable here. Use Chrome on Android with ARCore over HTTPS.');
        return;
      }

      try {
        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        setIsArSupported(supported);
        if (!supported) {
          setAvailabilityMessage('Immersive AR is not supported on this device. EchoBubbleLoop needs Chrome Android + ARCore.');
        }
      } catch (error) {
        setIsArSupported(false);
        setAvailabilityMessage(`Unable to verify AR support: ${error.message}`);
      }
    };

    checkArAvailability();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.setAnimationLoop(null);
      stopPreview();
      window.clearTimeout(dismissTimerRef.current);
      window.clearTimeout(hideHudTimerRef.current);

      if (xrSessionRef.current) {
        xrSessionRef.current.end().catch(() => {});
      }

      clearAllBubbles(false);
      audioLibraryRef.current.forEach((asset) => URL.revokeObjectURL(asset.url));
      masterGainRef.current?.disconnect();
      audioContextRef.current?.close().catch(() => {});
      renderer.dispose();
      sceneHostRef.current?.replaceChildren();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    audioLibraryRef.current = audioLibrary;
  }, [audioLibrary]);

  useEffect(() => {
    if (!setBubbles.length) {
      setActiveSetBubbleId('');
      return;
    }

    if (!setBubbles.some((bubble) => bubble.id === activeSetBubbleId)) {
      setActiveSetBubbleId(setBubbles[0].id);
    }
  }, [activeSetBubbleId, setBubbles]);

  useEffect(() => {
    if (!isSessionActive || isMenuOpen) {
      return undefined;
    }

    pingHud();
    return () => {
      window.clearTimeout(hideHudTimerRef.current);
    };
  }, [isSessionActive, isMenuOpen, pingHud]);

  const readiness = useMemo(() => {
    if (!isArSupported) {
      return availabilityMessage;
    }
    if (!setBubbles.length) {
      return 'Préparez votre set : ajoutez des bulles et affectez une source audio à chacune.';
    }
    if (!isSetValidated) {
      return 'Le set a changé : validez-le et sauvegardez-le avant la composition.';
    }
    if (!isSessionActive) {
      return 'Set prêt. Vous pouvez entrer en AR ou continuer à l’éditer.';
    }
    if (isListeningMode) {
      return 'Mode écoute actif. Déplacez-vous dans le paysage pour explorer les couches.';
    }
    if (isPlacementArmed) {
      return 'Pose préparée. Touchez la scène pour confirmer le placement.';
    }
    return 'Choisissez une bulle du set puis préparez la pose avant de toucher la scène.';
  }, [availabilityMessage, isArSupported, isListeningMode, isPlacementArmed, isSessionActive, isSetValidated, setBubbles.length]);

  return {
    sceneHostRef,
    overlayRootRef,
    audioLibrary,
    selectedAsset,
    selectedAssetId,
    setBubbles,
    selectedSetBubble,
    activeSetBubbleId,
    isSetValidated,
    isListeningMode,
    isArSupported,
    availabilityMessage,
    isSessionActive,
    bubbleCount,
    placedBubbles,
    toasts,
    isHudVisible,
    isMenuOpen,
    isBusy,
    isPlacementArmed,
    previewingId,
    readiness,
    enterAr,
    importAudioFiles,
    selectAsset,
    addSetBubble,
    updateSetBubble,
    removeSetBubble,
    validateSet,
    setActiveSetBubbleId,
    playSetBubblePreview,
    stopPreview,
    togglePlacedBubbleAudio,
    armPlacement,
    cancelPlacement,
    toggleMode,
    toggleMenu,
    dismissMenu,
    clearAllBubbles,
    pingHud,
  };
}
