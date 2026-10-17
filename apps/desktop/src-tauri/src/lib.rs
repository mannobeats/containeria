//! The Containeria desktop app: the window, the menu bar item and the commands the UI calls.

mod commands;
mod engine;
mod error;
mod events;
mod ipc;
mod metrics;
mod shells;
mod state;
mod streams;

use std::sync::Arc;

use tauri::Manager;

use crate::engine::Engine;
use crate::metrics::Sampler;
use crate::shells::Shells;
use crate::state::AppState;
use crate::streams::Streams;

/// Starts the app and blocks until it quits.
///
/// # Errors
/// Fails when Tauri can't create the app.
pub fn run() -> tauri::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();
    let ipc = ipc::builder();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .invoke_handler(ipc.invoke_handler())
        .setup(move |app| {
            ipc.mount_events(app);
            let bundled = app.path().resource_dir().ok().map(|dir| dir.join("bin/colima"));
            let engine = Arc::new(Engine::new(bundled.as_deref())?);
            let metrics = Arc::new(Sampler::default());
            let (watcher, handle) = (Arc::clone(&engine), app.handle().clone());
            tauri::async_runtime::spawn(async move { watcher.watch(handle).await });
            let (sampler, engine_for_sampler, handle) =
                (Arc::clone(&metrics), Arc::clone(&engine), app.handle().clone());
            tauri::async_runtime::spawn(
                async move { sampler.run(engine_for_sampler, handle).await },
            );
            app.manage(AppState {
                engine,
                metrics,
                streams: Streams::default(),
                shells: Shells::default(),
            });
            Ok(())
        })
        .run(tauri::generate_context!())
}
