//! The Mac, as the guest and its containers reach it.
//!
//! The guest takes the address [`MAC`] for itself, and Docker gives it to `host-gateway`. What
//! is sent there the agent answers in the Mac's place:
//!
//! - a TCP connection to any port is carried to that port on the Mac's own `localhost`, so a
//!   container reaches a server on the Mac that listens for nobody else;
//! - a datagram goes to the Mac's address on the network it shares with the guest;
//! - a DNS question is answered here when it asks where the Mac is, and passed to the resolvers
//!   the network named for everything else. `/etc/resolv.conf` names this resolver, containers
//!   copy that file, and so `host.docker.internal` means the Mac in each of them.
//!
//! The Mac's SSH agent is here too, as a socket containers mount.

use std::fs;
use std::io;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use contena_agent::dns;
use contena_proto::{HOST_PORT, MAC, REACHED, Reach, SSH_AGENT};
use tokio::io::{AsyncReadExt, AsyncWriteExt, copy_bidirectional};
use tokio::net::{TcpListener, TcpStream, UdpSocket, UnixListener};
use tokio_vsock::{VMADDR_CID_HOST, VsockAddr, VsockStream};

use crate::error::{Doing, Result};
use crate::system::run;

/// The resolvers the network named, as the DHCP client's script notes them.
pub(crate) const RESOLVERS: &str = "/run/resolvers";
const RESOLVER: &str = "/etc/resolv.conf";
const NAMES: [&str; 2] = ["host.docker.internal", "host.contena.internal"];
const DNS: u16 = 53;
/// Where connections to the Mac's address are turned to. Above the ports Docker picks from by
/// itself, since a container can't publish the port the guest listens on.
const CARRIER: u16 = 64321;
/// How long one resolver gets to answer.
const PATIENCE: Duration = Duration::from_secs(2);

/// Takes the Mac's address and starts answering for it.
pub(crate) async fn stand_in() -> Result<()> {
    let address = MAC.to_string();
    run("ip", &["addr", "add", &format!("{address}/32"), "dev", "lo"]).await?;
    // From containers, and from the guest itself: Docker pulls from a registry on the Mac.
    for chain in ["PREROUTING", "OUTPUT"] {
        let turn = ["-j", "REDIRECT", "--to-ports", &CARRIER.to_string()];
        run("iptables", &[&to_the_mac(chain, &address, "tcp")[..], &turn[..]].concat()).await?;
    }
    let questions = UdpSocket::bind((MAC, DNS)).await.doing("listen for DNS questions")?;
    let long_questions = TcpListener::bind((MAC, DNS)).await.doing("listen for DNS questions")?;
    let carrier = TcpListener::bind((Ipv4Addr::UNSPECIFIED, CARRIER))
        .await
        .doing("listen for connections to the Mac")?;
    fs::write(RESOLVER, format!("nameserver {address}\n")).doing("name the guest's resolver")?;
    tokio::spawn(answer_datagrams(Arc::new(questions)));
    tokio::spawn(answer_streams(long_questions));
    tokio::spawn(carry(carrier));
    tokio::spawn(lend_ssh_agent(ssh_agent_socket()?));
    Ok(())
}

/// Sends datagrams for the Mac to `mac_on_network`, the Mac's address on the network it shares
/// with the guest. They reach what listens on every address of the Mac, not on `localhost` only.
pub(crate) async fn send_datagrams_to(mac_on_network: Ipv4Addr) -> Result<()> {
    let address = MAC.to_string();
    let send = ["-j", "DNAT", "--to-destination", &mac_on_network.to_string()];
    run("iptables", &[&to_the_mac("PREROUTING", &address, "udp")[..], &send[..]].concat()).await
}

/// The start of a rule for what `chain` sees going to the Mac's `address`, DNS aside: that is
/// answered here.
fn to_the_mac<'a>(chain: &'a str, address: &'a str, protocol: &'a str) -> [&'a str; 11] {
    ["-t", "nat", "-A", chain, "-d", address, "-p", protocol, "!", "--dport", "53"]
}

/// A connection to `reach` on the Mac. An error when the Mac has nothing there.
pub(crate) async fn reach(reach: Reach) -> io::Result<VsockStream> {
    let mut mac = VsockStream::connect(VsockAddr::new(VMADDR_CID_HOST, HOST_PORT)).await?;
    let mut line = serde_json::to_vec(&reach)?;
    line.push(b'\n');
    mac.write_all(&line).await?;
    if mac.read_u8().await? != REACHED {
        return Err(io::Error::new(io::ErrorKind::ConnectionRefused, "nothing listens there"));
    }
    Ok(mac)
}

