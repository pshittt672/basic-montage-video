//! Tout ce qui touche à FFmpeg : trouver le programme, lire les
//! informations d'un fichier (durée, taille, son...) et lancer l'export.
//!
//! FFmpeg est l'outil de référence pour traiter la vidéo. L'application ne
//! fait que préparer la bonne ligne de commande et la lancer.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Empêche Windows d'ouvrir une fenêtre noire de console pour FFmpeg.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Nom du programme selon le système (« ffmpeg.exe » sous Windows).
fn exe_name(tool: &str) -> String {
    if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_string()
    }
}

/// Cherche `ffmpeg` ou `ffprobe`, dans cet ordre :
/// 1. le dossier `ffmpeg` installé avec l'application ;
/// 2. le dossier de l'exécutable de l'application ;
/// 3. le PATH du système (par exemple après `winget install Gyan.FFmpeg`).
pub fn find_tool(tool: &str, resource_dir: Option<&Path>) -> PathBuf {
    let name = exe_name(tool);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("ffmpeg").join(&name));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("ffmpeg").join(&name));
            candidates.push(dir.join(&name));
        }
    }
    candidates
        .into_iter()
        .find(|p| p.is_file())
        // Sinon on laisse le système chercher dans le PATH.
        .unwrap_or_else(|| PathBuf::from(name))
}

/// Prépare une commande sans fenêtre de console.
pub fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Renvoie la première ligne de `ffmpeg -version`, ou une erreur lisible.
pub fn version(ffmpeg: &Path) -> Result<String, String> {
    let out = command(ffmpeg)
        .arg("-version")
        .output()
        .map_err(|_| "FFmpeg est introuvable.".to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text.lines().next().unwrap_or("FFmpeg").to_string())
}

/// Informations utiles sur un fichier vidéo ou audio.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    /// Durée en secondes.
    pub duration: f64,
    pub has_video: bool,
    pub has_audio: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Images par seconde (cadence), si c'est une vidéo.
    pub fps: Option<f64>,
}

/// Convertit une cadence écrite « 24000/1001 » en nombre (23,976).
fn parse_rate(rate: &str) -> Option<f64> {
    let (num, den) = rate.split_once('/').unwrap_or((rate, "1"));
    let num: f64 = num.parse().ok()?;
    let den: f64 = den.parse().ok()?;
    if den == 0.0 || num == 0.0 {
        None
    } else {
        Some(num / den)
    }
}

/// Lit la sortie JSON de ffprobe.
pub fn parse_probe(json: &str) -> Result<MediaInfo, String> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Réponse de ffprobe illisible : {e}"))?;
    let mut info = MediaInfo {
        duration: 0.0,
        has_video: false,
        has_audio: false,
        width: None,
        height: None,
        fps: None,
    };
    if let Some(streams) = v["streams"].as_array() {
        for s in streams {
            match s["codec_type"].as_str() {
                // Une pochette d'album dans un MP3 apparaît comme « vidéo » : on l'ignore.
                Some("video") if s["disposition"]["attached_pic"].as_i64() != Some(1) => {
                    if !info.has_video {
                        info.has_video = true;
                        info.width = s["width"].as_u64().map(|w| w as u32);
                        info.height = s["height"].as_u64().map(|h| h as u32);
                        info.fps = s["avg_frame_rate"]
                            .as_str()
                            .and_then(parse_rate)
                            .or_else(|| s["r_frame_rate"].as_str().and_then(parse_rate));
                    }
                }
                Some("audio") => info.has_audio = true,
                _ => {}
            }
        }
    }
    info.duration = v["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse().ok())
        .unwrap_or(0.0);
    if info.duration <= 0.0 {
        return Err("Impossible de connaître la durée de ce fichier.".into());
    }
    Ok(info)
}

