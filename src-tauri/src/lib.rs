//! Partie « système » de l'application (en Rust).
//!
//! L'interface (dossier `src/`, en TypeScript) appelle les fonctions marquées
//! `#[tauri::command]` ci-dessous pour tout ce qu'un navigateur ne sait pas
//! faire seul : lancer FFmpeg, lire et écrire des fichiers.

mod ffmpeg;

use ffmpeg::{ExportPlan, MediaInfo};
use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// L'export en cours (s'il y en a un), pour pouvoir l'annuler.
#[derive(Default)]
struct ExportState {
    child: Arc<Mutex<Option<Child>>>,
}

fn resource_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok()
}

/// Vérifie que FFmpeg est disponible et renvoie sa version.
#[tauri::command]
fn check_ffmpeg(app: AppHandle) -> Result<String, String> {
    let path = ffmpeg::find_tool("ffmpeg", resource_dir(&app).as_deref());
    ffmpeg::version(&path)
}

/// Lit la durée, la taille et la présence de son d'un fichier.
#[tauri::command]
async fn probe_media(app: AppHandle, path: String) -> Result<MediaInfo, String> {
    let ffprobe = ffmpeg::find_tool("ffprobe", resource_dir(&app).as_deref());
    tauri::async_runtime::spawn_blocking(move || ffmpeg::probe(&ffprobe, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
struct ExportProgress {
    /// De 0 à 1.
    ratio: f64,
}

/// Lance l'export. Envoie régulièrement l'événement « export-progress ».
#[tauri::command]
async fn export_video(
    app: AppHandle,
    state: State<'_, ExportState>,
    plan: ExportPlan,
) -> Result<(), String> {
    let args = ffmpeg::build_export_args(&plan)?;
    let total = plan.duration().max(0.001);
    let ffmpeg_path = ffmpeg::find_tool("ffmpeg", resource_dir(&app).as_deref());

    let mut child = ffmpeg::command(&ffmpeg_path)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "FFmpeg est introuvable : impossible d'exporter.".to_string())?;

    let stdout = child.stdout.take().ok_or("Sortie de FFmpeg indisponible")?;
    let mut stderr = child.stderr.take().ok_or("Sortie de FFmpeg indisponible")?;
    let slot = state.child.clone();
    *slot.lock().unwrap() = Some(child);

    tauri::async_runtime::spawn_blocking(move || {
        // Les messages d'erreur de FFmpeg sont lus en parallèle.
        let err_reader = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stderr.read_to_string(&mut s);
            s
        });
        // Avec « -progress pipe:1 », FFmpeg écrit « out_time_us=... » au fil de l'eau.
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(us) = line.strip_prefix("out_time_us=") {
                if let Ok(us) = us.trim().parse::<f64>() {
                    let ratio = (us / 1_000_000.0 / total).clamp(0.0, 1.0);
                    let _ = app.emit("export-progress", ExportProgress { ratio });
                }
            }
        }
        let errors = err_reader.join().unwrap_or_default();
        let child = slot.lock().unwrap().take();
        let Some(mut child) = child else {
            return Err("Export annulé.".to_string());
        };
        let status = child.wait().map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            // On ne garde que la fin du message, la plus utile.
            let tail: Vec<&str> = errors.lines().rev().take(6).collect();
            let tail: Vec<&str> = tail.into_iter().rev().collect();
            Err(format!("L'export a échoué.\n{}", tail.join("\n")))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Annule l'export en cours.
#[tauri::command]
fn cancel_export(state: State<'_, ExportState>) {
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Fabrique une petite image (JPEG) d'un clip, pour la bibliothèque et la timeline.
#[tauri::command]
async fn thumbnail(app: AppHandle, path: String, at: f64) -> Result<tauri::ipc::Response, String> {
    let ffmpeg_path = ffmpeg::find_tool("ffmpeg", resource_dir(&app).as_deref());
    let bytes = tauri::async_runtime::spawn_blocking(move || ffmpeg::thumbnail(&ffmpeg_path, &path, at))
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Lit un fichier texte (utilisé pour ouvrir un projet).
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Impossible de lire le fichier : {e}"))
}

/// Écrit un fichier texte (utilisé pour enregistrer un projet).
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Impossible d'enregistrer : {e}"))
}

/// Indique si un fichier existe encore (un clip a pu être déplacé).
#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ExportState::default())
        .invoke_handler(tauri::generate_handler![
            check_ffmpeg,
            probe_media,
            thumbnail,
            export_video,
            cancel_export,
            read_text_file,
            write_text_file,
            file_exists
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application");
}
