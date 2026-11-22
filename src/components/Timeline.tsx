/**
 * Timeline : la piste vidéo (les clips bout à bout) et la piste musique.
 *
 * - Cliquer sur la règle ou une zone vide déplace le curseur de lecture.
 * - Cliquer sur un clip le sélectionne ; le faire glisser change sa place.
 * - Tirer sur les bords d'un clip le raccourcit (rognage).
 */

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Editor } from "../App";
import {
  clipDuration,
  clipStarts,
  getMedia,
  moveClip,
  removeClip,
  setAllMuted,
  setClipMuted,
  totalDuration,
  trimClip,
  type Clip,
} from "../model/project";
import { useThumbnail } from "./Thumb";

interface Props {
  editor: Editor;
  onSplit: () => void;
}

/** Marge à gauche de la piste, en pixels. */
const PAD = 12;

/** Choisit un pas de graduation lisible selon le zoom. */
function tickStep(pps: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120]) if (s * pps >= 70) return s;
  return 300;
}

function label(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.round(t - m * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Timeline({ editor, onSplit }: Props) {
  const { project, apply, gesture, selection, select, time, seek, playing } = editor;
  const scroller = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(40); // pixels par seconde (zoom)
  const [drag, setDrag] = useState<{ id: string; x: number; target: number } | null>(null);
  const fitted = useRef(false);

  const total = totalDuration(project);
  const starts = clipStarts(project);
  const musicMedia = project.music ? getMedia(project, project.music.mediaId) : undefined;
  const length = Math.max(total, musicMedia?.duration ?? 0, 10);
  const width = PAD * 2 + length * pps + 200;
  const selectedClip =
    selection?.kind === "clip" ? project.clips.find((c) => c.id === selection.id) : undefined;
  const allMuted = project.clips.length > 0 && project.clips.every((c) => c.muted);

  const fit = () => {
    const w = scroller.current?.clientWidth ?? 800;
    const len = Math.max(total, 5);
    setPps(Math.max(2, Math.min(200, (w - PAD * 2 - 40) / len)));
  };

  // Au premier import, on ajuste le zoom pour tout voir.
  useLayoutEffect(() => {
    if (!fitted.current && total > 0) {
      fitted.current = true;
      fit();
    }
    if (total === 0) fitted.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  // Pendant la lecture, la timeline suit le curseur.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const x = PAD + time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 40;
  }, [time, pps, playing]);

  /** Convertit une position de souris en temps sur la timeline. */
  const timeAt = (clientX: number) => {
    const el = scroller.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - PAD;
    return Math.max(0, Math.min(total, x / pps));
  };

  /** Déplacer le curseur en cliquant (et en glissant) sur la règle. */
  const scrub = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => seek(timeAt(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Glisser un clip pour changer sa place. */
  const startMove = (e: ReactPointerEvent, clip: Clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select({ kind: "clip", id: clip.id });
    const x0 = e.clientX;
    let moving = false;
    let target = project.clips.findIndex((c) => c.id === clip.id);
    // Milieu des autres clips : on insère avant le premier milieu dépassé.
    const others = project.clips.filter((c) => c.id !== clip.id);
    const mids: number[] = [];
    let t = 0;
    for (const c of others) {
      mids.push(t + clipDuration(c) / 2);
      t += clipDuration(c);
    }
    const move = (ev: PointerEvent) => {
      if (!moving && Math.abs(ev.clientX - x0) < 5) return;
      moving = true;
      const at = timeAt(ev.clientX);
      target = mids.filter((m) => m < at).length;
      setDrag({ id: clip.id, x: ev.clientX - x0, target });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (moving) apply((p) => moveClip(p, clip.id, target));
      else {
        // Simple clic : on place aussi le curseur à cet endroit.
        seek(timeAt(x0));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Tirer sur un bord pour rogner le clip. */
  const startTrim = (e: ReactPointerEvent, clip: Clip, side: "in" | "out") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select({ kind: "clip", id: clip.id });
    const x0 = e.clientX;
    gesture.start();
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - x0) / pps;
      gesture.update((p) =>
        trimClip(p, clip.id, side === "in" ? { inPoint: clip.inPoint + delta } : { outPoint: clip.outPoint + delta }),
      );
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      gesture.end();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Graduations de la règle.
  const step = tickStep(pps);
  const ticks: number[] = [];
  for (let t = 0; t <= length + step; t += step) ticks.push(t);

  // Position d'insertion affichée pendant un déplacement.
  let dropX: number | null = null;
  if (drag) {
    const others = project.clips.filter((c) => c.id !== drag.id);
    dropX = PAD + others.slice(0, drag.target).reduce((s, c) => s + clipDuration(c), 0) * pps;
  }

  return (
    <section className="timeline">
      <div className="timeline-bar">
        <button onClick={onSplit} disabled={project.clips.length === 0} title="Couper le clip en deux à la position du curseur (S)">
          ✂ Couper ici
        </button>
        <button
          onClick={() => selectedClip && apply((p) => removeClip(p, selectedClip.id))}
          disabled={!selectedClip}
          title="Supprimer le clip sélectionné (Suppr)"
        >
          🗑 Supprimer
        </button>
        <button
          onClick={() => apply((p) => setAllMuted(p, !allMuted))}
          disabled={project.clips.length === 0}
          title="Couper ou remettre le son d'origine de tous les clips"
        >
          {allMuted ? "🔊 Remettre le son des clips" : "🔇 Couper le son de tous les clips"}
        </button>
        <div className="spacer" />
        <span className="zoom">
          Zoom
          <input
            type="range"
            min={Math.log(2)}
            max={Math.log(200)}
            step={0.01}
            value={Math.log(pps)}
            onChange={(e) => setPps(Math.exp(Number(e.target.value)))}
          />
        </span>
        <button onClick={fit} title="Voir tout le montage">Tout voir</button>
      </div>

      <div className="tracks-wrap">
        <div className="track-labels">
          <div className="ruler-label" />
          <div className="track-label">Vidéo</div>
          <div className="track-label music">Musique</div>
        </div>
        <div className="scroller" ref={scroller}>
          <div className="tracks" style={{ width }}>
            <div className="ruler" onPointerDown={scrub}>
              {ticks.map((t) => (
                <span key={t} className="tick" style={{ left: PAD + t * pps }}>
                  {label(t)}
                </span>
              ))}
            </div>

            <div className="track video-track" onPointerDown={scrub}>
              {project.clips.length === 0 && (
                <div className="track-empty">Les clips importés s'ajoutent ici, bout à bout.</div>
              )}
              {project.clips.map((clip, i) => (
                <ClipBlock
                  key={clip.id}
                  clip={clip}
                  path={getMedia(project, clip.mediaId)?.path}
                  name={getMedia(project, clip.mediaId)?.name ?? "?"}
                  hasAudio={getMedia(project, clip.mediaId)?.hasAudio ?? false}
                  left={PAD + starts[i] * pps + (drag?.id === clip.id ? drag.x : 0)}
                  width={clipDuration(clip) * pps}
                  selected={selection?.kind === "clip" && selection.id === clip.id}
                  dragging={drag?.id === clip.id}
                  onMoveStart={(e) => startMove(e, clip)}
                  onTrimStart={(e, side) => startTrim(e, clip, side)}
                  onToggleMute={() => apply((p) => setClipMuted(p, clip.id, !clip.muted))}
                />
              ))}
              {dropX !== null && <div className="drop-marker" style={{ left: dropX - 2 }} />}
            </div>

            <div className="track music-track" onPointerDown={scrub}>
              {musicMedia ? (
                <div
                  className={`music-block ${selection?.kind === "music" ? "selected" : ""}`}
                  style={{ left: PAD, width: musicMedia.duration * pps }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    select({ kind: "music" });
                    scrub(e);
                  }}
                >
                  <span className="clip-name">♪ {musicMedia.name}</span>
                  {musicMedia.duration > total && total > 0 && (
                    <div
                      className="unused"
                      style={{ left: total * pps }}
                      title="Cette partie de la chanson dépasse la fin de la vidéo : elle ne sera pas exportée."
                    />
                  )}
                </div>
              ) : (
                <div className="track-empty">Importe une chanson (MP3, WAV…) pour la poser sous le montage.</div>
              )}
            </div>

            <div className="playhead" style={{ left: PAD + time * pps }} />
          </div>
        </div>
      </div>
    </section>
  );
}

interface ClipProps {
  clip: Clip;
  path?: string;
  name: string;
  hasAudio: boolean;
  left: number;
  width: number;
  selected: boolean;
  dragging: boolean;
  onMoveStart: (e: ReactPointerEvent) => void;
  onTrimStart: (e: ReactPointerEvent, side: "in" | "out") => void;
  onToggleMute: () => void;
}

function ClipBlock(p: ClipProps) {
  const thumb = useThumbnail(p.path, p.clip.inPoint + 0.2);
  return (
    <div
      className={`clip ${p.selected ? "selected" : ""} ${p.dragging ? "dragging" : ""}`}
      style={{
        left: p.left,
        width: Math.max(4, p.width),
        backgroundImage: thumb ? `url(${thumb})` : undefined,
      }}
      onPointerDown={p.onMoveStart}
      title={`${p.name} : ${(p.clip.outPoint - p.clip.inPoint).toFixed(1)} s`}
    >
      <div className="handle left" onPointerDown={(e) => p.onTrimStart(e, "in")} title="Tirer pour rogner le début" />
      {p.width > 50 && <span className="clip-name">{p.name}</span>}
      {p.hasAudio && p.width > 30 && (
        <button
          className={`mute ${p.clip.muted ? "on" : ""}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={p.onToggleMute}
          title={p.clip.muted ? "Son du clip coupé (cliquer pour le remettre)" : "Son du clip actif (cliquer pour le couper)"}
        >
          {p.clip.muted ? "🔇" : "🔊"}
        </button>
      )}
      <div className="handle right" onPointerDown={(e) => p.onTrimStart(e, "out")} title="Tirer pour rogner la fin" />
    </div>
  );
}
