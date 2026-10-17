use tauri::menu::{Menu, MenuBuilder, MenuEvent, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Wry};
use tauri_plugin_opener::OpenerExt;
use tauri_specta::Event;

use crate::events::Navigate;
use crate::tray;

const DOCS: &str = "https://github.com/mannobeats/containeria#readme";
const ISSUES: &str = "https://github.com/mannobeats/containeria/issues/new/choose";

/// Menu item id to the view it opens. Ids double as routes so the UI needs no lookup table.
const SECTIONS: [(&str, &str, &str); 6] = [
    ("/containers", "Containers", "CmdOrCtrl+1"),
    ("/images", "Images", "CmdOrCtrl+2"),
    ("/volumes", "Volumes", "CmdOrCtrl+3"),
    ("/networks", "Networks", "CmdOrCtrl+4"),
    ("/kubernetes", "Kubernetes", "CmdOrCtrl+5"),
    ("/machines", "Linux machines", "CmdOrCtrl+6"),
];

/// The macOS menu bar: the standard app, Edit and Window menus plus Containeria's views.
pub(crate) fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let containeria = SubmenuBuilder::new(app, "Containeria")
        .text("/settings/about", "About Containeria")
        .separator()
        .item(&tauri::menu::MenuItem::with_id(
            app,
            "/settings",
            "Settings…",
            true,
            Some("CmdOrCtrl+,"),
        )?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File")
        .text("/welcome", "Import from Docker Desktop…")
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let mut view = SubmenuBuilder::new(app, "View");
    for (path, label, accelerator) in SECTIONS {
        view =
            view.item(&tauri::menu::MenuItem::with_id(app, path, label, true, Some(accelerator))?);
    }
    let view = view
        .separator()
        .text("/activity", "Activity")
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .text(DOCS, "Documentation")
        .text(ISSUES, "Report an issue")
        .build()?;
    MenuBuilder::new(app).items(&[&containeria, &file, &edit, &view, &window, &help]).build()
}

/// Routes open a view in the main window; web addresses open in the browser.
pub(crate) fn handle(app: &AppHandle, event: &MenuEvent) {
    let id = event.id().as_ref();
    if id.starts_with("https://") {
        let _ = app.opener().open_url(id, None::<&str>);
    } else if id.starts_with('/') {
        tray::show_main(app);
        let _ = Navigate(id.to_owned()).emit(app);
    }
}
