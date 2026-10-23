use std::convert::Infallible;
use std::error::Error as StdError;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, PoisonError, RwLock};

use http_body_util::{Either, Full};
use hyper::body::{Bytes, Incoming};
use hyper::header::{CONTENT_TYPE, HOST, HeaderValue, UPGRADE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode, Uri};
use hyper_util::rt::TokioIo;
use rustls::ServerConfig;
use rustls::crypto::ring;
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::CertifiedKey;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;

use crate::ca::Authority;
use crate::error::Result;
use crate::host::normalize;
use crate::routes::RouteTable;

type Table = Arc<RwLock<RouteTable>>;
type Body = Either<Incoming, Full<Bytes>>;
type BoxError = Box<dyn StdError + Send + Sync>;

/// Binds the first of `ports` that is free on 127.0.0.1, so `http://name.containeria.local` works
/// without a port when 80 and 443 are available and falls back to a fixed high port otherwise.
///
/// # Errors
/// Fails when none of the ports can be bound.
pub(crate) async fn bind_first(ports: &[u16]) -> std::io::Result<TcpListener> {
    let mut last = std::io::Error::other("no port to bind");
    for &port in ports {
        match TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await {
            Ok(listener) => return Ok(listener),
            Err(error) => last = error,
        }
    }
    Err(last)
}

/// Serves plain HTTP until the task is dropped.
pub(crate) async fn serve_http(listener: TcpListener, table: Table) {
    loop {
        let Ok((stream, peer)) = listener.accept().await else { continue };
        let table = Arc::clone(&table);
        tokio::spawn(serve_connection(stream, peer, table, "http"));
    }
}

/// Serves HTTPS, with a certificate for each host from the local authority, until dropped.
pub(crate) async fn serve_https(listener: TcpListener, table: Table, tls: Arc<ServerConfig>) {
    let acceptor = TlsAcceptor::from(tls);
    loop {
        let Ok((stream, peer)) = listener.accept().await else { continue };
        let (acceptor, table) = (acceptor.clone(), Arc::clone(&table));
        tokio::spawn(async move {
            if let Ok(stream) = acceptor.accept(stream).await {
                serve_connection(stream, peer, table, "https").await;
            }
        });
    }
}

async fn serve_connection<S>(stream: S, peer: SocketAddr, table: Table, scheme: &'static str)
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let service = service_fn(move |request| proxy(request, peer, Arc::clone(&table), scheme));
    let _ =
        http1::Builder::new().serve_connection(TokioIo::new(stream), service).with_upgrades().await;
}

fn page(status: StatusCode, message: String) -> Response<Body> {
    let mut response = Response::new(Either::Right(Full::new(Bytes::from(message))));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static("text/plain; charset=utf-8"));
    response
}

fn request_host(request: &Request<Incoming>) -> Option<String> {
    let header = request.headers().get(HOST).and_then(|value| value.to_str().ok());
    header.or_else(|| request.uri().host()).and_then(normalize)
}

async fn proxy(
    request: Request<Incoming>,
    peer: SocketAddr,
    table: Table,
    scheme: &'static str,
) -> Result<Response<Body>, Infallible> {
    let Some(host) = request_host(&request) else {
        return Ok(page(StatusCode::BAD_REQUEST, "The request has no valid Host header.\n".into()));
    };
    let upstream = {
        let table = table.read().unwrap_or_else(PoisonError::into_inner);
        table.find(&host).map(|route| (route.container.clone(), route.upstream))
    };
    let response = match upstream {
        None => page(StatusCode::NOT_FOUND, format!("Containeria has no route for {host}.\n")),
        Some((container, None)) => page(
            StatusCode::BAD_GATEWAY,
            format!("{container} isn't running, or doesn't publish the port {host} points to.\n"),
        ),
        Some((container, Some(port))) => {
            forward(request, peer, port, scheme).await.unwrap_or_else(|error| {
                page(
                    StatusCode::BAD_GATEWAY,
                    format!("{container} didn't answer on port {port}: {error}\n"),
                )
            })
        }
    };
    Ok(response)
}

/// Sends the request to the container on its own connection, so WebSocket and other upgrades work.
async fn forward(
    mut request: Request<Incoming>,
    peer: SocketAddr,
    port: u16,
    scheme: &'static str,
) -> Result<Response<Body>, BoxError> {
    let stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await?;
    let (mut sender, connection) =
        hyper::client::conn::http1::handshake(TokioIo::new(stream)).await?;
    tokio::spawn(connection.with_upgrades());

    let client_upgrade =
        request.headers().contains_key(UPGRADE).then(|| hyper::upgrade::on(&mut request));
    let path = request.uri().path_and_query().map_or("/", |path| path.as_str()).to_owned();
    *request.uri_mut() = path.parse::<Uri>()?;
    let headers = request.headers_mut();
    headers.insert("x-forwarded-proto", HeaderValue::from_static(scheme));
    headers.insert("x-forwarded-for", HeaderValue::from_str(&peer.ip().to_string())?);

    let mut response = sender.send_request(request).await?;
    if response.status() == StatusCode::SWITCHING_PROTOCOLS
        && let Some(client) = client_upgrade
    {
        let upstream = hyper::upgrade::on(&mut response);
        tokio::spawn(async move {
            if let (Ok(client), Ok(upstream)) = (client.await, upstream.await) {
                let _ = tokio::io::copy_bidirectional(
                    &mut TokioIo::new(client),
                    &mut TokioIo::new(upstream),
                )
                .await;
            }
        });
    }
    Ok(response.map(Either::Left))
}

