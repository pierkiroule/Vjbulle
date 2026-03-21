import { useRef } from 'react';
import { useEchoBubbleLoop } from './hooks/useEchoBubbleLoop';

function getModeLabel(isListeningMode) {
  return isListeningMode ? 'Écoute' : 'Composition';
}

function getDockLabel({ isSessionActive, isSetValidated, setBubbles, isListeningMode }) {
  if (!isSessionActive) {
    if (!setBubbles.length) {
      return 'Préparer le set';
    }
    return isSetValidated ? 'Set validé · prêt pour AR' : 'Set à valider';
  }

  return `AR · ${getModeLabel(isListeningMode)}`;
}

function App() {
  const fileInputRef = useRef(null);
  const {
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
  const dockLabel = getDockLabel({ isSessionActive, isSetValidated, setBubbles, isListeningMode });
  const canEnterAr = isSetValidated && (isArSupported || isSessionActive) && !isBusy;

  return (
    <div className="app-shell" onPointerDown={pingHud}>
      <div ref={sceneHostRef} className="scene-host" aria-hidden="true" />

      <div ref={overlayRootRef} className={`overlay-root ${isSessionActive ? 'is-ar' : ''}`}>
        {!isSessionActive && (
          <section className="hero-copy-block">
            <div className="eyebrow">Spatial sound AR</div>
            <h1>EchoBubbleLoop</h1>
            <p>
              Préparez d’abord un set léger et validé, puis passez en AR pour composer votre paysage sonore.
              Vous pouvez revenir éditer le set à tout moment entre deux sessions.
            </p>
          </section>
        )}

        <div className={`bottom-dock ${isHudVisible ? 'is-visible' : 'is-dimmed'}`}>
          <button type="button" className="dock-handle" onClick={toggleMenu}>
            <span className="dock-handle__meta">{isSessionActive ? 'Contrôles' : 'Préparation'}</span>
            <strong>{dockLabel}</strong>
          </button>
        </div>

        <aside className={`bottom-sheet ${isMenuOpen ? 'is-open' : ''}`}>
          <div className="bottom-sheet__scrim" onClick={dismissMenu} />
          <div className="bottom-sheet__panel">
            <div className="bottom-sheet__handle" />

            <div className="sheet-header">
              <div>
                <p className="sheet-kicker">{isSessionActive ? 'Expérience AR' : 'Préparation du set'}</p>
                <h2>{isSessionActive ? 'Composer le paysage' : 'Définir le set'}</h2>
              </div>
            </div>

            <div className="sheet-scroll">
              <section className="sheet-card sheet-card--status">
                <span className="card-label">État actuel</span>
                <strong>
                  {isSessionActive
                    ? isPlacementArmed
                      ? 'Pose en attente de confirmation'
                      : modeLabel
                    : isSetValidated
                      ? 'Set validé et sauvegardé'
                      : 'Set à préparer'}
                </strong>
                <p>{availabilityMessage || readiness}</p>
              </section>

              <section className="sheet-card">
                <div className="card-row">
                  <span className="card-label">Bibliothèque audio</span>
                  <strong>{audioLibrary.length} fichier(s)</strong>
                </div>
                <select
                  value={selectedAssetId}
                  onChange={(event) => selectAsset(event.target.value)}
                  disabled={!audioLibrary.length}
                >
                  {!audioLibrary.length && <option value="">Importez des fichiers audio</option>}
                  {audioLibrary.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
                <div className="sheet-actions">
                  <button type="button" className="action-button" onClick={openFilePicker}>
                    Importer audio
                  </button>
                  {selectedAsset && (
                    <button type="button" className="action-button" onClick={() => stopPreview()}>
                      Stop preview source
                    </button>
                  )}
                </div>
                <p>
                  {selectedAsset
                    ? `Source active : ${selectedAsset.name}. Utilisez-la pour créer rapidement une bulle de set.`
                    : 'Commencez par importer vos sons de travail.'}
                </p>
              </section>

              <section className="sheet-card">
                <div className="card-row">
                  <span className="card-label">Set de bulles</span>
                  <strong>{setBubbles.length}/8 bulles</strong>
                </div>
                <div className="sheet-actions">
                  <button type="button" className="action-button" onClick={addSetBubble} disabled={!audioLibrary.length || setBubbles.length >= 8}>
                    Ajouter une bulle
                  </button>
                  <button type="button" className="action-button action-button--primary-ghost" onClick={validateSet} disabled={!setBubbles.length}>
                    Valider & sauvegarder
                  </button>
                </div>
                <p>
                  Sans set défini, validé et sauvegardé, la phase de composition reste verrouillée pour alléger l’interface.
                </p>
              </section>

              {setBubbles.map((bubble) => {
                const bubbleAsset = audioLibrary.find((asset) => asset.id === bubble.assetId);
                const isPreviewing = previewingId === bubble.id;
                return (
                  <section
                    key={bubble.id}
                    className={`sheet-card bubble-card ${activeSetBubbleId === bubble.id ? 'is-active' : ''}`}
                  >
                    <div className="card-row card-row--start">
                      <label className="radio-chip">
                        <input
                          type="radio"
                          name="active-set-bubble"
                          checked={activeSetBubbleId === bubble.id}
                          onChange={() => setActiveSetBubbleId(bubble.id)}
                        />
                        <span>{bubble.label}</span>
                      </label>
                      <strong>{bubbleAsset?.name || 'Source à définir'}</strong>
                    </div>

                    <label className="field-stack">
                      <span className="card-label">Source audio</span>
                      <select
                        value={bubble.assetId}
                        onChange={(event) => updateSetBubble(bubble.id, { assetId: event.target.value })}
                        disabled={!audioLibrary.length}
                      >
                        <option value="">Choisir une source</option>
                        {audioLibrary.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="range-grid">
                      <label className="field-stack">
                        <span className="card-label">Portée · {bubble.range} m</span>
                        <input
                          type="range"
                          min="2"
                          max="18"
                          step="1"
                          value={bubble.range}
                          onChange={(event) => updateSetBubble(bubble.id, { range: Number(event.target.value) })}
                        />
                      </label>

                      <label className="field-stack">
                        <span className="card-label">Volume initial · {bubble.volume}%</span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={bubble.volume}
                          onChange={(event) => updateSetBubble(bubble.id, { volume: Number(event.target.value) })}
                        />
                      </label>
                    </div>

                    <div className="sheet-actions sheet-actions--tight">
                      <button type="button" className="action-button" onClick={() => playSetBubblePreview(bubble.id)} disabled={!bubble.assetId}>
                        {isPreviewing ? 'Play en cours' : 'Play'}
                      </button>
                      <button type="button" className="action-button" onClick={stopPreview}>
                        Stop
                      </button>
                      <button type="button" className="action-button action-button--danger" onClick={() => removeSetBubble(bubble.id)}>
                        Supprimer
                      </button>
                    </div>
                  </section>
                );
              })}

              {isSessionActive && (
                <>
                  <section className="sheet-card">
                    <div className="card-row">
                      <span className="card-label">Mode</span>
                      <strong>{modeLabel}</strong>
                    </div>
                    <div className="sheet-actions">
                      <button type="button" className="action-button" onClick={toggleMode}>
                        {isListeningMode ? 'Passer en composition' : 'Passer en écoute'}
                      </button>
                      {!isListeningMode && (
                        <>
                          <button
                            type="button"
                            className="action-button action-button--primary-ghost"
                            onClick={armPlacement}
                            disabled={!selectedSetBubble || !isSetValidated}
                          >
                            Préparer la pose
                          </button>
                          {isPlacementArmed && (
                            <button type="button" className="action-button" onClick={cancelPlacement}>
                              Annuler la pose
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    <p>
                      Sélectionnez une bulle du set, préparez la pose, puis touchez la scène pour confirmer son placement.
                    </p>
                  </section>

                  <section className="sheet-card">
                    <div className="card-row">
                      <span className="card-label">Bulle prête</span>
                      <strong>{selectedSetBubble ? selectedSetBubble.label : 'Aucune sélection'}</strong>
                    </div>
                    <p>
                      {selectedSetBubble
                        ? `Portée ${selectedSetBubble.range} m · volume ${selectedSetBubble.volume}%`
                        : 'Choisissez une bulle dans le set pour composer.'}
                    </p>
                  </section>

                  {bubbleCount > 0 && (
                    <section className="sheet-card">
                      <div className="card-row">
                        <span className="card-label">Paysage courant</span>
                        <strong>{bubbleCount}/8 bulles posées</strong>
                      </div>
                      <div className="bubble-list">
                        {placedBubbles.map((bubble) => (
                          <div key={bubble.id} className="bubble-list__item">
                            <div>
                              <strong>{bubble.label}</strong>
                              <p>{bubble.assetName} · {bubble.range} m · {bubble.volume}%</p>
                            </div>
                            <div className="sheet-actions sheet-actions--tight sheet-actions--inline">
                              <button type="button" className="action-button action-button--small" onClick={() => togglePlacedBubbleAudio(bubble.id)}>
                                {bubble.isPlaying ? 'Stop' : 'Play'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="sheet-actions">
                        <button type="button" className="action-button action-button--danger" onClick={() => clearAllBubbles(true)}>
                          Vider la composition
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
                disabled={!canEnterAr}
              >
                {isBusy ? 'Starting…' : isSessionActive ? 'Quitter AR' : 'Entrer en AR'}
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
