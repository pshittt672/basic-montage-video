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
}

/** La chanson posée sous tout le montage. */
export interface Music {
  mediaId: string;
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
  /** Couper le son des clips à l'import (coché par défaut). */
  muteOnImport: boolean;
  exportSettings: ExportSettings;
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
  };
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export function getMedia(p: Project, id: string): MediaItem | undefined {
  return p.media.find((m) => m.id === id);
}

export function clipDuration(c: Clip): number {
  return c.outPoint - c.inPoint;
}

/** Durée totale du montage (somme des clips). */
export function totalDuration(p: Project): number {
  return p.clips.reduce((sum, c) => sum + clipDuration(c), 0);
}

/** Instant (sur la timeline) où commence chaque clip. */
export function clipStarts(p: Project): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const c of p.clips) {
    starts.push(t);
    t += clipDuration(c);
  }
  return starts;
}

/** Trouve le clip affiché à l'instant `t` de la timeline. */
export function clipAt(
  p: Project,
  t: number,
): { index: number; clip: Clip; start: number } | null {
  let start = 0;
  for (let index = 0; index < p.clips.length; index++) {
    const clip = p.clips[index];
    const end = start + clipDuration(clip);
    if (t >= start && t < end) return { index, clip, start };
    start = end;
  }
  return null;
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
  };
  const clips = [...p.clips];
  clips.splice(index, 0, clip);
  return { ...p, clips };
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
  const cut = clip.inPoint + (t - start);
  if (cut - clip.inPoint < MIN_CLIP || clip.outPoint - cut < MIN_CLIP) return p;
  const first: Clip = { ...clip, outPoint: cut };
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

export function setMusic(p: Project, mediaId: string): Project {
  const keep = p.music ?? { volume: 1, fadeIn: 0, fadeOut: 2 };
  return { ...p, music: { ...keep, mediaId } };
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

/** Plan d'export envoyé à la partie Rust (voir `src-tauri/src/ffmpeg.rs`). */
export interface ExportPlan {
  segments: { path: string; inPoint: number; outPoint: number; keepAudio: boolean }[];
  music: { path: string; volume: number; fadeIn: number; fadeOut: number } | null;
  width: number;
  height: number;
  fps: number;
  output: string;
}

export function buildExportPlan(p: Project, output: string): ExportPlan {
  const segments = p.clips.map((c) => {
    const m = getMedia(p, c.mediaId);
    if (!m) throw new Error("Un clip fait référence à un fichier manquant.");
    return {
      path: m.path,
      inPoint: c.inPoint,
      outPoint: c.outPoint,
      keepAudio: !c.muted && m.hasAudio,
    };
  });
  const musicMedia = p.music ? getMedia(p, p.music.mediaId) : undefined;
  const music =
    p.music && musicMedia
      ? {
          path: musicMedia.path,
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
    music: p.music ?? null,
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
