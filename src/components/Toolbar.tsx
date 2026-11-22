/** Barre d'outils du haut : les actions principales, avec leur raccourci. */

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  canExport: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onImport: () => void;
  onExport: () => void;
}

export function Toolbar(p: Props) {
  return (
    <header className="toolbar">
      <div className="group">
        <button onClick={p.onNew} title="Nouveau projet">Nouveau</button>
        <button onClick={p.onOpen} title="Ouvrir un projet (Ctrl+O)">Ouvrir</button>
        <button onClick={p.onSave} title="Enregistrer le projet (Ctrl+S)">Enregistrer</button>
      </div>
      <div className="group">
        <button onClick={p.onUndo} disabled={!p.canUndo} title="Annuler (Ctrl+Z)">↶ Annuler</button>
        <button onClick={p.onRedo} disabled={!p.canRedo} title="Rétablir (Ctrl+Y)">↷ Rétablir</button>
      </div>
      <div className="spacer" />
      <button className="primary" onClick={p.onImport} title="Importer des vidéos ou une chanson (Ctrl+I)">
        ＋ Importer
      </button>
      <button className="accent" onClick={p.onExport} disabled={!p.canExport} title="Exporter en MP4 (Ctrl+E)">
        Exporter la vidéo
      </button>
    </header>
  );
}
