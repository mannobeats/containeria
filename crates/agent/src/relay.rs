//! Connections from the Mac, carried to where they belong in the guest.

use std::io;
use std::net::SocketAddr;

use contena_agent::daemon::SOCKET;
use contena_proto::{Forward, Transport, datagram};
use tokio::io::{AsyncBufReadExt, BufReader, copy_bidirectional};
use tokio::net::{TcpStream, UdpSocket, UnixStream};
use tokio_vsock::{VsockListener, VsockStream};

/// Every connection is Docker's socket, byte for byte.
pub(crate) async fn docker(listener: VsockListener) {
    while let Ok((mut stream, _)) = listener.accept().await {
        tokio::spawn(async move {
            if let Ok(mut socket) = UnixStream::connect(SOCKET).await {
                // Either side hanging up ends the connection; there is nothing to report.
                let _ = copy_bidirectional(&mut stream, &mut socket).await;
            }
        });
    }
}

/// Every connection names where it goes on its first line, then is that connection.
pub(crate) async fn forward(listener: VsockListener) {
    while let Ok((stream, _)) = listener.accept().await {
        tokio::spawn(async move {
            let _ = carry(stream).await;
        });
    }
}

async fn carry(stream: VsockStream) -> io::Result<()> {
    let mut stream = BufReader::new(stream);
    let mut line = String::new();
    stream.read_line(&mut line).await?;
    let Forward { transport, to } = serde_json::from_str(&line)?;
    match transport {
        Transport::Tcp => {
            let mut target = TcpStream::connect(to).await?;
            copy_bidirectional(&mut stream, &mut target).await?;
            Ok(())
        }
        Transport::Udp => datagrams(stream, to).await,
    }
}

/// One sender's datagrams, each framed on the stream, to and from the container.
async fn datagrams(stream: BufReader<VsockStream>, to: SocketAddr) -> io::Result<()> {
    let local: SocketAddr =
        if to.is_ipv4() { ([0, 0, 0, 0], 0).into() } else { ([0; 16], 0).into() };
    let socket = UdpSocket::bind(local).await?;
    socket.connect(to).await?;
    let (mut incoming, mut outgoing) = tokio::io::split(stream);
    let to_container = async {
        let mut packet = Vec::new();
        loop {
            datagram::read(&mut incoming, &mut packet).await?;
            socket.send(&packet).await?;
        }
    };
    let from_container = async {
        let mut packet = vec![0; datagram::MAX];
        loop {
            let length = socket.recv(&mut packet).await?;
            datagram::write(&mut outgoing, &packet[..length]).await?;
        }
    };
    tokio::select! {
        ended = to_container => ended,
        ended = from_container => ended,
    }
}
