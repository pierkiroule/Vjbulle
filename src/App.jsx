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
            <div className="control-carousel" role="list" aria-label="Contrôles AR Bubble Looper">
              <section className="glass-sheet control-card control-card--status" role="listitem" aria-label="Statut de session">
                <div>
                  <span className="hud-label">Session</span>
                  <strong>AR Bubble Looper</strong>
                  <p className="control-card__lead">{bpm} BPM · {bubbleCount}/8 bulles</p>
                </div>

                <div className="control-card__content">
                  <div className="glass-pill compact-instructions compact-instructions--inline compact-instructions--minimal">
                    <strong>{readiness}</strong>
                  </div>

                  {!isArSupported && !isSessionActive && (
                    <div className="glass-pill availability-banner availability-banner--inline">
                      {availabilityMessage}
                    </div>
                  )}
                </div>

                <div className="control-card__actions">
                  {!!bubbleCount && (
                    <button type="button" className="action-button" onClick={() => clearAllBubbles(true)}>
                      Vider
                    </button>
                  )}
                  <button type="button" className="primary-button" onClick={enterAr} disabled={isBusy || (!isArSupported && !isSessionActive)}>
                    {isSessionActive ? 'Quitter AR' : isBusy ? 'Starting…' : 'Entrer AR'}
                  </button>
                </div>
              </section>

              <section className="glass-sheet control-card" role="listitem" aria-label="Outils du pad">
                <div className="sheet-head">
                  <div>
                    <span className="hud-label">Outils</span>
                    <strong>{pendingPadId ? `Pad ${pendingPadId.split('-').at(-1)}` : 'Import / micro'}</strong>
                  </div>
                  {!!pendingPadId && (
                    <button type="button" className="icon-button" onClick={() => setPendingPadId('')} disabled={isRecordingMic} aria-label="Fermer l’édition du pad">
                      ✕
                    </button>
                  )}
                </div>

                {pendingPadId ? (
                  <>
                    <div className="control-card__content">
                      <p className="control-card__lead">
                        {filledPadIds.has(pendingPadId) ? 'Remplacer le sample sélectionné.' : 'Ajouter un sample à ce pad.'}
                      </p>
                    </div>

                    <div className="control-card__actions">
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
                    </div>
                  </>
                ) : (
                  <div className="control-card__empty">
                    Maintiens un pad pour ouvrir ses outils d’import ou d’enregistrement micro.
                  </div>
                )}
              </section>

              <section className="glass-sheet control-card" role="listitem" aria-label="Gestion des bulles">
                <div className="sheet-head">
                  <div>
                    <span className="hud-label">Bulles</span>
                    <strong>{bubbleCount ? `${bubbleCount} loop${bubbleCount > 1 ? 's' : ''} actif${bubbleCount > 1 ? 's' : ''}` : 'Aucune bulle active'}</strong>
                  </div>
                  {!!bubbleCount && (
                    <button type="button" className="action-button action-button--ghost" onClick={() => clearAllBubbles(true)}>
                      Tout vider
                    </button>
                  )}
                </div>

                {!!bubbleCount ? (
                  <div className="bubble-list" role="list" aria-label="Bulles audio">
                    {placedBubbles.map((bubble) => (
                      <div key={bubble.id} className="bubble-row" role="listitem">
                        <div className="bubble-row__copy">
                          <strong>{bubble.label}</strong>
                          <span>{bubble.attached ? 'Collée à la caméra' : 'Libre dans la scène'}</span>
                        </div>

                        <div className="bubble-row__actions">
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
                            Supprimer
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="control-card__empty">
                    Place une bulle depuis un pad rempli pour afficher ses actions ici.
                  </div>
                )}
              </section>

              {pads.map((pad) => (
                <button
                  key={pad.id}
                  type="button"
                  role="listitem"
                  className={`control-card pad-card ${pad.buffer ? 'is-filled' : 'is-empty'} ${pendingPadId === pad.id ? 'is-pending' : ''}`}
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
