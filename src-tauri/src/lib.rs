use std::path::{Path, PathBuf};

use tauri::Manager;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;

fn resolve_external_audiobook_path(path: &str) -> Result<PathBuf, String> {
    let raw = PathBuf::from(path.trim());
    if raw.as_os_str().is_empty() {
        return Err("No file path provided.".into());
    }

    let path = if raw.is_file() {
        raw.canonicalize().unwrap_or(raw)
    } else {
        raw
    };

    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");

    if path.is_file() && !name.ends_with(".chapters.json") {
        return Ok(path);
    }

    let parent = path.parent().unwrap_or(Path::new("."));
    let base = if name.ends_with(".chapters.json") {
        name.strip_suffix(".chapters.json").unwrap_or(name)
    } else {
        path.file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("")
    };

    for ext in [".m4b", ".mp3", ".m4a"] {
        let candidate = parent.join(format!("{base}{ext}"));
        if candidate.is_file() {
            return Ok(candidate.canonicalize().unwrap_or(candidate));
        }
    }

    Err(format!(
        "No audiobook file found for {}. Expected a merged .m4b/.mp3/.m4a beside the chapter sidecar.",
        path.display()
    ))
}

#[cfg(windows)]
fn open_with_system_dialog(path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let path_str = path.to_string_lossy();
    let escaped = path_str.replace('\'', "''");
    let script = format!("Start-Process -LiteralPath '{escaped}' -Verb OpenAs");

    let ps = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    if matches!(ps, Ok(status) if status.success()) {
        return Ok(());
    }

    // Fallback: default associated app (same behavior as the legacy Tk app).
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path_str])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|err| format!("Failed to open file: {err}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_with_system_dialog(path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|err| format!("Failed to open file: {err}"))?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_with_system_dialog(path: &Path) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(|err| format!("Failed to open file: {err}"))?;
    Ok(())
}

#[tauri::command]
fn open_with_app(path: String) -> Result<(), String> {
    let resolved = resolve_external_audiobook_path(&path)?;
    open_with_system_dialog(&resolved)
}

#[cfg(windows)]
fn reveal_path_in_explorer(path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    if path.as_os_str().is_empty() {
        return Err("No path provided.".into());
    }

    let display = if path.exists() {
        path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
    } else {
        path.to_path_buf()
    };
    let path_str = display.to_string_lossy().to_string();

    // Launch via `start` so Explorer becomes the active foreground window.
    let mut cmd = std::process::Command::new("cmd");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.arg("/C").arg("start").arg("").arg("explorer");
    if display.is_dir() {
        cmd.arg(&path_str);
    } else {
        cmd.arg(format!("/select,\"{path_str}\""));
    }

    cmd.spawn()
        .map_err(|err| format!("Failed to reveal path: {err}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn reveal_path_in_explorer(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("No path provided.".into());
    }
    std::process::Command::new("open")
        .arg("-a")
        .arg("Finder")
        .arg("-R")
        .arg(path)
        .spawn()
        .map_err(|err| format!("Failed to reveal path: {err}"))?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_path_in_explorer(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("No path provided.".into());
    }
    let target = if path.is_file() {
        path.parent().unwrap_or(path)
    } else {
        path
    };
    std::process::Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map_err(|err| format!("Failed to reveal path: {err}"))?;
    Ok(())
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    reveal_path_in_explorer(Path::new(path.trim()))
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("project root")
        .to_path_buf()
}

fn ffmpeg_env_vars(resource_dir: Option<PathBuf>) -> Vec<(String, String)> {
    let Some(resource_dir) = resource_dir else {
        return Vec::new();
    };
    let ffmpeg_dir = resource_dir.join("ffmpeg");
    if !ffmpeg_dir.is_dir() {
        return Vec::new();
    }
    let ffmpeg_path = ffmpeg_dir.to_string_lossy().to_string();
    let path = std::env::var("PATH").unwrap_or_default();
    let merged = if path.is_empty() {
        ffmpeg_path.clone()
    } else {
        format!("{ffmpeg_path};{path}")
    };
    vec![
        ("NOVELFLOW_FFMPEG_DIR".to_string(), ffmpeg_path),
        ("PATH".to_string(), merged),
    ]
}

fn apply_ffmpeg_env(cmd: &mut std::process::Command, resource_dir: Option<PathBuf>) {
    for (key, value) in ffmpeg_env_vars(resource_dir) {
        cmd.env(key, value);
    }
}

#[cfg(debug_assertions)]
fn stop_existing_sidecars() {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        for name in [
            "novelflow-sidecar.exe",
            "novelflow-sidecar-x86_64-pc-windows-msvc.exe",
        ] {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", name])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(400));
}

#[cfg(debug_assertions)]
fn start_dev_python_sidecar(resource_dir: Option<PathBuf>) -> Result<(), String> {
    stop_existing_sidecars();

    let root = project_root();
    let src = root.join("src");
    let mut cmd = std::process::Command::new("python");
    cmd.args(["-m", "novelflow.api", "--port", "8765"])
        .current_dir(&root)
        .env("PYTHONPATH", src.to_string_lossy().to_string());
    apply_ffmpeg_env(&mut cmd, resource_dir);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn()
        .map_err(|err| format!("Failed to start dev Python sidecar: {err}"))?;
    Ok(())
}

#[cfg(not(debug_assertions))]
fn start_bundled_sidecar(app: &tauri::App) {
    match app.shell().sidecar("novelflow-sidecar") {
        Ok(sidecar) => {
            let resource_dir = app.path().resource_dir().ok();
            let mut cmd = sidecar.args(["--port", "8765"]);
            for (key, value) in ffmpeg_env_vars(resource_dir) {
                cmd = cmd.env(key, value);
            }
            if let Err(err) = cmd.spawn() {
                eprintln!("Failed to start novelflow-sidecar: {err}");
            }
        }
        Err(err) => eprintln!("Sidecar binary not found: {err}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![open_with_app, reveal_in_explorer])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let resource_dir = app.path().resource_dir().ok();
                if let Err(err) = start_dev_python_sidecar(resource_dir) {
                    eprintln!("{err}");
                }
            }
            #[cfg(not(debug_assertions))]
            {
                start_bundled_sidecar(app);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
