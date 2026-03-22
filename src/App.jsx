import React, { useMemo, useRef } from 'react';
import { useEchoBubbleLoop } from './hooks/useEchoBubbleLoop';

function formatPadMeta(pad) {
  if (!pad.buffer) {
    return 'Tap · import / mic';
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
    bubbleCount,
    isArSupported,
    availabilityMessage,
    isSessionActive,
    isBusy,
    pendingPadId,
    isRecordingMic,
    placedBubbles,
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
    toggleBubbleAttachment,
    popBubble,
    setPendingPadId,
  } = useEchoBubbleLoop();

  const filledPadIds = useMemo(() => new Set(pads.filter((pad) => pad.buffer).map((pad) => pad.id)), [pads]);

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

  const handlePadPointerUp = () => {
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

      <div ref={overlayRootRef} className="dom-overlay-root">
        <div className={`overlay-root ${isSessionActive ? 'is-ar' : ''}`}>
          <div className="bottom-dock" aria-live="polite">
            <div className="glass-sheet bottom-menu" aria-label="Menu bas">
              <div className="bottom-menu__row bottom-menu__row--primary">
                <div className="bottom-menu__summary">
                  <div>
                    <span className="hud-label">AR Bubble Looper</span>
                    <strong>Menu bas</strong>
                  </div>
                  <div className="metric-strip" aria-label="Résumé de session">
                    <span className="metric-pill">{bpm} BPM</span>
                    <span className="metric-pill">{bubbleCount}/8 bulles</span>
                    <span className="metric-pill metric-pill--status">{readiness}</span>
                  </div>
                  {!isArSupported && !isSessionActive && (
                    <p className="bottom-menu__hint bottom-menu__hint--warning">{availabilityMessage}</p>
                  )}
                </div>

                <div className="bottom-menu__actions">
                  {!!bubbleCount && (
                    <button type="button" className="action-button action-button--ghost" onClick={() => clearAllBubbles(true)}>
                      Vider
                    </button>
                  )}
                  <button type="button" className="primary-button" onClick={enterAr} disabled={isBusy || (!isArSupported && !isSessionActive)}>
                    {isSessionActive ? 'Quitter AR' : isBusy ? 'Starting…' : 'Entrer AR'}
                  </button>
                </div>
              </div>

              {!!pendingPadId && (
                <div className="bottom-menu__row bottom-menu__row--secondary">
                  <div className="bottom-menu__context">
                    <div>
                      <span className="hud-label">Pad {pendingPadId.split('-').at(-1)}</span>
                      <strong>{filledPadIds.has(pendingPadId) ? 'Remplacer le sample' : 'Ajouter un sample'}</strong>
                    </div>
                    <p className="bottom-menu__hint">
                      {filledPadIds.has(pendingPadId) ? 'Importez une nouvelle source ou enregistrez au micro.' : 'Choisissez un import ou une prise micro.'}
                    </p>
                  </div>

                  <div className="bottom-menu__actions bottom-menu__actions--compact">
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => openFilePickerForPad(pendingPadId, fileInputRef.current)}
                    >
                      Import
                    </button>
                    <button
                      type="button"
                      className={`action-button ${isRecordingMic ? 'action-button--danger' : ''}`}
                      onClick={() => toggleMicRecording(pendingPadId)}
                    >
                      {isRecordingMic ? 'Stop mic' : 'Micro'}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => setPendingPadId('')}
                      disabled={isRecordingMic}
                      aria-label="Fermer l’édition du pad"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {!!bubbleCount && (
                <div className="bottom-menu__row bottom-menu__row--bubbles">
                  <div className="bottom-menu__context">
                    <div>
                      <span className="hud-label">Bulles</span>
                      <strong>{bubbleCount} active{bubbleCount > 1 ? 's' : ''}</strong>
                    </div>
                  </div>

                  <div className="bubble-inline-list" role="list" aria-label="Bulles audio">
                    {placedBubbles.map((bubble) => (
                      <div key={bubble.id} className="bubble-inline-card" role="listitem">
                        <div className="bubble-inline-card__copy">
                          <strong>{bubble.label}</strong>
                          <span>{bubble.attached ? 'Caméra' : 'Scène'}</span>
                        </div>
                        <div className="bubble-inline-card__actions">
                          <button
                            type="button"
                            className="action-button action-button--ghost"
                            onClick={() => toggleBubbleAttachment(bubble.id)}
                          >
                            {bubble.attached ? 'Décoller' : 'Coller'}
                          </button>
                          <button
                            type="button"
                            className="action-button action-button--danger"
                            onClick={() => popBubble(bubble.id)}
                          >
                            Suppr.
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="pad-strip" role="list" aria-label="Pads audio">
              {pads.map((pad) => (
                <button
                  key={pad.id}
                  type="button"
                  role="listitem"
                  className={`pad-card ${pad.buffer ? 'is-filled' : 'is-empty'} ${pendingPadId === pad.id ? 'is-pending' : ''}`}
                  onPointerDown={() => handlePadPointerDown(pad)}
                  onPointerUp={handlePadPointerUp}
                  onPointerLeave={handlePadPointerUp}
                  onClick={() => handlePadClick(pad)}
                >
                  <span className="hud-label">Pad {pad.label}</span>
                  <strong>{pad.name || 'Empty'}</strong>
                  <span className="pad-card__meta">{formatPadMeta(pad)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="toast-stack" aria-live="polite" aria-atomic="true">
            {toasts.map((toast) => (
              <div key={toast.id} className={`toast toast--${toast.tone}`}>
                {toast.message}
              </div>
            ))}
          </div>
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
