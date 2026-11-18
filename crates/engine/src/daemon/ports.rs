//! Ports containers publish, listened for on the Mac and carried into the guest.

use std::collections::HashMap;
use std::io;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use contena_proto::{FORWARD_PORT, Forward, Port, Transport, datagram};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::io::{AsyncWriteExt, copy_bidirectional};
use tokio::net::{TcpListener, UdpSocket};
use tokio::task::JoinHandle;

use super::vmm::{Connection, Vmm};

/// A sender of datagrams that has been silent this long is forgotten.
const UDP_IDLE: Duration = Duration::from_secs(90);

#[derive(Debug, Default)]
pub(crate) struct Ports {
    listening: Mutex<HashMap<Port, JoinHandle<()>>>,
}

impl Ports {
    /// Starts listening for `port` on the Mac. The error is a sentence for whoever started the
    /// container: Docker shows it and the container doesn't start.
    pub(crate) fn publish(&self, port: Port, vmm: &Arc<Vmm>) -> Result<(), String> {
        let address = port.host();
        let failed = |error: io::Error| match error.kind() {
            io::ErrorKind::AddrInUse => {
                format!("Port {} is already in use on your Mac.", address.port())
            }
            io::ErrorKind::PermissionDenied => format!(
                "macOS doesn't let apps listen on {address}; ports below 1024 can only be published on every address."
            ),
            _ => format!("The Mac can't listen on {address}: {error}"),
        };
        let vmm = Arc::clone(vmm);
        let to = port.container();
        let serving = match port.transport {
            Transport::Tcp => {
                let listener =
                    bind(address, Type::STREAM).and_then(TcpListener::from_std).map_err(failed)?;
                tokio::spawn(serve_tcp(listener, vmm, to))
            }
            Transport::Udp => {
                let socket =
                    bind(address, Type::DGRAM).and_then(UdpSocket::from_std).map_err(failed)?;
                tokio::spawn(serve_udp(Arc::new(socket), vmm, to))
            }
        };
        let mut listening = self.listening.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(replaced) = listening.insert(port, serving) {
            replaced.abort();
        }
        Ok(())
    }

    pub(crate) fn unpublish(&self, port: &Port) {
        let serving = self.listening.lock().unwrap_or_else(PoisonError::into_inner).remove(port);
        if let Some(serving) = serving {
            serving.abort();
        }
    }

    /// Stops listening for every port, as when the VM goes off.
    pub(crate) fn clear(&self) {
        for (_, serving) in self.listening.lock().unwrap_or_else(PoisonError::into_inner).drain() {
            serving.abort();
        }
    }
}

/// A socket on `address`, of whichever std type `kind` makes. An IPv6 one takes IPv6 only: Docker
/// publishes a port on `0.0.0.0` and on `::` separately.
fn bind<T: From<Socket>>(address: SocketAddr, kind: Type) -> io::Result<T> {
    let protocol = if kind == Type::STREAM { Protocol::TCP } else { Protocol::UDP };
    let socket = Socket::new(Domain::for_address(address), kind, Some(protocol))?;
    if address.is_ipv6() {
        socket.set_only_v6(true)?;
    }
    socket.set_reuse_address(true)?;
    socket.set_nonblocking(true)?;
    socket.bind(&address.into())?;
    if kind == Type::STREAM {
        socket.listen(1024)?;
    }
    Ok(socket.into())
}

/// A connection into the guest that goes on to `to`.
async fn carried(vmm: &Vmm, transport: Transport, to: SocketAddr) -> io::Result<Connection> {
    let mut guest = vmm.connect(FORWARD_PORT).await.map_err(io::Error::other)?;
    let mut line = serde_json::to_vec(&Forward { transport, to })?;
    line.push(b'\n');
    guest.write_all(&line).await?;
    Ok(guest)
}

async fn serve_tcp(listener: TcpListener, vmm: Arc<Vmm>, to: SocketAddr) {
    while let Ok((mut client, _)) = listener.accept().await {
        let vmm = Arc::clone(&vmm);
        tokio::spawn(async move {
            let _ = client.set_nodelay(true);
            if let Ok(mut guest) = carried(&vmm, Transport::Tcp, to).await {
                // Either side hanging up ends the connection; there is nothing to report.
                let _ = copy_bidirectional(&mut client, &mut guest).await;
            }
        });
    }
}

/// Each sender gets its own connection into the guest, so the container's answers find their way
/// back to it.
async fn serve_udp(socket: Arc<UdpSocket>, vmm: Arc<Vmm>, to: SocketAddr) {
    let senders: Arc<Mutex<HashMap<SocketAddr, tokio::sync::mpsc::Sender<Vec<u8>>>>> =
        Arc::default();
    let mut packet = vec![0; datagram::MAX];
    while let Ok((length, sender)) = socket.recv_from(&mut packet).await {
        let known = senders.lock().unwrap_or_else(PoisonError::into_inner).get(&sender).cloned();
        let queue = if let Some(queue) = known {
            queue
        } else {
            let (queue, queued) = tokio::sync::mpsc::channel(64);
            senders.lock().unwrap_or_else(PoisonError::into_inner).insert(sender, queue.clone());
            let (socket, vmm, senders) =
                (Arc::clone(&socket), Arc::clone(&vmm), Arc::clone(&senders));
            tokio::spawn(async move {
                let _ = carry_udp(&socket, &vmm, sender, to, queued).await;
                senders.lock().unwrap_or_else(PoisonError::into_inner).remove(&sender);
            });
            queue
        };
        // A full queue drops the datagram, as a busy network would.
        let _ = queue.try_send(packet[..length].to_vec());
    }
}

async fn carry_udp(
    socket: &UdpSocket,
    vmm: &Vmm,
    sender: SocketAddr,
    to: SocketAddr,
    mut queued: tokio::sync::mpsc::Receiver<Vec<u8>>,
) -> io::Result<()> {
    let (mut from_guest, mut to_guest) = tokio::io::split(carried(vmm, Transport::Udp, to).await?);
    let mut answer = Vec::new();
    loop {
        tokio::select! {
            packet = queued.recv() => match packet {
                Some(packet) => datagram::write(&mut to_guest, &packet).await?,
                None => return Ok(()),
            },
            read = datagram::read(&mut from_guest, &mut answer) => {
                read?;
                socket.send_to(&answer, sender).await?;
            }
            () = tokio::time::sleep(UDP_IDLE) => return Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_port_in_use_is_refused() {
        let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = taken.local_addr().unwrap();
        let error = bind::<std::net::TcpListener>(address, Type::STREAM).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AddrInUse);
    }

    #[test]
    fn ipv4_and_ipv6_listen_on_the_same_port_side_by_side() {
        let first = bind::<std::net::TcpListener>("[::]:0".parse().unwrap(), Type::STREAM).unwrap();
        let port = first.local_addr().unwrap().port();
        let address = SocketAddr::from(([0, 0, 0, 0], port));
        bind::<std::net::TcpListener>(address, Type::STREAM).unwrap();
    }
}
