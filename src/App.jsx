import { useRef } from 'react';
import { useEchoBubbleLoop } from './hooks/useEchoBubbleLoop';

function getModeLabel(isListeningMode) {
  return isListeningMode ? 'Listening' : 'Creation';
}

function getLauncherLabel({ isSessionActive, selectedAsset, isListeningMode, bubbleCount }) {
  if (!isSessionActive) {
    return selectedAsset ? `Ready · ${selectedAsset.name}` : 'Setup';
  }

  const mode = getModeLabel(isListeningMode);
  const source = selectedAsset ? selectedAsset.name : 'No source';
  return `${mode} · ${source} · ${bubbleCount}/8`;
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
  const launcherLabel = getLauncherLabel({ isSessionActive, selectedAsset, isListeningMode, bubbleCount });

  return (
    <div className="app-shell" onPointerDown={pingHud}>
      <div ref={sceneHostRef} className="scene-host" aria-hidden="true" />

      <div ref={overlayRootRef} className={`overlay-root ${isSessionActive ? 'is-ar' : ''}`}>
        {!isSessionActive && (
          <section className="hero-copy-block">
            <div className="eyebrow">Spatial sound AR</div>
            <h1>EchoBubbleLoop</h1>
            <p>
              Import a sound, choose the active source, then launch AR. Once inside, everything stays in one bottom menu.
            </p>
          </section>
        )}

        <div className={`bottom-dock ${isSessionActive ? 'is-ar' : ''} ${isHudVisible ? 'is-visible' : 'is-dimmed'}`}>
          <button type="button" className="dock-handle" onClick={toggleMenu}>
            <span className="dock-handle__meta">{isSessionActive ? 'Menu' : 'Setup'}</span>
            <strong>{launcherLabel}</strong>
          </button>
        </div>

        <aside className={`bottom-sheet ${isMenuOpen ? 'is-open' : ''}`}>
          <div className="bottom-sheet__scrim" onClick={dismissMenu} />
          <div className="bottom-sheet__panel">
            <div className="bottom-sheet__handle" />

            <div className="sheet-header">
              <div>
                <p className="sheet-kicker">{isSessionActive ? 'AR session' : 'Preparation'}</p>
                <h2>{isSessionActive ? 'Quick controls' : 'Get ready'}</h2>
              </div>
              <button type="button" className="ghost-button" onClick={dismissMenu}>
                Close
              </button>
            </div>

            <div className="sheet-scroll">
              <section className="sheet-card sheet-card--status">
                <span className="card-label">Status</span>
                <strong>{modeLabel}</strong>
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
                <p>{selectedAsset ? `Active source: ${selectedAsset.name}` : 'New bubbles use the selected source.'}</p>
              </section>

              <section className="sheet-card">
                <div className="card-row">
                  <span className="card-label">Scene</span>
                  <strong>{bubbleCount}/8 bubbles</strong>
                </div>
                <div className="sheet-actions">
                  <button type="button" className="action-button" onClick={openFilePicker}>
                    Import audio
                  </button>
                  <button type="button" className="action-button" onClick={toggleMode}>
                    {modeLabel}
                  </button>
                  {bubbleCount > 0 && (
                    <button type="button" className="action-button action-button--danger" onClick={() => clearAllBubbles(true)}>
                      Clear all
                    </button>
                  )}
                </div>
              </section>
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
