//! The engine, end to end: a real VM, real Docker, driven by the `docker` command.
//!
//! Needs the VM helper (`scripts/build-engine.sh`), the guest (`scripts/build-guest.sh`) and
//! the Docker CLI (`scripts/fetch-tools.sh`), and pulls two small images. Run with
//! `cargo test -p contena-engine -- --ignored`.

use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::{Duration, Instant};

use contena_engine::{Engine, EngineConfig, Home, Phase};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::process::Command;

type Outcome<T = ()> = Result<T, Box<dyn std::error::Error>>;

/// Fails the scenario without panicking, so the engine it started is always stopped.
macro_rules! ensure {
    ($held:expr, $($why:tt)+) => {
        if !$held {
            return Err(format!($($why)+).into());
        }
    };
}

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The engine binary Cargo built, with the helper and the guest linked beside it as they are in
/// the app bundle.
fn engine_program() -> Outcome<PathBuf> {
    let program = PathBuf::from(env!("CARGO_BIN_EXE_contena-engine"));
    let beside = program.parent().ok_or("the engine binary has no folder")?;
    for (name, built) in [
        ("contena-vmm", "apps/desktop/src-tauri/resources/engine/contena-vmm"),
        ("guest", "apps/desktop/src-tauri/resources/engine/guest"),
    ] {
        let built = repository().join(built);
        assert!(built.exists(), "{} is missing; see this file's first lines", built.display());
        let link = beside.join(name);
        // A link from before the parts moved points nowhere now.
        if std::fs::read_link(&link).ok().as_deref() != Some(built.as_path()) {
            let _ = std::fs::remove_file(&link);
            symlink(&built, &link)?;
        }
    }
    Ok(program)
}

struct Docker {
    program: PathBuf,
    socket: PathBuf,
}

impl Docker {
    fn new(home: &Home) -> Self {
        let bundled = repository().join("apps/desktop/src-tauri/resources/tools/bin/docker");
        let program = if bundled.is_file() { bundled } else { PathBuf::from("docker") };
        Self { program, socket: home.docker_socket() }
    }

    async fn run(&self, arguments: &[&str], input: &str) -> Outcome<Output> {
        let mut docker = Command::new(&self.program)
            .args(arguments)
            .env("DOCKER_HOST", format!("unix://{}", self.socket.display()))
            .env("DOCKER_CONFIG", self.socket.with_file_name("docker-config"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;
        let mut stdin = docker.stdin.take().ok_or("docker has no input")?;
        stdin.write_all(input.as_bytes()).await?;
        drop(stdin);
        Ok(docker.wait_with_output().await?)
    }

    /// Runs a command that must succeed and returns what it printed.
    async fn ok(&self, arguments: &[&str]) -> Outcome<String> {
        let output = self.run(arguments, "").await?;
        let errors = String::from_utf8_lossy(&output.stderr);
        ensure!(output.status.success(), "docker {arguments:?} failed: {errors}");
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }
}

async fn free_port() -> Outcome<u16> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    Ok(listener.local_addr()?.port())
}

async fn http_status(port: u16) -> std::io::Result<String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await?;
    stream.write_all(b"GET / HTTP/1.0\r\n\r\n").await?;
    let mut answer = String::new();
    stream.read_to_string(&mut answer).await?;
    Ok(answer.lines().next().unwrap_or_default().to_owned())
}

