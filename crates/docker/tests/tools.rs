//! Runs against a real Docker engine with the Docker CLI and Compose installed:
//! `CONTAINERIA_DOCKER_SOCKET=... cargo test -p containeria-docker --test tools -- --ignored`.
//! Everything it makes is named `containeria-test-*` and removed at the end.

use std::path::PathBuf;

use containeria_docker::{
    BuildSpec, BuildStatus, Compose, ComposeFiles, ComposeVerb, ContainerAction, Docker, DockerCli,
    EnvVar, Restart, RunSpec,
};

fn socket() -> PathBuf {
    std::env::var_os("CONTAINERIA_DOCKER_SOCKET")
        .map_or_else(|| PathBuf::from("/var/run/docker.sock"), PathBuf::from)
}

#[tokio::test]
#[ignore = "needs a Docker engine"]
async fn recreates_a_container_with_its_name_settings_and_volume_data() {
    let docker = Docker::connect(&socket()).unwrap();
    let name = format!("containeria-test-recreate-{}", std::process::id());
    let spec = RunSpec {
        image: "busybox:1.37".to_owned(),
        name: Some(name.clone()),
        ports: Vec::new(),
        env: vec![EnvVar { key: "KEEP".to_owned(), value: "me".to_owned() }],
        storage: Vec::new(),
        restart: Restart::No,
        command: Some(vec!["sh".into(), "-c".into(), "sleep 300".into()]),
        platform: None,
    };
    let old = docker.run(&spec).await.unwrap();
    let new = docker.recreate(&old, false).await.unwrap();
    assert_ne!(old, new);
    let details = docker.details(&new).await.unwrap();
    assert_eq!(details.name, name);
    assert!(details.env.iter().any(|var| var.key == "KEEP" && var.value == "me"));
    assert!(docker.details(&old).await.is_err());
    docker.act(&new, ContainerAction::Remove).await.unwrap();
}

#[tokio::test]
#[ignore = "needs a Docker engine and the Docker CLI"]
async fn builds_exports_and_scans_an_image() {
    let docker = Docker::connect(&socket()).unwrap();
    let cli =
        DockerCli::locate(&socket(), None, None, std::path::Path::new("/tmp")).expect("docker CLI");
    let context = tempfile::tempdir().unwrap();
    std::fs::write(
        context.path().join("Dockerfile"),
        "FROM busybox:1.37\nARG WHO\nRUN echo \"hi $WHO\" > /hello\n",
    )
    .unwrap();
    let tag = format!("containeria-test-build:{}", std::process::id());
    let mut lines = Vec::new();
    cli.build(
        &BuildSpec {
            context: context.path().to_string_lossy().into_owned(),
            dockerfile: None,
            tag: tag.clone(),
            build_args: vec!["WHO=mac".to_owned()],
            no_cache: true,
            pull: false,
        },
        |line| lines.push(line),
    )
    .await
    .unwrap();
    assert!(lines.iter().any(|line| line.contains("naming to")), "{lines:?}");

    let archive = context.path().join("image.tar");
    docker.export_image(&tag, &archive).await.unwrap();
    assert!(std::fs::metadata(&archive).unwrap().len() > 1024);

    let report = docker.scan_image(&tag).await.unwrap();
    assert_eq!(report.reference, tag);

    docker.remove_image(&tag, true).await.unwrap();
}

