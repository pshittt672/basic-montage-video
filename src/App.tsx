/**
 * Fenêtre principale : elle assemble les différentes zones de l'écran et
 * garde l'état du montage (le projet, l'historique, la position de lecture).
 */

import { ask } from "@tauri-apps/plugin-dialog";
import type React from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ExportDialog } from "./components/ExportDialog";
import { Inspector } from "./components/Inspector";
import { Library } from "./components/Library";
import { Preview, stopRequest } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { Toolbar } from "./components/Toolbar";
import {
  checkFfmpeg,
  fileExists,
  onFileDrop,
  pickMediaFiles,
  pickProjectToOpen,
  pickProjectToSave,
  probeFile,
  readTextFile,
  writeTextFile,
} from "./lib/backend";
import {
  addBeat,
  addMedia,
  clipAt,
  emptyProject,
  parseProject,
  PROJECT_EXTENSION,
  removeClip,
  serializeProject,
  setClipMuted,
  splitAt,
  totalDuration,
  type MediaItem,
  type Project,
} from "./model/project";
import { historyReducer, initHistory } from "./state/history";

/** Ce qui est sélectionné : un clip de la timeline, ou la piste musique. */
export type Selection = { kind: "clip"; id: string } | { kind: "music" } | null;

export interface Editor {
  project: Project;
  /** Modification annulable. */
  apply: (change: (p: Project) => Project) => void;
  /** Pour les gestes continus (glisser) : une seule étape d'annulation. */
  gesture: {
    start: () => void;
    update: (change: (p: Project) => Project) => void;
    end: () => void;
  };
  selection: Selection;
  select: (s: Selection) => void;
  time: number;
  /** Déplace le curseur (aussi pendant la lecture). */
  seek: (t: number) => void;
  /** Utilisé par l'horloge de lecture de l'aperçu, pour faire avancer le curseur. */
  tick: (t: number) => void;
  /** Saut demandé pendant la lecture, que l'horloge prend en compte. */
  pendingJump: React.MutableRefObject<number | null>;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  /** Pose un marqueur de rythme à la position du curseur. */
  addBeat: () => void;
}

