import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

const MAX_BUBBLES = 8;
const FLOAT_SPEED = 0.68;
const FLOAT_HEIGHT = 0.028;
const DRIFT_AMOUNT = 0.013;
const MAX_AUDIBLE_DISTANCE = 9;
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
  const toastCounterRef = useRef(0);
  const dismissTimerRef = useRef(0);
  const hideHudTimerRef = useRef(0);
  const audioLibraryRef = useRef([]);

  const [audioLibrary, setAudioLibrary] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [isListeningMode, setIsListeningMode] = useState(false);
  const [isArSupported, setIsArSupported] = useState(true);
  const [availabilityMessage, setAvailabilityMessage] = useState('');
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [bubbleCount, setBubbleCount] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [isHudVisible, setIsHudVisible] = useState(true);
  const [isMenuOpen, setIsMenuOpen] = useState(true);
  const [isBusy, setIsBusy] = useState(false);

  const selectedAsset = useMemo(
    () => audioLibrary.find((asset) => asset.id === selectedAssetId) ?? null,
    [audioLibrary, selectedAssetId],
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

    window.setTimeout(() => disposeBubbleAudio(bubble.audio), fadeOut ? 180 : 0);
  }, [disposeBubbleAudio]);

  const clearAllBubbles = useCallback((notify = true) => {
    const existing = bubblesRef.current.splice(0, bubblesRef.current.length);
    existing.forEach((bubble) => destroyBubble(bubble, true));
    setBubbleCount(0);

    if (notify) {
      postToast('All bubbles cleared.', 'neutral');
    }
  }, [destroyBubble, postToast]);

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
  }, []);

  const playPreview = useCallback((asset) => {
    stopPreview();

    if (!asset || bubblesRef.current.length > 0) {
      return false;
    }

    const preview = new Audio(asset.url);
    preview.preload = 'auto';
    preview.playsInline = true;
    preview.volume = 0.8;

    previewAudioRef.current = preview;
    previewStopTimerRef.current = window.setTimeout(() => {
      stopPreview();
    }, 1000);

    preview.play().catch(() => {
      stopPreview();
      postToast(`Preview unavailable for ${asset.name}.`, 'warning');
    });

    return true;
  }, [postToast, stopPreview]);

  const createBubbleAudio = useCallback((asset) => {
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
    panner.refDistance = 0.42;
    panner.maxDistance = MAX_AUDIBLE_DISTANCE;
    panner.rolloffFactor = 1.4;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 0;

    gain.gain.setValueAtTime(0.0001, context.currentTime);

    source.connect(gain);
    gain.connect(panner);
    panner.connect(masterGainRef.current);

    element.play().catch(() => {
      postToast(`Playback blocked for ${asset.name}. Tap again to resume.`, 'warning');
    });

    return { element, source, gain, panner };
  }, [postToast]);

  const createBubble = useCallback((asset) => {
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
      assetId: asset.id,
      assetName: asset.name,
      createdAt: performance.now() * 0.001,
      seed: Math.random() * Math.PI * 2,
      root,
      sphere,
      glow,
      audio: createBubbleAudio(asset),
    };
  }, [createBubbleAudio]);

  const placeBubble = useCallback((asset) => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) {
      return;
    }

    const bubble = createBubble(asset);

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
    postToast(`Placed ${asset.name}. ${bubblesRef.current.length}/${MAX_BUBBLES} active.`, 'success');
  }, [createBubble, destroyBubble, postToast]);

  const onSelect = useCallback(async () => {
    if (isListeningMode) {
      postToast('Listening mode is active.', 'neutral');
      return;
    }

    if (!selectedAsset) {
      postToast('Choose a sound before placing a bubble.', 'warning');
      return;
    }

    try {
      await ensureAudioContext();
      stopPreview();
      placeBubble(selectedAsset);
      pingHud();
    } catch (error) {
      postToast(error.message, 'warning');
    }
  }, [ensureAudioContext, isListeningMode, pingHud, placeBubble, postToast, selectedAsset, stopPreview]);

  const onSessionEnd = useCallback(() => {
    xrSessionRef.current?.removeEventListener('end', onSessionEnd);
    xrSessionRef.current?.removeEventListener('select', onSelect);
    xrSessionRef.current = null;
    setIsSessionActive(false);
    setIsMenuOpen(false);
    setIsHudVisible(true);
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
      postToast(selectedAsset ? 'AR ready. Tap anywhere to place.' : 'AR ready. Import a sound to place bubbles.', 'success');
    } catch (error) {
      postToast(`Failed to start AR: ${error.message}`, 'warning');
    } finally {
      setIsBusy(false);
    }
  }, [ensureAudioContext, onSelect, onSessionEnd, pingHud, postToast, selectedAsset]);

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

    setAudioLibrary((current) => {
      const next = [...current, ...importedAssets];
      return next;
    });
    setSelectedAssetId(importedAssets.at(-1)?.id ?? '');

    const latestAsset = importedAssets.at(-1);
    if (latestAsset) {
      const previewStarted = playPreview(latestAsset);
      postToast(
        previewStarted
          ? `${importedAssets.length} sound${importedAssets.length > 1 ? 's' : ''} imported. Previewing ${latestAsset.name}.`
          : `${importedAssets.length} sound${importedAssets.length > 1 ? 's' : ''} imported.`,
        'success',
      );
    }
  }, [ensureAudioContext, playPreview, postToast]);

  const selectAsset = useCallback((assetId) => {
    setSelectedAssetId(assetId);
    const asset = audioLibrary.find((item) => item.id === assetId);
    if (!asset) {
      return;
    }

    const previewStarted = playPreview(asset);
    postToast(
      previewStarted ? `Current source: ${asset.name}.` : `Current source updated to ${asset.name}.`,
      'neutral',
    );
    pingHud();
  }, [audioLibrary, pingHud, playPreview, postToast]);

  const toggleMode = useCallback(() => {
    setIsListeningMode((current) => {
      const next = !current;
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
          const targetGain = THREE.MathUtils.clamp(1 - distance / MAX_AUDIBLE_DISTANCE, 0.02, 1);
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
    if (!selectedAsset) {
      return 'Import a sound and choose a source before placing bubbles.';
    }
    return isListeningMode
      ? 'Listening mode active. Walk the space and explore your layers.'
      : 'Tap in AR to place a bubble exactly where you look.';
  }, [availabilityMessage, isArSupported, isListeningMode, selectedAsset]);

  return {
    sceneHostRef,
    overlayRootRef,
    audioLibrary,
    selectedAsset,
    selectedAssetId,
    isListeningMode,
    isArSupported,
    availabilityMessage,
    isSessionActive,
    bubbleCount,
    toasts,
    isHudVisible,
    isMenuOpen,
    isBusy,
    readiness,
    enterAr,
    importAudioFiles,
    selectAsset,
    toggleMode,
    toggleMenu,
    dismissMenu,
    clearAllBubbles,
    pingHud,
  };
}
