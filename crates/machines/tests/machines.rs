//! Machines against a real engine: `cargo test -p contena-machines -- --ignored`, with the
//! engine running. `$CONTENA_DOCKER_SOCKET` names another Docker socket. The machines it
//! makes are named `contena-test-…` and removed again; the Ubuntu image it sets up stays.

use std::path::PathBuf;

use contena_machines::{CreateMachine, DISTROS, MachineAction, MachineState, Machines, User};

type Outcome<T = ()> = Result<T, Box<dyn std::error::Error>>;

macro_rules! ensure {
    ($held:expr, $($why:tt)+) => {
        if !$held {
            return Err(format!($($why)+).into());
        }
    };
}

const MACHINE: &str = "contena-test-machine";
const COPY: &str = "contena-test-copy";
const IMPORTED: &str = "contena-test-imported";

fn socket() -> PathBuf {
    std::env::var_os("CONTENA_DOCKER_SOCKET").map_or_else(
        || std::env::home_dir().unwrap_or_default().join(".contena/run/docker.sock"),
        PathBuf::from,
    )
}

#[tokio::test]
#[ignore = "needs a Docker engine"]
async fn a_machine_lives_through_snapshots_copies_and_archives() -> Outcome {
    let machines = Machines::connect(&socket())?;
    let outcome = scenario(&machines).await;
    for name in [MACHINE, COPY, IMPORTED] {
        let _ = machines.delete(name).await;
    }
    outcome
}

async fn scenario(machines: &Machines) -> Outcome {
    let folder = tempfile::tempdir()?;
    let home = folder.path().to_string_lossy().into_owned();
    let user = User { name: "ada".to_owned(), uid: 501, home: Some(home) };
    let spec = CreateMachine {
        name: MACHINE.to_owned(),
        distro: "ubuntu".to_owned(),
        release: "24.04".to_owned(),
        cpus: 2,
        memory_gib: 2,
        mount_home: true,
    };
    let mut steps = 0;
    machines.create(&spec, &user, |_| steps += 1).await?;
    ensure!(steps > 0, "creating a machine reported nothing");

    let machine = machines.machine(MACHINE).await?;
    ensure!(machine.state == MachineState::Running, "the new machine is {:?}", machine.state);
    ensure!(machine.user == "ada" && machine.distro == "ubuntu", "it reads back as {machine:?}");
    ensure!(machine.processes > 0, "a running machine shows no processes");
    ensure!(machines.machines().await?.iter().any(|listed| listed.name == MACHINE), "not listed");
    let again = machines.create(&spec, &user, |_| {}).await;
    ensure!(again.is_err(), "a second machine took the same name");

    // A snapshot brings back what was there and loses what came after.
    machines.snapshot(MACHINE, "clean").await?;
    ensure!(machines.snapshot(MACHINE, "clean").await.is_err(), "a snapshot name was reused");
    ensure!(machines.snapshots(MACHINE).await?.len() == 1, "the snapshot isn't listed");
    machines.act(MACHINE, MachineAction::Stop).await?;
    ensure!(machines.machine(MACHINE).await?.state == MachineState::Stopped, "it didn't stop");
    machines.restore(MACHINE, "clean").await?;
    ensure!(
        machines.machine(MACHINE).await?.state == MachineState::Stopped,
        "a restore started it"
    );
    machines.act(MACHINE, MachineAction::Start).await?;
    ensure!(machines.machine(MACHINE).await?.state == MachineState::Running, "it didn't start");

    // A copy and an import are machines of their own, stopped until started.
    machines.copy(MACHINE, COPY).await?;
    let copy = machines.machine(COPY).await?;
    ensure!(copy.state == MachineState::Stopped && copy.user == "ada", "the copy is {copy:?}");
    let archive = folder.path().join("machine.tar");
    machines.export(MACHINE, &archive).await?;
    ensure!(std::fs::metadata(&archive)?.len() > 50 << 20, "the archive is too small for a disk");
    machines.import(IMPORTED, &archive).await?;
    let imported = machines.machine(IMPORTED).await?;
    ensure!(imported.distro == "ubuntu" && imported.release == "24.04", "imported as {imported:?}");
    machines.act(IMPORTED, MachineAction::Start).await?;
    ensure!(
        machines.machine(IMPORTED).await?.state == MachineState::Running,
        "the import won't run"
    );

    machines.delete(MACHINE).await?;
    ensure!(machines.machine(MACHINE).await.is_err(), "the machine outlived its deletion");
    ensure!(machines.snapshots(MACHINE).await?.is_empty(), "its snapshots outlived it");
    Ok(())
}

/// Every distribution in the catalogue becomes a machine whose init keeps running and whose user
/// exists: making one ends by running a script in it. The first run pulls and sets up seven
/// images, which takes a few minutes.
#[tokio::test]
#[ignore = "needs a Docker engine"]
async fn every_distribution_makes_a_running_machine() -> Outcome {
    let machines = Machines::connect(&socket())?;
    let user = User { name: "ada".to_owned(), uid: 501, home: None };
    let mut failed = Vec::new();
    for distro in DISTROS {
        let name = format!("contena-test-{}", distro.id);
        let spec = CreateMachine {
            name: name.clone(),
            distro: distro.id.to_owned(),
            release: distro.releases[0].alias.to_owned(),
            cpus: 1,
            memory_gib: 1,
            mount_home: false,
        };
        let made = machines.create(&spec, &user, |_| {}).await;
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        match (made, machines.machine(&name).await) {
            (Ok(()), Ok(machine)) if machine.state == MachineState::Running => {}
            (made, machine) => failed.push(format!("{}: {made:?} {machine:?}", distro.id)),
        }
        let _ = machines.delete(&name).await;
    }
    ensure!(failed.is_empty(), "{}", failed.join("\n"));
    Ok(())
}
