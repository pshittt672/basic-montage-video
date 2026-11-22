/**
 * Appels vers la partie Rust de l'application (voir `src-tauri/src/lib.rs`).
 * Chaque fonction ici correspond à une commande `#[tauri::command]`.
 */

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { newId, PROJECT_EXTENSION, type ExportPlan, type MediaItem } from "../model/project";

export const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "avi", "m4v"];
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"];

interface MediaInfo {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  fps?: number;
}

/** Adresse utilisable par les balises <video> et <audio> pour un fichier local. */
export function mediaUrl(path: string): string {
  return convertFileSrc(path);
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function checkFfmpeg(): Promise<string> {
  return invoke<string>("check_ffmpeg");
}

/** Lit un fichier et le transforme en élément de bibliothèque. */
export async function probeFile(path: string): Promise<MediaItem> {
  const info = await invoke<MediaInfo>("probe_media", { path });
  return {
    id: newId(),
    path,
    name: fileName(path),
    kind: info.hasVideo ? "video" : "audio",
    duration: info.duration,
    hasAudio: info.hasAudio,
    width: info.width ?? undefined,
    height: info.height ?? undefined,
    fps: info.fps ?? undefined,
  };
}

const thumbnailCache = new Map<string, Promise<string>>();

/** Petite image d'un clip (mise en cache). */
export function thumbnailUrl(path: string, at = 0.5): Promise<string> {
  const key = `${path}@${at}`;
  let p = thumbnailCache.get(key);
  if (!p) {
    p = invoke<ArrayBuffer>("thumbnail", { path, at }).then((bytes) =>
      URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })),
    );
    p.catch(() => thumbnailCache.delete(key));
    thumbnailCache.set(key, p);
  }
  return p;
}

const waveformCache = new Map<string, Promise<Uint8Array>>();

/** Forme d'onde d'une chanson : 50 valeurs par seconde, de 0 (silence) à 255. */
export function waveform(path: string): Promise<Uint8Array> {
  let p = waveformCache.get(path);
  if (!p) {
    p = invoke<ArrayBuffer>("waveform", { path }).then((b) => new Uint8Array(b));
    p.catch(() => waveformCache.delete(path));
    waveformCache.set(path, p);
  }
  return p;
}

export async function pickMediaFiles(): Promise<string[]> {
  const result = await open({
    multiple: true,
    title: "Importer des vidéos ou une chanson",
    filters: [
      { name: "Vidéos et sons", extensions: [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] },
      { name: "Vidéos", extensions: VIDEO_EXTENSIONS },
      { name: "Sons", extensions: AUDIO_EXTENSIONS },
    ],
  });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

const projectFilter = [{ name: "Projet Montage Vidéo", extensions: [PROJECT_EXTENSION] }];

export async function pickProjectToOpen(): Promise<string | null> {
  const result = await open({ multiple: false, title: "Ouvrir un projet", filters: projectFilter });
  return typeof result === "string" ? result : null;
}

export function pickProjectToSave(): Promise<string | null> {
  return save({ title: "Enregistrer le projet", defaultPath: "mon-clip.montage", filters: projectFilter });
}

export function pickExportFile(): Promise<string | null> {
  return save({
    title: "Exporter la vidéo",
    defaultPath: "mon-clip.mp4",
    filters: [{ name: "Vidéo MP4", extensions: ["mp4"] }],
  });
}

export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke("write_text_file", { path, contents });
}

export function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path });
}

export function exportVideo(plan: ExportPlan): Promise<void> {
  return invoke("export_video", { plan });
}

export function cancelExport(): Promise<void> {
  return invoke("cancel_export");
}

export function onExportProgress(cb: (ratio: number) => void): Promise<UnlistenFn> {
  return listen<{ ratio: number }>("export-progress", (e) => cb(e.payload.ratio));
}

/** Fichiers déposés sur la fenêtre depuis l'Explorateur Windows. */
export async function onFileDrop(cb: (paths: string[]) => void): Promise<UnlistenFn> {
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type === "drop") cb(e.payload.paths);
  });
}