/// Picks the certificate for a TLS handshake: only for names the table routes.
#[derive(Debug)]
struct Certificates {
    authority: Arc<Authority>,
    table: Table,
}

impl ResolvesServerCert for Certificates {
    fn resolve(&self, hello: ClientHello<'_>) -> Option<Arc<CertifiedKey>> {
        let host = normalize(hello.server_name()?)?;
        let routed = self.table.read().unwrap_or_else(PoisonError::into_inner).resolves(&host);
        routed.then(|| self.authority.leaf(&host).ok()).flatten()
    }
}

/// TLS settings for the HTTPS listener.
///
/// # Errors
/// Fails if the TLS library rejects its own defaults.
pub(crate) fn tls_config(authority: Arc<Authority>, table: Table) -> Result<Arc<ServerConfig>> {
    let mut config = ServerConfig::builder_with_provider(Arc::new(ring::default_provider()))
        .with_safe_default_protocol_versions()?
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(Certificates { authority, table }));
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}

#[cfg(test)]
mod tests {
    use containeria_docker::{ContainerState, ContainerSummary, Port, PortProtocol};
    use rustls::pki_types::ServerName;
    use rustls::{ClientConfig, RootCertStore};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_rustls::TlsConnector;

    use super::*;
    use crate::routes::CustomRoute;

    /// A stand-in for a container: answers every request with its Host header and path.
    async fn echo_server() -> u16 {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let service = service_fn(|request: Request<Incoming>| async move {
                        let host = request
                            .headers()
                            .get(HOST)
                            .and_then(|value| value.to_str().ok())
                            .unwrap_or_default();
                        let proto = request
                            .headers()
                            .get("x-forwarded-proto")
                            .and_then(|value| value.to_str().ok())
                            .unwrap_or_default();
                        let body = format!("{host} {proto} {}", request.uri());
                        Ok::<_, Infallible>(Response::new(Full::new(Bytes::from(body))))
                    });
                    let _ =
                        http1::Builder::new().serve_connection(TokioIo::new(stream), service).await;
                });
            }
        });
        port
    }

    fn table(upstream: u16) -> Table {
        let container = ContainerSummary {
            id: "api".into(),
            name: "shop-api".into(),
            image: "shop/api".into(),
            state: ContainerState::Running,
            status: "Up".into(),
            project: None,
            service: None,
            pod: None,
            ports: vec![Port {
                container: 8080,
                host: Some(upstream),
                protocol: PortProtocol::Tcp,
            }],
            created_at: 0,
        };
        let custom = [CustomRoute {
            host: "shop.test".into(),
            container: "shop-api".into(),
            port: 8080,
            https: true,
        }];
        Arc::new(RwLock::new(RouteTable::build(
            "containeria.local",
            &[container],
            &[],
            &custom,
            true,
        )))
    }

    async fn get<S: AsyncRead + AsyncWrite + Unpin>(mut stream: S, host: &str) -> String {
        let request =
            format!("GET /hello?x=1 HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        response
    }

    #[tokio::test]
    async fn forwards_by_host_and_keeps_the_host_header() {
        let table = table(echo_server().await);
        let listener = bind_first(&[0]).await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(serve_http(listener, table));

        let response = get(TcpStream::connect(address).await.unwrap(), "v2.shop.test").await;
        assert!(response.starts_with("HTTP/1.1 200"), "{response}");
        assert!(response.ends_with("v2.shop.test http /hello?x=1"), "{response}");

        let missing =
            get(TcpStream::connect(address).await.unwrap(), "nothing.containeria.local").await;
        assert!(missing.starts_with("HTTP/1.1 404"), "{missing}");
    }

    #[tokio::test]
    async fn serves_https_with_a_certificate_from_the_local_authority() {
        let dir = tempfile::tempdir().unwrap();
        let authority = Arc::new(Authority::load_or_create(dir.path()).unwrap());
        let table = table(echo_server().await);
        let listener = bind_first(&[0]).await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(serve_https(
            listener,
            Arc::clone(&table),
            tls_config(Arc::clone(&authority), table).unwrap(),
        ));

        let pem = std::fs::read(authority.cert_path()).unwrap();
        let mut roots = RootCertStore::empty();
        roots.add(rustls::pki_types::pem::PemObject::from_pem_slice(&pem).unwrap()).unwrap();
        let client = ClientConfig::builder_with_provider(Arc::new(ring::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let stream = TlsConnector::from(Arc::new(client))
            .connect(
                ServerName::try_from("shop.test").unwrap(),
                TcpStream::connect(address).await.unwrap(),
            )
            .await
            .unwrap();
        let response = get(stream, "shop.test").await;
        assert!(response.ends_with("shop.test https /hello?x=1"), "{response}");
    }
}
