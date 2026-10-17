use std::path::PathBuf;
use std::sync::Arc;

use containeria_data::{
    ChangeSet, Connection, ConnectionInput, Detected, ExportFormat, HistoryEntry, Namespace,
    QueryResult, RedisKeyPage, RedisValue, RowPage, RowsRequest, SavedQuery, ServerInfo,
};
use tauri::State;

use crate::error::Result;
use crate::state::AppState;

fn count(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_connections(state: State<'_, AppState>) -> Result<Vec<Connection>> {
    Ok(state.data.data.connections()?)
}

/// Databases running in containers. Empty while the engine is stopped.
#[tauri::command]
#[specta::specta]
pub(crate) async fn data_detected(state: State<'_, AppState>) -> Result<Vec<Detected>> {
    match state.engine.docker().await {
        Ok(docker) => Ok(state.data.data.detected(&docker).await?),
        Err(_) => Ok(Vec::new()),
    }
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_save_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<Connection> {
    Ok(state.data.data.save(input)?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_remove_connection(state: State<'_, AppState>, id: String) -> Result<()> {
    Ok(state.data.data.remove(&id).await?)
}

/// Dials the connection described in the sheet; returns the server's version.
#[tauri::command]
#[specta::specta]
pub(crate) async fn data_test_connection(
    state: State<'_, AppState>,
    input: ConnectionInput,
) -> Result<String> {
    Ok(state.data.data.test(input).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_connect(state: State<'_, AppState>, id: String) -> Result<ServerInfo> {
    let docker = state.engine.docker().await.ok();
    Ok(state.data.data.connect(&id, docker.as_ref()).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_disconnect(state: State<'_, AppState>, id: String) -> Result<()> {
    state.data.data.disconnect(&id).await;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_schema(
    state: State<'_, AppState>,
    id: String,
    refresh: bool,
) -> Result<Vec<Namespace>> {
    Ok(state.data.data.schema(&id, refresh).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_rows(
    state: State<'_, AppState>,
    id: String,
    request: RowsRequest,
) -> Result<RowPage> {
    Ok(state.data.data.rows(&id, &request).await?)
}

/// The SQL a commit would run, for the review sheet.
#[tauri::command]
#[specta::specta]
pub(crate) async fn data_preview_changes(
    state: State<'_, AppState>,
    id: String,
    changes: ChangeSet,
) -> Result<String> {
    Ok(state.data.data.preview(&id, &changes).await?)
}

/// Commits staged edits in one transaction; returns the rows changed.
#[tauri::command]
#[specta::specta]
pub(crate) async fn data_commit(
    state: State<'_, AppState>,
    id: String,
    changes: ChangeSet,
) -> Result<u32> {
    Ok(count(state.data.data.commit(&id, &changes).await?))
}

/// Runs editor SQL. `run_id` lets `data_cancel` stop it.
#[tauri::command]
#[specta::specta]
pub(crate) async fn data_run(
    state: State<'_, AppState>,
    id: String,
    sql: String,
    run_id: String,
) -> Result<QueryResult> {
    let data = Arc::clone(&state.data);
    let worker = Arc::clone(&data);
    data.cancellable(run_id, async move { Ok(worker.data.run(&id, &sql).await?) }).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_cancel(state: State<'_, AppState>, run_id: String) -> Result<()> {
    state.data.cancel(&run_id);
    Ok(())
}

/// Lets a production connection write for a while; safe mode comes back by itself.
#[tauri::command]
#[specta::specta]
pub(crate) async fn data_allow_writes(
    state: State<'_, AppState>,
    id: String,
    minutes: u32,
) -> Result<ServerInfo> {
    Ok(state.data.data.allow_writes(&id, minutes).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_safe_mode(state: State<'_, AppState>, id: String) -> Result<ServerInfo> {
    Ok(state.data.data.safe_mode(&id).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_history(state: State<'_, AppState>) -> Result<Vec<HistoryEntry>> {
    Ok(state.data.data.history()?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_saved_queries(state: State<'_, AppState>) -> Result<Vec<SavedQuery>> {
    Ok(state.data.data.saved_queries()?)
}

/// Saves a query; an empty id creates a new one.
#[tauri::command]
#[specta::specta]
pub(crate) async fn data_save_query(
    state: State<'_, AppState>,
    query: SavedQuery,
) -> Result<SavedQuery> {
    Ok(state.data.data.save_query(query)?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_delete_query(state: State<'_, AppState>, id: String) -> Result<()> {
    Ok(state.data.data.delete_query(&id)?)
}

/// Writes every row matching the request's filters to `path`; returns how many.
#[tauri::command]
#[specta::specta]
pub(crate) async fn data_export(
    state: State<'_, AppState>,
    id: String,
    request: RowsRequest,
    format: ExportFormat,
    path: String,
) -> Result<u32> {
    Ok(count(state.data.data.export(&id, &request, format, &PathBuf::from(path)).await?))
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_redis_keys(
    state: State<'_, AppState>,
    id: String,
    pattern: String,
    cursor: Option<String>,
) -> Result<RedisKeyPage> {
    Ok(state.data.data.redis_keys(&id, &pattern, cursor.as_deref()).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_redis_value(
    state: State<'_, AppState>,
    id: String,
    key: String,
) -> Result<RedisValue> {
    Ok(state.data.data.redis_value(&id, &key).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_redis_set(
    state: State<'_, AppState>,
    id: String,
    key: String,
    value: String,
) -> Result<()> {
    Ok(state.data.data.redis_set(&id, &key, &value).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn data_redis_delete(
    state: State<'_, AppState>,
    id: String,
    key: String,
) -> Result<()> {
    Ok(state.data.data.redis_delete(&id, &key).await?)
}
