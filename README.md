# Montage Vidéo

Un logiciel de montage vidéo **simple et gratuit pour Windows**, pensé pour les débutants.

Il est conçu d'abord pour réaliser un **clip musical** à partir de courts clips vidéo (par exemple générés par une IA comme LTX-2) : on importe les clips et la chanson, on range et raccourcit les clips, on coupe leur son d'origine, puis on exporte un MP4.

## Ce que sait faire la version 1

- **Importer** des vidéos (MP4, MOV, MKV, WEBM…) et une chanson (MP3, WAV, M4A…), avec le bouton « Importer » ou en glissant les fichiers dans la fenêtre. Les vidéos vont dans la bibliothèque ; c'est toi qui les poses sur la timeline, dans l'ordre que tu veux, en les y faisant glisser (ou par double-clic pour les ajouter à la fin).
- **Couper le son des clips** : coché par défaut quand on pose un clip sur la timeline, réglable clip par clip ou pour tous les clips d'un coup.
- **Timeline** avec une piste vidéo et une piste musique :
  - ranger les clips en les faisant glisser ;
  - les raccourcir en tirant sur leurs bords ;
  - les couper en deux à la position du curseur (« Couper ici » ou touche <kbd>S</kbd>) ;
  - les dupliquer ou les supprimer.
- **Aperçu** en direct, avec lecture/pause et déplacement image par image.
- **Musique** : volume, fondu au début et fondu à la fin.
- **Export MP4** en 720p ou 1080p, en paysage, portrait ou carré, à 24, 25, 30 ou 60 images par seconde. Les clips d'un format différent sont centrés avec des bandes noires.
- **Annuler / Rétablir** (<kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd>).
- **Enregistrer le projet** (fichier `.montage`) pour le rouvrir plus tard.

Prévu ensuite : forme d'onde de la chanson, marqueurs de rythme avec aimantation des coupes, transitions (fondu enchaîné, fondu au noir), vitesse des clips, zoom lent.

## Installer le logiciel sous Windows

1. Ouvre l'onglet **Actions** du dépôt GitHub, puis le dernier passage réussi (coche verte) de « Installateur Windows ».
   Quand une version officielle existe, elle est aussi dans l'onglet **Releases**.
2. En bas de la page, dans **Artifacts**, télécharge `installateur-windows` (un fichier ZIP) et décompresse-le.
3. Lance `Montage Vidéo_x.y.z_x64-setup.exe`.
   Windows peut afficher « Windows a protégé votre ordinateur », car le logiciel n'est pas signé par un éditeur payant : clique sur **Informations complémentaires**, puis **Exécuter quand même**.
4. Le logiciel apparaît dans le menu Démarrer sous le nom **Montage Vidéo**.

L'installateur contient déjà **FFmpeg**, l'outil qui lit et fabrique les vidéos : il n'y a rien d'autre à installer.

## Pour les développeurs

Le logiciel utilise [Tauri 2](https://tauri.app) : l'interface est une page web (React + TypeScript, dossier `src/`) et la partie système est écrite en Rust (dossier `src-tauri/`). Le traitement vidéo est confié à [FFmpeg](https://ffmpeg.org).

### Organisation du code

| Fichier | Rôle |
| --- | --- |
| `src/model/project.ts` | Les données du montage et toutes les opérations (rogner, couper, déplacer…) |
| `src/state/history.ts` | Annuler / Rétablir |
| `src/components/` | Les zones de l'écran : bibliothèque, aperçu, timeline, réglages, export |
| `src/lib/backend.ts` | Les appels vers la partie Rust |
| `src-tauri/src/ffmpeg.rs` | Lecture des fichiers et construction de la commande d'export FFmpeg |
| `src-tauri/src/lib.rs` | Les commandes appelées par l'interface |

### Lancer en mode développement

Prérequis : [Node.js](https://nodejs.org) 22, [Rust](https://rustup.rs), les [prérequis Tauri](https://tauri.app/start/prerequisites/) et FFmpeg dans le PATH (`winget install Gyan.FFmpeg`).

```bash
npm install
npm run tauri dev     # lance le logiciel
npm test              # tests de l'interface
cd src-tauri && cargo test -- --include-ignored   # tests Rust, dont un vrai export
```

## Licences

Le code de ce logiciel est publié sous licence MIT (voir [LICENSE](LICENSE)).

L'installateur Windows inclut FFmpeg (build de [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)), distribué sous licence GPL ; son texte de licence est installé à côté de `ffmpeg.exe`. Le code source de FFmpeg est disponible sur [ffmpeg.org](https://ffmpeg.org/download.html).
