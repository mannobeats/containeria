use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Effect, EffectState};
use tauri::{
    AppHandle, LogicalPosition, Manager, Rect, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

use crate::state::AppState;

const TRAY: &str = "main";
const POPOVER: &str = "tray";
const POPOVER_WIDTH: f64 = 340.0;
/// A first guess; the popover sizes itself to its content once it renders.
const POPOVER_HEIGHT: f64 = 320.0;
/// A click on the icon while the popover shows takes the popover's focus as the button goes
/// down, which hides it, and is reported as a click when the button comes up. Within this long
/// of being hidden that way, the click is the one that closed it and must not open it again.
const SAME_CLICK: Duration = Duration::from_millis(400);

/// When the popover last hid because it lost focus.
static DISMISSED: Mutex<Option<Instant>> = Mutex::new(None);

/// The menu bar item: a template icon, the engine's memory beside it, and a popover on click.
pub(crate) fn install(app: &AppHandle) -> tauri::Result<()> {
    // The popover material draws the panel, its rounded corners and, through them, the system
    // shadow; the window itself stays exactly the size of what it shows.
    let material = WindowEffectsConfig {
        effects: vec![Effect::Popover],
        state: Some(EffectState::Active),
        radius: Some(10.0),
        color: None,
        interactive: false,
    };
    let popover = WebviewWindowBuilder::new(app, POPOVER, WebviewUrl::App("tray.html".into()))
        .title("Contena")
        .inner_size(POPOVER_WIDTH, POPOVER_HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .effects(material)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    let hide = popover.clone();
    popover.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(false)) {
            *DISMISSED.lock().unwrap_or_else(PoisonError::into_inner) = Some(Instant::now());
            let _ = hide.hide();
        }
    });

    TrayIconBuilder::with_id(TRAY)
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("Contena")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_popover(tray, rect);
            }
        })
        .build(app)?;

    Ok(())
}

/// Shows the engine's memory beside the icon, or nothing while it's stopped or the setting is off.
pub(crate) fn show_memory(app: &AppHandle, used_bytes: Option<u64>) {
    let wanted = app.state::<AppState>().preferences.get().memory_in_menu_bar;
    let title = used_bytes.filter(|_| wanted).map(format_memory);
    if let Some(tray) = app.tray_by_id(TRAY) {
        let _ = tray.set_title(title);
    }
}

fn toggle_popover(tray: &TrayIcon, rect: Rect) {
    let Some(popover) = tray.app_handle().get_webview_window(POPOVER) else { return };
    if popover.is_visible().unwrap_or(false) {
        let _ = popover.hide();
        return;
    }
    let dismissed = DISMISSED.lock().unwrap_or_else(PoisonError::into_inner).take();
    if closed_by_this_click(dismissed.map(|at| at.elapsed())) {
        return;
    }
    let _ = place_under(&popover, rect);
    let _ = popover.show();
    let _ = popover.set_focus();
}

/// Whether the click being handled is the one that just closed the popover, given how long ago
/// it hid for losing focus.
fn closed_by_this_click(hidden_for: Option<Duration>) -> bool {
    hidden_for.is_some_and(|hidden_for| hidden_for < SAME_CLICK)
}

/// Centres the popover under the icon, the way macOS places menu bar popovers.
fn place_under(popover: &WebviewWindow, rect: Rect) -> tauri::Result<()> {
    let scale = popover.scale_factor()?;
    let position = rect.position.to_logical::<f64>(scale);
    let size = rect.size.to_logical::<f64>(scale);
    let x = position.x + size.width / 2.0 - POPOVER_WIDTH / 2.0;
    popover.set_position(LogicalPosition::new(x, position.y + size.height + 4.0))
}

/// Brings the main window back, from the popover, the Dock or a menu.
pub(crate) fn show_main(app: &AppHandle) {
    if let Some(popover) = app.get_webview_window(POPOVER) {
        let _ = popover.hide();
    }
    if let Some(window) = app.get_webview_window("main") {
        crate::dock::show(app);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

const GIB: f64 = 1024.0 * 1024.0 * 1024.0;
const MIB: f64 = 1024.0 * 1024.0;

/// The menu bar reading, in Activity Monitor's units: `820 MB`, `1.2 GB`.
#[expect(clippy::cast_precision_loss, reason = "memory sizes fit an f64 exactly enough to print")]
pub(crate) fn format_memory(bytes: u64) -> String {
    let bytes = bytes as f64;
    if bytes >= GIB { format!("{:.1} GB", bytes / GIB) } else { format!("{:.0} MB", bytes / MIB) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_click_on_the_icon_closes_an_open_popover_and_stays_closed() {
        assert!(closed_by_this_click(Some(Duration::from_millis(30))));
        assert!(!closed_by_this_click(Some(Duration::from_secs(2))));
        assert!(!closed_by_this_click(None));
    }

    #[test]
    fn reads_like_activity_monitor() {
        assert_eq!(format_memory(820 * 1024 * 1024), "820 MB");
        assert_eq!(format_memory(1288 * 1024 * 1024), "1.3 GB");
        assert_eq!(format_memory(0), "0 MB");
    }
}
