//! The Containeria desktop app: the window, the menu bar item and the commands the UI calls.

mod commands;
mod data;
mod dock;
mod domains;
mod engine;
mod error;
mod events;
mod ipc;
mod kubernetes;
mod machines;
mod menu;
mod metrics;
mod notifications;
mod preferences;
mod settings_window;
mod shells;
mod state;
mod storage;
mod streams;
mod tray;

use std::sync::Arc;

use containeria_engine::Home;
use containeria_net::Domains;
use tauri::{ActivationPolicy, AppHandle, Manager, RunEvent, Window, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_window_state::StateFlags;

use crate::data::DataState;
use crate::engine::Engine;
use crate::kubernetes::Kubernetes;
use crate::machines::MachinesEngine;
use crate::metrics::Sampler;
use crate::preferences::PreferencesStore;
use crate::shells::Shells;
use crate::state::AppState;
use crate::streams::Streams;

/// Passed by the login item, so a launch at login stays in the menu bar.
const AT_LOGIN: &str = "--at-login";

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
        // The window starts hidden and the app decides whether it shows: not at login.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::Builder::new().arg(AT_LOGIN).build())
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
            notifications::open_on_click(app.handle());
            open_window_unless_at_login(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())?
        .run(|app, event| on_run_event(app, &event));
    Ok(())
}

fn app_state(app: &AppHandle) -> Result<AppState, Box<dyn std::error::Error>> {
    let tools = app.path().resource_dir().ok().map(|dir| dir.join("tools"));
    let home = Home::from_env()?;
    let engine = Arc::new(Engine::new(tools.as_deref())?);
    let bundled_colima = tools.map(|dir| dir.join("bin/colima"));
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

/// The long-running tasks: Docker events, metrics, Kubernetes watches, the domains service and
/// stopping the machines VM when idle.
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
        let for_domains = Arc::clone(&kubernetes);
        tauri::async_runtime::spawn(async move { kubernetes.watch(&for_kube, handle).await });
        tauri::async_runtime::spawn(domains::supervise(domains, engine, for_domains));
        tauri::async_runtime::spawn(machines::stop_when_idle(app.clone()));
        tauri::async_runtime::spawn(engine::start_with_app(app.clone()));
    }
}

/// Opened by hand, the window shows; opened at login, Containeria stays in the menu bar. A login
/// item saved before it passed `AT_LOGIN` is rewritten with it.
fn open_window_unless_at_login(app: &AppHandle) {
    let login = app.autolaunch();
    if login.is_enabled().unwrap_or(false) {
        let _ = login.enable();
    }
    if std::env::args().any(|arg| arg == AT_LOGIN) {
        let _ = app.set_activation_policy(ActivationPolicy::Accessory);
    } else {
        tray::show_main(app);
    }
}

/// Closing the main window hides it, and the Dock icon with it, while Containeria stays in the
/// menu bar. Closing Settings with the main window hidden takes the Dock icon away too.
fn on_window_event(window: &Window, event: &WindowEvent) {
    match event {
        WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
            if window.state::<AppState>().preferences.get().keep_running_in_menu_bar {
                api.prevent_close();
                let _ = window.hide();
                dock::hide_unless_open(window.app_handle(), None);
            } else {
                window.app_handle().exit(0);
            }
        }
        WindowEvent::Destroyed if window.label() == settings_window::LABEL => {
            dock::hide_unless_open(window.app_handle(), Some(settings_window::LABEL));
        }
        _ => {}
    }
}

/// Clicking the Dock icon brings the hidden window back.
fn on_run_event(app: &AppHandle, event: &RunEvent) {
    if let RunEvent::Reopen { has_visible_windows: false, .. } = event {
        tray::show_main(app);
    }
}
