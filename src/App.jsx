import { useMemo, useRef } from 'react';
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

      <div ref={overlayRootRef} className={`overlay-root ${isSessionActive ? 'is-ar' : ''}`}>
        <div className="top-hud top-hud--minimal">
          <div className="glass-pill hud-status hud-status--compact">
            <div>
              <span className="hud-label">AR Bubble Looper</span>
              <strong>{bpm} BPM · {bubbleCount}/8 bulles</strong>
            </div>
          </div>

          <div className="hud-actions">
            {!!bubbleCount && (
              <button type="button" className="action-button" onClick={() => clearAllBubbles(true)}>
                Vider
              </button>
            )}
            <button type="button" className="primary-button" onClick={enterAr} disabled={isBusy || (!isArSupported && !isSessionActive)}>
              {isSessionActive ? 'Quitter AR' : isBusy ? 'Starting…' : 'Entrer AR'}
            </button>
          </div>
        </div>

        {!isArSupported && !isSessionActive && (
          <div className="glass-pill availability-banner availability-banner--inline">
            {availabilityMessage}
          </div>
        )}

        {!!pendingPadId && (
          <div className="glass-pill source-sheet source-sheet--inline source-sheet--compact">
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
                Import
              </button>
              <button
                type="button"
                className={`action-button ${isRecordingMic ? 'action-button--danger' : ''}`}
                onClick={() => toggleMicRecording(pendingPadId)}
              >
                {isRecordingMic ? 'Stop mic' : 'Micro'}
              </button>
              <button type="button" className="action-button" onClick={() => setPendingPadId('')} disabled={isRecordingMic}>
                Annuler
              </button>
            </div>
          </div>
        )}

        <div className="bottom-hud bottom-hud--minimal">
          <div className="glass-pill compact-instructions compact-instructions--inline compact-instructions--minimal">
            <strong>{readiness}</strong>
          </div>

          <div className="pad-carousel" role="list" aria-label="Pads audio">
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
                <span className="pad-card__index">Pad {pad.label}</span>
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
