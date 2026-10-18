use tauri::{ActivationPolicy, AppHandle, Manager};

use crate::settings_window;

/// Puts Containeria in the Dock before one of its windows shows.
pub(crate) fn show(app: &AppHandle) {
    let _ = app.set_activation_policy(ActivationPolicy::Regular);
}

/// Takes Containeria out of the Dock once none of its windows is open, as menu bar apps do; the
/// menu bar icon still reaches it. `closing` is a window on its way out that still counts as open.
pub(crate) fn hide_unless_open(app: &AppHandle, closing: Option<&str>) {
    let open = ["main", settings_window::LABEL]
        .into_iter()
        .filter(|label| Some(*label) != closing)
        .any(|label| {
            app.get_webview_window(label).is_some_and(|window| window.is_visible().unwrap_or(false))
        });
    if !open {
        let _ = app.set_activation_policy(ActivationPolicy::Accessory);
    }
}
