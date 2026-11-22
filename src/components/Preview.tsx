/**
 * Lecteur d'aperçu.
 *
 * Il n'y a pas de « vrai » film tant qu'on n'a pas exporté : l'aperçu
 * rejoue le montage en direct. Deux lecteurs vidéo sont utilisés à tour de
 * rôle : pendant que l'un joue un clip, l'autre prépare le clip suivant,
 * pour que l'enchaînement soit fluide.
 */

import { useEffect, useRef } from "react";
import type { Editor } from "../App";
import { mediaUrl } from "../lib/backend";
import {
  clipAt,
  clipDuration,
  exportSize,
  fadeToBlackHalf,
  formatTime,
  getMedia,
  overlapAfter,
  sourceTime,
  totalDuration,
  type Clip,
  type Project,
} from "../model/project";

/** Zoom lent de l'aperçu (le même que celui de l'export : 15 % sur toute la durée du clip). */
function zoomTransform(clip: Clip, elapsed: number, dur: number): string {
  const r = Math.max(0, Math.min(1, elapsed / dur));
  if (clip.zoom === "in") return `scale(${1 + 0.15 * r})`;
  if (clip.zoom === "out") return `scale(${1.15 - 0.15 * r})`;
  return "none";
}

/** Volume de la musique à l'instant t de la timeline, fondus compris (de 0 à 1). */
export function musicGain(p: Project, t: number): number {
  if (!p.music) return 0;
  const total = totalDuration(p);
  const local = t - p.music.start; // position dans la chanson
  if (local < 0) return 0;
  let g = Math.min(1, Math.max(0, p.music.volume));
  if (p.music.fadeIn > 0) g *= Math.min(1, local / p.music.fadeIn);
  if (p.music.fadeOut > 0) g *= Math.min(1, Math.max(0, (total - t) / p.music.fadeOut));
  return Math.max(0, Math.min(1, g));
}

