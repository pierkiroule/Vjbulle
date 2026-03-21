import { useRef } from 'react';
import { useEchoBubbleLoop } from './hooks/useEchoBubbleLoop';

function formatPadStatus(pad) {
  if (!pad.assetId) {
    return 'Aucune source';
  }

  return `${pad.loopBars} mesures · ${pad.tempo} BPM · ${pad.syncMode}`;
}

function getPadTone(pad, isActive) {
  if (isActive) {
    return 'is-active';
  }
  if (pad.assetId) {
    return 'is-ready';
  }
  return 'is-empty';
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
    readyPadCount,
    isArSupported,
    availabilityMessage,
    isSessionActive,
    bubbleCount,
    placedBubbles,
    selectedPlacedBubble,
    selectedPlacedBubbleId,
    toasts,
    isBusy,
    isPlacementArmed,
    previewingId,
    readiness,
    interactionMode,
    isRecordingMic,
    enterAr,
    importAudioFiles,
    selectAsset,
    updateSetBubble,
    setActiveSetBubbleId,
    playSetBubblePreview,
    stopPreview,
    togglePlacedBubbleAudio,
    armPlacement,
    cancelPlacement,
    setInteractionMode,
    updatePlacedBubble,
    setSelectedPlacedBubbleId,
    clearAllBubbles,
    pingHud,
    toggleMicRecording,
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

  const canEnterAr = readyPadCount > 0 && (isArSupported || isSessionActive) && !isBusy;
  const isBlowerMode = interactionMode === 'blower';

  return (
    <div className="app-shell" onPointerDown={pingHud}>
      <div ref={sceneHostRef} className="scene-host" aria-hidden="true" />

      <div ref={overlayRootRef} className={`overlay-root ${isSessionActive ? 'is-ar' : ''}`}>
        {!isSessionActive ? (
          <main className="studio-shell">
            <section className="hero-banner glass-panel">
              <div>
                <p className="eyebrow">Bubble looper instrument</p>
                <h1>Le sampleur est le cœur de l’app.</h1>
                <p className="hero-banner__text">
                  Le flow est maintenant visible dès l’ouverture : choisir une source, la caler sur un pad du sampler,
                  puis entrer en AR pour souffler la loop dans l’espace réel.
                </p>
              </div>
              <div className="hero-stats">
                <div>
                  <span className="card-label">Pads prêts</span>
                  <strong>{readyPadCount}/3</strong>
                </div>
                <div>
                  <span className="card-label">Sources</span>
                  <strong>{audioLibrary.length}</strong>
                </div>
                <div>
                  <span className="card-label">AR</span>
                  <strong>{isArSupported ? 'Disponible' : 'Non supportée'}</strong>
                </div>
              </div>
            </section>

            <section className="studio-grid">
              <div className="studio-column studio-column--left">
                <section className="glass-panel source-panel">
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">1 · Source rack</p>
                      <h2>Capture / import</h2>
                    </div>
                    <span className="status-pill">Bibliothèque {audioLibrary.length}</span>
                  </div>

                  <div className="source-actions">
                    <button type="button" className="primary-button" onClick={openFilePicker}>
                      Importer un son
                    </button>
                    <button
                      type="button"
                      className={`action-button ${isRecordingMic ? 'action-button--danger' : 'action-button--primary-ghost'}`}
                      onClick={toggleMicRecording}
                    >
                      {isRecordingMic ? 'Stop micro' : 'Record voix mic'}
                    </button>
                  </div>

                  <label className="field-stack">
                    <span className="card-label">Source active</span>
                    <select
                      value={selectedAssetId}
                      onChange={(event) => selectAsset(event.target.value)}
                      disabled={!audioLibrary.length}
                    >
                      {!audioLibrary.length && <option value="">Importez ou enregistrez un son</option>}
                      {audioLibrary.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="source-preview glass-subpanel">
                    <div>
                      <span className="card-label">Preview</span>
                      <strong>{selectedAsset ? selectedAsset.name : 'Aucune source sélectionnée'}</strong>
                    </div>
                    <div className="sheet-actions sheet-actions--tight">
                      <button type="button" className="action-button" onClick={() => selectedAsset && selectAsset(selectedAsset.id)} disabled={!selectedAsset}>
                        Écouter
                      </button>
                      <button type="button" className="action-button" onClick={stopPreview} disabled={!selectedAsset}>
                        Stop
                      </button>
                    </div>
                  </div>
                </section>

                <section className="glass-panel launch-panel">
                  <div className="panel-header">
                    <div>
                      <p className="eyebrow">3 · Diffusion</p>
                      <h2>Entrée en AR</h2>
                    </div>
                  </div>
                  <p className="panel-copy">{readiness}</p>
                  <p className="panel-copy panel-copy--muted">
                    {availabilityMessage || 'Une fois en AR, tu souffles une loop avec le téléphone puis tu ajustes la bulle en mode sticker.'}
                  </p>
                  <button type="button" className="primary-button" onClick={enterAr} disabled={!canEnterAr}>
                    {isBusy ? 'Starting…' : 'Entrer dans l’espace AR'}
                  </button>
                </section>
              </div>

              <section className="glass-panel sampler-panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">2 · Sampler / looper</p>
                    <h2>3 pads visibles, éditables, prêts à souffler</h2>
                  </div>
                  <span className="status-pill">Pad actif {selectedSetBubble?.label || '—'}</span>
                </div>

                <div className="sampler-grid">
                  {setBubbles.map((pad) => {
                    const isActive = activeSetBubbleId === pad.id;
                    const isPreviewing = previewingId === pad.id;
                    return (
                      <button
                        key={pad.id}
                        type="button"
                        className={`sampler-pad ${getPadTone(pad, isActive)}`}
                        onClick={() => setActiveSetBubbleId(pad.id)}
                      >
                        <span className="sampler-pad__corner">{pad.label}</span>
                        <strong>{pad.assetId ? 'Loop chargée' : 'Pad vide'}</strong>
                        <span className="sampler-pad__meta">{formatPadStatus(pad)}</span>
                        <span className="sampler-pad__footer">
                          {isPreviewing ? 'Preview' : pad.assetId ? 'Prêt à jouer' : 'Sélectionnez une source'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {selectedSetBubble && (
                  <div className="sampler-editor">
                    <div className="sampler-editor__head">
                      <div>
                        <span className="card-label">Pad sélectionné</span>
                        <h3>{selectedSetBubble.label}</h3>
                      </div>
                      <div className="sheet-actions sheet-actions--tight">
                        <button
                          type="button"
                          className="action-button action-button--primary-ghost"
                          onClick={() => playSetBubblePreview(selectedSetBubble.id)}
                          disabled={!selectedSetBubble.assetId}
                        >
                          Preview loop
                        </button>
                        <button type="button" className="action-button" onClick={stopPreview}>
                          Stop
                        </button>
                      </div>
                    </div>

                    <div className="sampler-editor__grid">
                      <label className="field-stack">
                        <span className="card-label">Source assignée</span>
                        <select
                          value={selectedSetBubble.assetId}
                          onChange={(event) => updateSetBubble(selectedSetBubble.id, { assetId: event.target.value })}
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

                      <label className="field-stack">
                        <span className="card-label">Sync / quantize</span>
                        <select
                          value={selectedSetBubble.syncMode}
                          onChange={(event) => updateSetBubble(selectedSetBubble.id, { syncMode: event.target.value })}
                        >
                          <option value="Auto">Auto</option>
                          <option value="Quantize 1 bar">Quantize 1 bar</option>
                          <option value="Quantize 2 bars">Quantize 2 bars</option>
                        </select>
                      </label>

                      <label className="field-stack">
                        <span className="card-label">Longueur de loop</span>
                        <select
                          value={selectedSetBubble.loopBars}
                          onChange={(event) => updateSetBubble(selectedSetBubble.id, { loopBars: Number(event.target.value) })}
                        >
                          <option value="1">1 mesure</option>
                          <option value="2">2 mesures</option>
                          <option value="4">4 mesures</option>
                          <option value="8">8 mesures</option>
                        </select>
                      </label>
                    </div>

                    <div className="mixer-grid">
                      <label className="slider-card">
                        <span className="card-label">Tempo cible</span>
                        <strong>{selectedSetBubble.tempo} BPM</strong>
                        <input
                          type="range"
                          min="70"
                          max="160"
                          step="1"
                          value={selectedSetBubble.tempo}
                          onChange={(event) => updateSetBubble(selectedSetBubble.id, { tempo: Number(event.target.value) })}
                        />
                      </label>

                      <label className="slider-card">
                        <span className="card-label">Volume au souffle</span>
                        <strong>{selectedSetBubble.volume}%</strong>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={selectedSetBubble.volume}
                          onChange={(event) => updateSetBubble(selectedSetBubble.id, { volume: Number(event.target.value) })}
                        />
                      </label>

                      <label className="slider-card">
                        <span className="card-label">Portée spatiale</span>
                        <strong>{selectedSetBubble.range} m</strong>
                        <input
                          type="range"
                          min="2"
                          max="18"
                          step="1"
                          value={selectedSetBubble.range}
                          onChange={(event) => updateSetBubble(selectedSetBubble.id, { range: Number(event.target.value) })}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </section>
            </section>
          </main>
        ) : (
          <main className="ar-shell">
            <section className="glass-panel ar-control-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Session AR</p>
                  <h2>{isBlowerMode ? 'Mode souffleur' : 'Mode sticker'}</h2>
                </div>
                <span className="status-pill">{bubbleCount}/8 bulles live</span>
              </div>

              <div className="mode-switch">
                <button
                  type="button"
                  className={`mode-switch__button ${isBlowerMode ? 'is-selected' : ''}`}
                  onClick={() => setInteractionMode('blower')}
                >
                  Souffleur
                </button>
                <button
                  type="button"
                  className={`mode-switch__button ${!isBlowerMode ? 'is-selected' : ''}`}
                  onClick={() => setInteractionMode('sticker')}
                >
                  Sticker
                </button>
              </div>

              <div className="glass-subpanel ar-active-pad">
                <div>
                  <span className="card-label">Pad prêt</span>
                  <strong>{selectedSetBubble ? selectedSetBubble.label : 'Sélectionnez un pad'}</strong>
                  <p>{selectedSetBubble ? formatPadStatus(selectedSetBubble) : 'Revenez sur le sampleur pour assigner une source.'}</p>
                </div>
                <div className="sheet-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={armPlacement}
                    disabled={!selectedSetBubble || !selectedSetBubble.assetId || interactionMode !== 'blower'}
                  >
                    {isPlacementArmed ? 'Souffleur armé' : 'Souffler cette loop'}
                  </button>
                  {isPlacementArmed && (
                    <button type="button" className="action-button" onClick={cancelPlacement}>
                      Annuler
                    </button>
                  )}
                </div>
              </div>

              <button type="button" className="action-button action-button--wide" onClick={enterAr}>
                Quitter AR
              </button>
            </section>

            <section className="glass-panel ar-bubbles-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Bulles placées</p>
                  <h2>Édition live</h2>
                </div>
                <button type="button" className="action-button action-button--danger" onClick={() => clearAllBubbles(true)}>
                  Tout vider
                </button>
              </div>

              <p className="panel-copy">{readiness}</p>

              <div className="bubble-chip-list">
                {placedBubbles.map((bubble) => (
                  <button
                    key={bubble.id}
                    type="button"
                    className={`bubble-chip ${selectedPlacedBubbleId === bubble.id ? 'is-selected' : ''}`}
                    onClick={() => setSelectedPlacedBubbleId(bubble.id)}
                  >
                    <strong>{bubble.label}</strong>
                    <span>{bubble.assetName}</span>
                  </button>
                ))}
              </div>

              {selectedPlacedBubble ? (
                <div className="editor-panel">
                  <div className="panel-header panel-header--compact">
                    <div>
                      <span className="card-label">Bulle sélectionnée</span>
                      <strong>{selectedPlacedBubble.label}</strong>
                    </div>
                    <span className="status-pill">{selectedPlacedBubble.isPlaying ? 'Live' : 'Pause'}</span>
                  </div>

                  <div className="mixer-grid mixer-grid--compact">
                    <label className="slider-card">
                      <span className="card-label">Volume</span>
                      <strong>{selectedPlacedBubble.volume}%</strong>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={selectedPlacedBubble.volume}
                        onChange={(event) => updatePlacedBubble(selectedPlacedBubble.id, { volume: Number(event.target.value) })}
                      />
                    </label>

                    <label className="slider-card">
                      <span className="card-label">Portée</span>
                      <strong>{selectedPlacedBubble.range} m</strong>
                      <input
                        type="range"
                        min="2"
                        max="18"
                        step="1"
                        value={selectedPlacedBubble.range}
                        onChange={(event) => updatePlacedBubble(selectedPlacedBubble.id, { range: Number(event.target.value) })}
                      />
                    </label>
                  </div>

                  <button type="button" className="action-button" onClick={() => togglePlacedBubbleAudio(selectedPlacedBubble.id)}>
                    {selectedPlacedBubble.isPlaying ? 'Mettre en pause' : 'Relancer la loop'}
                  </button>
                </div>
              ) : (
                <div className="empty-state">Soufflez une première bulle pour ouvrir l’édition sticker.</div>
              )}
            </section>
          </main>
        )}

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
        multiple
        onChange={handleFileChange}
      />
    </div>
  );
}

export default App;
