//! What the guest reaches on the Mac: the connections it opens, carried to where they name.
//!
//! This is how a container's `host.docker.internal` gets to a server that listens only on the
//! Mac's `localhost`, and how the SSH agent's socket appears inside the guest.

use std::io;
use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::PathBuf;

use contena_proto::{REACHED, Reach};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, copy_bidirectional};
use tokio::net::{TcpStream, UnixStream};
use tokio::sync::mpsc;

use super::vmm::Connection;

/// Carries each connection the guest opens until there are no more to come.
pub(crate) async fn serve(mut accepted: mpsc::UnboundedReceiver<Connection>) {
    while let Some(guest) = accepted.recv().await {
        tokio::spawn(async move {
            // A place that can't be reached is a closed connection to whoever asked for it.
            let _ = carry(guest).await;
        });
    }
}

async fn carry(guest: Connection) -> io::Result<()> {
    let mut guest = BufReader::new(guest);
    let mut line = String::new();
    guest.read_line(&mut line).await?;
    match serde_json::from_str(&line)? {
        Reach::SshAgent => {
            let mut agent = UnixStream::connect(ssh_agent()?).await?;
            guest.write_u8(REACHED).await?;
            copy_bidirectional(&mut guest, &mut agent).await?;
        }
        Reach::Tcp { port } => {
            let mut server = local(port).await?;
            server.set_nodelay(true)?;
            guest.write_u8(REACHED).await?;
            copy_bidirectional(&mut guest, &mut server).await?;
        }
    }
    Ok(())
}

/// A server on the Mac's own `localhost`, whichever of its two addresses it listens on.
async fn local(port: u16) -> io::Result<TcpStream> {
    match TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await {
        Ok(server) => Ok(server),
        Err(_) => TcpStream::connect((Ipv6Addr::LOCALHOST, port)).await,
    }
}

/// The SSH agent of whoever started the engine. macOS gives every app and terminal the socket of
/// its own agent; a terminal set up for another one, such as a password manager's, names that.
fn ssh_agent() -> io::Result<PathBuf> {
    std::env::var_os("SSH_AUTH_SOCK")
        .filter(|socket| !socket.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no SSH agent runs on this Mac"))
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;

    #[tokio::test]
    async fn reaches_a_server_that_listens_on_localhost_only() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut client, _) = listener.accept().await.unwrap();
            client.write_all(b"hello").await.unwrap();
        });
        let mut said = String::new();
        local(port).await.unwrap().read_to_string(&mut said).await.unwrap();
        assert_eq!(said, "hello");
    }

    #[tokio::test]
    async fn reaches_a_server_that_listens_on_ipv6_localhost_only() {
        let listener = TcpListener::bind((Ipv6Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut client, _) = listener.accept().await.unwrap();
            client.write_all(b"hello").await.unwrap();
        });
        let mut said = String::new();
        local(port).await.unwrap().read_to_string(&mut said).await.unwrap();
        assert_eq!(said, "hello");
    }
}
