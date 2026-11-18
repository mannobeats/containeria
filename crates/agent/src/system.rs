//! Settings the engine sends at boot: the clock, the name, the Mac's folders, Rosetta.

use std::fs;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use contena_agent::daemon::GROUP;
use contena_agent::memory::{Memory, populated};
use contena_proto::{Alias, Boot, Share, Stats};
use rustix::mount::{MountFlags, mount};
use rustix::time::{ClockId, Timespec, clock_settime};
use tokio::process::{Child, Command};

use crate::error::{Doing, Error, Result};
use crate::log;

const ROSETTA: &str = "/mnt/rosetta";

/// Registers Rosetta for x86-64 programs, as Apple documents it: the ELF header of an x86-64
/// executable, the bits of it that matter, and flags so the kernel opens the program itself (`O`),
/// keeps its credentials (`C`) and holds the interpreter open across mount namespaces (`F`).
const ROSETTA_FORMAT: &str = concat!(
    r":rosetta:M::\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x3e\x00:",
    r"\xff\xff\xff\xff\xff\xfe\xfe\x00\xff\xff\xff\xff\xff\xff\xff\xff\xfe\xff\xff\xff:",
    "/mnt/rosetta/rosetta:OCF"
);

pub(crate) fn apply(boot: &Boot) -> Result<()> {
    set_clock(boot.unix_seconds.saturating_mul(1000))?;
    rustix::system::sethostname(boot.hostname.as_bytes()).doing("set the hostname")?;
    fs::write("/etc/hostname", format!("{}\n", boot.hostname)).doing("write /etc/hostname")?;
    let hosts = format!("127.0.0.1 localhost\n::1 localhost\n127.0.1.1 {}\n", boot.hostname);
    fs::write("/etc/hosts", hosts).doing("write /etc/hosts")?;
    boot.shares.iter().try_for_each(share)?;
    boot.aliases.iter().try_for_each(alias)?;
    boot.rosetta.as_deref().map_or(Ok(()), rosetta)
}

fn share(share: &Share) -> Result<()> {
    fs::create_dir_all(&share.path).doing(format!("create {}", share.path))?;
    mount(share.tag.as_str(), share.path.as_str(), "virtiofs", MountFlags::empty(), None)
        .doing(format!("mount the Mac's {}", share.path))
}

fn alias(alias: &Alias) -> Result<()> {
    fs::create_dir_all(&alias.path).doing(format!("create {}", alias.path))?;
    mount(alias.target.as_str(), alias.path.as_str(), "", MountFlags::BIND | MountFlags::REC, None)
        .doing(format!("mount the Mac's {}", alias.path))
}

fn rosetta(tag: &str) -> Result<()> {
    fs::create_dir_all(ROSETTA).doing("create the Rosetta folder")?;
    mount(tag, ROSETTA, "virtiofs", MountFlags::RDONLY, None).doing("mount Rosetta")?;
    fs::write("/proc/sys/fs/binfmt_misc/register", ROSETTA_FORMAT).doing("register Rosetta")
}

/// Runs a program that sets something up and must succeed.
pub(crate) async fn run(program: &str, arguments: &[&str]) -> Result<()> {
    let status =
        Command::new(program).args(arguments).status().await.doing(format!("run {program}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::Failed(format!("{program} {} failed ({status})", arguments.join(" "))))
    }
}

/// Brings the network up. The DHCP client keeps running to renew the address; its script, in the
/// system image, sets the address and the route and notes the network's resolvers.
pub(crate) async fn network() -> Result<Child> {
    for interface in ["lo", "eth0"] {
        run("ip", &["link", "set", interface, "up"]).await?;
    }
    Command::new("udhcpc")
        .args(["-i", "eth0", "-f", "-t", "20", "-T", "1"])
        .kill_on_drop(true)
        .spawn()
        .doing("start the DHCP client")
}

/// Waits until the network has an address and a resolver, which pulling an image needs. A guest
/// that never gets one still starts: containers run, and the reason is in the log.
pub(crate) async fn online() {
    for _ in 0..500 {
        if fs::metadata(crate::mac::RESOLVERS).is_ok_and(|file| file.len() > 0) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    log("the network has no address after 5 seconds; images can't be pulled until it does");
}

pub(crate) fn stats() -> Stats {
    let read = |path| fs::read_to_string(path).unwrap_or_default();
    let memory = Memory::parse(
        &read("/proc/meminfo"),
        &read("/proc/vmstat"),
        &read("/proc/pressure/memory"),
    );
    Stats {
        memory_total: memory.total,
        memory_available: memory.available,
        memory_ballooned: memory.ballooned,
        memory_pressure: memory.pressure,
        busy: busy(),
        unix_millis: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |now| u64::try_from(now.as_millis()).unwrap_or(u64::MAX)),
    }
}

/// Sets the clock to the Mac's.
pub(crate) fn set_clock(unix_millis: u64) -> Result<()> {
    let now = Timespec {
        tv_sec: i64::try_from(unix_millis / 1000).unwrap_or(0),
        tv_nsec: i64::try_from(unix_millis % 1000 * 1_000_000).unwrap_or(0),
    };
    clock_settime(ClockId::Realtime, now).doing("set the clock")
}

/// The Mac's address on the network it shares with the guest: where the guest's packets out of
/// the VM go first.
pub(crate) fn gateway() -> Option<std::net::Ipv4Addr> {
    contena_agent::network::default_gateway(&fs::read_to_string("/proc/net/route").ok()?)
}

/// Docker, BuildKit and Kubernetes each put their work in a control group of its own. So any
/// group with processes in it, other than the one Docker itself runs in, is work.
fn busy() -> bool {
    let Ok(groups) = fs::read_dir("/sys/fs/cgroup") else { return false };
    groups
        .filter_map(std::result::Result::ok)
        .filter(|group| group.file_name() != GROUP)
        .filter_map(|group| fs::read_to_string(group.path().join("cgroup.events")).ok())
        .any(|events| populated(&events))
}

pub(crate) fn kernel() -> String {
    fs::read_to_string("/proc/sys/kernel/osrelease").unwrap_or_default().trim().to_owned()
}
