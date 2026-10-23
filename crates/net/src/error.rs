use std::io;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("“{0}” isn't a valid host name; use a name like shop.test")]
    InvalidHost(String),

    #[error("there's no route for {0}")]
    UnknownRoute(String),

    #[error("you cancelled the macOS permission prompt")]
    Cancelled,

    #[error("{action} failed: {message}")]
    Command { action: &'static str, message: String },

    #[error("the certificate authority couldn't be used: {0}")]
    Certificate(#[from] rcgen::Error),

    #[error(
        "the certificate authority's file is damaged; delete ~/.containeria/net to create a new one"
    )]
    DamagedCertificate,

    #[error("TLS setup failed: {0}")]
    Tls(#[from] rustls::Error),

    #[error("the domain settings couldn't be read: {0}")]
    Settings(#[from] serde_json::Error),

    #[error(transparent)]
    Io(#[from] io::Error),
}
