//! Where Docker's port proxy, run as [`crate::proxy`], asks for a port to be published on the Mac.
//!
//! The proxy keeps its connection open for as long as it lives, so the connection closing means
//! the container's port is gone, however the proxy ended.

use std::fs;
use std::io;

use containeria_proto::{AgentCall, Port};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::error::{Doing, Result};
use crate::proxy::SOCKET;
use crate::serve::Engine;

pub(crate) fn bind() -> Result<UnixListener> {
    if let Some(folder) = std::path::Path::new(SOCKET).parent() {
        fs::create_dir_all(folder).doing("create the agent's folder")?;
    }
    UnixListener::bind(SOCKET).doing("listen for published ports")
}

pub(crate) async fn listen(listener: UnixListener, engine: Engine) {
    while let Ok((proxy, _)) = listener.accept().await {
        let engine = engine.clone();
        tokio::spawn(async move {
            let _ = publish(proxy, &engine).await;
        });
    }
}

async fn publish(proxy: UnixStream, engine: &Engine) -> io::Result<()> {
    let mut proxy = BufReader::new(proxy);
    let mut line = String::new();
    proxy.read_line(&mut line).await?;
    let port: Port = serde_json::from_str(&line)?;
    let published = engine.call(AgentCall::Publish(port)).await;
    let mut answer = serde_json::to_vec(&published)?;
    answer.push(b'\n');
    proxy.write_all(&answer).await?;
    if published.is_ok() {
        // Nothing more is sent; the read ends when the proxy does.
        let _ = proxy.read_to_end(&mut Vec::new()).await;
        let _ = engine.call(AgentCall::Unpublish(port)).await;
    }
    Ok(())
}
