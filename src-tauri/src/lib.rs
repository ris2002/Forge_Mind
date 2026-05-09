use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct BackendState(Mutex<Option<CommandChild>>);

#[tauri::command]
fn backend_ready() -> bool {
    true
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendState(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            // Spawn the Python backend sidecar.
            // In dev mode the backend runs separately, so a spawn failure is non-fatal.
            if let Ok(sidecar) = handle.shell().sidecar("forgemind-backend") {
                if let Ok((_rx, child)) = sidecar.spawn() {
                    let state: State<BackendState> = handle.state();
                    *state.0.lock().unwrap() = Some(child);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state: State<BackendState> = window.state();
                let child = state.0.lock().unwrap().take();
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![backend_ready])
        .run(tauri::generate_context!())
        .expect("error running ForgeMind");
}
