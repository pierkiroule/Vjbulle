import { useMemo, useRef } from 'react';
import { useEchoBubbleLoop } from './hooks/useEchoBubbleLoop';

function formatPadMeta(pad) {
  if (!pad.buffer) {
    return 'Tap · import ou micro';
  }

  return `${pad.bars} bar · ${pad.bpm} BPM · ${pad.loopEnd.toFixed(2)}s`;
}

function App() {
  const fileInputRef = useRef(null);
  const longPressRef = useRef({ timer: 0, padId: '', handled: false });
  const {
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
    isHudVisible,
    pendingPadId,
    isRecordingMic,
    menuOpen,
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
    clearAllBubbles,
    setPendingPadId,
    setMenuOpen,
  } = useEchoBubbleLoop();

  const filledPadIds = useMemo(() => new Set(pads.filter((pad) => pad.buffer).map((pad) => pad.id)), [pads]);
  const readyToEnterAr = activePadCount > 0 && (isArSupported || isSessionActive);

  const handleFileChange = async (event) => {
    const files = Array.from(event.target.files ?? []);
    await handleImportedFiles(files);
    event.target.value = '';
  };

  const handlePadAction = async (pad) => {
    pingHud();

    if (!pad.buffer) {
      beginPadImport(pad.id);
      return;
    }

    await placeBubbleFromPad(pad.id);
  };

  const handlePadPointerDown = (pad) => {
    window.clearTimeout(longPressRef.current.timer);
    longPressRef.current = {
      padId: pad.id,
      handled: false,
      timer: window.setTimeout(() => {
        longPressRef.current.handled = true;
        beginPadImport(pad.id);
      }, 420),
    };
  };

  const clearLongPress = () => {
    window.clearTimeout(longPressRef.current.timer);
  };

  const handlePadClick = async (pad) => {
    if (longPressRef.current.handled && longPressRef.current.padId === pad.id) {
      longPressRef.current.handled = false;
      return;
    }

    await handlePadAction(pad);
  };

  return (
    <div className="app-shell" onPointerDown={pingHud}>
      <div ref={sceneHostRef} className="scene-host" aria-hidden="true" />

      <div ref={overlayRootRef} className={`overlay-root ${isSessionActive ? 'is-ar' : 'is-lobby'} ${isHudVisible ? 'is-visible' : 'is-hidden'}`}>
        <header className="top-hud">
          <div className="glass-pill hero-status">
            <div>
              <span className="hud-label">AR Audio Looper</span>
              <strong>Bubble blower instrument</strong>
            </div>
            <div className="hero-status__metrics">
              <span className="hud-chip">{bpm} BPM</span>
              <span className="hud-chip">{bubbleCount}/8 bulles</span>
            </div>
          </div>

          <div className="hud-actions">
            <button type="button" className="icon-button" onClick={() => setMenuOpen((current) => !current)} aria-label="Options">
              ⚙️
            </button>
            <button type="button" className="primary-button" onClick={enterAr} disabled={isBusy || (!isArSupported && !isSessionActive)}>
              {isSessionActive ? 'Quitter AR' : isBusy ? 'Starting…' : 'Entrer AR'}
            </button>
          </div>
        </header>

        {!isSessionActive && (
          <section className="center-stage">
            <div className="glass-stage stage-panel">
              <span className="hud-label">Expérience</span>
              <h1>Charge un sample. Tape un pad. Souffle une bulle sur le beat.</h1>
              <p>
                L’app est maintenant un instrument minimal : aucun éditeur, pas de menu complexe, seulement des pads,
                des bulles et une synchro globale à {bpm} BPM.
              </p>
              <div className="stage-panel__actions">
                <button type="button" className="primary-button" onClick={enterAr} disabled={!readyToEnterAr || isBusy}>
                  {isBusy ? 'Starting…' : 'Lancer la session AR'}
                </button>
                <span className="stage-panel__hint">Long press sur un pad rempli pour remplacer le sample.</span>
              </div>
            </div>

            <div className="glass-stage stats-panel">
              <div>
                <span className="hud-label">Pads prêts</span>
                <strong>{activePadCount}/8</strong>
              </div>
              <div>
                <span className="hud-label">Horloge</span>
                <strong>{beatDuration.toFixed(3)} s / beat</strong>
              </div>
              <div>
                <span className="hud-label">Flow</span>
                <strong>Tap pad → next beat → bubble</strong>
              </div>
            </div>
          </section>
        )}

        {menuOpen && (
          <div className="glass-sheet mini-menu">
            <p>{readiness}</p>
            <div className="mini-menu__actions">
              <button type="button" className="action-button" onClick={() => clearAllBubbles(true)} disabled={!bubbleCount}>
                Vider les bulles
              </button>
              <button type="button" className="action-button" onClick={() => setMenuOpen(false)}>
                Fermer
              </button>
            </div>
          </div>
        )}

        {!isArSupported && !isSessionActive && (
          <div className="glass-sheet availability-banner">
            {availabilityMessage}
          </div>
        )}

        {!!pendingPadId && (
          <div className="glass-sheet source-sheet">
            <div>
              <span className="hud-label">Pad {pendingPadId.split('-').at(-1)}</span>
              <strong>{filledPadIds.has(pendingPadId) ? 'Remplacer le sample' : 'Ajouter un sample'}</strong>
            </div>
            <div className="mini-menu__actions">
              <button
                type="button"
                className="action-button"
                onClick={() => openFilePickerForPad(pendingPadId, fileInputRef.current)}
              >
                Import audio
              </button>
              <button
                type="button"
                className={`action-button ${isRecordingMic ? 'action-button--danger' : ''}`}
                onClick={() => toggleMicRecording(pendingPadId)}
              >
                {isRecordingMic ? 'Stop micro' : 'Record mic'}
              </button>
              <button type="button" className="action-button" onClick={() => setPendingPadId('')} disabled={isRecordingMic}>
                Annuler
              </button>
            </div>
          </div>
        )}

        <footer className="bottom-hud">
          <div className="glass-sheet compact-instructions">
            <div className="compact-instructions__topline">
              <strong>{activePadCount}/8 pads prêts</strong>
              <span className="session-state">{isSessionActive ? 'Session AR live' : 'Prépare tes pads'}</span>
            </div>
            <p>{readiness}</p>
            {!!placedBubbles.length && (
              <div className="bubble-inline-list">
                {placedBubbles.map((bubble) => (
                  <span key={bubble.id} className={`bubble-inline-chip ${bubble.attached ? 'is-attached' : ''}`}>
                    {bubble.attached ? '📌' : '○'} {bubble.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="pad-dock">
            <div className="pad-dock__header">
              <span className="hud-label">Pads</span>
              <strong>Tap = jouer / Long press = remplacer</strong>
            </div>
            <div className="pad-carousel" role="list" aria-label="Pads audio">
              {pads.map((pad) => (
                <button
                  key={pad.id}
                  type="button"
                  role="listitem"
                  className={`pad-card ${pad.buffer ? 'is-filled' : 'is-empty'} ${pendingPadId === pad.id ? 'is-pending' : ''}`}
                  onPointerDown={() => handlePadPointerDown(pad)}
                  onPointerUp={clearLongPress}
                  onPointerLeave={clearLongPress}
                  onClick={() => handlePadClick(pad)}
                >
                  <span className="pad-card__index">Pad {pad.label}</span>
                  <strong>{pad.name || 'Empty'}</strong>
                  <span className="pad-card__meta">{formatPadMeta(pad)}</span>
                </button>
              ))}
            </div>
          </div>
        </footer>

        <div className="toast-stack" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast--${toast.tone}`}>
              {toast.message}
            </div>
          ))}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="visually-hidden"
        accept="audio/*,.mp3,.wav,.m4a"
        onChange={handleFileChange}
      />
    </div>
  );
}

export default App;
