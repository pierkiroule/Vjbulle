import { useRef } from 'react';
import { useEchoBubbleLoop } from './hooks/useEchoBubbleLoop';

function getModeLabel(isListeningMode) {
  return isListeningMode ? 'Listening' : 'Creation';
}

function getDockLabel({ isSessionActive, isListeningMode, selectedAsset }) {
  if (!isSessionActive) {
    return selectedAsset ? 'Setup · ready' : 'Setup';
  }

  return `Menu · ${getModeLabel(isListeningMode)}`;
}

function App() {
  const fileInputRef = useRef(null);
  const {
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
  } = useEchoBubbleLoop();

  const handleFileChange = async (event) => {
    const files = Array.from(event.target.files ?? []);
    await importAudioFiles(files);
    event.target.value = '';
  };

  const openFilePicker = () => {
    pingHud();
    fileInputRef.current?.click();
  };

  const modeLabel = getModeLabel(isListeningMode);
  const dockLabel = getDockLabel({ isSessionActive, isListeningMode, selectedAsset });
  const nextModeAction = isListeningMode ? 'Switch to creation' : 'Switch to listening';

  return (
    <div className="app-shell" onPointerDown={pingHud}>
      <div ref={sceneHostRef} className="scene-host" aria-hidden="true" />

      <div ref={overlayRootRef} className={`overlay-root ${isSessionActive ? 'is-ar' : ''}`}>
        {!isSessionActive && (
          <section className="hero-copy-block">
            <div className="eyebrow">Spatial sound AR</div>
            <h1>EchoBubbleLoop</h1>
            <p>Import a sound, pick the active source, then enter AR. Once inside, use one bottom menu for everything.</p>
          </section>
        )}

        <div className={`bottom-dock ${isHudVisible ? 'is-visible' : 'is-dimmed'}`}>
          <button type="button" className="dock-handle" onClick={toggleMenu}>
            <span className="dock-handle__meta">{isSessionActive ? 'Controls' : 'Preparation'}</span>
            <strong>{dockLabel}</strong>
          </button>
        </div>

        <aside className={`bottom-sheet ${isMenuOpen ? 'is-open' : ''}`}>
          <div className="bottom-sheet__scrim" onClick={dismissMenu} />
          <div className="bottom-sheet__panel">
            <div className="bottom-sheet__handle" />

            <div className="sheet-header">
              <div>
                <p className="sheet-kicker">{isSessionActive ? 'In AR' : 'Before AR'}</p>
                <h2>{isSessionActive ? 'Quick controls' : 'Get ready'}</h2>
              </div>
            </div>

            <div className="sheet-scroll">
              <section className="sheet-card sheet-card--status">
                <span className="card-label">Current step</span>
                <strong>{isSessionActive ? modeLabel : selectedAsset ? 'Ready to enter AR' : 'Add your first sound'}</strong>
                <p>{availabilityMessage || readiness}</p>
              </section>

              <section className="sheet-card">
                <div className="card-row">
                  <span className="card-label">Source</span>
                  <strong>{audioLibrary.length} files</strong>
                </div>
                <select
                  value={selectedAssetId}
                  onChange={(event) => selectAsset(event.target.value)}
                  disabled={!audioLibrary.length}
                >
                  {!audioLibrary.length && <option value="">Import audio files first</option>}
                  {audioLibrary.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
                <div className="sheet-actions">
                  <button type="button" className="action-button" onClick={openFilePicker}>
                    Import audio
                  </button>
                </div>
                <p>{selectedAsset ? `Active source: ${selectedAsset.name}` : 'New bubbles always use the active source.'}</p>
              </section>

              {isSessionActive && (
                <>
                  <section className="sheet-card">
                    <div className="card-row">
                      <span className="card-label">Mode</span>
                      <strong>{modeLabel}</strong>
                    </div>
                    <div className="sheet-actions">
                      <button type="button" className="action-button" onClick={toggleMode}>
                        {nextModeAction}
                      </button>
                    </div>
                    <p>{isListeningMode ? 'Walk through the scene and listen.' : 'Tap in AR to place bubbles where you look.'}</p>
                  </section>

                  {bubbleCount > 0 && (
                    <section className="sheet-card">
                      <div className="card-row">
                        <span className="card-label">Scene</span>
                        <strong>{bubbleCount}/8 bubbles</strong>
                      </div>
                      <div className="sheet-actions">
                        <button type="button" className="action-button action-button--danger" onClick={() => clearAllBubbles(true)}>
                          Clear bubbles
                        </button>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>

            <div className="sheet-footer">
              <button
                type="button"
                className="primary-button"
                onClick={enterAr}
                disabled={(!isArSupported && !isSessionActive) || isBusy}
              >
                {isBusy ? 'Starting…' : isSessionActive ? 'Exit AR' : 'Enter AR'}
              </button>
            </div>
          </div>
        </aside>

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
        accept="audio/*,.mp3,.wav"
        multiple
        onChange={handleFileChange}
      />
    </div>
  );
}

export default App;
