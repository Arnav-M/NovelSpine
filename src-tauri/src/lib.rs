use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if let Ok(sidecar) = app.shell().sidecar("novelflow-sidecar") {
                let mut cmd = sidecar.args(["--port", "8765"]);

                if let Ok(resource_dir) = app.path().resource_dir() {
                    let ffmpeg_dir = resource_dir.join("ffmpeg");
                    if ffmpeg_dir.is_dir() {
                        cmd = cmd.env(
                            "NOVELFLOW_FFMPEG_DIR",
                            ffmpeg_dir.to_string_lossy().to_string(),
                        );

                        let path = std::env::var("PATH").unwrap_or_default();
                        let ffmpeg_path = ffmpeg_dir.to_string_lossy().to_string();
                        let merged = if path.is_empty() {
                            ffmpeg_path
                        } else {
                            format!("{ffmpeg_path};{path}")
                        };
                        cmd = cmd.env("PATH", merged);
                    }
                }

                let _ = cmd.spawn();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
