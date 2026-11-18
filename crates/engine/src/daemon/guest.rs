//! Starting the VM and the guest inside it.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use containeria_proto::rpc::{self, Caller, Incoming};
use containeria_proto::{AgentCall, Alias, Boot, Booted, CONTROL_PORT, EngineCall, HOST_PORT};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::changes::Watching;
use super::ports::Ports;
use super::reach;
use super::vmm::{Connection, Disk, Machine, Share, Vmm};
use crate::config::EngineConfig;
use crate::error::{Error, Result};
use crate::home::Home;

const HOSTNAME: &str = "containeria";
const ROSETTA: &str = "rosetta";
/// The system image is the first disk and the data disk the second, which the agent relies on.
const COMMAND_LINE: &str = "console=hvc0 root=/dev/vda ro rootfstype=erofs init=/sbin/containeria-agent panic=-1 loglevel=4";
/// The Mac's folders the guest sees at the same paths, so a bind mount means the same on both
/// sides: by tag, then path.
const SHARES: [(&str, &str); 3] =
    [("users", "/Users"), ("volumes", "/Volumes"), ("private", "/private")];
/// Folders macOS knows by a second name, which is the one programs use: where it keeps each
/// user's temporary files, and everyone's.
const ALIASES: [(&str, &str); 2] =
    [("/var/folders", "/private/var/folders"), ("/tmp", "/private/tmp")];
const CONSOLE_KEPT: u64 = 4 << 20;
const ANSWER_PATIENCE: Duration = Duration::from_secs(15);
/// How long a guest gets to power off after its agent ended.
const POWER_OFF_PATIENCE: Duration = Duration::from_secs(30);

/// The files the engine runs from.
#[derive(Debug)]
pub(crate) struct Paths {
    pub(crate) home: Home,
    helper: PathBuf,
    kernel: PathBuf,
    system: PathBuf,
}

impl Paths {
    /// Finds the VM helper and the guest: `$CONTAINERIA_VMM` and `$CONTAINERIA_GUEST`, or next to
    /// this program, where the app bundle has them.
    pub(crate) fn locate(home: Home) -> Result<Self> {
        let beside = std::env::current_exe()?.parent().map(Path::to_path_buf).unwrap_or_default();
        let from = |variable: &str, name: &str| {
            std::env::var_os(variable).map_or_else(|| beside.join(name), PathBuf::from)
        };
        let guest = from("CONTAINERIA_GUEST", "guest");
        let paths = Self {
            home,
            helper: from("CONTAINERIA_VMM", "containeria-vmm"),
            kernel: guest.join("Image"),
            system: guest.join("rootfs.erofs"),
        };
        for (what, path) in [
            ("The VM helper", &paths.helper),
            ("The guest's kernel", &paths.kernel),
            ("The guest's system image", &paths.system),
        ] {
            if !path.is_file() {
                return Err(Error::Missing { what, searched: path.display().to_string() });
            }
        }
        Ok(paths)
    }

    fn console(&self) -> PathBuf {
        self.home.logs().join("console.log")
    }
}

/// A running guest.
#[derive(Debug)]
pub(crate) struct Guest {
    pub(crate) vmm: Arc<Vmm>,
    pub(crate) agent: Caller,
    pub(crate) cpus: u16,
    pub(crate) kernel: String,
    /// What serves the guest for as long as it runs: its calls, and the connections it opens.
    serving: Vec<JoinHandle<()>>,
}

impl Drop for Guest {
    fn drop(&mut self) {
        for task in &self.serving {
            task.abort();
        }
    }
}

/// Starts the VM and returns once Docker answers inside it.
pub(crate) async fn boot(
    paths: &Paths,
    config: &EngineConfig,
    ports: &Arc<Ports>,
) -> Result<Guest> {
    let vmm = Arc::new(Vmm::start(&paths.helper, &machine(paths, config)?, &paths.home.run())?);
    let started = async {
        vmm.on().await?;
        let (reader, writer) = tokio::io::split(control(&vmm).await?);
        let (agent, calls) = rpc::open(reader, writer);
        let watching = Watching::start(Arc::clone(&vmm), agent.clone(), paths.home.root());
        let answering = answer(calls, Arc::clone(ports), Arc::clone(&vmm), watching);
        let mut serving = vec![tokio::spawn(answering)];
        serving.extend(vmm.accepted().map(|accepted| tokio::spawn(reach::serve(accepted))));
        // Made before the guest is asked to boot, so a boot that fails ends the serving too.
        let mut guest = Guest {
            vmm: Arc::clone(&vmm),
            agent,
            cpus: config.cpus,
            kernel: String::new(),
            serving,
        };
        let booted: Booted = guest.agent.call(&EngineCall::Boot(settings(config))).await?;
        guest.kernel = booted.kernel;
        Ok::<_, Error>(guest)
    };
    tokio::select! {
        started = started => started,
        reason = vmm.off() => Err(Error::Engine(format!(
            "The VM stopped while starting{}. Its console is in {}.",
            reason.map(|reason| format!(": {reason}")).unwrap_or_default(),
            paths.console().display()
        ))),
    }
}

fn machine(paths: &Paths, config: &EngineConfig) -> Result<Machine> {
    let home = &paths.home;
    for folder in [home.run(), home.vm(), home.logs()] {
        fs::create_dir_all(folder)?;
    }
    let data = home.data_disk();
    grow(&data, config.disk_bytes())?;
    let console = paths.console();
    if fs::metadata(&console).is_ok_and(|log| log.len() > CONSOLE_KEPT) {
        fs::rename(&console, console.with_extension("log.1"))?;
    }
    Ok(Machine {
        cpus: config.cpus,
        memory_bytes: config.memory_bytes(),
        kernel: paths.kernel.clone(),
        command_line: COMMAND_LINE.to_owned(),
        disks: vec![
            Disk { path: paths.system.clone(), read_only: true },
            Disk { path: data, read_only: false },
        ],
        shares: shared()
            .map(|(tag, path)| Share { tag: tag.to_owned(), path: path.into(), read_only: false })
            .collect(),
        rosetta_tag: config.rosetta.then(|| ROSETTA.to_owned()),
        console,
        mac_address: mac_address(&home.vm().join("mac-address"))?,
        host_port: HOST_PORT,
    })
}

