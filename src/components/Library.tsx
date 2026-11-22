/**
 * Bibliothèque : la liste des fichiers importés.
 * Un double-clic (ou le bouton « + ») ajoute une vidéo à la fin de la timeline.
 */

import type { Editor } from "../App";
import { formatTime, insertClip, removeMedia, setMusic, type MediaItem } from "../model/project";
import { Thumb } from "./Thumb";

interface Props {
  editor: Editor;
  onImport: () => void;
}

export function Library({ editor, onImport }: Props) {
  const { project, apply } = editor;

  const use = (m: MediaItem) => {
    if (m.kind === "video") apply((p) => insertClip(p, m));
    else {
      apply((p) => setMusic(p, m.id));
      editor.select({ kind: "music" });
    }
  };

  return (
    <aside className="panel library">
      <h2>Bibliothèque</h2>
      {project.media.length === 0 ? (
        <div className="empty-state">
          <p>Commence par importer tes clips vidéo et ta chanson.</p>
          <button className="primary" onClick={onImport}>＋ Importer des fichiers</button>
          <p className="hint">Tu peux aussi glisser des fichiers depuis l'Explorateur Windows.</p>
        </div>
      ) : (
        <ul className="media-list">
          {project.media.map((m) => {
            const used =
              m.kind === "video"
                ? project.clips.filter((c) => c.mediaId === m.id).length
                : project.music?.mediaId === m.id
                  ? 1
                  : 0;
            return (
              <li
                key={m.id}
                onDoubleClick={() => use(m)}
                title={`${m.path}${m.width ? `\n${m.width}×${m.height}` : ""}${m.fps ? `, ${Math.round(m.fps * 100) / 100} images/s` : ""}`}
              >
                {m.kind === "video" ? <Thumb path={m.path} /> : <div className="thumb audio">♪</div>}
                <div className="media-info">
                  <span className="name">{m.name}</span>
                  <span className="meta">
                    {formatTime(m.duration)}
                    {m.kind === "video" && m.hasAudio ? " · avec son" : ""}
                  </span>
                  {used > 0 && (
                    <span className="meta used">
                      {m.kind === "video" ? `✓ sur la timeline${used > 1 ? ` (${used}×)` : ""}` : "✓ musique"}
                    </span>
                  )}
                </div>
                <div className="media-actions">
                  <button
                    onClick={() => use(m)}
                    title={m.kind === "video" ? "Ajouter à la fin de la timeline" : "Utiliser comme musique"}
                  >
                    ＋
                  </button>
                  <button
                    className="ghost"
                    onClick={() => apply((p) => removeMedia(p, m.id))}
                    title="Retirer de la bibliothèque (et de la timeline)"
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <label className="check" title="Les clips générés par IA ont souvent leur propre son : il est coupé à l'import.">
        <input
          type="checkbox"
          checked={project.muteOnImport}
          onChange={(e) => {
            const muteOnImport = e.target.checked;
            apply((p) => ({ ...p, muteOnImport }));
          }}
        />
        Couper le son des clips à l'import
      </label>
    </aside>
  );
}
