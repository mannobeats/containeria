//! The Containeria desktop app: the window, the menu bar item and the commands the UI calls.

mod commands;
mod domains;
mod engine;
mod error;
mod events;
mod ipc;
mod machines;
mod menu;
mod metrics;
mod preferences;
mod state;
mod streams;
mod tray;

use std::sync::Arc;

use containeria_engine::Home;
use containeria_net::Domains;
use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};

use crate::engine::Engine;
use crate::machines::MachinesEngine;
use crate::metrics::Sampler;
use crate::preferences::PreferencesStore;
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
        .menu(menu::build)
        .on_menu_event(|app, event| menu::handle(app, &event))
        .on_window_event(on_window_event)
        .setup(move |app| {
            ipc.mount_events(app);
            let bundled = app.path().resource_dir().ok().map(|dir| dir.join("bin/colima"));
            let engine = Arc::new(Engine::new(bundled.as_deref())?);
            let machines = MachinesEngine::new(Home::from_env()?, bundled.as_deref());
            let metrics = Arc::new(Sampler::default());
            let (watcher, handle) = (Arc::clone(&engine), app.handle().clone());
            tauri::async_runtime::spawn(async move { watcher.watch(handle).await });
            let (sampler, engine_for_sampler, handle) =
                (Arc::clone(&metrics), Arc::clone(&engine), app.handle().clone());
            tauri::async_runtime::spawn(
                async move { sampler.run(engine_for_sampler, handle).await },
            );
            let domains = Arc::new(Domains::open(&Home::from_env()?.root().join("net"))?);
            let (supervised, engine_for_domains) = (Arc::clone(&domains), Arc::clone(&engine));
            tauri::async_runtime::spawn(domains::supervise(supervised, engine_for_domains));
            let preferences = PreferencesStore::open(engine.home().root());
            app.manage(AppState {
                engine,
                domains,
                machines,
                metrics,
                preferences,
                streams: Streams::default(),
            });
            tray::install(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())?
        .run(|app, event| on_run_event(app, &event));
    Ok(())
}

/// Closing the main window hides it while Containeria stays in the menu bar.
fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    if window.label() != "main" {
        return;
    }
    if window.state::<AppState>().preferences.get().keep_running_in_menu_bar {
        api.prevent_close();
        let _ = window.hide();
    } else {
        window.app_handle().exit(0);
    }
}

/// Clicking the Dock icon brings the hidden window back.
fn on_run_event(app: &AppHandle, event: &RunEvent) {
    if let RunEvent::Reopen { has_visible_windows: false, .. } = event {
        tray::show_main(app);
    }
}
