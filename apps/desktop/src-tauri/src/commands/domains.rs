use containeria_net::{CustomRoute, DomainsStatus};
use tauri::State;

use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub(crate) async fn domains_status(state: State<'_, AppState>) -> Result<DomainsStatus> {
    Ok(state.domains.status().await)
}

/// Turns domains on or off. On starts the DNS server and the proxy at once.
#[tauri::command]
#[specta::specta]
pub(crate) async fn domains_set_enabled(state: State<'_, AppState>, enabled: bool) -> Result<()> {
    state.domains.set_enabled(enabled).await?;
    // Fill the route table now rather than on the supervisor's next tick.
    if enabled && let Ok(docker) = state.engine.docker().await {
        state.domains.set_containers(docker.containers().await.unwrap_or_default());
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn domains_add_route(
    state: State<'_, AppState>,
    route: CustomRoute,
    replaces: Option<String>,
) -> Result<()> {
    Ok(state.domains.add_route(route, replaces.as_deref())?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn domains_remove_route(state: State<'_, AppState>, host: String) -> Result<()> {
    Ok(state.domains.remove_route(&host)?)
}

/// Asks macOS for an administrator password, then writes `/etc/resolver/<tld>`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn domains_install_resolver(state: State<'_, AppState>) -> Result<()> {
    Ok(state.domains.install_resolver().await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn domains_uninstall_resolver(state: State<'_, AppState>) -> Result<()> {
    Ok(state.domains.uninstall_resolver().await?)
}

/// Adds the local certificate authority to the login keychain; macOS asks the user to confirm.
#[tauri::command]
#[specta::specta]
pub(crate) async fn domains_trust_ca(state: State<'_, AppState>) -> Result<()> {
    Ok(state.domains.trust_ca().await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn domains_untrust_ca(state: State<'_, AppState>) -> Result<()> {
    Ok(state.domains.untrust_ca().await?)
}
