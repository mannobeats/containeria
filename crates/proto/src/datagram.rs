//! Datagrams on a stream: each is its length as two bytes, big end first, then its bytes. A
//! forwarded UDP port speaks this between the Mac and the guest.

use std::io;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// The largest datagram there is.
pub const MAX: usize = 65_535;

/// Reads the next datagram into `packet`, replacing what it held.
///
/// # Errors
/// Fails when the stream ends or breaks; an end between datagrams is `UnexpectedEof` too.
pub async fn read<R: AsyncRead + Unpin>(stream: &mut R, packet: &mut Vec<u8>) -> io::Result<()> {
    let length = usize::from(stream.read_u16().await?);
    packet.resize(length, 0);
    stream.read_exact(packet).await?;
    Ok(())
}

/// Writes `packet` as one datagram.
///
/// # Errors
/// Fails when the stream breaks, or with `InvalidInput` when `packet` is longer than [`MAX`].
pub async fn write<W: AsyncWrite + Unpin>(stream: &mut W, packet: &[u8]) -> io::Result<()> {
    let length = u16::try_from(packet.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "a datagram holds 65535 bytes"))?;
    stream.write_u16(length).await?;
    stream.write_all(packet).await?;
    stream.flush().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn datagrams_keep_their_boundaries() {
        let (mut near, mut far) = tokio::io::duplex(1024);
        write(&mut near, b"one").await.unwrap();
        write(&mut near, b"").await.unwrap();
        write(&mut near, b"three").await.unwrap();
        let mut packet = Vec::new();
        for expected in [b"one".as_slice(), b"", b"three"] {
            read(&mut far, &mut packet).await.unwrap();
            assert_eq!(packet, expected);
        }
    }

    #[tokio::test]
    async fn a_datagram_too_long_is_refused() {
        let (mut near, _far) = tokio::io::duplex(16);
        let error = write(&mut near, &vec![0; MAX + 1]).await.unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
    }

    #[tokio::test]
    async fn the_stream_ending_is_an_error() {
        let (near, mut far) = tokio::io::duplex(16);
        drop(near);
        let error = read(&mut far, &mut Vec::new()).await.unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::UnexpectedEof);
    }
}
