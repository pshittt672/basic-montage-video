/**
 * Timeline : la piste vidéo (les clips bout à bout) et la piste musique.
 *
 * - Cliquer sur la règle ou une zone vide déplace le curseur de lecture.
 * - Cliquer sur un clip le sélectionne ; le faire glisser change sa place.
 * - Tirer sur les bords d'un clip le raccourcit (rognage).
 * - Les marqueurs de rythme (touche B) apparaissent en traits jaunes ; avec
 *   l'aimantation, le curseur et les coupes viennent s'y caler.
 */

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Editor } from "../App";
import { onLibraryDrag } from "../lib/libraryDrag";
import { useWaveform } from "./Waveform";
import {
  beatTimes,
  clearBeats,
  clipDuration,
  clipStarts,
  overlapAfter,
  removeBeatNear,
  snapTo,
  getMedia,
  insertClip,
  moveClip,
  removeClip,
  setMusic,
  updateMusic,
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

function label(t: number, step: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const sec = step < 1 ? s.toFixed(1).padStart(4, "0") : String(Math.round(s)).padStart(2, "0");
  return `${m}:${sec}`;
}

export function Timeline({ editor, onSplit }: Props) {
  const { project, apply, gesture, selection, select, time, seek, playing } = editor;
  const scroller = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState(40); // pixels par seconde (zoom)
  const [drag, setDrag] = useState<{ id: string; x: number; target: number } | null>(null);
  const [libraryDrop, setLibraryDrop] = useState<number | null>(null); // position d'insertion
  const [musicDrop, setMusicDrop] = useState<number | null>(null); // début de la chanson déposée
  const videoTrack = useRef<HTMLDivElement>(null);
  const musicTrack = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);

  const total = totalDuration(project);
  const starts = clipStarts(project);
  const musicMedia = project.music ? getMedia(project, project.music.mediaId) : undefined;
  const length = Math.max(total, (project.music?.start ?? 0) + (musicMedia?.duration ?? 0), 10);
  const width = PAD * 2 + length * pps + 200;
  const selectedClip =
    selection?.kind === "clip" ? project.clips.find((c) => c.id === selection.id) : undefined;
  const allMuted = project.clips.length > 0 && project.clips.every((c) => c.muted);
  const beats = beatTimes(project);
  /** Aimantation : à moins de 10 pixels d'un marqueur (ou d'une coupe), on s'y cale. */
  const snap = (t: number, extra: number[] = []) =>
    project.snap ? snapTo(t, [...beats, ...extra], 10 / pps) : t;

  /** Ajuste le zoom pour voir `len` secondes (par défaut tout le montage). */
  const fit = (len = Math.max(total, 5)) => {
    const w = scroller.current?.clientWidth ?? 800;
    setPps(Math.max(2, Math.min(200, (w - PAD * 2 - 40) / len)));
  };

  // Au premier clip posé, on règle le zoom pour voir environ une minute, ou toute la chanson.
  useLayoutEffect(() => {
    if (!fitted.current && total > 0) {
      fitted.current = true;
      fit(Math.max(total, Math.min(musicMedia?.duration ?? 60, 240)));
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
    const at = (x: number) => snap(timeAt(x), [...starts, total]);
    seek(at(e.clientX));
    const move = (ev: PointerEvent) => seek(at(ev.clientX));
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
    const move = (ev: PointerEvent) => {
      if (!moving && Math.abs(ev.clientX - x0) < 5) return;
      moving = true;
      target = indexAt(timeAt(ev.clientX), clip.id);
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
    const speed = clip.speed || 1;
    const start = starts[project.clips.findIndex((c) => c.id === clip.id)];
    gesture.start();
    const move = (ev: PointerEvent) => {
      // Déplacement de la souris, converti en secondes de la vidéo source.
      const delta = ((ev.clientX - x0) / pps) * speed;
      // La fin du clip sur la timeline peut s'aimanter sur un marqueur de rythme.
      if (side === "out") {
        const end = snap(start + (clip.outPoint + delta - clip.inPoint) / speed);
        gesture.update((p) => trimClip(p, clip.id, { outPoint: clip.inPoint + (end - start) * speed }));
      } else {
        const end = snap(start + (clip.outPoint - clip.inPoint - delta) / speed);
        gesture.update((p) => trimClip(p, clip.id, { inPoint: clip.outPoint - (end - start) * speed }));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      gesture.end();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Position d'insertion (index) correspondant à un instant de la timeline. */
  const indexAt = (t: number, excludeId?: string) => {
    let start = 0;
    let index = 0;
    for (const c of project.clips) {
      if (c.id === excludeId) continue;
      if (t < start + clipDuration(c) / 2) break;
      start += clipDuration(c);
      index++;
    }
    return index;
  };

  /**
   * Aimantation de la chanson : près du début ou d'une limite entre deux
   * clips (à moins de 10 pixels), elle s'y cale exactement.
   */
  const snapMusic = (t: number) => {
    const points = [0, ...clipStarts(project), total];
    const near = points.find((pt) => Math.abs(pt - t) * pps < 10);
    return Math.max(0, near ?? t);
  };

  // Fichier glissé depuis la bibliothèque : marqueur, puis pose au lâcher.
  // Une vidéo va sur la piste vidéo, une chanson sur la piste musique.
  const dragRef = useRef({ project, indexAt, timeAt, apply, snapMusic });
  dragRef.current = { project, indexAt, timeAt, apply, snapMusic };
  useEffect(
    () =>
      onLibraryDrag((d) => {
        const { project, indexAt, timeAt, apply, snapMusic } = dragRef.current;
        const media = getMedia(project, d.mediaId);
        if (!media) return;
        const track = media.kind === "video" ? videoTrack.current : musicTrack.current;
        const r = track?.getBoundingClientRect();
        const over =
          !!r && d.clientX >= r.left && d.clientX <= r.right && d.clientY >= r.top - 20 && d.clientY <= r.bottom + 20;
        if (media.kind === "video") {
          const index = over ? indexAt(timeAt(d.clientX)) : null;
          setLibraryDrop(d.phase === "move" ? index : null);
          if (d.phase === "drop" && index !== null) apply((p) => insertClip(p, media, index));
        } else {
          const start = over ? snapMusic(timeAt(d.clientX)) : null;
          setMusicDrop(d.phase === "move" ? start : null);
          if (d.phase === "drop" && start !== null) {
            apply((p) => setMusic(p, media.id, start));
            select({ kind: "music" });
          }
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Faire glisser la chanson pour changer le moment où elle commence. */
  const startMusicMove = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !project.music) return;
    e.stopPropagation();
    select({ kind: "music" });
    const x0 = e.clientX;
    const start0 = project.music.start;
    let moving = false;
    const move = (ev: PointerEvent) => {
      if (!moving && Math.abs(ev.clientX - x0) < 5) return;
      if (!moving) gesture.start();
      moving = true;
      const start = snapMusic(start0 + (ev.clientX - x0) / pps);
      gesture.update((p) => updateMusic(p, { start }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moving) gesture.end();
      else seek(timeAt(x0));
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
  } else if (libraryDrop !== null) {
    dropX = PAD + project.clips.slice(0, libraryDrop).reduce((s, c) => s + clipDuration(c), 0) * pps;
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
        <span className="rhythm" title="Pendant la lecture, tape B sur chaque temps fort de la chanson.">
          <button className="ghost" onClick={() => editor.addBeat()} disabled={total === 0}>
            ♩ Marquer le rythme (B)
          </button>
          <label className="check inline" title="Le curseur et les coupes se calent sur les marqueurs">
            <input
              type="checkbox"
              checked={project.snap}
              onChange={(e) => {
                const on = e.target.checked;
                apply((p) => ({ ...p, snap: on }));
              }}
            />
            Aimantation
          </label>
          {beats.length > 0 && (
            <button className="ghost" onClick={() => apply(clearBeats)} title="Effacer tous les marqueurs de rythme">
              Effacer ({beats.length})
            </button>
          )}
        </span>
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
        <button onClick={() => fit()} title="Voir tout le montage">Tout voir</button>
      </div>

      <div className="tracks-wrap">
        <div className="track-labels">
          <div className="ruler-label" />
          <div className="track-label">Vidéo</div>
          <div className="track-label music">Musique</div>
        </div>
        <div className="scroller" ref={scroller}>
          <div className="tracks" style={{ width }}>
            <div
              className="ruler"
              onPointerDown={scrub}
              onContextMenu={(e) => {
                e.preventDefault();
                const t = timeAt(e.clientX);
                apply((p) => removeBeatNear(p, t, 10 / pps));
              }}
              title={beats.length ? "Clic droit sur un marqueur jaune pour l'effacer" : undefined}
            >
              {ticks.map((t) => (
                <span key={t} className="tick" style={{ left: PAD + t * pps }}>
                  {label(t, step)}
                </span>
              ))}
            </div>

            <div className={`track video-track ${libraryDrop !== null ? "drop-over" : ""}`} ref={videoTrack} onPointerDown={scrub}>
              {project.clips.length === 0 && (
                <div className="track-empty">Glisse ici les clips de la bibliothèque, dans l'ordre que tu veux.</div>
              )}
              {project.clips.map((clip, i) => (
                <ClipBlock
                  key={clip.id}
                  clip={clip}
                  path={getMedia(project, clip.mediaId)?.path}
                  name={getMedia(project, clip.mediaId)?.name ?? "?"}
                  hasAudio={getMedia(project, clip.mediaId)?.hasAudio ?? false}
                  left={PAD + starts[i] * pps + (drag?.id === clip.id ? drag.x : 0)}
                  zIndex={i}
                  width={clipDuration(clip) * pps}
                  selected={selection?.kind === "clip" && selection.id === clip.id}
                  dragging={drag?.id === clip.id}
                  onMoveStart={(e) => startMove(e, clip)}
                  onTrimStart={(e, side) => startTrim(e, clip, side)}
                  onToggleMute={() => apply((p) => setClipMuted(p, clip.id, !clip.muted))}
                />
              ))}
              {project.clips.map((clip, i) =>
                clip.transition && i < project.clips.length - 1 ? (
                  <button
                    key={`t-${clip.id}`}
                    className="transition-badge"
                    style={{ left: PAD + (starts[i + 1] + overlapAfter(project, i) / 2) * pps - 11 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => select({ kind: "clip", id: clip.id })}
                    title={`${clip.transition.kind === "crossfade" ? "Fondu enchaîné" : "Fondu au noir"} (${clip.transition.duration} s)`}
                  >
                    {clip.transition.kind === "crossfade" ? "⧓" : "■"}
                  </button>
                ) : null,
              )}
              {dropX !== null && <div className="drop-marker" style={{ left: dropX - 2 }} />}
            </div>

            <div
              className={`track music-track ${musicDrop !== null ? "drop-over" : ""}`}
              ref={musicTrack}
              onPointerDown={scrub}
            >
              {musicMedia && project.music ? (
                <div
                  className={`music-block ${selection?.kind === "music" ? "selected" : ""}`}
                  style={{ left: PAD + project.music.start * pps, width: musicMedia.duration * pps }}
                  onPointerDown={startMusicMove}
                  title="Glisser pour choisir le moment où la chanson commence"
                >
                  <WaveformCanvas path={musicMedia.path} width={musicMedia.duration * pps} />
                  <span className="clip-name">♪ {musicMedia.name}</span>
                  {project.music.start + musicMedia.duration > total && total > 0 && (
                    <div
                      className="unused"
                      style={{ left: Math.max(0, total - project.music.start) * pps }}
                      title="Cette partie de la chanson dépasse la fin de la vidéo : elle ne sera pas exportée."
                    />
                  )}
                </div>
              ) : (
                musicDrop === null && (
                  <div className="track-empty">Glisse ici une chanson de la bibliothèque, à l'endroit où elle doit commencer.</div>
                )
              )}
              {musicDrop !== null && <div className="drop-marker" style={{ left: PAD + musicDrop * pps - 2 }} />}
            </div>

            {beats.map((b) => (
              <div key={b} className="beat" style={{ left: PAD + b * pps }} />
            ))}
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
  zIndex: number;
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
        zIndex: p.dragging ? 50 : p.zIndex,
        backgroundImage: thumb ? `url(${thumb})` : undefined,
      }}
      onPointerDown={p.onMoveStart}
      title={`${p.name} : ${((p.clip.outPoint - p.clip.inPoint) / (p.clip.speed || 1)).toFixed(1)} s`}
    >
      <div className="handle left" onPointerDown={(e) => p.onTrimStart(e, "in")} title="Tirer pour rogner le début" />
      {p.width > 50 && <span className="clip-name">{p.name}</span>}
      {p.width > 40 && (p.clip.speed !== 1 || p.clip.zoom !== "none") && (
        <span className="clip-badges">
          {p.clip.speed !== 1 && `×${p.clip.speed}`}
          {p.clip.zoom !== "none" && " 🔍"}
        </span>
      )}
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

/** Dessine la forme d'onde de la chanson (les pics montrent les temps forts). */
function WaveformCanvas({ path, width }: { path: string; width: number }) {
  const peaks = useWaveform(path);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Un canevas ne peut pas être infiniment large : au-delà, l'image est étirée.
  const w = Math.max(1, Math.min(Math.round(width), 16000));
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !peaks) return;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    const per = peaks.length / w;
    for (let x = 0; x < w; x++) {
      let max = 0;
      const from = Math.floor(x * per);
      const to = Math.max(from + 1, Math.floor((x + 1) * per));
      for (let i = from; i < to && i < peaks.length; i++) max = Math.max(max, peaks[i]);
      const bar = (max / 255) * h;
      ctx.fillRect(x, (h - bar) / 2, 1, bar);
    }
  }, [peaks, w]);
  return <canvas ref={canvas} className="waveform" width={w} height={40} />;
}
