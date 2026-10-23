use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use bytes::Bytes;
use http::{HeaderMap, Method, Request, Response, StatusCode, header};
use http_body_util::{BodyExt, Full};
use hyper::body::{Body, Incoming};
use hyper_util::rt::TokioIo;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::net::UnixStream;

use crate::{Error, Result};

/// The Incus REST API of the machines profile, over the Unix socket Colima forwards.
#[derive(Debug, Clone)]
pub struct Incus {
    socket: PathBuf,
}

/// A reply before its body is interpreted: file downloads are raw bytes, everything else JSON.
#[derive(Debug)]
pub(crate) struct Reply {
    pub(crate) status: StatusCode,
    pub(crate) headers: HeaderMap,
    pub(crate) body: Bytes,
}

#[derive(Debug, Deserialize)]
struct Envelope {
    #[serde(default)]
    error: String,
    #[serde(default)]
    error_code: u16,
    #[serde(default)]
    operation: String,
    #[serde(default)]
    metadata: Value,
}

#[derive(Debug, Deserialize)]
struct Operation {
    status: String,
    #[serde(default)]
    err: String,
    #[serde(default)]
    metadata: Option<serde_json::Map<String, Value>>,
}

impl Incus {
    #[must_use]
    pub fn new(socket: impl Into<PathBuf>) -> Self {
        Self { socket: socket.into() }
    }

    #[must_use]
    pub fn socket(&self) -> &Path {
        &self.socket
    }

    /// Checks the daemon answers.
    ///
    /// # Errors
    /// Fails when the socket is missing or Incus doesn't reply.
    pub async fn ping(&self) -> Result<()> {
        self.get::<Value>("/1.0").await.map(drop)
    }

    /// Whether Incus is in the middle of something: a download, a copy, an export, an open shell.
    ///
    /// # Errors
    /// Fails when Incus can't be reached.
    pub async fn is_busy(&self) -> Result<bool> {
        let operations: HashMap<String, Vec<Value>> = self.get("/1.0/operations").await?;
        Ok(operations.get("running").is_some_and(|running| !running.is_empty()))
    }

    pub(crate) async fn stream(&self) -> Result<UnixStream> {
        UnixStream::connect(&self.socket)
            .await
            .map_err(|_| Error::Unreachable(self.socket.display().to_string()))
    }

    /// Sends a request and hands back the response before its body is read, so a download can
    /// stream it.
    pub(crate) async fn respond<B>(
        &self,
        method: Method,
        path: &str,
        body: B,
        headers: &[(&str, &str)],
    ) -> Result<Response<Incoming>>
    where
        B: Body + Send + 'static,
        B::Data: Send,
        B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
    {
        let io = TokioIo::new(self.stream().await?);
        let (mut sender, connection) = hyper::client::conn::http1::handshake(io)
            .await
            .map_err(|error| Error::Protocol(error.to_string()))?;
        tokio::spawn(connection);
        let mut request = Request::builder().method(method).uri(path).header(header::HOST, "incus");
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let request = request.body(body).map_err(|error| Error::Protocol(error.to_string()))?;
        sender.send_request(request).await.map_err(|error| Error::Protocol(error.to_string()))
    }

    pub(crate) async fn send(
        &self,
        method: Method,
        path: &str,
        body: Bytes,
        headers: &[(&str, &str)],
    ) -> Result<Reply> {
        let response = self.respond(method, path, Full::new(body), headers).await?;
        read(response).await
    }

    async fn json(&self, method: Method, path: &str, body: Option<&Value>) -> Result<Envelope> {
        let bytes = body.map_or_else(Bytes::new, |body| Bytes::from(body.to_string()));
        let headers: &[(&str, &str)] =
            if body.is_some() { &[("content-type", "application/json")] } else { &[] };
        let reply = self.send(method, path, bytes, headers).await?;
        envelope(reply.status, &reply.body)
    }

