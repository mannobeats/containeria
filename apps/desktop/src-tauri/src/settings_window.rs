use std::sync::{Mutex, PoisonError};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
use tauri_specta::Event;

use crate::events::SettingsPaneShown;

pub(crate) const LABEL: &str = "settings";
const WIDTH: f64 = 640.0;
/// A first guess; the window sizes itself to the pane once it renders.
const HEIGHT: f64 = 480.0;

/// A tab in the Settings window's toolbar.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SettingsPane {
    #[default]
    General,
    Engine,
    Storage,
    Kubernetes,
    Docker,
    Advanced,
    About,
}

impl SettingsPane {
    /// The window title, as macOS Settings windows show the pane's name.
    const fn title(self) -> &'static str {
        match self {
            Self::General => "General",
            Self::Engine => "Engine",
            Self::Storage => "Storage",
            Self::Kubernetes => "Kubernetes",
            Self::Docker => "Docker",
            Self::Advanced => "Advanced",
            Self::About => "About",
        }
    }
}

/// The pane the Settings window shows, so a window that opens reads where to start.
#[derive(Debug, Default)]
pub(crate) struct ShownPane(Mutex<SettingsPane>);

impl ShownPane {
    pub(crate) fn get(&self) -> SettingsPane {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn set(&self, pane: SettingsPane) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = pane;
    }
}

/// Opens Settings at `pane` in its own window, the Mac way, or brings it forward on that pane.
pub(crate) fn open(app: &AppHandle, pane: SettingsPane) -> tauri::Result<()> {
    app.state::<ShownPane>().set(pane);
    crate::dock::show(app);
    if let Some(window) = app.get_webview_window(LABEL) {
        window.set_title(pane.title())?;
        SettingsPaneShown(pane).emit_to(app, LABEL)?;
        window.unminimize()?;
        window.show()?;
        return window.set_focus();
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("settings.html".into()))
        .title(pane.title())
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .maximizable(false)
        .title_bar_style(TitleBarStyle::Overlay)
        // The page centres the title over its toolbar, as macOS Settings windows do.
        .hidden_title(true)
        .center()
        .build()?;
    Ok(())
}
