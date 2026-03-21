import { useRef } from 'react';
import { useEchoBubbleLoop } from './hooks/useEchoBubbleLoop';

function formatPadStatus(pad) {
  if (!pad.assetId) {
    return 'Source à connecter';
  }

  return `Loop ${pad.loopBars} mesures · ${pad.volume}% · portée ${pad.range} m`;
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
    isHudVisible,
    isMenuOpen,
    isBusy,
    isPlacementArmed,
    previewingId,
    readiness,
    interactionMode,
    isRecordingMic,
    enterAr,
    importAudioFiles,
    selectAsset,
    addSetBubble,
    updateSetBubble,
    removeSetBubble,
    setActiveSetBubbleId,
    playSetBubblePreview,
    stopPreview,
    togglePlacedBubbleAudio,
    armPlacement,
    cancelPlacement,
    setInteractionMode,
    updatePlacedBubble,
    setSelectedPlacedBubbleId,
    toggleMenu,
    dismissMenu,
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
  const selectedPlacedBubbleLabel = selectedPlacedBubble ? selectedPlacedBubble.label : 'Aucune bulle sélectionnée';
  const isBlowerMode = interactionMode === 'blower';

  return (
    <div className="app-shell" onPointerDown={pingHud}>
      <div ref={sceneHostRef} className="scene-host" aria-hidden="true" />

      <div ref={overlayRootRef} className={`overlay-root ${isSessionActive ? 'is-ar' : ''}`}>
        {!isSessionActive && (
          <section className="hero-copy-block hero-copy-block--story">
            <div className="eyebrow">AR looper bubble instrument</div>
            <h1>VJ Bulle Loopscape</h1>
            <p>
              Le flow tient maintenant en 3 gestes : capturer un son, le caler sur un pad looper,
              puis le souffler dans l&apos;espace réel avec la caméra du téléphone.
            </p>
            <div className="hero-pills">
              <span>3 pads max</span>
              <span>Mode éditeur avant AR</span>
              <span>Souffleur + sticker en AR</span>
            </div>
          </section>
        )}

        <div className={`bottom-dock ${isHudVisible ? 'is-visible' : 'is-dimmed'}`}>
          <button type="button" className="dock-handle" onClick={toggleMenu}>
            <span className="dock-handle__meta">{isSessionActive ? 'Session AR' : 'Préparation'}</span>
            <strong>
              {isSessionActive
                ? isBlowerMode
                  ? isPlacementArmed
                    ? 'Souffleur armé · touchez la scène'
                    : 'Mode souffleur'
                  : 'Mode sticker'
                : `${readyPadCount}/3 pads prêts à souffler`}
            </strong>
          </button>
        </div>

        <aside className={`bottom-sheet ${isMenuOpen ? 'is-open' : ''}`}>
          <div className="bottom-sheet__scrim" onClick={dismissMenu} />
          <div className="bottom-sheet__panel">
            <div className="bottom-sheet__handle" />

            <div className="sheet-header">
              <div>
                <p className="sheet-kicker">{isSessionActive ? 'Contrôle live' : 'Préparation rapide'}</p>
                <h2>{isSessionActive ? 'Looper spatial' : 'Éditeur de pads'}</h2>
              </div>
            </div>

            <div className="sheet-scroll">
              <section className="sheet-card sheet-card--status">
                <span className="card-label">Flow courant</span>
                <strong>{readiness}</strong>
                <p>{availabilityMessage || 'Conservez un seul panneau, des actions directes et un chemin clair jusqu’au souffle.'}</p>
              </section>

              {!isSessionActive && (
                <>
                  <section className="sheet-card sheet-card--step">
                    <div className="card-row card-row--start">
                      <div>
                        <span className="card-label">Étape 1 · Capturer une source</span>
                        <strong>Importer un son ou enregistrer la voix</strong>
                      </div>
                      <span className="step-badge">Bibliothèque {audioLibrary.length}</span>
                    </div>
                    <div className="sheet-actions">
                      <button type="button" className="action-button" onClick={openFilePicker}>
                        Importer depuis le tel
                      </button>
                      <button
                        type="button"
                        className={`action-button ${isRecordingMic ? 'action-button--danger' : 'action-button--primary-ghost'}`}
                        onClick={toggleMicRecording}
                      >
                        {isRecordingMic ? 'Stop record voix' : 'Record voix mic'}
                      </button>
                      {selectedAsset && (
                        <button type="button" className="action-button" onClick={stopPreview}>
                          Stop preview
                        </button>
                      )}
                    </div>
                    <select
                      value={selectedAssetId}
                      onChange={(event) => selectAsset(event.target.value)}
                      disabled={!audioLibrary.length}
                    >
                      {!audioLibrary.length && <option value="">Ajoutez d&apos;abord une source audio</option>}
                      {audioLibrary.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                    </select>
                    <p>
                      {selectedAsset
                        ? `Source active : ${selectedAsset.name}. Affectez-la à un pad pour la caler avant diffusion.`
                        : 'Une seule librairie source, pas de détour : vous choisissez un son puis vous l’envoyez sur un pad.'}
                    </p>
                  </section>

                  <section className="sheet-card sheet-card--step">
                    <div className="card-row card-row--start">
                      <div>
                        <span className="card-label">Étape 2 · Sampler / looper</span>
                        <strong>3 pads maximum pour garder le set lisible</strong>
                      </div>
                      <span className="step-badge">{readyPadCount}/3 prêts</span>
                    </div>
                    <div className="sheet-actions">
                      <button
                        type="button"
                        className="action-button action-button--primary-ghost"
                        onClick={addSetBubble}
                        disabled={setBubbles.length >= 3}
                      >
                        Ajouter un pad
                      </button>
                    </div>
                    <p>
                      Chaque pad correspond à une loop soufflable. On retire l’étape de validation pour éviter la friction :
                      dès qu’un pad a une source, il est prêt.
                    </p>
                  </section>

                  {setBubbles.map((bubble) => {
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
                          <strong>{formatPadStatus(bubble)}</strong>
                        </div>

                        <label className="field-stack">
                          <span className="card-label">Source du pad</span>
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

                        <div className="range-grid range-grid--triple">
                          <label className="field-stack">
                            <span className="card-label">Sync</span>
                            <select value={bubble.syncMode} onChange={(event) => updateSetBubble(bubble.id, { syncMode: event.target.value })}>
                              <option value="Auto">Auto</option>
                              <option value="Quantize 1 bar">Quantize 1 bar</option>
                              <option value="Quantize 2 bars">Quantize 2 bars</option>
                            </select>
                          </label>

                          <label className="field-stack">
                            <span className="card-label">Longueur</span>
                            <select value={bubble.loopBars} onChange={(event) => updateSetBubble(bubble.id, { loopBars: Number(event.target.value) })}>
                              <option value="1">1 mesure</option>
                              <option value="2">2 mesures</option>
                              <option value="4">4 mesures</option>
                              <option value="8">8 mesures</option>
                            </select>
                          </label>

                          <label className="field-stack">
                            <span className="card-label">Tempo cible</span>
                            <input
                              type="range"
                              min="70"
                              max="160"
                              step="1"
                              value={bubble.tempo}
                              onChange={(event) => updateSetBubble(bubble.id, { tempo: Number(event.target.value) })}
                            />
                            <span className="inline-value">{bubble.tempo} BPM</span>
                          </label>
                        </div>

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
                            <span className="card-label">Volume · {bubble.volume}%</span>
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
                            {isPreviewing ? 'Preview en cours' : 'Preview'}
                          </button>
                          <button type="button" className="action-button action-button--danger" onClick={() => removeSetBubble(bubble.id)}>
                            Supprimer le pad
                          </button>
                        </div>
                      </section>
                    );
                  })}
                </>
              )}

              {isSessionActive && (
                <>
                  <section className="sheet-card sheet-card--step">
                    <div className="card-row card-row--start">
                      <div>
                        <span className="card-label">Étape 3 · Diffusion spatiale</span>
                        <strong>{isBlowerMode ? 'Souffleur' : 'Sticker'}</strong>
                      </div>
                      <span className="step-badge">{bubbleCount}/8 bulles live</span>
                    </div>
                    <div className="sheet-actions">
                      <button
                        type="button"
                        className={`action-button ${isBlowerMode ? 'action-button--primary-ghost' : ''}`}
                        onClick={() => setInteractionMode('blower')}
                      >
                        Mode souffleur
                      </button>
                      <button
                        type="button"
                        className={`action-button ${!isBlowerMode ? 'action-button--primary-ghost' : ''}`}
                        onClick={() => setInteractionMode('sticker')}
                      >
                        Mode sticker
                      </button>
                    </div>
                    <p>
                      Le mode souffleur crée une bulle à la position du téléphone. Le mode sticker sert à réviser les bulles
                      déjà placées sans casser le flow de jeu.
                    </p>
                  </section>

                  <section className="sheet-card">
                    <div className="card-row card-row--start">
                      <div>
                        <span className="card-label">Pad actif à souffler</span>
                        <strong>{selectedSetBubble ? selectedSetBubble.label : 'Sélectionnez un pad'}</strong>
                      </div>
                      <span className="step-badge">{selectedSetBubble?.assetId ? 'Prêt' : 'Incomplet'}</span>
                    </div>
                    <p>
                      {selectedSetBubble
                        ? `${formatPadStatus(selectedSetBubble)} · ${selectedSetBubble.syncMode}.`
                        : 'Revenez sur un pad configuré pour le souffler dans la scène.'}
                    </p>
                    <div className="sheet-actions">
                      <button
                        type="button"
                        className="action-button action-button--primary-ghost"
                        onClick={armPlacement}
                        disabled={!selectedSetBubble || interactionMode !== 'blower' || !selectedSetBubble.assetId}
                      >
                        {isPlacementArmed ? 'Souffle prêt' : 'Armer le souffleur'}
                      </button>
                      {isPlacementArmed && (
                        <button type="button" className="action-button" onClick={cancelPlacement}>
                          Annuler
                        </button>
                      )}
                    </div>
                  </section>

                  {bubbleCount > 0 && (
                    <section className="sheet-card">
                      <div className="card-row card-row--start">
                        <div>
                          <span className="card-label">Bulles posées</span>
                          <strong>{selectedPlacedBubbleLabel}</strong>
                        </div>
                        <button type="button" className="action-button action-button--danger action-button--small" onClick={() => clearAllBubbles(true)}>
                          Tout vider
                        </button>
                      </div>

                      <div className="bubble-list">
                        {placedBubbles.map((bubble) => (
                          <button
                            key={bubble.id}
                            type="button"
                            className={`bubble-list__item bubble-list__item--button ${selectedPlacedBubbleId === bubble.id ? 'is-selected' : ''}`}
                            onClick={() => setSelectedPlacedBubbleId(bubble.id)}
                          >
                            <div>
                              <strong>{bubble.label}</strong>
                              <p>{bubble.assetName} · {bubble.range} m · {bubble.volume}%</p>
                            </div>
                            <span className="pill-state">{bubble.isPlaying ? 'Live' : 'Pause'}</span>
                          </button>
                        ))}
                      </div>

                      {selectedPlacedBubble && (
                        <div className="editor-panel">
                          <div className="range-grid">
                            <label className="field-stack">
                              <span className="card-label">Volume bubble · {selectedPlacedBubble.volume}%</span>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={selectedPlacedBubble.volume}
                                onChange={(event) => updatePlacedBubble(selectedPlacedBubble.id, { volume: Number(event.target.value) })}
                              />
                            </label>

                            <label className="field-stack">
                              <span className="card-label">Portée bubble · {selectedPlacedBubble.range} m</span>
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

                          <div className="sheet-actions sheet-actions--tight">
                            <button type="button" className="action-button" onClick={() => togglePlacedBubbleAudio(selectedPlacedBubble.id)}>
                              {selectedPlacedBubble.isPlaying ? 'Pause audio' : 'Relancer audio'}
                            </button>
                          </div>
                        </div>
                      )}
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
                {isBusy ? 'Starting…' : isSessionActive ? 'Quitter AR' : 'Entrer dans l’espace AR'}
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
        accept="audio/*,.mp3,.wav,.m4a"
        multiple
        onChange={handleFileChange}
      />
    </div>
  );
}

export default App;