#[tokio::test]
#[ignore = "needs a Docker engine and the Docker CLI with buildx"]
async fn finds_a_build_in_the_history_with_its_logs_and_removes_it() {
    let docker = Docker::connect(&socket()).unwrap();
    let cli =
        DockerCli::locate(&socket(), None, None, std::path::Path::new("/tmp")).expect("docker CLI");
    let context = tempfile::tempdir().unwrap();
    std::fs::write(
        context.path().join("Dockerfile"),
        "FROM busybox:1.37\nARG WHO\nRUN echo \"history for $WHO\"\n",
    )
    .unwrap();
    let tag = format!("containeria-test-build-history:{}", std::process::id());
    let before: Vec<String> = cli.builds().await.unwrap().into_iter().map(|b| b.id).collect();
    cli.build(
        &BuildSpec {
            context: context.path().to_string_lossy().into_owned(),
            dockerfile: None,
            tag: tag.clone(),
            build_args: vec!["WHO=containeria".to_owned()],
            no_cache: true,
            pull: false,
        },
        |_| {},
    )
    .await
    .unwrap();

    let ours: Vec<_> = cli
        .builds()
        .await
        .unwrap()
        .into_iter()
        .filter(|build| !before.contains(&build.id))
        .collect();
    assert_eq!(ours.len(), 1, "{ours:?}");
    let record = &ours[0];
    assert_eq!(record.status, BuildStatus::Completed);
    assert!(record.total_steps > 0 && record.completed_at_ms.is_some(), "{record:?}");

    let detail = cli.build_detail(&record.id).await.unwrap();
    assert!(detail.build_args.iter().any(|arg| arg.key == "WHO" && arg.value == "containeria"));
    let image = docker.image(&tag).await.unwrap();
    assert_eq!(detail.image_id.as_deref(), Some(image.id.as_str()));

    let mut lines = Vec::new();
    cli.build_logs(&record.id, |line| lines.push(line)).await.unwrap();
    assert!(lines.iter().any(|line| line.contains("history for containeria")), "{lines:?}");

    cli.remove_build(&record.id).await.unwrap();
    assert!(cli.builds().await.unwrap().iter().all(|build| build.id != record.id));
    let gone = cli.build_detail(&record.id).await;
    assert!(matches!(gone, Err(containeria_docker::Error::NotFound(_))), "{gone:?}");
    docker.remove_image(&tag, true).await.unwrap();
}

#[tokio::test]
#[ignore = "needs a Docker engine and Compose"]
async fn deploys_previews_and_removes_a_compose_project() {
    let compose = Compose::locate(&socket(), None).expect("docker compose");
    let folder = tempfile::tempdir().unwrap();
    let file = folder.path().join("compose.yaml");
    std::fs::write(&file, "services:\n  app:\n    image: busybox:1.37\n    command: sleep 300\n")
        .unwrap();
    let files = ComposeFiles { files: vec![file], directory: Some(folder.path().to_path_buf()) };
    let name = format!("containeria-test-compose-{}", std::process::id());
    let preview = compose.preview(&files, Some(&name)).await.unwrap();
    assert_eq!(preview.services[0].name, "app");
    compose.run(&files, &name, ComposeVerb::Up, |_| {}).await.unwrap();
    let docker = Docker::connect(&socket()).unwrap();
    assert_eq!(docker.project_containers(&name).await.unwrap().len(), 1);
    assert!(docker.compose_files(&name).await.unwrap().is_some());
    compose.run(&ComposeFiles::default(), &name, ComposeVerb::Down, |_| {}).await.unwrap();
    assert!(docker.project_containers(&name).await.unwrap().is_empty());
}

#[tokio::test]
#[ignore = "needs a Docker engine"]
async fn opens_a_root_shell_in_the_engine_vm() {
    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    let docker = Docker::connect(&socket()).unwrap();
    let mut shell = docker.engine_shell(120, 40).await.unwrap();
    shell.input.write_all(b"echo engine-$(id -u)-$(cat /proc/1/comm); exit\n").await.unwrap();
    let mut seen = String::new();
    while let Some(Ok(chunk)) = shell.output.next().await {
        seen.push_str(&String::from_utf8_lossy(&chunk));
        if seen.contains("engine-0-systemd") {
            break;
        }
    }
    assert!(seen.contains("engine-0-systemd"), "{seen}");
}

#[tokio::test]
#[ignore = "needs a Docker engine"]
async fn backs_up_and_restores_a_volume() {
    let docker = Docker::connect(&socket()).unwrap();
    let id = std::process::id();
    let (source, restored) =
        (format!("containeria-test-vol-{id}"), format!("containeria-test-restored-{id}"));
    docker.create_volume(&source).await.unwrap();
    let writer = RunSpec {
        image: "busybox:1.37".to_owned(),
        name: Some(format!("containeria-test-writer-{id}")),
        ports: Vec::new(),
        env: Vec::new(),
        storage: vec![containeria_docker::StorageMapping {
            source: source.clone(),
            target: "/d".to_owned(),
            read_only: false,
        }],
        restart: Restart::No,
        command: Some(vec![
            "sh".into(),
            "-c".into(),
            "mkdir -p /d/sub && echo kept > /d/sub/note".into(),
        ]),
        platform: None,
    };
    let container = docker.run(&writer).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    docker.act(&container, ContainerAction::Remove).await.unwrap();

    let folder = tempfile::tempdir().unwrap();
    let backup = folder.path().join("backup.tar.gz");
    docker.backup_volume(&source, &backup).await.unwrap();
    docker.restore_volume(&restored, &backup, false).await.unwrap();
    let files = docker.volume_files(&restored, "/sub").await.unwrap();
    assert!(files.iter().any(|file| file.name == "note"), "{files:?}");

    docker.remove_volume(&source).await.unwrap();
    docker.remove_volume(&restored).await.unwrap();
}