pub fn probe(ffprobe: &Path, file: &str) -> Result<MediaInfo, String> {
    let out = command(ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate:stream_disposition=attached_pic",
            "-of",
            "json",
            file,
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|_| "ffprobe est introuvable : FFmpeg n'est pas installé.".to_string())?;
    if !out.status.success() {
        return Err(format!(
            "Fichier illisible : {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    parse_probe(&String::from_utf8_lossy(&out.stdout))
}

/// Extrait une image du fichier à l'instant `at` (en secondes), en JPEG.
pub fn thumbnail(ffmpeg: &Path, file: &str, at: f64) -> Result<Vec<u8>, String> {
    let out = command(ffmpeg)
        .args(["-v", "error", "-ss", &num(at.max(0.0)), "-i", file])
        .args(["-frames:v", "1", "-vf", "scale=240:-2", "-f", "image2pipe", "-c:v", "mjpeg", "-"])
        .stdin(Stdio::null())
        .output()
        .map_err(|_| "FFmpeg est introuvable.".to_string())?;
    if !out.status.success() || out.stdout.is_empty() {
        return Err("Impossible de créer la vignette.".into());
    }
    Ok(out.stdout)
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// Un morceau de la timeline vidéo, tel que l'envoie l'interface.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportSegment {
    pub path: String,
    /// Début et fin (en secondes) de la partie gardée dans le fichier source.
    pub in_point: f64,
    pub out_point: f64,
    /// Faut-il garder le son d'origine du clip ?
    pub keep_audio: bool,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportMusic {
    pub path: String,
    /// Instant du film (en secondes) où la chanson commence.
    #[serde(default)]
    pub start: f64,
    /// Volume de 0 (muet) à 1 (normal) ; au-delà, le son est amplifié.
    pub volume: f64,
    pub fade_in: f64,
    pub fade_out: f64,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlan {
    pub segments: Vec<ExportSegment>,
    pub music: Option<ExportMusic>,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub output: String,
}

impl ExportPlan {
    /// Durée totale du film, égale à la somme des morceaux vidéo.
    pub fn duration(&self) -> f64 {
        self.segments
            .iter()
            .map(|s| (s.out_point - s.in_point).max(0.0))
            .sum()
    }
}

/// Écrit un nombre avec au plus 3 décimales (« 1.5 », « 2 »).
fn num(x: f64) -> String {
    let s = format!("{x:.3}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// Construit la liste des arguments de FFmpeg pour un export.
///
/// Principe : chaque clip est découpé, mis à la même taille et à la même
/// cadence, puis tous les clips sont mis bout à bout (« concat »). La chanson
/// est ensuite mélangée au son des clips (qui est muet si on l'a coupé).
pub fn build_export_args(plan: &ExportPlan) -> Result<Vec<String>, String> {
    if plan.segments.is_empty() {
        return Err("La timeline est vide : ajoute au moins un clip.".into());
    }
    let (w, h, fps) = (plan.width, plan.height, plan.fps);
    let total = plan.duration();
    let mut args: Vec<String> = vec!["-y".into(), "-hide_banner".into()];
    let mut filters: Vec<String> = Vec::new();
    let mut concat_inputs = String::new();

    for (i, seg) in plan.segments.iter().enumerate() {
        let dur = seg.out_point - seg.in_point;
        if dur <= 0.0 {
            return Err(format!("Le clip n°{} a une durée nulle.", i + 1));
        }
        args.extend([
            "-ss".into(),
            num(seg.in_point),
            "-t".into(),
            num(dur),
            "-i".into(),
            seg.path.clone(),
        ]);
        // Image : même taille (bandes noires si le format diffère) et même cadence.
        filters.push(format!(
            "[{i}:v]scale={w}:{h}:force_original_aspect_ratio=decrease,\
             pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps={fps},\
             format=yuv420p,trim=duration={d},setpts=PTS-STARTPTS[v{i}]",
            d = num(dur)
        ));
        // Son : celui du clip, ou un silence de la même durée.
        if seg.keep_audio {
            filters.push(format!(
                "[{i}:a]aresample=48000,aformat=channel_layouts=stereo,\
                 apad,atrim=duration={d},asetpts=PTS-STARTPTS[a{i}]",
                d = num(dur)
            ));
        } else {
            filters.push(format!(
                "anullsrc=r=48000:cl=stereo,atrim=duration={d}[a{i}]",
                d = num(dur)
            ));
        }
        concat_inputs.push_str(&format!("[v{i}][a{i}]"));
    }
    let n = plan.segments.len();
    filters.push(format!("{concat_inputs}concat=n={n}:v=1:a=1[vout][clips]"));

    // La chanson n'est gardée que si elle commence avant la fin du film.
    let music = plan.music.as_ref().filter(|m| m.start.max(0.0) < total);
    if let Some(m) = music {
        let idx = n;
        let start = m.start.max(0.0);
        // Durée pendant laquelle la chanson s'entend.
        let heard = total - start;
        args.extend(["-i".into(), m.path.clone()]);
        let mut chain = format!(
            "[{idx}:a]aresample=48000,aformat=channel_layouts=stereo,\
             atrim=duration={t},asetpts=PTS-STARTPTS,volume={v}",
            t = num(heard),
            v = num(m.volume.max(0.0))
        );
        if m.fade_in > 0.0 {
            chain.push_str(&format!(",afade=t=in:st=0:d={}", num(m.fade_in)));
        }
        if m.fade_out > 0.0 {
            let fade_start = (heard - m.fade_out).max(0.0);
            chain.push_str(&format!(
                ",afade=t=out:st={}:d={}",
                num(fade_start),
                num(m.fade_out)
            ));
        }
        if start > 0.0 {
            // Silence avant le début de la chanson (en millisecondes).
            chain.push_str(&format!(",adelay=delays={}:all=1", (start * 1000.0).round() as u64));
        }
        chain.push_str("[music]");
        filters.push(chain);
        // duration=first : le son s'arrête avec la vidéo.
        filters.push(
            "[clips][music]amix=inputs=2:duration=first:normalize=0[aout]".to_string(),
        );
    } else {
        filters.push("[clips]anull[aout]".to_string());
    }

    args.extend([
        "-filter_complex".into(),
        filters.join(";"),
        "-map".into(),
        "[vout]".into(),
        "-map".into(),
        "[aout]".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "medium".into(),
        "-crf".into(),
        "20".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        "192k".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        plan.output.clone(),
    ]);
    Ok(args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_la_cadence() {
        assert_eq!(parse_rate("30/1"), Some(30.0));
        assert!((parse_rate("24000/1001").unwrap() - 23.976).abs() < 0.001);
        assert_eq!(parse_rate("0/0"), None);
    }

    #[test]
    fn lit_la_sortie_de_ffprobe() {
        let json = r#"{"streams":[
            {"codec_type":"video","width":768,"height":512,"avg_frame_rate":"24/1","disposition":{"attached_pic":0}},
            {"codec_type":"audio","disposition":{"attached_pic":0}}],
            "format":{"duration":"10.04"}}"#;
        let info = parse_probe(json).unwrap();
        assert!(info.has_video && info.has_audio);
        assert_eq!(info.width, Some(768));
        assert_eq!(info.fps, Some(24.0));
        assert!((info.duration - 10.04).abs() < 1e-9);
    }

    #[test]
    fn ignore_la_pochette_d_un_mp3() {
        let json = r#"{"streams":[
            {"codec_type":"audio","disposition":{"attached_pic":0}},
            {"codec_type":"video","width":500,"height":500,"disposition":{"attached_pic":1}}],
            "format":{"duration":"200.5"}}"#;
        let info = parse_probe(json).unwrap();
        assert!(!info.has_video && info.has_audio);
    }

    #[test]
    fn construit_un_export() {
        let plan = ExportPlan {
            segments: vec![
                ExportSegment { path: "a.mp4".into(), in_point: 1.0, out_point: 4.0, keep_audio: false },
                ExportSegment { path: "b.mp4".into(), in_point: 0.0, out_point: 2.5, keep_audio: true },
            ],
            music: Some(ExportMusic { path: "song.mp3".into(), start: 0.0, volume: 0.8, fade_in: 1.0, fade_out: 2.0 }),
            width: 1920,
            height: 1080,
            fps: 30,
            output: "out.mp4".into(),
        };
        assert!((plan.duration() - 5.5).abs() < 1e-9);
        let args = build_export_args(&plan).unwrap();
        let filter = &args[args.iter().position(|a| a == "-filter_complex").unwrap() + 1];
        assert!(filter.contains("anullsrc=r=48000:cl=stereo,atrim=duration=3[a0]"));
        assert!(filter.contains("[1:a]aresample"));
        assert!(filter.contains("concat=n=2:v=1:a=1"));
        assert!(filter.contains("afade=t=out:st=3.5:d=2"));
        assert_eq!(args.last().unwrap(), "out.mp4");
    }

    #[test]
    fn decale_le_debut_de_la_chanson() {
        let seg = ExportSegment { path: "a.mp4".into(), in_point: 0.0, out_point: 10.0, keep_audio: false };
        let mut plan = ExportPlan {
            segments: vec![seg],
            music: Some(ExportMusic { path: "s.mp3".into(), start: 4.0, volume: 1.0, fade_in: 0.0, fade_out: 2.0 }),
            width: 1280,
            height: 720,
            fps: 30,
            output: "o.mp4".into(),
        };
        let filter_of = |plan: &ExportPlan| {
            let args = build_export_args(plan).unwrap();
            args[args.iter().position(|a| a == "-filter_complex").unwrap() + 1].clone()
        };
        let f = filter_of(&plan);
        assert!(f.contains("atrim=duration=6,"));
        assert!(f.contains("afade=t=out:st=4:d=2"));
        assert!(f.contains("adelay=delays=4000:all=1"));
        // Chanson posée après la fin du film : elle est ignorée.
        plan.music.as_mut().unwrap().start = 12.0;
        assert!(!filter_of(&plan).contains("amix"));
    }

    #[test]
    fn refuse_une_timeline_vide() {
        let plan = ExportPlan { segments: vec![], music: None, width: 1280, height: 720, fps: 30, output: "o.mp4".into() };
        assert!(build_export_args(&plan).is_err());
    }

    /// Test complet avec le vrai FFmpeg : `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn export_reel_avec_ffmpeg() {
        let dir = std::env::temp_dir().join("montage-test");
        std::fs::create_dir_all(&dir).unwrap();
        let f = |n: &str| dir.join(n).to_string_lossy().to_string();
        let run = |args: &[&str]| {
            let ok = Command::new("ffmpeg").args(["-y", "-v", "error"]).args(args).status().unwrap();
            assert!(ok.success());
        };
        // Clip avec son, 768x512 à 24 i/s ; clip sans son, 640x640 à 16 i/s ; une « chanson ».
        run(&["-f", "lavfi", "-i", "testsrc=size=768x512:rate=24:duration=4", "-f", "lavfi", "-i", "sine=f=300:duration=4", "-shortest", &f("a.mp4")]);
        run(&["-f", "lavfi", "-i", "testsrc2=size=640x640:rate=16:duration=3", &f("b.mp4")]);
        run(&["-f", "lavfi", "-i", "sine=f=500:duration=20", &f("song.mp3")]);
        let plan = ExportPlan {
            segments: vec![
                ExportSegment { path: f("a.mp4"), in_point: 0.5, out_point: 3.0, keep_audio: true },
                ExportSegment { path: f("b.mp4"), in_point: 0.0, out_point: 3.0, keep_audio: false },
            ],
            music: Some(ExportMusic { path: f("song.mp3"), start: 1.5, volume: 0.7, fade_in: 1.0, fade_out: 1.0 }),
            width: 1280,
            height: 720,
            fps: 30,
            output: f("out.mp4"),
        };
        let args = build_export_args(&plan).unwrap();
        let st = Command::new("ffmpeg").args(&args).stdout(Stdio::null()).status().unwrap();
        assert!(st.success());
        let info = probe(Path::new("ffprobe"), &f("out.mp4")).unwrap();
        assert_eq!((info.width, info.height), (Some(1280), Some(720)));
        assert!(info.has_audio);
        assert!((info.duration - 5.5).abs() < 0.15, "durée {}", info.duration);
    }
}

