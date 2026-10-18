use containeria_docker::EngineInfo;
use containeria_engine::Host;
use objc2_foundation::{NSDateFormatter, NSLocale, ns_string};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalSize, State, Theme, WebviewWindow};

use tauri_specta::Event;

use crate::error::Result;
use crate::events::PreferencesChanged;
use crate::preferences::Preferences;
use crate::settings_window::{self, SettingsPane, ShownPane};
use crate::state::AppState;
use crate::tray;

#[tauri::command]
#[specta::specta]
pub(crate) async fn preferences_get(state: State<'_, AppState>) -> Result<Preferences> {
    Ok(state.preferences.get())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn preferences_set(
    app: AppHandle,
    state: State<'_, AppState>,
    preferences: Preferences,
) -> Result<()> {
    state.preferences.set(preferences)?;
    PreferencesChanged.emit(&app)?;
    let used = state.metrics.latest().await.map(|metrics| metrics.ledger.used_bytes);
    tray::show_memory(&app, used);
    Ok(())
}

/// How the Mac shows the time. The web view's `Intl` knows the region and time zone but not the
/// 24-hour switch in System Settings, which overrides the region.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Clock {
    pub(crate) hour12: bool,
}

#[tauri::command]
#[specta::specta]
pub(crate) fn clock() -> Clock {
    let locale = NSLocale::autoupdatingCurrentLocale();
    let hours =
        NSDateFormatter::dateFormatFromTemplate_options_locale(ns_string!("j"), 0, Some(&locale));
    Clock { hour12: hours.is_some_and(|format| uses_12_hour_clock(&format.to_string())) }
}

/// Reads the hour pattern macOS picks for the `j` skeleton: `h a` or `HH`.
fn uses_12_hour_clock(pattern: &str) -> bool {
    pattern.contains(['h', 'K'])
}

/// The Mac's chip, cores and memory, to size the engine's limits.
#[tauri::command]
#[specta::specta]
pub(crate) async fn host_info() -> Result<Host> {
    Ok(Host::detect().await?)
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) struct About {
    pub(crate) app_version: String,
    pub(crate) colima_version: Option<String>,
    /// `None` while the engine is stopped.
    pub(crate) engine: Option<EngineInfo>,
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn about(app: AppHandle, state: State<'_, AppState>) -> Result<About> {
    let engine = match state.engine.docker().await {
        Ok(docker) => docker.info().await.ok(),
        Err(_) => None,
    };
    Ok(About {
        app_version: app.package_info().version.to_string(),
        colima_version: state.engine.colima_version().await,
        engine,
    })
}

/// Brings the main window forward, for the menu bar popover.
#[tauri::command]
#[specta::specta]
pub(crate) async fn window_show_main(app: AppHandle) -> Result<()> {
    tray::show_main(&app);
    Ok(())
}

/// Sizes the calling window, the menu bar popover or Settings, to its content's height.
#[tauri::command]
#[specta::specta]
pub(crate) async fn window_fit(window: WebviewWindow, height: u32) -> Result<()> {
    let width = window.inner_size()?.to_logical::<f64>(window.scale_factor()?).width;
    Ok(window.set_size(LogicalSize::new(width, f64::from(height)))?)
}

/// Hides the calling window, as Esc dismisses the menu bar popover.
#[tauri::command]
#[specta::specta]
pub(crate) async fn window_hide(window: WebviewWindow) -> Result<()> {
    Ok(window.hide()?)
}

/// Opens Settings at a pane, or switches the open Settings window to it.
#[tauri::command]
#[specta::specta]
pub(crate) async fn settings_open(app: AppHandle, pane: SettingsPane) -> Result<()> {
    Ok(settings_window::open(&app, pane)?)
}

/// The pane the Settings window should show.
#[tauri::command]
#[specta::specta]
pub(crate) async fn settings_pane(shown: State<'_, ShownPane>) -> Result<SettingsPane> {
    Ok(shown.get())
}

#[derive(Debug, Clone, Copy, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Appearance {
    System,
    Light,
    Dark,
}

/// Matches the native materials, the sidebar and the menu bar popover, to the page's appearance.
#[tauri::command]
#[specta::specta]
pub(crate) async fn app_set_appearance(app: AppHandle, appearance: Appearance) -> Result<()> {
    app.set_theme(match appearance {
        Appearance::System => None,
        Appearance::Light => Some(Theme::Light),
        Appearance::Dark => Some(Theme::Dark),
    });
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn app_quit(app: AppHandle) -> Result<()> {
    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_hour_pattern() {
        assert!(uses_12_hour_clock("h a"));
        assert!(!uses_12_hour_clock("HH"));
    }
}
