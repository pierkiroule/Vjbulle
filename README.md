# VJ Bulle Loopscape

Refonte du concept AR audio autour d’un instrument simple :

1. le user capture un son depuis son téléphone (import ou prise micro) ;
2. il le cale sur un des 3 pads du sampler / looper ;
3. il souffle cette loop dans l’espace réel via la caméra du téléphone ;
4. il repasse en mode sticker pour réajuster volume et portée des bulles déjà posées.

## Scripts

```bash
npm install
npm run dev
npm run build
```

## Flow UX retenu

- **Un seul écran de préparation** : plus de validation/sauvegarde intermédiaire du set ; un pad devient utilisable dès qu’une source lui est affectée.
- **3 pads maximum** : limite volontaire pour conserver un flow live lisible et mobile-first.
- **Deux modes AR clairs** :
  - `Souffleur` pour créer une bulle de loop à la position du téléphone ;
  - `Sticker` pour retoucher les propriétés d’une bulle déjà placée.
- **Capture voix intégrée** : enregistrement micro navigateur pour créer rapidement une source sans sortir du flow.
- **Bubble landscape conservé** : rendu spatial WebXR/Web Audio avec `three` et bulles flottantes repositionnables conceptuellement via le panneau sticker.