    pub(crate) async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let envelope = self.json(Method::GET, path, None).await?;
        Ok(serde_json::from_value(envelope.metadata)?)
    }

    /// Changes some of an object's fields, such as an instance's config, in one synchronous call.
    pub(crate) async fn patch(&self, path: &str, body: &Value) -> Result<()> {
        self.json(Method::PATCH, path, Some(body)).await.map(drop)
    }

    /// Sends a request that starts a background operation and returns the operation's path.
    pub(crate) async fn start(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<String> {
        let envelope = self.json(method, path, body).await?;
        if envelope.operation.is_empty() {
            return Err(Error::Protocol(format!("{path} started no operation")));
        }
        Ok(envelope.operation)
    }

    /// Starts an operation and returns its own metadata, such as an exec's websocket secrets.
    pub(crate) async fn start_with_metadata(
        &self,
        path: &str,
        body: &Value,
    ) -> Result<(String, Value)> {
        let envelope = self.json(Method::POST, path, Some(body)).await?;
        let metadata = envelope.metadata.get("metadata").cloned().unwrap_or(Value::Null);
        Ok((envelope.operation, metadata))
    }

    /// Waits for an operation, reporting its `*_progress` messages, such as an image download.
    pub(crate) async fn wait(
        &self,
        operation: &str,
        mut on_progress: impl FnMut(String),
    ) -> Result<()> {
        const POLL: Duration = Duration::from_secs(1);
        let path = format!("{operation}/wait?timeout={}", POLL.as_secs());
        loop {
            let state: Operation = self.get(&path).await?;
            match state.status.as_str() {
                "Success" => return Ok(()),
                "Failure" | "Cancelled" => return Err(Error::Incus(state.err)),
                _ => {
                    if let Some(message) = state.metadata.as_ref().and_then(progress) {
                        on_progress(message);
                    }
                }
            }
        }
    }

    pub(crate) async fn run(&self, method: Method, path: &str, body: Option<&Value>) -> Result<()> {
        let operation = self.start(method, path, body).await?;
        self.wait(&operation, drop).await
    }

    /// Posts a raw body that starts an operation, such as a backup to import, and waits for it.
    pub(crate) async fn run_upload<B>(
        &self,
        path: &str,
        body: B,
        headers: &[(&str, &str)],
    ) -> Result<()>
    where
        B: Body + Send + 'static,
        B::Data: Send,
        B::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
    {
        let reply = read(self.respond(Method::POST, path, body, headers).await?).await?;
        let operation = envelope(reply.status, &reply.body)?.operation;
        if operation.is_empty() {
            return Err(Error::Protocol(format!("{path} started no operation")));
        }
        self.wait(&operation, drop).await
    }

    /// Starts a download, such as a backup's tarball, and returns its body unread.
    pub(crate) async fn download(&self, path: &str) -> Result<Incoming> {
        let response = self.respond(Method::GET, path, Full::new(Bytes::new()), &[]).await?;
        if response.status().is_success() {
            return Ok(response.into_body());
        }
        let reply = read(response).await?;
        envelope(reply.status, &reply.body)?;
        Err(Error::Incus(format!("{path} answered {}", reply.status)))
    }
}

async fn read(response: Response<Incoming>) -> Result<Reply> {
    let (parts, incoming) = response.into_parts();
    let body =
        incoming.collect().await.map_err(|error| Error::Protocol(error.to_string()))?.to_bytes();
    Ok(Reply { status: parts.status, headers: parts.headers, body })
}

fn envelope(status: StatusCode, body: &[u8]) -> Result<Envelope> {
    let envelope: Envelope = serde_json::from_slice(body)?;
    if status == StatusCode::NOT_FOUND || envelope.error_code == 404 {
        return Err(Error::NotFound(envelope.error));
    }
    if !envelope.error.is_empty() || !status.is_success() {
        return Err(Error::Incus(envelope.error));
    }
    Ok(envelope)
}

/// Incus reports progress in metadata keys ending in `_progress`, like `download_progress`.
fn progress(metadata: &serde_json::Map<String, Value>) -> Option<String> {
    metadata
        .iter()
        .find(|(key, _)| key.ends_with("_progress"))
        .and_then(|(_, value)| value.as_str())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn reads_a_sync_reply() {
        let body = br#"{"type":"sync","status":"Success","status_code":200,"operation":"",
            "error_code":0,"error":"","metadata":{"api_version":"1.0"}}"#;
        let envelope = envelope(StatusCode::OK, body).unwrap();
        assert_eq!(envelope.metadata["api_version"], "1.0");
    }

    #[test]
    fn turns_an_error_reply_into_an_error() {
        let body =
            br#"{"type":"error","error":"Instance not found","error_code":404,"metadata":null}"#;
        assert!(
            matches!(envelope(StatusCode::NOT_FOUND, body), Err(Error::NotFound(message)) if message == "Instance not found")
        );
        let body = br#"{"type":"error","error":"Name is invalid","error_code":400}"#;
        assert!(matches!(envelope(StatusCode::BAD_REQUEST, body), Err(Error::Incus(_))));
    }

    #[test]
    fn finds_the_progress_message() {
        let metadata =
            json!({ "create_instance_from_image_unpack_progress": "Unpack: 45%", "other": 1 });
        assert_eq!(progress(metadata.as_object().unwrap()).as_deref(), Some("Unpack: 45%"));
        assert_eq!(progress(json!({ "fds": {} }).as_object().unwrap()), None);
    }
}
