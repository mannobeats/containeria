//! The Containeria desktop app: the window, the menu bar item and the commands the UI calls.

mod commands;
mod data;
mod domains;
mod engine;
mod error;
mod events;
mod ipc;
mod kubernetes;
mod machines;
mod menu;
mod metrics;
mod preferences;
mod settings_window;
mod shells;
mod state;
mod streams;
mod tray;

use std::sync::Arc;

use containeria_engine::Home;
use containeria_net::Domains;
use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};

use crate::data::DataState;
use crate::engine::Engine;
use crate::kubernetes::Kubernetes;
use crate::machines::MachinesEngine;
use crate::metrics::Sampler;
use crate::preferences::PreferencesStore;
use crate::shells::Shells;
use crate::state::AppState;
use crate::streams::Streams;

/// Starts the app and blocks until it quits.
///
/// # Errors
/// Fails when Tauri can't create the app.
pub fn run() -> tauri::Result<()> {
    // kube logs every failed request at error level, including the refused connections and 503s
    // of a cluster that is still booting. The app already shows that as Kubernetes starting.
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("error,kube_client::client=off"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
    let ipc = ipc::builder();
    tauri::Builder::default()
        // Opening the app again, from Finder or Spotlight, brings back its window even when hidden.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show_main(app)))
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
            let state = app_state(app.handle())?;
            let background = Background::from(&state);
            // Registered before any task starts: the tasks read it through the app handle.
            app.manage(state);
            app.manage(settings_window::ShownPane::default());
            background.spawn(app.handle());
            tray::install(app.handle())?;
            Ok(())
        })
        .build(tauri::generate_context!())?
        .run(|app, event| on_run_event(app, &event));
    Ok(())
}

fn app_state(app: &AppHandle) -> Result<AppState, Box<dyn std::error::Error>> {
    let bundled_bin = app.path().resource_dir().ok().map(|dir| dir.join("bin"));
    let home = Home::from_env()?;
    let engine = Arc::new(Engine::new(bundled_bin.as_deref())?);
    let bundled_colima = bundled_bin.map(|dir| dir.join("colima"));
    Ok(AppState {
        data: Arc::new(DataState::new(&home.root().join("data"))),
        machines: MachinesEngine::new(home.clone(), bundled_colima.as_deref()),
        domains: Arc::new(Domains::open(&home.root().join("net"))?),
        kubernetes: Arc::new(Kubernetes::default()),
        metrics: Arc::new(Sampler::default()),
        preferences: PreferencesStore::open(engine.home().root()),
        engine,
        shells: Shells::default(),
        streams: Streams::default(),
    })
}

/// The long-running tasks: Docker events, metrics, Kubernetes watches and the domains service.
struct Background {
    engine: Arc<Engine>,
    metrics: Arc<Sampler>,
    kubernetes: Arc<Kubernetes>,
    domains: Arc<Domains>,
}

impl From<&AppState> for Background {
    fn from(state: &AppState) -> Self {
        Self {
            engine: Arc::clone(&state.engine),
            metrics: Arc::clone(&state.metrics),
            kubernetes: Arc::clone(&state.kubernetes),
            domains: Arc::clone(&state.domains),
        }
    }
}

impl Background {
    fn spawn(self, app: &AppHandle) {
        let Self { engine, metrics, kubernetes, domains } = self;
        let (watcher, handle) = (Arc::clone(&engine), app.clone());
        tauri::async_runtime::spawn(async move { watcher.watch(handle).await });
        let (sampled, handle) = (Arc::clone(&engine), app.clone());
        tauri::async_runtime::spawn(async move { metrics.run(sampled, handle).await });
        let (for_kube, handle) = (Arc::clone(&engine), app.clone());
        tauri::async_runtime::spawn(async move { kubernetes.watch(&for_kube, handle).await });
        tauri::async_runtime::spawn(domains::supervise(domains, engine));
    }
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