export default function App() {
  const [history, dispatch] = useReducer(historyReducer, emptyProject(), initHistory);
  const project = history.present;
  const [selection, select] = useState<Selection>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [ffmpeg, setFfmpeg] = useState<"checking" | "ok" | "missing">("checking");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const duration = totalDuration(project);
  const pendingJump = useRef<number | null>(null);
  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, t);
    pendingJump.current = clamped;
    setTime(clamped);
  }, []);
  const tick = useCallback((t: number) => setTime(t), []);
  const apply = useCallback((change: (p: Project) => Project) => dispatch({ type: "apply", change }), []);
  const gesture = useRef({
    start: () => dispatch({ type: "gestureStart" }),
    update: (change: (p: Project) => Project) => dispatch({ type: "gestureUpdate", change }),
    end: () => dispatch({ type: "gestureEnd" }),
  }).current;

  // Vérifie au démarrage que FFmpeg est bien là.
  useEffect(() => {
    checkFfmpeg()
      .then(() => setFfmpeg("ok"))
      .catch(() => setFfmpeg("missing"));
  }, []);

  // Le curseur de lecture ne doit pas dépasser la fin du montage.
  useEffect(() => {
    if (time > duration) setTime(duration);
  }, [time, duration]);

  // Si le clip sélectionné a disparu (suppression, annulation), on désélectionne.
  useEffect(() => {
    if (selection?.kind === "clip" && !project.clips.some((c) => c.id === selection.id)) select(null);
    if (selection?.kind === "music" && !project.music) select(null);
  }, [project, selection]);

  // Titre de la fenêtre : nom du projet et « * » s'il n'est pas enregistré.
  useEffect(() => {
    const name = projectPath ? projectPath.split(/[\\/]/).pop() : "Nouveau projet";
    document.title = `${history.dirty ? "• " : ""}${name} – Montage Vidéo`;
  }, [projectPath, history.dirty]);

  const flash = useCallback((text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage((m) => (m === text ? null : m)), 6000);
  }, []);

  /**
   * Importe des fichiers dans la bibliothèque. Les vidéos n'y sont que rangées :
   * c'est l'utilisateur qui les pose sur la timeline, dans l'ordre qu'il veut.
   * Il en va de même pour la chanson, posée sur la piste musique à l'endroit voulu.
   */
  const importPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      setBusy(`Import de ${paths.length} fichier(s)…`);
      const items: MediaItem[] = [];
      const errors: string[] = [];
      for (const path of paths) {
        try {
          items.push(await probeFile(path));
        } catch (e) {
          errors.push(`${path.split(/[\\/]/).pop()} : ${e}`);
        }
      }
      setBusy(null);
      // Rangement par nom dans la bibliothèque, pour retrouver facilement clip_001, clip_002...
      items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      apply((p) => addMedia(p, items));
      if (errors.length) flash(`Certains fichiers n'ont pas pu être importés :\n${errors.join("\n")}`);
    },
    [apply, flash],
  );

  const importFiles = useCallback(async () => importPaths(await pickMediaFiles()), [importPaths]);

  // Glisser-déposer de fichiers depuis l'Explorateur Windows.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    onFileDrop((paths) => {
      const project = paths.find((p) => p.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`));
      if (project) void openProjectAt(project);
      else void importPaths(paths);
    })
      .then((fn) => (cancelled ? fn() : (stop = fn)))
      .catch(() => {});
    return () => {
      cancelled = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importPaths]);

  const confirmDiscard = async () =>
    !history.dirty ||
    (await ask("Le projet en cours n'est pas enregistré. Continuer quand même ?", {
      title: "Montage Vidéo",
      kind: "warning",
      okLabel: "Continuer",
      cancelLabel: "Annuler",
    }));

  const newProject = async () => {
    if (!(await confirmDiscard())) return;
    dispatch({ type: "load", project: emptyProject() });
    setProjectPath(null);
    setTime(0);
  };

  const openProjectAt = async (path: string) => {
    try {
      const loaded = parseProject(await readTextFile(path));
      dispatch({ type: "load", project: loaded });
      setProjectPath(path);
      setTime(0);
      const missing: string[] = [];
      for (const m of loaded.media) if (!(await fileExists(m.path))) missing.push(m.name);
      if (missing.length) flash(`Fichiers introuvables (déplacés ou supprimés ?) : ${missing.join(", ")}`);
    } catch (e) {
      flash(String(e instanceof Error ? e.message : e));
    }
  };

  const openProject = async () => {
    if (!(await confirmDiscard())) return;
    const path = await pickProjectToOpen();
    if (path) await openProjectAt(path);
  };

  const saveProject = async (saveAs = false) => {
    let path = projectPath;
    if (!path || saveAs) path = await pickProjectToSave();
    if (!path) return;
    try {
      await writeTextFile(path, serializeProject(project));
      setProjectPath(path);
      dispatch({ type: "saved" });
      flash("Projet enregistré.");
    } catch (e) {
      flash(String(e));
    }
  };

  const splitHere = useCallback(() => {
    const hit = clipAt(project, time);
    apply((p) => splitAt(p, time));
    if (hit) select({ kind: "clip", id: hit.clip.id });
  }, [apply, project, time]);

  const timeRef = useRef(time);
  timeRef.current = time;
  const addBeatHere = useCallback(() => {
    const t = timeRef.current;
    apply((p) => addBeat(p, t));
  }, [apply]);

  // Raccourcis clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Dans une zone de texte, les touches servent à écrire.
      if (target.closest("textarea, input:not([type=range]):not([type=checkbox])")) return;
      // Sur un curseur, les flèches servent à le régler.
      if (target.matches("input[type=range]") && e.key.startsWith("Arrow")) return;
      // Sur une liste ou une case à cocher, on rend la main aux raccourcis.
      if (target.matches("select, input[type=checkbox], input[type=range]")) target.blur();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && key === "z" && !e.shiftKey) dispatch({ type: "undo" });
      else if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) dispatch({ type: "redo" });
      else if (ctrl && key === "s") void saveProject(e.shiftKey);
      else if (ctrl && key === "o") void openProject();
      else if (ctrl && key === "i") void importFiles();
      else if (ctrl && key === "e") setExportOpen(true);
      else if (ctrl) return;
      else if (key === " ") setPlaying((p) => !p);
      else if (key === "s") splitHere();
      else if (key === "b") addBeatHere();
      else if ((key === "delete" || key === "backspace") && selection?.kind === "clip") {
        apply((p) => removeClip(p, selection.id));
      } else if (key === "m" && selection?.kind === "clip") {
        const clip = project.clips.find((c) => c.id === selection.id);
        if (clip) apply((p) => setClipMuted(p, clip.id, !clip.muted));
      } else if (key === "arrowleft") seek(time - (e.shiftKey ? 5 : 1 / project.exportSettings.fps));
      else if (key === "arrowright") seek(Math.min(duration, time + (e.shiftKey ? 5 : 1 / project.exportSettings.fps)));
      else if (key === "escape") stopRequest.current?.();
      else if (key === "home") seek(0);
      else if (key === "end") seek(duration);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const editor: Editor = {
    project,
    apply,
    gesture,
    selection,
    select,
    time,
    seek,
    tick,
    pendingJump,
    playing,
    setPlaying,
    addBeat: addBeatHere,
  };

  return (
    <div className="app">
      <Toolbar
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        onNew={newProject}
        onOpen={openProject}
        onSave={() => saveProject(false)}
        onImport={importFiles}
        onExport={() => setExportOpen(true)}
        canExport={project.clips.length > 0 && ffmpeg === "ok"}
      />

      {ffmpeg === "missing" && (
        <div className="banner error">
          <strong>FFmpeg est introuvable.</strong> Il sert à lire et exporter les vidéos. Installe-le en
          tapant <code>winget install Gyan.FFmpeg</code> dans un terminal Windows, puis relance le
          logiciel. (L'installateur officiel du logiciel l'inclut déjà.)
        </div>
      )}
      {busy && <div className="banner">{busy}</div>}
      {message && (
        <div className="banner info" onClick={() => setMessage(null)}>
          {message}
        </div>
      )}

      <main className="workspace">
        <Library editor={editor} onImport={importFiles} />
        <Preview editor={editor} />
        <Inspector editor={editor} onSplit={splitHere} />
      </main>

      <Timeline editor={editor} onSplit={splitHere} />

      {exportOpen && <ExportDialog project={project} apply={apply} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
