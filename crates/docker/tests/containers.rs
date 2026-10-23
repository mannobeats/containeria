//! Runs against a real Docker engine: `CONTAINERIA_DOCKER_SOCKET=... cargo test -- --ignored`.
//! Every container it makes is named `containeria-test-*` and removed at the end.

use std::path::PathBuf;
use std::pin::pin;

use containeria_docker::{
    ContainerAction, Docker, EnvVar, FileKind, Level, Restart, RunSpec, Utf8Decoder,
};
use futures::StreamExt;
use tokio::io::AsyncWriteExt;

fn socket() -> PathBuf {
    std::env::var_os("CONTAINERIA_DOCKER_SOCKET")
        .map_or_else(|| PathBuf::from("/var/run/docker.sock"), PathBuf::from)
}

#[tokio::test]
#[ignore = "needs a Docker engine"]
async fn runs_inspects_logs_lists_copies_and_opens_a_shell() {
    let docker = Docker::connect(&socket()).unwrap();
    let name = format!("containeria-test-{}", std::process::id());
    let spec = RunSpec {
        image: "busybox:1.38".to_owned(),
        name: Some(name.clone()),
        ports: Vec::new(),
        env: vec![EnvVar { key: "GREETING".to_owned(), value: "hi".to_owned() }],
        storage: Vec::new(),
        restart: Restart::No,
        command: Some(vec!["sh".into(), "-c".into(), "echo ERROR boom; sleep 300".into()]),
        platform: None,
    };
    let id = docker.run(&spec).await.unwrap();

    let details = docker.details(&id).await.unwrap();
    assert_eq!(details.name, name);
    assert!(details.env.iter().any(|var| var.key == "GREETING" && var.value == "hi"));

    let mut logs = pin!(docker.logs(&id, 100));
    let batch = logs.next().await.unwrap().unwrap();
    assert_eq!(batch[0].message, "ERROR boom");
    assert_eq!(batch[0].level, Level::Error);

    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("hello.txt");
    std::fs::write(&source, "hello from the Mac").unwrap();
    docker.upload(&id, "/tmp", vec![source]).await.unwrap();
    let files = docker.list_files(&id, "/tmp").await.unwrap();
    assert!(files.iter().any(|file| file.name == "hello.txt" && file.kind == FileKind::File));
    let copy = dir.path().join("copy.txt");
    docker.download(&id, "/tmp/hello.txt", &copy).await.unwrap();
    assert_eq!(std::fs::read_to_string(copy).unwrap(), "hello from the Mac");

    let mut shell = docker.shell(&id, 80, 24).await.unwrap();
    shell.input.write_all(b"echo $((6*7))\nexit\n").await.unwrap();
    let mut decoder = Utf8Decoder::default();
    let mut seen = String::new();
    while let Some(Ok(chunk)) = shell.output.next().await {
        seen.push_str(&decoder.push(&chunk));
    }
    assert!(seen.contains("42"), "{seen}");

    let mut debug = docker.debug_shell(&id, 80, 24).await.unwrap();
    debug.input.write_all(b"cat /proc/1/root/tmp/hello.txt; exit\n").await.unwrap();
    let mut seen = String::new();
    while let Some(Ok(chunk)) = debug.output.next().await {
        seen.push_str(&decoder.push(&chunk));
    }
    assert!(seen.contains("hello from the Mac"), "{seen}");

    docker.act(&id, ContainerAction::Remove).await.unwrap();
}