async fn phase_becomes(engine: &Engine, wanted: Phase, within: Duration) -> Outcome {
    let started = Instant::now();
    loop {
        let phase = engine.status().await.phase;
        if phase == wanted {
            return Ok(());
        }
        ensure!(started.elapsed() < within, "the engine is {phase:?}, not {wanted:?}");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "needs the VM helper, the guest and the Docker CLI; see the top of this file"]
async fn runs_containers_and_sleeps_between_them() -> Outcome {
    let folder = tempfile::tempdir()?;
    let home = Home::at(folder.path().join("home"));
    let config = EngineConfig { idle_seconds: 3, ..EngineConfig::default() };
    config.save(&home.config_file())?;
    let engine = Engine::locate(home.clone(), Some(&engine_program()?));
    ensure!(engine.status().await.phase == Phase::Stopped, "an engine already runs here");

    let outcome = scenario(&engine, &Docker::new(&home), folder.path()).await;
    engine.stop().await?;
    outcome?;
    ensure!(engine.status().await.phase == Phase::Stopped, "the engine didn't stop");
    ensure!(!home.docker_socket().exists(), "Docker's socket outlived the engine");
    Ok(())
}

async fn scenario(engine: &Engine, docker: &Docker, folder: &Path) -> Outcome {
    let started = Instant::now();
    engine.start().await?;
    ensure!(started.elapsed() < Duration::from_secs(10), "starting took {:?}", started.elapsed());
    let status = engine.status().await;
    ensure!(status.phase == Phase::Running && status.vm.is_some(), "not running: {status:?}");
    runs_and_shares(engine, docker, folder).await?;
    publishes_ports(engine, docker).await?;
    knows_the_mac(docker).await?;
    sees_changes_on_the_mac(docker, folder).await?;
    sleeps_and_keeps_data(engine, docker).await
}

/// Containers run, every connection is answered, and the Mac's folders are theirs too.
async fn runs_and_shares(engine: &Engine, docker: &Docker, folder: &Path) -> Outcome {
    // A container runs, and its input reaches it and ends when ours does.
    let said = docker.ok(&["run", "--rm", "alpine", "echo", "hello"]).await?;
    ensure!(said == "hello", "the container said {said:?}");
    let piped = docker.run(&["run", "-i", "--rm", "alpine", "cat"], "piped in").await?;
    ensure!(piped.stdout == b"piped in", "the container's input came back as {piped:?}");

    // Every new connection to Docker gets its answer. One in a hundred didn't, when the VM
    // helper let go of a connection the engine was still using.
    for attempt in 0..300 {
        let mut docker = tokio::net::UnixStream::connect(engine.home().docker_socket()).await?;
        docker.write_all(b"GET /_ping HTTP/1.0\r\n\r\n").await?;
        let mut answer = String::new();
        docker.read_to_string(&mut answer).await?;
        ensure!(answer.starts_with("HTTP/1.0 200"), "connection {attempt} was answered {answer:?}");
    }

    // A folder on the Mac is the same folder in a container, both ways.
    let shared = folder.join("shared");
    std::fs::create_dir(&shared)?;
    std::fs::write(shared.join("from-the-mac"), "read me")?;
    let mount = format!("{}:/shared", shared.display());
    let script = "cat /shared/from-the-mac && echo written > /shared/from-the-container";
    let read = docker.ok(&["run", "--rm", "-v", &mount, "alpine", "sh", "-c", script]).await?;
    ensure!(read == "read me", "the container read {read:?}");
    let written = std::fs::read_to_string(shared.join("from-the-container"))?;
    ensure!(written == "written\n", "the Mac read {written:?}");
    Ok(())
}

/// Published ports answer on the Mac, a port the Mac uses is refused with the reason, and a
/// container that publishes nothing is still reached through the engine.
async fn publishes_ports(engine: &Engine, docker: &Docker) -> Outcome {
    // A published port answers on the Mac, and stops answering with its container.
    let port = free_port().await?;
    let publish = format!("127.0.0.1:{port}:80");
    docker.ok(&["run", "-d", "--name", "web", "-p", &publish, "nginx:alpine"]).await?;
    let answered = Instant::now();
    while http_status(port).await.ok().as_deref() != Some("HTTP/1.1 200 OK") {
        ensure!(answered.elapsed() < Duration::from_secs(10), "nginx never answered on {port}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    docker.ok(&["rm", "-f", "web"]).await?;
    ensure!(TcpStream::connect(("127.0.0.1", port)).await.is_err(), "port {port} still answers");

    // A port the Mac already uses fails the container's start, and says so.
    let taken = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let publish = format!("127.0.0.1:{}:80", taken.local_addr()?.port());
    let clash = docker.run(&["run", "--rm", "-p", &publish, "nginx:alpine"], "").await?;
    let reason = String::from_utf8_lossy(&clash.stderr);
    ensure!(!clash.status.success(), "a container took a port the Mac was using");
    ensure!(reason.contains("is already in use on your Mac"), "the reason given was: {reason}");

    // The engine's way into the guest's network reaches a container that publishes no port,
    // which is how a domain name leads to one.
    docker.ok(&["run", "-d", "--name", "unpublished", "nginx:alpine"]).await?;
    let address = [
        "inspect",
        "-f",
        "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
        "unpublished",
    ];
    let to = std::net::SocketAddr::new(docker.ok(&address).await?.parse()?, 80);
    let asked = Instant::now();
    loop {
        let mut inside = tokio::net::UnixStream::connect(engine.home().inside_socket()).await?;
        let forward = contena_proto::Forward { transport: contena_proto::Transport::Tcp, to };
        inside.write_all(format!("{}\n", serde_json::to_string(&forward)?).as_bytes()).await?;
        inside.write_all(b"GET / HTTP/1.0\r\n\r\n").await?;
        let mut answer = String::new();
        // A connection the container isn't listening for yet ends without an answer.
        let _ = inside.read_to_string(&mut answer).await;
        if answer.starts_with("HTTP/1.1 200") {
            break;
        }
        ensure!(asked.elapsed() < Duration::from_secs(10), "{to} answered {answer:?}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    docker.ok(&["rm", "-f", "unpublished"]).await?;
    Ok(())
}

/// The guest knows where the Mac is and what time it is, and containers get their limits.
async fn knows_the_mac(docker: &Docker) -> Outcome {
    // `host.docker.internal` is the Mac in every container, with nothing added to it, and
    // reaches a server that listens for nobody but the Mac itself.
    let mac = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = mac.local_addr()?.port();
    let url = format!("http://host.docker.internal:{port}/");
    let serving = tokio::spawn(async move {
        while let Ok((mut client, _)) = mac.accept().await {
            let _ = client.write_all(b"HTTP/1.0 200 OK\r\n\r\nfrom the Mac").await;
        }
    });
    let ask = ["run", "--rm", "alpine", "wget", "-qO-", "-T", "5", &url];
    let answer = docker.ok(&ask).await?;
    ensure!(answer == "from the Mac", "a container asking the Mac got {answer:?}");
    // So does `host-gateway`, for a name of the user's own.
    let named = format!("http://the-mac:{port}/");
    let asked = ["run", "--rm", "--add-host", "the-mac:host-gateway", "alpine"];
    let answer =
        docker.ok(&[asked.as_slice(), &["wget", "-qO-", "-T", "5", &named]].concat()).await?;
    ensure!(answer == "from the Mac", "a container asking host-gateway got {answer:?}");
    // A port nothing listens on is refused at once, not left to time out.
    serving.abort();
    let _ = serving.await;
    let refused = Instant::now();
    let nothing = docker.run(&ask, "").await?;
    ensure!(!nothing.status.success(), "a closed port on the Mac answered");
    ensure!(
        refused.elapsed() < Duration::from_secs(4),
        "a closed port took {:?}",
        refused.elapsed()
    );
    // Names that are not the Mac's still resolve, over UDP and TCP.
    let resolved = docker.ok(&["run", "--rm", "alpine", "nslookup", "example.com"]).await?;
    ensure!(resolved.contains("Address"), "example.com resolved to {resolved:?}");

    // The Mac's SSH agent answers in a container, to a user who is not root.
    if std::env::var_os("SSH_AUTH_SOCK").is_some() {
        let here = Command::new("ssh-add").arg("-l").output().await?;
        let agent = contena_proto::SSH_AGENT;
        let mount = format!("{agent}:{agent}");
        let environment = format!("SSH_AUTH_SOCK={agent}");
        let listed = docker
            .run(
                &[
                    "run",
                    "--rm",
                    "--user",
                    "1000:1000",
                    "-v",
                    &mount,
                    "-e",
                    &environment,
                    "--entrypoint",
                    "ssh-add",
                    "alpine/git",
                    "-l",
                ],
                "",
            )
            .await?;
        let (here, there) =
            (String::from_utf8_lossy(&here.stdout), String::from_utf8_lossy(&listed.stdout));
        ensure!(here == there, "the Mac's agent lists {here:?}, the container sees {there:?}");
    }

    // A guest whose clock is wrong, as after the Mac slept, gets the Mac's time again.
    docker
        .ok(&["run", "--rm", "--privileged", "alpine", "date", "-s", "2020-01-01 00:00:00"])
        .await?;
    tokio::time::sleep(Duration::from_secs(5)).await;
    let guest: u64 = docker.ok(&["run", "--rm", "alpine", "date", "+%s"]).await?.parse()?;
    let here = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs();
    ensure!(guest.abs_diff(here) < 5, "the guest's clock is {guest}, the Mac's {here}");

    // Limits reach the container.
    let limit = ["run", "--rm", "-m", "64m", "alpine", "cat", "/sys/fs/cgroup/memory.max"];
    let limited = docker.ok(&limit).await?;
    ensure!(limited == "67108864", "the memory limit read {limited:?}");

    // Intel images run through Rosetta, where the Mac has it.
    if Path::new("/Library/Apple/usr/libexec/oah").exists() {
        let machine = ["run", "--rm", "--platform", "linux/amd64", "alpine", "uname", "-m"];
        let machine = docker.ok(&machine).await?;
        ensure!(machine == "x86_64", "an Intel image ran as {machine:?}");
    }
    Ok(())
}

/// What changes on the Mac is what a container sees at once, and what its watchers hear of.
async fn sees_changes_on_the_mac(docker: &Docker, folder: &Path) -> Outcome {
    let watched = folder.join("watched");
    std::fs::create_dir(&watched)?;
    let file = watched.join("page.html");
    std::fs::write(&file, "one")?;
    let mount = format!("{}:/watched", watched.display());
    docker.ok(&["run", "-d", "--name", "watching", "-v", &mount, "alpine", "sleep", "600"]).await?;
    let inside = |script: &'static str| async move {
        docker.ok(&["exec", "watching", "sh", "-c", script]).await
    };
    // The agent hears of the container's mount a moment after it starts.
    tokio::time::sleep(Duration::from_secs(1)).await;

    // With nothing watching: a file saved on the Mac has its new size and contents the moment
    // a container looks, and one saved by renaming a new file over it can be opened. Without
    // the engine telling the guest, each is the old file for up to a second.
    ensure!(inside("cat /watched/page.html").await? == "one", "the container can't read the file");
    for (round, saved) in ["one two", "one two three", "one two three four"].into_iter().enumerate()
    {
        if round % 2 == 0 {
            std::fs::write(&file, saved)?;
        } else {
            std::fs::write(watched.join(".page.html.new"), saved)?;
            std::fs::rename(watched.join(".page.html.new"), &file)?;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        let read = inside("stat -c %s /watched/page.html; cat /watched/page.html").await?;
        let wanted = format!("{}\n{saved}", saved.len());
        ensure!(read == wanted, "after save {round} the container read {read:?}");
    }

    // With something watching: each change on the Mac raises the event the same change in the
    // guest would. Busybox's `inotifyd` prints `c` for changed contents, `n` for a new file,
    // `d` for a deleted one, then the folder and the name.
    inside("inotifyd - /watched:cnd > /tmp/events 2>&1 & sleep 0.5").await?;
    let heard = |event: &'static str| async move {
        let started = Instant::now();
        loop {
            let events = docker.ok(&["exec", "watching", "cat", "/tmp/events"]).await?;
            if events.lines().any(|line| line == event) {
                return Ok::<_, Box<dyn std::error::Error>>(());
            }
            ensure!(
                started.elapsed() < Duration::from_secs(5),
                "no {event:?} among what the watcher heard: {events:?}"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    };
    std::fs::write(&file, "saved in place")?;
    heard("c\t/watched\tpage.html").await?;
    std::fs::write(watched.join("new.css"), "body {}")?;
    heard("n\t/watched\tnew.css").await?;
    std::fs::remove_file(watched.join("new.css"))?;
    heard("d\t/watched\tnew.css").await?;
    std::fs::write(watched.join(".page.html.new"), "saved by renaming")?;
    std::fs::rename(watched.join(".page.html.new"), &file)?;
    heard("n\t/watched\tpage.html").await?;
    ensure!(
        inside("cat /watched/page.html").await? == "saved by renaming",
        "the watcher was told before the container could read the new file"
    );
    docker.ok(&["rm", "-f", "watching"]).await?;

    // `/tmp` is the Mac's `/tmp`, as it is for programs on the Mac.
    let temporary = tempfile::tempdir_in("/tmp")?;
    std::fs::write(temporary.path().join("note"), "in /tmp")?;
    let mount = format!("{}:/note", temporary.path().display());
    let read = docker.ok(&["run", "--rm", "-v", &mount, "alpine", "cat", "/note/note"]).await?;
    ensure!(read == "in /tmp", "a folder in /tmp was read as {read:?}");
    Ok(())
}

/// The VM sleeps and wakes, and nothing written is lost over a sleep or a stop.
async fn sleeps_and_keeps_data(engine: &Engine, docker: &Docker) -> Outcome {
    // With nothing running the VM turns off, and the next command turns it back on with
    // everything still there.
    docker.ok(&["volume", "create", "kept"]).await?;
    phase_becomes(engine, Phase::Asleep, Duration::from_secs(30)).await?;
    let woke = Instant::now();
    let volumes = docker.ok(&["volume", "ls", "--format", "{{.Name}}"]).await?;
    ensure!(volumes.contains("kept"), "the volume is gone after sleeping: {volumes:?}");
    ensure!(woke.elapsed() < Duration::from_secs(5), "waking took {:?}", woke.elapsed());
    ensure!(engine.status().await.phase == Phase::Running, "the engine didn't wake");

    // What the guest wrote just before a stop is all there after it. The writer is a process
    // of the guest itself, outside any container, since Docker writes the disk out whenever it
    // takes a container down. It ignores being asked to end, so the shutdown takes its full
    // course: the disk is written out last, and the power must not go before that.
    let pattern = "yes contena | head -c 33554432";
    let writer = format!(
        "echo $$ > /sys/fs/cgroup/cgroup.procs; trap '' TERM; \
         (sleep 1; {pattern} > /var/lib/written-before-the-stop; sleep 600) >/dev/null 2>&1 &"
    );
    let guest = ["run", "--rm", "--privileged", "--pid=host", "alpine", "nsenter", "-t", "1", "-m"];
    docker.ok(&[guest.as_slice(), &["--", "sh", "-c", &writer]].concat()).await?;
    tokio::time::sleep(Duration::from_secs(2)).await;
    engine.stop().await?;
    engine.start().await?;
    let wanted = docker
        .ok(&["run", "--rm", "alpine", "sh", "-c", &format!("{pattern} | sha256sum")])
        .await?;
    let read = docker
        .ok(&[
            guest.as_slice(),
            &["--", "sh", "-c", "sha256sum < /var/lib/written-before-the-stop"],
        ]
        .concat())
        .await?;
    ensure!(read == wanted, "what the guest wrote before the stop came back different");

    // A hold wakes a sleeping VM by itself, and keeps it awake while nothing runs.
    phase_becomes(engine, Phase::Asleep, Duration::from_secs(30)).await?;
    let hold = engine.hold().await?;
    phase_becomes(engine, Phase::Running, Duration::from_secs(5)).await?;
    tokio::time::sleep(Duration::from_secs(8)).await;
    ensure!(engine.status().await.phase == Phase::Running, "the VM slept while held");
    drop(hold);
    phase_becomes(engine, Phase::Asleep, Duration::from_secs(30)).await
}
