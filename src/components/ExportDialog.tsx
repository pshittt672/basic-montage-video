/** Fenêtre d'export : choix de la qualité, puis fabrication du MP4 avec FFmpeg. */

import { useEffect, useState } from "react";
import { cancelExport, exportVideo, onExportProgress, pickExportFile } from "../lib/backend";
import {
  buildExportPlan,
  exportSize,
  formatTime,
  suggestExportSettings,
  totalDuration,
  type ExportSettings,
  type Project,
} from "../model/project";

interface Props {
  project: Project;
  apply: (change: (p: Project) => Project) => void;
  onClose: () => void;
}

type Status =
  | { step: "settings" }
  | { step: "running"; ratio: number }
  | { step: "done"; output: string }
  | { step: "error"; message: string };

export function ExportDialog({ project, apply, onClose }: Props) {
  const [settings, setSettings] = useState<ExportSettings>(() => suggestExportSettings(project));
  const [status, setStatus] = useState<Status>({ step: "settings" });
  const { width, height } = exportSize(settings);

  useEffect(() => {
    const stop = onExportProgress((ratio) =>
      setStatus((s) => (s.step === "running" ? { step: "running", ratio } : s)),
    );
    return () => void stop.then((fn) => fn());
  }, []);

  const start = async () => {
    const output = await pickExportFile();
    if (!output) return;
    // Les réglages choisis sont gardés dans le projet pour la prochaine fois.
    apply((p) => ({ ...p, exportSettings: settings }));
    setStatus({ step: "running", ratio: 0 });
    try {
      await exportVideo(buildExportPlan({ ...project, exportSettings: settings }, output));
      setStatus({ step: "done", output });
    } catch (e) {
      setStatus({ step: "error", message: String(e) });
    }
  };

  const set = (change: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...change }));

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="Exporter la vidéo">
        <h2>Exporter la vidéo</h2>

        {status.step === "settings" && (
          <>
            <p className="meta">Durée du montage : {formatTime(totalDuration(project))}</p>
            <label>
              Qualité
              <select value={settings.quality} onChange={(e) => set({ quality: Number(e.target.value) as 720 | 1080 })}>
                <option value={1080}>Haute qualité (1080p)</option>
                <option value={720}>Fichier plus léger (720p)</option>
              </select>
            </label>
            <label>
              Format de l'image
              <select
                value={settings.orientation}
                onChange={(e) => set({ orientation: e.target.value as ExportSettings["orientation"] })}
              >
                <option value="landscape">Paysage 16:9 (YouTube, télévision)</option>
                <option value="portrait">Portrait 9:16 (TikTok, Reels, Shorts)</option>
                <option value="square">Carré 1:1</option>
              </select>
            </label>
            <label>
              Images par seconde
              <select value={settings.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>
                {[24, 25, 30, 60].map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
            <p className="hint">
              Image finale : {width} × {height}. Les clips d'un autre format sont centrés avec des bandes noires.
              Réglages proposés d'après tes clips.
            </p>
            <div className="buttons end">
              <button onClick={onClose}>Annuler</button>
              <button className="accent" onClick={start}>Choisir l'emplacement et exporter</button>
            </div>
          </>
        )}

        {status.step === "running" && (
          <>
            <p>Fabrication de la vidéo… {Math.round(status.ratio * 100)} %</p>
            <progress value={status.ratio} max={1} />
            <div className="buttons end">
              <button onClick={() => void cancelExport()}>Arrêter l'export</button>
            </div>
          </>
        )}

        {status.step === "done" && (
          <>
            <p>✅ Ta vidéo est prête :</p>
            <p className="path">{status.output}</p>
            <div className="buttons end">
              <button className="primary" onClick={onClose}>Fermer</button>
            </div>
          </>
        )}

        {status.step === "error" && (
          <>
            <p className="error-text">{status.message}</p>
            <div className="buttons end">
              <button onClick={() => setStatus({ step: "settings" })}>Retour</button>
              <button onClick={onClose}>Fermer</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