fn shared() -> impl Iterator<Item = (&'static str, &'static str)> {
    SHARES.into_iter().filter(|(_, path)| Path::new(path).is_dir())
}

/// Makes the data disk as large as the settings say. A new one takes no space on the Mac until
/// the guest writes to it, and a disk never shrinks: the guest's filesystem fills it.
fn grow(disk: &Path, bytes: u64) -> Result<()> {
    let file = fs::OpenOptions::new().create(true).append(true).open(disk)?;
    if file.metadata()?.len() < bytes {
        file.set_len(bytes)?;
    }
    Ok(())
}

/// The VM's network address, made once and kept: the Mac's DHCP server hands out an address for
/// each one it sees, and a VM that sleeps and wakes all day must not use them up.
fn mac_address(saved: &Path) -> Result<String> {
    if let Ok(address) = fs::read_to_string(saved) {
        return Ok(address.trim().to_owned());
    }
    let mut random = [0; 6];
    fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
    // Locally administered, and for one device rather than a group.
    random[0] = (random[0] | 0x02) & 0xFE;
    let address = random.map(|byte| format!("{byte:02x}")).join(":");
    fs::write(saved, &address)?;
    Ok(address)
}

fn settings(config: &EngineConfig) -> Boot {
    Boot {
        hostname: HOSTNAME.to_owned(),
        unix_seconds: SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |now| now.as_secs()),
        shares: shared()
            .map(|(tag, path)| containeria_proto::Share {
                tag: tag.to_owned(),
                path: path.to_owned(),
            })
            .collect(),
        aliases: ALIASES
            .into_iter()
            .filter(|(_, target)| Path::new(target).is_dir())
            .map(|(path, target)| Alias { path: path.to_owned(), target: target.to_owned() })
            .collect(),
        rosetta: config.rosetta.then(|| ROSETTA.to_owned()),
        docker: config.docker_settings(),
    }
}

/// Connects to the agent, which listens a moment after the VM starts.
async fn control(vmm: &Vmm) -> Result<Connection> {
    let started = Instant::now();
    loop {
        match vmm.connect(CONTROL_PORT).await {
            Ok(stream) => return Ok(stream),
            Err(Error::Stopped) => return Err(Error::Stopped),
            Err(error) if started.elapsed() > ANSWER_PATIENCE => {
                return Err(Error::Engine(format!(
                    "The guest didn't answer within 15 seconds: {error}"
                )));
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(10)).await,
        }
    }
}

/// Answers the agent's calls until its connection ends. The agent ending is how every shutdown
/// begins: the guest then stops what runs, writes its disk out and powers off by itself, and
/// cutting its power before that loses what it was writing. Only a guest that stays on long
/// after it stopped talking, as one that restarted itself would, has its power cut.
async fn answer(
    mut calls: mpsc::Receiver<Incoming<AgentCall>>,
    ports: Arc<Ports>,
    vmm: Arc<Vmm>,
    watching: Watching,
) {
    while let Some(incoming) = calls.recv().await {
        let (call, answer) = incoming.split();
        let done = match call {
            AgentCall::Publish(port) => ports.publish(port, &vmm),
            AgentCall::Unpublish(port) => {
                ports.unpublish(&port);
                Ok(())
            }
            AgentCall::Watch(folders) => watching.set(&folders).await,
        };
        answer.send(done).await;
    }
    drop(watching);
    if tokio::time::timeout(POWER_OFF_PATIENCE, vmm.off()).await.is_err() {
        tracing::warn!("the guest stopped talking but stayed on; cutting its power");
        let _ = vmm.stop().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_data_disk_takes_no_space() {
        use std::os::unix::fs::MetadataExt;
        let folder = tempfile::tempdir().unwrap();
        let disk = folder.path().join("data.img");
        grow(&disk, 10 << 30).unwrap();
        let file = fs::metadata(&disk).unwrap();
        assert_eq!(file.len(), 10 << 30);
        assert!(file.blocks() * 512 < 1 << 20);
    }

    #[test]
    fn a_data_disk_grows_but_never_shrinks() {
        let folder = tempfile::tempdir().unwrap();
        let disk = folder.path().join("data.img");
        grow(&disk, 2 << 20).unwrap();
        fs::OpenOptions::new().write(true).open(&disk).unwrap().set_len(4 << 20).unwrap();
        grow(&disk, 2 << 20).unwrap();
        assert_eq!(fs::metadata(&disk).unwrap().len(), 4 << 20);
        grow(&disk, 8 << 20).unwrap();
        assert_eq!(fs::metadata(&disk).unwrap().len(), 8 << 20);
    }

    #[test]
    fn the_network_address_is_made_once_and_kept() {
        let folder = tempfile::tempdir().unwrap();
        let saved = folder.path().join("mac-address");
        let first = mac_address(&saved).unwrap();
        assert_eq!(mac_address(&saved).unwrap(), first);
        let bytes: Vec<u8> =
            first.split(':').map(|byte| u8::from_str_radix(byte, 16).unwrap()).collect();
        assert_eq!(bytes.len(), 6);
        assert_eq!(bytes[0] & 0x03, 0x02, "locally administered, for one device");
    }
}
