use std::pin::pin;

use containeria_docker::{ContainerAction, ContainerSummary, StatsSample};
use futures::StreamExt;
use tauri::State;
use tauri::ipc::Channel;

use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub(crate) async fn containers_list(state: State<'_, AppState>) -> Result<Vec<ContainerSummary>> {
    Ok(state.engine.docker().await?.containers().await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn container_act(
    state: State<'_, AppState>,
    id: String,
    action: ContainerAction,
) -> Result<()> {
    Ok(state.engine.docker().await?.act(&id, action).await?)
}

/// Streams stats readings into `channel` until cancelled with `stream_cancel`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn container_stats(
    state: State<'_, AppState>,
    id: String,
    channel: Channel<StatsSample>,
) -> Result<u32> {
    let docker = state.engine.docker().await?;
    Ok(state.streams.spawn(async move {
        let mut readings = pin!(docker.stats(&id));
        while let Some(Ok(sample)) = readings.next().await {
            if channel.send(sample).is_err() {
                break;
            }
        }
    }))
}