async fn carry(listener: TcpListener) {
    while let Ok((mut client, _)) = listener.accept().await {
        tokio::spawn(async move {
            // The port the client asked for, before its connection was turned to this one. One
            // that came here directly asked for nothing on the Mac.
            let Ok(asked) = rustix::net::sockopt::ip_original_dst(&client) else { return };
            if *asked.ip() != MAC {
                return;
            }
            match reach(Reach::Tcp { port: asked.port() }).await {
                Ok(mut mac) => {
                    let _ = client.set_nodelay(true);
                    // Either side hanging up ends the connection; there is nothing to report.
                    let _ = copy_bidirectional(&mut client, &mut mac).await;
                }
                // Closed as a refused connection is: at once, and not as one that ended well.
                Err(_) => {
                    let _ = socket2::SockRef::from(&client).set_linger(Some(Duration::ZERO));
                }
            }
        });
    }
}

fn ssh_agent_socket() -> Result<UnixListener> {
    if let Some(folder) = Path::new(SSH_AGENT).parent() {
        fs::create_dir_all(folder).doing("create the folder for the Mac's services")?;
    }
    let listener = UnixListener::bind(SSH_AGENT).doing("listen for the SSH agent's users")?;
    // A container's user is rarely root, and mounting the socket is already the say-so.
    fs::set_permissions(SSH_AGENT, fs::Permissions::from_mode(0o666))
        .doing("open the SSH agent's socket to every user")?;
    Ok(listener)
}

async fn lend_ssh_agent(listener: UnixListener) {
    while let Ok((mut client, _)) = listener.accept().await {
        tokio::spawn(async move {
            if let Ok(mut agent) = reach(Reach::SshAgent).await {
                let _ = copy_bidirectional(&mut client, &mut agent).await;
            }
        });
    }
}

async fn answer_datagrams(socket: Arc<UdpSocket>) {
    let mut packet = vec![0; 4096];
    loop {
        let Ok((length, asker)) = socket.recv_from(&mut packet).await else {
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        };
        let question = packet[..length].to_vec();
        let socket = Arc::clone(&socket);
        tokio::spawn(async move {
            let answer = match dns::answer(&question, &NAMES, MAC) {
                Some(answer) => Some(answer),
                None => match ask(&question).await {
                    Ok(answer) => Some(answer),
                    Err(_) => dns::failure(&question),
                },
            };
            if let Some(answer) = answer {
                let _ = socket.send_to(&answer, asker).await;
            }
        });
    }
}

fn resolvers() -> Vec<std::net::IpAddr> {
    dns::resolvers(&fs::read_to_string(RESOLVERS).unwrap_or_default())
}

/// Asks the network's resolvers, one after the other, until one answers.
async fn ask(question: &[u8]) -> io::Result<Vec<u8>> {
    for resolver in resolvers() {
        let local: SocketAddr = if resolver.is_ipv4() {
            (Ipv4Addr::UNSPECIFIED, 0).into()
        } else {
            (Ipv6Addr::UNSPECIFIED, 0).into()
        };
        let socket = UdpSocket::bind(local).await?;
        socket.connect((resolver, DNS)).await?;
        socket.send(question).await?;
        let mut answer = vec![0; usize::from(u16::MAX)];
        if let Ok(Ok(length)) = tokio::time::timeout(PATIENCE, socket.recv(&mut answer)).await {
            answer.truncate(length);
            return Ok(answer);
        }
    }
    Err(io::Error::new(io::ErrorKind::TimedOut, "no resolver answered"))
}

async fn answer_streams(listener: TcpListener) {
    while let Ok((client, _)) = listener.accept().await {
        tokio::spawn(async move {
            let _ = answer_stream(client).await;
        });
    }
}

/// DNS over TCP: each message follows its length. Questions about the Mac are answered here; the
/// first one that isn't hands the connection to the network's resolver.
async fn answer_stream(mut client: TcpStream) -> io::Result<()> {
    loop {
        let length = client.read_u16().await?;
        let mut question = vec![0; usize::from(length)];
        client.read_exact(&mut question).await?;
        if let Some(answer) = dns::answer(&question, &NAMES, MAC) {
            client.write_u16(u16::try_from(answer.len()).unwrap_or(u16::MAX)).await?;
            client.write_all(&answer).await?;
            continue;
        }
        let resolver = resolvers().into_iter().next().ok_or(io::ErrorKind::NotConnected)?;
        let mut resolver = TcpStream::connect((resolver, DNS)).await?;
        resolver.write_u16(length).await?;
        resolver.write_all(&question).await?;
        copy_bidirectional(&mut client, &mut resolver).await?;
        return Ok(());
    }
}