export function Preview({ editor }: { editor: Editor }) {
  const { project, time, playing, setPlaying, seek } = editor;
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const blackVeil = useRef<HTMLDivElement>(null);
  const active = useRef(0); // 0 = lecteur A visible, 1 = lecteur B visible
  const projectRef = useRef(project);
  projectRef.current = project;

  const duration = totalDuration(project);
  const musicMedia = project.music ? getMedia(project, project.music.mediaId) : undefined;
  const { width, height } = exportSize(project.exportSettings);

  /** Fait jouer la chanson au bon endroit (elle peut commencer après le début). */
  const syncMusic = (t: number, isPlaying: boolean) => {
    const a = audio.current;
    const p = projectRef.current;
    if (!a || !a.src || !p.music) return;
    const local = t - p.music.start;
    a.volume = musicGain(p, t);
    if (!isPlaying || local < 0 || (a.duration && local >= a.duration)) {
      a.pause();
      return;
    }
    if (a.paused || Math.abs(a.currentTime - local) > 0.25) a.currentTime = local;
    if (a.paused) void a.play().catch(() => {});
  };

  /** Place un lecteur au bon endroit de son fichier, en lecture ou en pause. */
  const drive = (v: HTMLVideoElement, local: number, speed: number, isPlaying: boolean) => {
    v.playbackRate = speed;
    if (!isPlaying) {
      v.pause();
      if (Math.abs(v.currentTime - local) > 0.01) v.currentTime = local;
      return;
    }
    if (v.paused || Math.abs(v.currentTime - local) > 0.3) v.currentTime = local;
    if (v.paused) void v.play().catch(() => {});
  };

  /** Charge un fichier dans un lecteur (s'il n'y est pas déjà). */
  const load = (v: HTMLVideoElement, path: string) => {
    if (v.dataset.path !== path) {
      v.dataset.path = path;
      v.src = mediaUrl(path);
    }
  };

  /** Affiche la bonne image de la timeline à l'instant t. */
  const render = (t: number, isPlaying: boolean) => {
    const p = projectRef.current;
    const players = [videoA.current, videoB.current];
    const veil = blackVeil.current;
    if (!players[0] || !players[1] || !veil) return;
    const total = totalDuration(p);
    // Tout à la fin, on montre la dernière image du dernier clip.
    const hit = clipAt(p, Math.min(t, total - 0.001));
    if (!hit) {
      players.forEach((v) => v!.classList.remove("visible"));
      veil.style.opacity = "0";
      return;
    }
    const { clip, index, start } = hit;
    const media = getMedia(p, clip.mediaId);
    if (!media) return;
    const dur = clipDuration(clip);

    let current = players[active.current]!;
    let other = players[1 - active.current]!;
    if (current.dataset.path !== media.path && other.dataset.path === media.path) {
      // Le clip était déjà prêt dans l'autre lecteur : on bascule.
      current.pause();
      active.current = 1 - active.current;
      [current, other] = [other, current];
    }
    load(current, media.path);
    current.classList.add("visible");
    current.style.opacity = "1";
    current.style.zIndex = "1";
    current.style.transform = zoomTransform(clip, t - start, dur);
    current.muted = clip.muted || !media.hasAudio;
    drive(current, sourceTime(clip, start, t), clip.speed || 1, isPlaying);

    // Fondu au noir : un voile noir plus ou moins opaque.
    const prev = p.clips[index - 1];
    const next = p.clips[index + 1];
    let black = 0;
    if (prev?.transition?.kind === "black") {
      const d = fadeToBlackHalf(prev, clip);
      if (d > 0 && t - start < d) black = 1 - (t - start) / d;
    }
    if (clip.transition?.kind === "black" && next) {
      const d = fadeToBlackHalf(clip, next);
      if (d > 0 && start + dur - t < d) black = Math.max(black, 1 - (start + dur - t) / d);
    }
    veil.style.opacity = String(black);

    // Fondu enchaîné : le clip suivant apparaît par-dessus, de plus en plus opaque.
    const overlap = overlapAfter(p, index);
    const nextMedia = next ? getMedia(p, next.mediaId) : undefined;
    const usable = !!next && !!nextMedia && nextMedia.path !== media.path;
    const nextStart = start + dur - overlap;
    if (usable && overlap > 0 && t >= nextStart) {
      load(other, nextMedia!.path);
      other.classList.add("visible");
      other.style.zIndex = "2";
      other.style.opacity = String(Math.min(1, (t - nextStart) / overlap));
      other.style.transform = zoomTransform(next!, t - nextStart, clipDuration(next!));
      other.muted = next!.muted || !nextMedia!.hasAudio;
      drive(other, sourceTime(next!, nextStart, t), next!.speed || 1, isPlaying);
      return;
    }
    other.classList.remove("visible");
    other.pause();

    // Prépare le clip suivant dans l'autre lecteur.
    if (isPlaying && usable && nextStart - t < 1.5 && other.dataset.prepared !== next!.id) {
      other.dataset.prepared = next!.id;
      load(other, nextMedia!.path);
      other.currentTime = next!.inPoint;
    }
  };

  // Hors lecture : on affiche l'image correspondant au curseur.
  useEffect(() => {
    if (!playing) {
      render(time, false);
      syncMusic(time, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, playing, project]);

  // Pendant la lecture : une horloge fait avancer le curseur.
  useEffect(() => {
    if (!playing) return;
    const total = totalDuration(projectRef.current);
    let t0 = time >= total - 0.05 ? 0 : time; // relance depuis le début si on est à la fin
    if (total <= 0) {
      setPlaying(false);
      return;
    }
    const a = audio.current;
    const wallStart = performance.now();
    let frame = 0;
    const tick = () => {
      const p = projectRef.current;
      const t = t0 + (performance.now() - wallStart) / 1000;
      if (t >= totalDuration(p)) {
        seek(totalDuration(p));
        setPlaying(false);
        return;
      }
      render(t, true);
      syncMusic(t, true);
      seek(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      a?.pause();
      [videoA.current, videoB.current].forEach((v) => v?.pause());
      t0 = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  return (
    <section className="panel preview">
      <div className="screen-wrap">
        <div className="screen" style={{ aspectRatio: `${width} / ${height}` }}>
          <video ref={videoA} preload="auto" playsInline />
          <video ref={videoB} preload="auto" playsInline />
          <div className="black-veil" ref={blackVeil} />
          {project.clips.length === 0 && <div className="screen-empty">Aperçu</div>}
        </div>
      </div>
      {musicMedia && <audio ref={audio} src={mediaUrl(musicMedia.path)} preload="auto" />}
      <div className="transport">
        <button onClick={() => seek(0)} title="Aller au début (Début)">⏮</button>
        <button
          className="play"
          onClick={() => setPlaying(!playing)}
          disabled={duration === 0}
          title="Lecture / pause (barre d'espace)"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button onClick={() => seek(duration)} title="Aller à la fin (Fin)">⏭</button>
        <span className="timecode">
          {formatTime(time)} / {formatTime(duration)}
        </span>
      </div>
    </section>
  );
}
