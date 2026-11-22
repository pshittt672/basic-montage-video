/**
 * Panneau de droite : les réglages de ce qui est sélectionné
 * (un clip ou la musique), ou une aide rapide si rien ne l'est.
 */

import type { Editor } from "../App";
import {
  clipDuration,
  duplicateClip,
  formatTime,
  getMedia,
  removeClip,
  removeMusic,
  setClipMuted,
  setClipSpeed,
  setClipTransition,
  setClipZoom,
  SPEEDS,
  totalDuration,
  trimClip,
  updateMusic,
} from "../model/project";

interface Props {
  editor: Editor;
  onSplit: () => void;
}

/** Curseur + valeur, qui ne compte qu'une étape d'annulation par geste. */
function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  gesture: Editor["gesture"];
}) {
  const shown = props.format ? props.format(props.value) : props.value.toFixed(1);
  return (
    <label className="slider">
      <span>
        {props.label} <strong>{shown}{props.unit}</strong>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onPointerDown={props.gesture.start}
        onPointerUp={props.gesture.end}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Inspector({ editor, onSplit }: Props) {
  const { project, apply, gesture, selection } = editor;

  if (selection?.kind === "clip") {
    const clip = project.clips.find((c) => c.id === selection.id);
    const media = clip && getMedia(project, clip.mediaId);
    if (!clip || !media) return <aside className="panel inspector" />;
    const isLast = project.clips[project.clips.length - 1]?.id === clip.id;
    const trim = (change: { inPoint?: number; outPoint?: number }) =>
      gesture.update((p) => trimClip(p, clip.id, change));
    return (
      <aside className="panel inspector">
        <h2>Clip sélectionné</h2>
        <p className="name" title={media.path}>{media.name}</p>
        <p className="meta">
          Durée sur la timeline : <strong>{formatTime(clipDuration(clip))}</strong> (vidéo de {formatTime(media.duration)})
        </p>
        <Slider
          label="Début"
          value={clip.inPoint}
          min={0}
          max={media.duration}
          step={0.04}
          unit=" s"
          onChange={(v) => trim({ inPoint: v })}
          gesture={gesture}
        />
        <Slider
          label="Fin"
          value={clip.outPoint}
          min={0}
          max={media.duration}
          step={0.04}
          unit=" s"
          onChange={(v) => trim({ outPoint: v })}
          gesture={gesture}
        />
        {media.hasAudio ? (
          <label className="check">
            <input
              type="checkbox"
              checked={clip.muted}
              onChange={(e) => {
                const muted = e.target.checked;
                apply((p) => setClipMuted(p, clip.id, muted));
              }}
            />
            Couper le son de ce clip (M)
          </label>
        ) : (
          <p className="meta">Ce clip n'a pas de son.</p>
        )}
        <div className="buttons">
          <button onClick={onSplit} title="Couper en deux à la position du curseur (S)">✂ Couper ici</button>
          <button onClick={() => apply((p) => duplicateClip(p, clip.id))}>Dupliquer</button>
          <button className="danger" onClick={() => apply((p) => removeClip(p, clip.id))}>Supprimer</button>
        </div>

        <details className="more" open={clip.speed !== 1 || clip.zoom !== "none" || !!clip.transition}>
          <summary>Effets : vitesse, zoom, transition</summary>
          <label>
            Vitesse
            <select
              value={clip.speed}
              onChange={(e) => {
                const speed = Number(e.target.value);
                apply((p) => setClipSpeed(p, clip.id, speed));
              }}
            >
              {SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {v === 1 ? "Normale" : v < 1 ? `Ralenti ×${v}` : `Accéléré ×${v}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Zoom lent
            <select
              value={clip.zoom}
              onChange={(e) => {
                const zoom = e.target.value as typeof clip.zoom;
                apply((p) => setClipZoom(p, clip.id, zoom));
              }}
            >
              <option value="none">Aucun</option>
              <option value="in">On s'approche (zoom avant)</option>
              <option value="out">On s'éloigne (zoom arrière)</option>
            </select>
          </label>
          {isLast ? (
            <p className="hint">Dernier clip : pas de transition après lui.</p>
          ) : (
            <>
              <label>
                Transition vers le clip suivant
                <select
                  value={clip.transition?.kind ?? "none"}
                  onChange={(e) => {
                    const v = e.target.value;
                    const transition =
                      v === "none" ? null : { kind: v as "crossfade" | "black", duration: clip.transition?.duration ?? 1 };
                    apply((p) => setClipTransition(p, clip.id, transition));
                  }}
                >
                  <option value="none">Aucune (coupe franche)</option>
                  <option value="crossfade">Fondu enchaîné</option>
                  <option value="black">Fondu au noir</option>
                </select>
              </label>
              {clip.transition && (
                <Slider
                  label="Durée de la transition"
                  value={clip.transition.duration}
                  min={0.2}
                  max={3}
                  step={0.1}
                  unit=" s"
                  onChange={(duration) =>
                    gesture.update((p) => setClipTransition(p, clip.id, { ...clip.transition!, duration }))
                  }
                  gesture={gesture}
                />
              )}
            </>
          )}
        </details>
      </aside>
    );
  }

  if (selection?.kind === "music" && project.music) {
    const music = project.music;
    const media = getMedia(project, music.mediaId);
    const set = (change: Parameters<typeof updateMusic>[1]) => gesture.update((p) => updateMusic(p, change));
    return (
      <aside className="panel inspector">
        <h2>Musique</h2>
        <p className="name" title={media?.path}>{media?.name}</p>
        <Slider
          label="Commence à"
          value={music.start}
          min={0}
          max={Math.max(totalDuration(project), music.start, 1)}
          step={0.04}
          unit=""
          format={formatTime}
          onChange={(start) => set({ start })}
          gesture={gesture}
        />
        <p className="hint">Tu peux aussi faire glisser la chanson sur la timeline : elle s'aimante au début des clips.</p>
        <Slider
          label="Volume"
          value={music.volume}
          min={0}
          max={1}
          step={0.01}
          unit=" %"
          format={(v) => String(Math.round(v * 100))}
          onChange={(volume) => set({ volume })}
          gesture={gesture}
        />
        <Slider
          label="Fondu au début"
          value={music.fadeIn}
          min={0}
          max={10}
          step={0.5}
          unit=" s"
          onChange={(fadeIn) => set({ fadeIn })}
          gesture={gesture}
        />
        <Slider
          label="Fondu à la fin"
          value={music.fadeOut}
          min={0}
          max={10}
          step={0.5}
          unit=" s"
          onChange={(fadeOut) => set({ fadeOut })}
          gesture={gesture}
        />
        <p className="hint">La chanson s'arrête avec la dernière image du montage ; le fondu de fin s'applique à ce moment-là.</p>
        <div className="buttons">
          <button className="danger" onClick={() => apply(removeMusic)}>Retirer la musique</button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel inspector help">
      <h2>Comment faire ?</h2>
      <ol>
        <li><strong>Importe</strong> tes clips vidéo et ta chanson.</li>
        <li><strong>Pose</strong> les clips sur la timeline en les faisant glisser depuis la bibliothèque, dans l'ordre que tu veux. Tu peux ensuite les déplacer.</li>
        <li><strong>Raccourcis</strong> un clip en tirant sur ses bords, ou coupe-le en deux avec « Couper ici ».</li>
        <li><strong>Pose la chanson</strong> sur la piste musique, à l'endroit où elle doit commencer, puis clique dessus pour régler le <strong>volume</strong> et les <strong>fondus</strong>.</li>
        <li><strong>Exporte</strong> ta vidéo en MP4.</li>
      </ol>
      <h3>Raccourcis clavier</h3>
      <ul className="keys">
        <li><kbd>Espace</kbd> lecture / pause</li>
        <li><kbd>S</kbd> couper ici</li>
        <li><kbd>B</kbd> marquer un temps fort (rythme)</li>
        <li><kbd>Suppr</kbd> supprimer le clip</li>
        <li><kbd>M</kbd> couper / remettre le son du clip</li>
        <li><kbd>←</kbd> <kbd>→</kbd> image par image (<kbd>Maj</kbd> : 1 s)</li>
        <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> annuler / rétablir</li>
        <li><kbd>Ctrl</kbd>+<kbd>S</kbd> enregistrer</li>
      </ul>
    </aside>
  );
}
