/**
 * Le « modèle » du projet : les données d'un montage et toutes les
 * opérations possibles dessus (ajouter, couper, déplacer un clip...).
 *
 * Toutes les fonctions sont « pures » : elles ne modifient jamais le projet
 * reçu, elles en renvoient une copie modifiée. C'est ce qui rend
 * « Annuler / Rétablir » très simple (on garde les versions précédentes).
 */

/** Un fichier importé (vidéo ou chanson). */
export interface MediaItem {
  id: string;
  path: string;
  name: string;
  kind: "video" | "audio";
  /** Durée en secondes. */
  duration: number;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
}

/** Un morceau de vidéo posé sur la timeline. */
export interface Clip {
  id: string;
  mediaId: string;
  /** Début et fin (en secondes) de la partie gardée dans le fichier d'origine. */
  inPoint: number;
  outPoint: number;
  /** true = on n'entend pas le son d'origine du clip. */
  muted: boolean;
  /** Vitesse : 1 = normale, 0.5 = ralenti (deux fois plus long), 2 = accéléré. */
  speed: number;
  /** Zoom lent pendant le clip (effet « Ken Burns »). */
  zoom: "none" | "in" | "out";
  /** Transition vers le clip suivant (null = coupe franche). */
  transition: Transition | null;
}

export interface Transition {
  /** « crossfade » : fondu enchaîné ; « black » : fondu au noir. */
  kind: "crossfade" | "black";
  /** Durée en secondes. */
  duration: number;
}

/** Vitesses proposées dans l'interface. */
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** La chanson posée sous tout le montage. */
export interface Music {
  mediaId: string;
  /** Instant de la timeline (en secondes) où la chanson commence. */
  start: number;
  /** 1 = volume normal, 0 = muet. */
  volume: number;
  /** Durée des fondus en secondes (0 = pas de fondu). */
  fadeIn: number;
  fadeOut: number;
}

export interface ExportSettings {
  /** Hauteur de l'image pour le format paysage : 720 ou 1080. */
  quality: 720 | 1080;
  orientation: "landscape" | "portrait" | "square";
  fps: number;
}

export interface Project {
  version: 1;
  media: MediaItem[];
  /** Les clips de la timeline, dans l'ordre, mis bout à bout. */
  clips: Clip[];
  music: Music | null;
  /** Couper le son des clips posés sur la timeline (coché par défaut). */
  muteOnImport: boolean;
  exportSettings: ExportSettings;
  /**
   * Marqueurs de rythme, en secondes depuis le début de la chanson : ils
   * suivent la chanson si on la déplace. Sans chanson : depuis le début du montage.
   */
  beats: number[];
  /** Aimantation : les coupes et le curseur se calent sur les marqueurs. */
  snap: boolean;
}

/** Durée minimale d'un clip après rognage, en secondes. */
export const MIN_CLIP = 0.1;

export function newId(): string {
  return crypto.randomUUID();
}

