use containeria_docker::{NetworkDetail, NetworkSpec, NetworkSummary};
use tauri::State;

use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub(crate) async fn networks_list(state: State<'_, AppState>) -> Result<Vec<NetworkSummary>> {
    Ok(state.engine.docker().await?.networks().await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn network_detail(
    state: State<'_, AppState>,
    id: String,
) -> Result<NetworkDetail> {
    Ok(state.engine.docker().await?.network(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn network_create(state: State<'_, AppState>, spec: NetworkSpec) -> Result<()> {
    Ok(state.engine.docker().await?.create_network(spec).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn network_remove(state: State<'_, AppState>, id: String) -> Result<()> {
    Ok(state.engine.docker().await?.remove_network(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn network_connect(
    state: State<'_, AppState>,
    network: String,
    container: String,
) -> Result<()> {
    Ok(state.engine.docker().await?.connect_network(&network, &container).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn network_disconnect(
    state: State<'_, AppState>,
    network: String,
    container: String,
) -> Result<()> {
    Ok(state.engine.docker().await?.disconnect_network(&network, &container).await?)
}
