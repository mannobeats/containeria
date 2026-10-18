use tauri::menu::{Menu, MenuBuilder, MenuEvent, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Wry};
use tauri_plugin_opener::OpenerExt;
use tauri_specta::Event;

use crate::events::{MenuCommand, Navigate};
use crate::settings_window::{self, SettingsPane};
use crate::tray;

const SETTINGS: &str = "settings";
const ABOUT: &str = "about";
const ENGINE_SETTINGS: &str = "engine-settings";
const DOCS: &str = "https://github.com/mannobeats/containeria#readme";
const ISSUES: &str = "https://github.com/mannobeats/containeria/issues/new/choose";

/// File menu items the main window handles, with their ids and shortcuts.
const COMMANDS: [(MenuCommand, &str, &str, Option<&str>); 7] = [
    (MenuCommand::RunContainer, "command:run", "Run Container…", Some("CmdOrCtrl+N")),
    (
        MenuCommand::NewComposeProject,
        "command:compose",
        "New Compose Project…",
        Some("CmdOrCtrl+Shift+N"),
    ),
    (
        MenuCommand::OpenComposeFile,
        "command:open-compose",
        "Open Compose File…",
        Some("CmdOrCtrl+O"),
    ),
    (MenuCommand::PullImage, "command:pull", "Pull Image…", None),
    (MenuCommand::BuildImage, "command:build", "Build Image…", Some("CmdOrCtrl+B")),
    (MenuCommand::NewMachine, "command:machine", "New Linux Machine…", None),
    (MenuCommand::NewConnection, "command:connection", "New Database Connection…", None),
];

/// The Engine menu's items.
const ENGINE: [(MenuCommand, &str, &str, Option<&str>); 4] = [
    (MenuCommand::StartEngine, "command:engine-start", "Start Engine", None),
    (MenuCommand::StopEngine, "command:engine-stop", "Stop Engine", None),
    (MenuCommand::RestartEngine, "command:engine-restart", "Restart Engine", None),
    (MenuCommand::OpenEngineShell, "command:engine-shell", "Open Engine Shell", None),
];

/// The Help menu's items the main window shows.
const HELP: [(MenuCommand, &str, &str, Option<&str>); 2] = [
    (MenuCommand::ShowShortcuts, "command:shortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+/")),
    (MenuCommand::CollectDiagnostics, "command:diagnostics", "Collect Diagnostics…", None),
];

/// Menu item id to the view it opens. Ids double as routes so the UI needs no lookup table.
const SECTIONS: [(&str, &str, &str); 6] = [
    ("/containers", "Containers", "CmdOrCtrl+1"),
    ("/images", "Images", "CmdOrCtrl+2"),
    ("/volumes", "Volumes", "CmdOrCtrl+3"),
    ("/networks", "Networks", "CmdOrCtrl+4"),
    ("/kubernetes", "Kubernetes", "CmdOrCtrl+5"),
    ("/machines", "Linux Machines", "CmdOrCtrl+6"),
];

/// The macOS menu bar: the standard app, Edit and Window menus plus Containeria's views, engine
/// and help.
pub(crate) fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let containeria = SubmenuBuilder::new(app, "Containeria")
        .text(ABOUT, "About Containeria")
        .separator()
        .item(&tauri::menu::MenuItem::with_id(
            app,
            SETTINGS,
            "Settings…",
            true,
            Some("CmdOrCtrl+,"),
        )?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide Containeria"))?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit Containeria"))?)
        .build()?;
    let mut file = SubmenuBuilder::new(app, "File");
    for (index, (_, id, label, accelerator)) in COMMANDS.into_iter().enumerate() {
        if index == 3 {
            file = file.separator();
        }
        file = file.item(&tauri::menu::MenuItem::with_id(app, id, label, true, accelerator)?);
    }
    let file = file
        .separator()
        .text("/import", "Import from Docker Desktop or OrbStack…")
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
        .text("/builds", "Builds")
        .separator()
        .text("/activity", "Activity")
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let mut engine = SubmenuBuilder::new(app, "Engine");
    for (index, (_, id, label, accelerator)) in ENGINE.into_iter().enumerate() {
        if index == 3 {
            engine = engine.separator();
        }
        engine = engine.item(&tauri::menu::MenuItem::with_id(app, id, label, true, accelerator)?);
    }
    let engine = engine.separator().text(ENGINE_SETTINGS, "Engine Settings…").build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;
    let mut help = SubmenuBuilder::new(app, "Help").text(DOCS, "Documentation");
    for (_, id, label, accelerator) in HELP {
        help = help.item(&tauri::menu::MenuItem::with_id(app, id, label, true, accelerator)?);
    }
    let help = help.separator().text(ISSUES, "Report an Issue").build()?;
    MenuBuilder::new(app)
        .items(&[&containeria, &file, &edit, &view, &engine, &window, &help])
        .build()
}

/// Settings opens its own window; routes open a view in the main window; web addresses open in
/// the browser.
pub(crate) fn handle(app: &AppHandle, event: &MenuEvent) {
    let id = event.id().as_ref();
    if id == SETTINGS || id == ABOUT || id == ENGINE_SETTINGS {
        let pane = match id {
            ABOUT => SettingsPane::About,
            ENGINE_SETTINGS => SettingsPane::Engine,
            _ => SettingsPane::General,
        };
        let _ = settings_window::open(app, pane);
    } else if let Some((command, ..)) =
        COMMANDS.iter().chain(&ENGINE).chain(&HELP).find(|(_, item, ..)| *item == id)
    {
        tray::show_main(app);
        let _ = command.emit(app);
    } else if id.starts_with("https://") {
        let _ = app.opener().open_url(id, None::<&str>);
    } else if id.starts_with('/') {
        tray::show_main(app);
        let _ = Navigate(id.to_owned()).emit(app);
    }
}
