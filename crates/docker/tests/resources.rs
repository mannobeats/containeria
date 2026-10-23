//! Runs against a real Docker engine: `cargo test -p containeria-docker -- --ignored`.
//! Uses `$CONTAINERIA_DOCKER_SOCKET`, or `/var/run/docker.sock`. Only touches `containeria-test-*`.

use std::path::PathBuf;

use containeria_docker::{Docker, NetworkSpec, Result};
use futures::TryStreamExt;

fn docker() -> Result<Docker> {
    let socket = std::env::var_os("CONTAINERIA_DOCKER_SOCKET")
        .map_or_else(|| PathBuf::from("/var/run/docker.sock"), PathBuf::from);
    Docker::connect(&socket)
}

#[tokio::test]
#[ignore = "needs a Docker engine"]
async fn volume_round_trip() -> Result<()> {
    let docker = docker()?;
    let (source, copy) = ("containeria-test-volume", "containeria-test-volume-copy");
    docker.create_volume(source).await?;
    docker.clone_volume(source, copy).await?;
    assert!(docker.volume_files(copy, "/").await?.is_empty());
    assert!(docker.volume_files(source, "../etc").await.is_err());
    assert!(docker.volumes().await?.iter().any(|volume| volume.name == source));

    let dir = tempfile::tempdir()?;
    let backup = dir.path().join("backup.tar.gz");
    docker.backup_volume(source, &backup).await?;
    assert!(backup.metadata()?.len() > 0);

    docker.remove_volume(copy).await?;
    docker.remove_volume(source).await?;
    Ok(())
}

#[tokio::test]
#[ignore = "needs a Docker engine"]
async fn image_pull_tag_and_remove() -> Result<()> {
    let docker = docker()?;
    let progress: Vec<_> = docker.pull("busybox:1.37").try_collect().await?;
    assert!(!progress.is_empty());
    docker.tag_image("busybox:1.37", "containeria-test-busybox:1").await?;
    let images = docker.images().await?;
    let tagged = images
        .iter()
        .find(|image| image.references.iter().any(|name| name == "containeria-test-busybox:1"))
        .unwrap();
    assert!(!docker.image(&tagged.id).await?.layers.is_empty());
    docker.remove_image("containeria-test-busybox:1", false).await?;
    Ok(())
}

#[tokio::test]
#[ignore = "needs a Docker engine"]
async fn network_lifecycle() -> Result<()> {
    let docker = docker()?;
    let spec = NetworkSpec {
        name: "containeria-test-net".into(),
        driver: "bridge".into(),
        subnet: None,
        gateway: None,
        internal: true,
        ipv6: false,
    };
    docker.create_network(spec).await?;
    let networks = docker.networks().await?;
    let network = networks.iter().find(|network| network.name == "containeria-test-net").unwrap();
    assert!(network.internal);
    assert!(docker.network(&network.id).await?.endpoints.is_empty());
    docker.remove_network(&network.id).await?;
    Ok(())
}