/// A throwaway Docker engine inside Containeria's, reached over TCP, to copy into.
async fn second_engine(name: &str) -> Result<Docker, Box<dyn std::error::Error>> {
    use bollard::models::{ContainerCreateBody, HostConfig, PortBinding};
    use bollard::query_parameters::{CreateContainerOptionsBuilder, CreateImageOptionsBuilder};
    use futures::TryStreamExt;

    let api = bollard::Docker::connect_with_socket(
        &socket().to_string_lossy(),
        120,
        bollard::API_DEFAULT_VERSION,
    )?;
    let pull = CreateImageOptionsBuilder::new().from_image("docker").tag("28-dind").build();
    api.create_image(Some(pull), None, None).try_collect::<Vec<_>>().await?;
    let body = ContainerCreateBody {
        image: Some("docker:28-dind".to_owned()),
        env: Some(vec!["DOCKER_TLS_CERTDIR=".to_owned()]),
        cmd: Some(vec!["--host=tcp://0.0.0.0:2375".to_owned()]),
        host_config: Some(HostConfig {
            privileged: Some(true),
            port_bindings: Some(std::collections::HashMap::from([(
                "2375/tcp".to_owned(),
                Some(vec![PortBinding {
                    host_ip: Some("127.0.0.1".to_owned()),
                    host_port: Some("23750".to_owned()),
                }]),
            )])),
            ..HostConfig::default()
        }),
        ..ContainerCreateBody::default()
    };
    let options = CreateContainerOptionsBuilder::new().name(name).build();
    let created = api.create_container(Some(options), body).await?;
    api.start_container(&created.id, None::<bollard::query_parameters::StartContainerOptions>)
        .await?;
    let target = Docker::connect_http("tcp://127.0.0.1:23750")?;
    for _ in 0..60 {
        if target.ping().await.is_ok() {
            return Ok(target);
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    Err("the second engine never answered".into())
}

#[tokio::test]
#[ignore = "needs a Docker engine that allows privileged containers"]
async fn copies_volumes_and_containers_to_another_engine() {
    let docker = Docker::connect(&socket()).unwrap();
    let id = std::process::id();
    let dind = format!("containeria-test-dind-{id}");
    let target = second_engine(&dind).await.unwrap();
    let volume = format!("containeria-test-move-{id}");
    docker.create_volume(&volume).await.unwrap();
    let app = RunSpec {
        image: "busybox:1.37".to_owned(),
        name: Some(format!("containeria-test-app-{id}")),
        ports: Vec::new(),
        env: vec![EnvVar { key: "KEEP".to_owned(), value: "me".to_owned() }],
        storage: vec![containeria_docker::StorageMapping {
            source: volume.clone(),
            target: "/d".to_owned(),
            read_only: false,
        }],
        restart: Restart::No,
        command: Some(vec!["sh".into(), "-c".into(), "echo moved > /d/note; sleep 300".into()]),
        platform: None,
    };
    let source_id = docker.run(&app).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    let inventory = docker.inventory().await.unwrap();
    let moving = inventory.volumes.iter().find(|moving| moving.name == volume).unwrap();
    assert_eq!(moving.in_use_by, [format!("containeria-test-app-{id}")]);
    assert!(inventory.containers.iter().any(|container| container.id == source_id));

    let copied = docker.copy_container_to(&target, &source_id, true).await.unwrap();
    let details = target.details(&copied).await.unwrap();
    assert!(details.env.iter().any(|var| var.key == "KEEP" && var.value == "me"));
    let files = target.volume_files(&volume, "/").await.unwrap();
    assert!(files.iter().any(|file| file.name == "note"), "{files:?}");

    docker.act(&source_id, ContainerAction::Remove).await.unwrap();
    docker.remove_volume(&volume).await.unwrap();
    let api = bollard::Docker::connect_with_socket(
        &socket().to_string_lossy(),
        120,
        bollard::API_DEFAULT_VERSION,
    )
    .unwrap();
    let options =
        bollard::query_parameters::RemoveContainerOptionsBuilder::new().force(true).v(true).build();
    api.remove_container(&dind, Some(options)).await.unwrap();
}
