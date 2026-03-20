import { useRef } from 'react';
import { useEchoBubbleLoop } from './hooks/useEchoBubbleLoop';

function formatCount(count) {
  return `${count}/8 bubbles`;
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

  return (
    <div className="app-shell" onPointerDown={pingHud}>
      <div ref={sceneHostRef} className="scene-host" aria-hidden="true" />

      <div ref={overlayRootRef} className={`overlay-root ${isSessionActive ? 'is-ar' : ''}`}>
        <header className={`landing-shell ${isSessionActive ? 'is-hidden' : ''}`}>
          <div className="hero-card">
            <div className="eyebrow">Spatial sound AR</div>
            <h1>EchoBubbleLoop</h1>
            <p className="hero-copy">
              Prepare your sound palette, launch AR, then place calm looping bubbles exactly where you look.
            </p>

            <div className="hero-actions">
              <button
                type="button"
                className="primary-action"
                onClick={enterAr}
                disabled={!isArSupported || isBusy}
              >
                {isBusy ? 'Starting…' : 'Enter AR'}
              </button>
              <button type="button" className="secondary-action" onClick={openFilePicker}>
                Import audio
              </button>
            </div>

            <div className="setup-grid">
              <section className="setup-panel">
                <div className="section-header">
                  <span>Current source</span>
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
                <p className="supporting-copy">
                  {selectedAsset
                    ? `Selected: ${selectedAsset.name}`
                    : 'Choose the sound that new bubbles should use.'}
                </p>
              </section>

              <section className="setup-panel compact">
                <div className="section-header">
                  <span>Modes</span>
                  <strong>{isListeningMode ? 'Listening' : 'Creation'}</strong>
                </div>
                <button type="button" className="mode-toggle" onClick={toggleMode}>
                  {isListeningMode ? 'Switch to creation mode' : 'Switch to listening mode'}
                </button>
                <p className="supporting-copy">{readiness}</p>
              </section>
            </div>

            <div className="tips-row">
              <span>Tap to place</span>
              <span>Auto-hide AR controls</span>
              <span>Independent spatial loops</span>
            </div>

            {!isArSupported && <p className="availability-banner">{availabilityMessage}</p>}
          </div>
        </header>

        <div className={`ar-hud ${isSessionActive ? 'is-active' : ''} ${isHudVisible ? 'is-visible' : 'is-dimmed'}`}>
          <div className="hud-top">
            <div className="hud-chip-group">
              <button type="button" className="hud-chip source-chip" onClick={toggleMenu}>
                <span className="chip-label">Source</span>
                <strong>{selectedAsset ? selectedAsset.name : 'None'}</strong>
              </button>
              <button type="button" className="hud-chip" onClick={toggleMode}>
                <span className="chip-label">Mode</span>
                <strong>{isListeningMode ? 'Listening' : 'Creation'}</strong>
              </button>
            </div>
            <button type="button" className="icon-button" onClick={enterAr}>
              Exit
            </button>
          </div>

          <div className="hud-bottom">
            <button type="button" className="floating-menu-button" onClick={toggleMenu}>
              <span>{formatCount(bubbleCount)}</span>
              <strong>Menu</strong>
            </button>
          </div>
        </div>

        <aside className={`menu-sheet ${isMenuOpen ? 'is-open' : ''}`}>
          <div className="menu-sheet__scrim" onClick={dismissMenu} />
          <div className="menu-sheet__panel">
            <div className="menu-sheet__handle" />
            <div className="menu-sheet__header">
              <div>
                <p className="menu-sheet__eyebrow">AR controls</p>
                <h2>Quick actions</h2>
              </div>
              <button type="button" className="icon-button" onClick={dismissMenu}>
                Close
              </button>
            </div>

            <div className="menu-grid">
              <button type="button" className="menu-card menu-card--primary" onClick={toggleMode}>
                <span className="menu-card__label">Mode</span>
                <strong>{isListeningMode ? 'Listening' : 'Creation'}</strong>
                <small>Swap instantly depending on whether you want to place or explore.</small>
              </button>

              <button type="button" className="menu-card" onClick={openFilePicker}>
                <span className="menu-card__label">Library</span>
                <strong>Import audio</strong>
                <small>Add more sounds without leaving the experience.</small>
              </button>

              <label className="menu-select-card">
                <span className="menu-card__label">Current source</span>
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
              </label>

              <button type="button" className="menu-card menu-card--danger" onClick={() => clearAllBubbles(true)}>
                <span className="menu-card__label">Scene</span>
                <strong>Clear bubbles</strong>
                <small>Remove every active loop and restart with a clean space.</small>
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