export function emptyProject(): Project {
  return {
    version: 1,
    media: [],
    clips: [],
    music: null,
    muteOnImport: true,
    exportSettings: { quality: 1080, orientation: "landscape", fps: 30 },
    beats: [],
    snap: true,
  };
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export function getMedia(p: Project, id: string): MediaItem | undefined {
  return p.media.find((m) => m.id === id);
}

/** Durée du clip sur la timeline (vitesse comprise). */
export function clipDuration(c: Clip): number {
  return (c.outPoint - c.inPoint) / (c.speed || 1);
}

/**
 * Chevauchement entre le clip `i` et le suivant : un fondu enchaîné fait se
 * superposer la fin d'un clip et le début du suivant. Limité à la moitié
 * de chacun des deux clips.
 */
export function overlapAfter(p: Project, i: number): number {
  const c = p.clips[i];
  const next = p.clips[i + 1];
  if (!c?.transition || c.transition.kind !== "crossfade" || !next) return 0;
  return Math.max(0, Math.min(c.transition.duration, clipDuration(c) / 2, clipDuration(next) / 2));
}

/** Instant (sur la timeline) où commence chaque clip. */
export function clipStarts(p: Project): number[] {
  const starts: number[] = [];
  let t = 0;
  p.clips.forEach((c, i) => {
    starts.push(t);
    t += clipDuration(c) - overlapAfter(p, i);
  });
  return starts;
}

/** Durée totale du montage. */
export function totalDuration(p: Project): number {
  return p.clips.reduce((sum, c, i) => sum + clipDuration(c) - overlapAfter(p, i), 0);
}

/**
 * Trouve le clip affiché à l'instant `t` de la timeline. Pendant un fondu
 * enchaîné, c'est le premier des deux clips (le suivant est géré à part).
 */
export function clipAt(
  p: Project,
  t: number,
): { index: number; clip: Clip; start: number } | null {
  const starts = clipStarts(p);
  for (let index = 0; index < p.clips.length; index++) {
    const clip = p.clips[index];
    const start = starts[index];
    if (t >= start && t < start + clipDuration(clip)) return { index, clip, start };
  }
  return null;
}

/** Position dans le fichier source d'un clip, pour l'instant `t` de la timeline. */
export function sourceTime(clip: Clip, clipStart: number, t: number): number {
  return clip.inPoint + (t - clipStart) * (clip.speed || 1);
}

// ---------------------------------------------------------------------------
// Modifications
// ---------------------------------------------------------------------------

function updateClip(p: Project, id: string, change: (c: Clip) => Clip): Project {
  return { ...p, clips: p.clips.map((c) => (c.id === id ? change(c) : c)) };
}

export function addMedia(p: Project, items: MediaItem[]): Project {
  return { ...p, media: [...p.media, ...items] };
}

/** Ajoute un clip (le fichier vidéo entier) en fin de timeline, ou à `index`. */
export function insertClip(p: Project, media: MediaItem, index = p.clips.length): Project {
  const clip: Clip = {
    id: newId(),
    mediaId: media.id,
    inPoint: 0,
    outPoint: media.duration,
    muted: p.muteOnImport,
    speed: 1,
    zoom: "none",
    transition: null,
  };
  const clips = [...p.clips];
  clips.splice(index, 0, clip);
  const next = { ...p, clips };
  // Premier clip posé : le format de l'aperçu et de l'export suit celui des clips.
  return p.clips.length === 0 ? { ...next, exportSettings: suggestExportSettings(next) } : next;
}

/** Rogne un clip : change son début et/ou sa fin dans le fichier source. */
export function trimClip(
  p: Project,
  id: string,
  change: { inPoint?: number; outPoint?: number },
): Project {
  return updateClip(p, id, (c) => {
    const media = getMedia(p, c.mediaId);
    const max = media?.duration ?? c.outPoint;
    let inPoint = change.inPoint ?? c.inPoint;
    let outPoint = change.outPoint ?? c.outPoint;
    inPoint = Math.max(0, Math.min(inPoint, outPoint - MIN_CLIP));
    outPoint = Math.min(max, Math.max(outPoint, inPoint + MIN_CLIP));
    return { ...c, inPoint, outPoint };
  });
}

/**
 * Coupe en deux le clip situé à l'instant `t` de la timeline.
 * Renvoie le projet inchangé si l'on est trop près d'un bord.
 */
export function splitAt(p: Project, t: number): Project {
  const hit = clipAt(p, t);
  if (!hit) return p;
  const { clip, start, index } = hit;
  const cut = sourceTime(clip, start, t);
  if (cut - clip.inPoint < MIN_CLIP || clip.outPoint - cut < MIN_CLIP) return p;
  // La transition éventuelle reste à la fin, donc sur le second morceau.
  const first: Clip = { ...clip, outPoint: cut, transition: null };
  const second: Clip = { ...clip, id: newId(), inPoint: cut };
  const clips = [...p.clips];
  clips.splice(index, 1, first, second);
  return { ...p, clips };
}

/** Déplace un clip à une nouvelle position dans l'ordre de la timeline. */
export function moveClip(p: Project, id: string, newIndex: number): Project {
  const from = p.clips.findIndex((c) => c.id === id);
  if (from < 0) return p;
  const clips = [...p.clips];
  const [clip] = clips.splice(from, 1);
  const to = Math.max(0, Math.min(newIndex, clips.length));
  clips.splice(to, 0, clip);
  return { ...p, clips };
}

export function removeClip(p: Project, id: string): Project {
  return { ...p, clips: p.clips.filter((c) => c.id !== id) };
}

/** Duplique un clip juste après lui-même. */
export function duplicateClip(p: Project, id: string): Project {
  const index = p.clips.findIndex((c) => c.id === id);
  if (index < 0) return p;
  const clips = [...p.clips];
  clips.splice(index + 1, 0, { ...p.clips[index], id: newId() });
  return { ...p, clips };
}

export function setClipMuted(p: Project, id: string, muted: boolean): Project {
  return updateClip(p, id, (c) => ({ ...c, muted }));
}

/** Change la vitesse d'un clip (la partie gardée de la vidéo ne change pas). */
export function setClipSpeed(p: Project, id: string, speed: number): Project {
  return updateClip(p, id, (c) => ({ ...c, speed: Math.max(0.1, Math.min(8, speed)) }));
}

export function setClipZoom(p: Project, id: string, zoom: Clip["zoom"]): Project {
  return updateClip(p, id, (c) => ({ ...c, zoom }));
}

/** Transition entre ce clip et le suivant (null = aucune). */
export function setClipTransition(p: Project, id: string, transition: Transition | null): Project {
  return updateClip(p, id, (c) => ({ ...c, transition }));
}

// ----- Marqueurs de rythme -----

/** Instant de la timeline où commencent les marqueurs (le début de la chanson). */
function beatOrigin(p: Project): number {
  return p.music?.start ?? 0;
}

/** Les marqueurs de rythme, en instants de la timeline. */
export function beatTimes(p: Project): number[] {
  const o = beatOrigin(p);
  return p.beats.map((b) => b + o).filter((t) => t >= 0);
}

/** Ajoute un marqueur à l'instant `t` de la timeline (sauf s'il y en a déjà un tout près). */
export function addBeat(p: Project, t: number): Project {
  const b = t - beatOrigin(p);
  if (t < 0 || p.beats.some((x) => Math.abs(x - b) < 0.05)) return p;
  return { ...p, beats: [...p.beats, b].sort((x, y) => x - y) };
}

/** Retire le marqueur le plus proche de `t` (à moins de `tolerance` secondes). */
export function removeBeatNear(p: Project, t: number, tolerance: number): Project {
  const b = t - beatOrigin(p);
  let best = -1;
  p.beats.forEach((x, i) => {
    if (Math.abs(x - b) <= tolerance && (best < 0 || Math.abs(x - b) < Math.abs(p.beats[best] - b))) best = i;
  });
  if (best < 0) return p;
  return { ...p, beats: p.beats.filter((_, i) => i !== best) };
}

export function clearBeats(p: Project): Project {
  return { ...p, beats: [] };
}

/**
 * Aimantation : renvoie l'instant le plus proche parmi `points` s'il est à
 * moins de `tolerance` secondes de `t`, sinon `t` tel quel.
 */
export function snapTo(t: number, points: number[], tolerance: number): number {
  let best = t;
  let dist = tolerance;
  for (const pt of points) {
    const d = Math.abs(pt - t);
    if (d <= dist) {
      best = pt;
      dist = d;
    }
  }
  return best;
}

/** Coupe (ou remet) le son de tous les clips d'un coup. */
export function setAllMuted(p: Project, muted: boolean): Project {
  return { ...p, clips: p.clips.map((c) => ({ ...c, muted })) };
}

/** Retire un fichier de la bibliothèque, ainsi que ses clips. */
export function removeMedia(p: Project, mediaId: string): Project {
  return {
    ...p,
    media: p.media.filter((m) => m.id !== mediaId),
    clips: p.clips.filter((c) => c.mediaId !== mediaId),
    music: p.music?.mediaId === mediaId ? null : p.music,
  };
}

/** Pose une chanson sur la piste musique, à l'instant `start` de la timeline. */
export function setMusic(p: Project, mediaId: string, start = 0): Project {
  const keep = p.music ?? { volume: 1, fadeIn: 0, fadeOut: 2 };
  return { ...p, music: { ...keep, mediaId, start: Math.max(0, start) } };
}

export function updateMusic(p: Project, change: Partial<Omit<Music, "mediaId">>): Project {
  if (!p.music) return p;
  return { ...p, music: { ...p.music, ...change } };
}

export function removeMusic(p: Project): Project {
  return { ...p, music: null };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Taille de l'image exportée selon la qualité et l'orientation choisies. */
export function exportSize(s: ExportSettings): { width: number; height: number } {
  const short = s.quality; // 720 ou 1080
  const long = s.quality === 1080 ? 1920 : 1280;
  if (s.orientation === "portrait") return { width: short, height: long };
  if (s.orientation === "square") return { width: short, height: short };
  return { width: long, height: short };
}

/**
 * Fondu au noir entre `a` et `b` : la moitié de la durée pour assombrir la
 * fin de `a`, l'autre moitié pour éclaircir le début de `b`.
 */
export function fadeToBlackHalf(a: Clip, b: Clip): number {
  const d = (a.transition?.duration ?? 0) / 2;
  return Math.max(0, Math.min(d, clipDuration(a) / 2, clipDuration(b) / 2));
}

/** Plan d'export envoyé à la partie Rust (voir `src-tauri/src/ffmpeg.rs`). */
export interface ExportSegment {
  path: string;
  inPoint: number;
  outPoint: number;
  keepAudio: boolean;
  speed: number;
  zoom: Clip["zoom"];
  /** Fondu depuis le noir au début / vers le noir à la fin (secondes, 0 = aucun). */
  fadeInBlack: number;
  fadeOutBlack: number;
  /** Durée du fondu enchaîné avec le clip suivant (0 = aucun). */
  crossfadeNext: number;
}

export interface ExportPlan {
  segments: ExportSegment[];
  music: { path: string; start: number; volume: number; fadeIn: number; fadeOut: number } | null;
  width: number;
  height: number;
  fps: number;
  output: string;
}

export function buildExportPlan(p: Project, output: string): ExportPlan {
  const segments = p.clips.map((c, i): ExportSegment => {
    const m = getMedia(p, c.mediaId);
    if (!m) throw new Error("Un clip fait référence à un fichier manquant.");
    const prev = p.clips[i - 1];
    const blackIn = prev?.transition?.kind === "black" ? fadeToBlackHalf(prev, c) : 0;
    const next = p.clips[i + 1];
    const blackOut = c.transition?.kind === "black" && next ? fadeToBlackHalf(c, next) : 0;
    return {
      path: m.path,
      inPoint: c.inPoint,
      outPoint: c.outPoint,
      keepAudio: !c.muted && m.hasAudio,
      speed: c.speed || 1,
      zoom: c.zoom ?? "none",
      fadeInBlack: blackIn,
      fadeOutBlack: blackOut,
      crossfadeNext: overlapAfter(p, i),
    };
  });
  const musicMedia = p.music ? getMedia(p, p.music.mediaId) : undefined;
  // Une chanson qui commence après la fin de la vidéo ne s'entendrait pas.
  const music =
    p.music && musicMedia && p.music.start < totalDuration(p)
      ? {
          path: musicMedia.path,
          start: p.music.start,
          volume: p.music.volume,
          fadeIn: p.music.fadeIn,
          fadeOut: p.music.fadeOut,
        }
      : null;
  return { segments, music, ...exportSize(p.exportSettings), fps: p.exportSettings.fps, output };
}

/**
 * Propose des réglages d'export adaptés aux clips : orientation du premier
 * clip, et cadence la plus courante (arrondie) parmi 24, 25, 30 ou 60.
 */
export function suggestExportSettings(p: Project): ExportSettings {
  const videos = p.clips
    .map((c) => getMedia(p, c.mediaId))
    .filter((m): m is MediaItem => !!m && m.kind === "video");
  const first = videos[0];
  let orientation: ExportSettings["orientation"] = "landscape";
  if (first?.width && first?.height) {
    const r = first.width / first.height;
    orientation = r > 1.1 ? "landscape" : r < 0.9 ? "portrait" : "square";
  }
  const counts = new Map<number, number>();
  for (const v of videos) {
    if (!v.fps) continue;
    const f = [24, 25, 30, 60].reduce((a, b) => (Math.abs(b - v.fps!) < Math.abs(a - v.fps!) ? b : a));
    counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  let fps = p.exportSettings.fps;
  let best = 0;
  for (const [f, n] of counts) if (n > best) [fps, best] = [f, n];
  return { ...p.exportSettings, orientation, fps };
}

// ---------------------------------------------------------------------------
// Enregistrement
// ---------------------------------------------------------------------------

export const PROJECT_EXTENSION = "montage";

export function serializeProject(p: Project): string {
  return JSON.stringify(p, null, 2);
}

/** Relit un fichier projet, en vérifiant qu'il est bien formé. */
export function parseProject(text: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Ce fichier n'est pas un projet valide.");
  }
  const p = data as Partial<Project>;
  if (!p || p.version !== 1 || !Array.isArray(p.media) || !Array.isArray(p.clips)) {
    throw new Error("Ce fichier n'est pas un projet de Montage Vidéo.");
  }
  const base = emptyProject();
  return {
    ...base,
    ...p,
    // Valeurs par défaut pour les projets enregistrés avec une version précédente.
    clips: p.clips.map((c: Partial<Clip>) => ({
      ...(c as Clip),
      speed: c.speed ?? 1,
      zoom: c.zoom ?? "none",
      transition: c.transition ?? null,
    })),
    beats: p.beats ?? [],
    snap: p.snap ?? true,
    music: p.music ? { ...p.music, start: p.music.start ?? 0 } : null,
    exportSettings: { ...base.exportSettings, ...p.exportSettings },
  } as Project;
}

/** Affiche une durée en « m:ss.d » (par exemple 1:05.3). */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}
