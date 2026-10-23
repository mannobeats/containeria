use std::pin::pin;

use containeria_engine::LogLine;
use containeria_kube::{Cluster, ConfigKind, Kube, KubeEvent, ResourceKind};
use futures::StreamExt;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::commands::shell::{ShellEvent, attach};
use crate::error::{CommandError, ErrorKind, Result};
use crate::kubernetes::PortForward;
use crate::shells::Resizer;
use crate::state::AppState;

async fn kube(state: &AppState) -> Result<Kube> {
    state.kubernetes.client(&state.engine).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_cluster(state: State<'_, AppState>) -> Result<Cluster> {
    Ok(kube(&state).await?.cluster().await?)
}

/// Turns Kubernetes on or off now and for every later start.
#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_set_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
    progress: Channel<LogLine>,
) -> Result<()> {
    if !enabled {
        state.kubernetes.forget().await;
    }
    state.engine.set_kubernetes(&app, enabled, |line| drop(progress.send(line))).await
}

/// Deletes every Kubernetes object and starts a fresh cluster. Docker is untouched.
#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_reset(
    state: State<'_, AppState>,
    progress: Channel<LogLine>,
) -> Result<()> {
    state.kubernetes.forget().await;
    state.engine.reset_kubernetes(|line| drop(progress.send(line))).await
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_create_namespace(
    state: State<'_, AppState>,
    name: String,
) -> Result<()> {
    Ok(kube(&state).await?.create_namespace(&name).await?)
}

/// The kubeconfig file the app and `kubectl` read the cluster from.
#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_kubeconfig_path() -> Result<String> {
    containeria_kube::kubeconfig_path()
        .map(|path| path.display().to_string())
        .ok_or_else(|| CommandError::new(ErrorKind::NotFound, "Your home folder can't be found."))
}

/// Opens a terminal in a pod's container (the first when `container` is `None`): bash when it has
/// one, sh otherwise. Output streams into `channel`; type with `shell_input`, resize with
/// `shell_resize`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_shell(
    state: State<'_, AppState>,
    namespace: String,
    pod: String,
    container: Option<String>,
    cols: u16,
    rows: u16,
    channel: Channel<ShellEvent>,
) -> Result<u32> {
    let shell = kube(&state).await?.shell(&namespace, &pod, container, cols, rows).await?;
    Ok(attach(&state, shell.output, Resizer::Pod(shell.resize), shell.input, channel))
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_delete_pod(
    state: State<'_, AppState>,
    namespace: String,
    name: String,
) -> Result<()> {
    Ok(kube(&state).await?.delete_pod(&namespace, &name).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_delete_deployment(
    state: State<'_, AppState>,
    namespace: String,
    name: String,
) -> Result<()> {
    Ok(kube(&state).await?.delete_deployment(&namespace, &name).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_restart_deployment(
    state: State<'_, AppState>,
    namespace: String,
    name: String,
) -> Result<()> {
    Ok(kube(&state).await?.restart_deployment(&namespace, &name).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_scale_deployment(
    state: State<'_, AppState>,
    namespace: String,
    name: String,
    replicas: u16,
) -> Result<()> {
    Ok(kube(&state).await?.scale_deployment(&namespace, &name, replicas).await?)
}

/// Server-side applies a manifest; returns what changed, one `kind/name configured` per object.
#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_apply(
    state: State<'_, AppState>,
    manifest: String,
    namespace: String,
    dry_run: bool,
) -> Result<Vec<String>> {
    Ok(kube(&state).await?.apply(&manifest, &namespace, dry_run).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_yaml(
    state: State<'_, AppState>,
    kind: ResourceKind,
    namespace: String,
    name: String,
) -> Result<String> {
    Ok(kube(&state).await?.yaml(kind, &namespace, &name).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_events(
    state: State<'_, AppState>,
    namespace: String,
    name: String,
) -> Result<Vec<KubeEvent>> {
    Ok(kube(&state).await?.events(&namespace, &name).await?)
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_config_value(
    state: State<'_, AppState>,
    kind: ConfigKind,
    namespace: String,
    name: String,
    key: String,
) -> Result<String> {
    Ok(kube(&state).await?.config_value(kind, &namespace, &name, &key).await?)
}

/// Streams a pod's log lines into `channel`, starting with the last 500.
#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_logs(
    state: State<'_, AppState>,
    namespace: String,
    pod: String,
    container: Option<String>,
    channel: Channel<String>,
) -> Result<u32> {
    let lines = kube(&state).await?.logs(&namespace, &pod, container, 500).await?;
    Ok(state.streams.spawn(async move {
        let mut lines = pin!(lines);
        while let Some(Ok(line)) = lines.next().await {
            if channel.send(line).is_err() {
                break;
            }
        }
    }))
}

/// Forwards `localhost:local_port` to a pod until stopped with `kubernetes_stop_forward`.
#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_port_forward(
    state: State<'_, AppState>,
    namespace: String,
    pod: String,
    local_port: u16,
    pod_port: u16,
) -> Result<PortForward> {
    let tunnel = kube(&state).await?.port_forward(&namespace, &pod, local_port, pod_port).await?;
    let stream = state.streams.spawn(tunnel);
    let forward = PortForward { stream, namespace, pod, local_port, pod_port };
    state.kubernetes.add_forward(forward.clone());
    Ok(forward)
}

/// Port forwards started in this session that are still running.
#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_forwards(state: State<'_, AppState>) -> Result<Vec<PortForward>> {
    Ok(state.kubernetes.forwards())
}

#[tauri::command]
#[specta::specta]
pub(crate) async fn kubernetes_stop_forward(state: State<'_, AppState>, stream: u32) -> Result<()> {
    state.kubernetes.remove_forward(stream);
    state.streams.cancel(stream);
    Ok(())
}
