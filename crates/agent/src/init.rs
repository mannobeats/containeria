//! Process 1: mounts the system, runs the agent, and powers off when the agent ends.

use std::ffi::CStr;
use std::fs;
use std::io::Read;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::process::Command;

use containeria_agent::disk::{HEADER_LEN, Superblock};
use rustix::mount::{
    MountFlags, MountPropagationFlags, UnmountFlags, mount, mount_change, unmount,
};
use rustix::process::{Pid, Signal, WaitOptions, kill_process, pivot_root, waitpid};
use rustix::system::{RebootCommand, reboot};

use crate::error::{Doing, Error, Result};
use crate::log;

/// The second disk the engine attaches: Docker's images, containers and volumes.
const DATA_DISK: &str = "/dev/vdb";
const DATA: &str = "/var/lib";

pub(crate) fn run() -> ! {
    match start() {
        Ok(()) => log("the agent ended; powering off"),
        Err(error) => log(format_args!("can't go on: {error}")),
    }
    power_off()
}

fn start() -> Result<()> {
    writable_root()?;
    system_mounts()?;
    data_disk()?;
    // Linux keeps written data in memory for up to thirty seconds before it goes to disk. If the
    // VM loses power in that time, files written just before come back empty. Five seconds keeps
    // that window small; the Mac's own cache makes the extra writes cheap.
    fs::write("/proc/sys/vm/dirty_expire_centisecs", "500").doing("set how long data may wait")?;
    let agent = Command::new("/proc/self/exe")
        .arg("serve")
        .env("PATH", crate::PATH)
        .spawn()
        .doing("start the agent")?;
    let agent = i32::try_from(agent.id()).ok().and_then(Pid::from_raw);
    // Every process whose parent dies becomes a child of process 1, which must collect it.
    loop {
        match waitpid(None, WaitOptions::empty()) {
            Ok(Some((pid, _))) if Some(pid) == agent => return Ok(()),
            Ok(_) | Err(rustix::io::Errno::INTR) => {}
            Err(error) => return Err(error).doing("wait for the agent"),
        }
    }
}

/// The system image is read-only. Laying memory over it gives a root that can be written to,
/// which mount points for the Mac's folders and files like `/etc/resolv.conf` need; only what is
/// written takes memory, and it is gone at power-off.
fn writable_root() -> Result<()> {
    tmpfs("/run", c"mode=755")?;
    for folder in ["/run/upper", "/run/work", "/run/root"] {
        fs::create_dir(folder).doing(format!("create {folder}"))?;
    }
    let layers = c"lowerdir=/,upperdir=/run/upper,workdir=/run/work";
    mount("overlay", "/run/root", "overlay", MountFlags::empty(), layers)
        .doing("lay a writable root over the system image")?;
    pivot_root("/run/root", "/run/root/mnt").doing("switch to the writable root")?;
    std::env::set_current_dir("/").doing("enter the writable root")?;
    // The old root stays in use underneath; it only leaves the tree.
    unmount("/mnt", UnmountFlags::DETACH).doing("hide the system image")?;
    // Mounts made in one container can be seen by another only from a shared root: Kubernetes
    // needs it for volumes, and so does a bind mount with `shared` propagation.
    mount_change("/", MountPropagationFlags::SHARED | MountPropagationFlags::REC)
        .doing("share the root's mounts")
}

fn system_mounts() -> Result<()> {
    let quiet = MountFlags::NOSUID | MountFlags::NODEV | MountFlags::NOEXEC;
    mount("proc", "/proc", "proc", quiet, None).doing("mount /proc")?;
    mount("sysfs", "/sys", "sysfs", quiet, None).doing("mount /sys")?;
    mount("devtmpfs", "/dev", "devtmpfs", MountFlags::NOSUID, c"mode=755").doing("mount /dev")?;
    for folder in ["/dev/pts", "/dev/shm"] {
        fs::create_dir_all(folder).doing(format!("create {folder}"))?;
    }
    let terminals = c"gid=5,mode=620,ptmxmode=666";
    mount("devpts", "/dev/pts", "devpts", MountFlags::NOSUID | MountFlags::NOEXEC, terminals)
        .doing("mount /dev/pts")?;
    tmpfs("/dev/shm", c"mode=1777")?;
    tmpfs("/run", c"mode=755")?;
    mount("cgroup2", "/sys/fs/cgroup", "cgroup2", quiet, None).doing("mount the control groups")?;
    limits_for_containers()?;
    mount("binfmt_misc", "/proc/sys/fs/binfmt_misc", "binfmt_misc", quiet, None)
        .doing("mount binfmt_misc")?;
    for (name, target) in [
        ("fd", "/proc/self/fd"),
        ("stdin", "/proc/self/fd/0"),
        ("stdout", "/proc/self/fd/1"),
        ("stderr", "/proc/self/fd/2"),
    ] {
        match symlink(target, format!("/dev/{name}")) {
            Err(error) if error.kind() != std::io::ErrorKind::AlreadyExists => {
                return Err(error).doing(format!("link /dev/{name}"));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Hands every resource controller down to the groups below the root, where Docker puts each
/// container. Without this a container's memory, CPU and process limits have nothing to act on.
fn limits_for_containers() -> Result<()> {
    let controllers =
        fs::read_to_string("/sys/fs/cgroup/cgroup.controllers").doing("read the controllers")?;
    let all: Vec<String> = controllers.split_whitespace().map(|name| format!("+{name}")).collect();
    fs::write("/sys/fs/cgroup/cgroup.subtree_control", all.join(" "))
        .doing("enable the controllers")
}

fn tmpfs(at: &str, options: &CStr) -> Result<()> {
    mount("tmpfs", at, "tmpfs", MountFlags::NOSUID | MountFlags::NODEV, options)
        .doing(format!("mount {at}"))
}

/// Formats the data disk the first time, grows its filesystem when the disk was made larger, and
/// mounts it. `discard` hands the space of deleted files back to the Mac as they are deleted.
fn data_disk() -> Result<()> {
    let mut header = [0; HEADER_LEN];
    fs::File::open(DATA_DISK)
        .and_then(|mut disk| disk.read_exact(&mut header))
        .doing("read the data disk")?;
    let found = Superblock::read(&header);
    if found.is_none() {
        let options = "lazy_itable_init=1,lazy_journal_init=1";
        tool("mkfs.ext4", &["-q", "-F", "-m", "0", "-L", "containeria", "-E", options, DATA_DISK])?;
    }
    mount(DATA_DISK, DATA, "ext4", MountFlags::NOATIME, c"discard").doing("mount the data disk")?;
    fs::set_permissions(DATA, fs::Permissions::from_mode(0o755)).doing("open the data disk")?;
    if found.is_some_and(|filesystem| filesystem.bytes < disk_bytes()) {
        tool("resize2fs", &[DATA_DISK])?;
    }
    Ok(())
}

/// The data disk's size, or zero when it can't be read, which never asks for a resize.
fn disk_bytes() -> u64 {
    fs::read_to_string("/sys/class/block/vdb/size")
        .ok()
        .and_then(|sectors| sectors.trim().parse::<u64>().ok())
        .map_or(0, |sectors| sectors.saturating_mul(512))
}

fn tool(program: &str, arguments: &[&str]) -> Result<()> {
    let status = Command::new(program)
        .args(arguments)
        .env("PATH", crate::PATH)
        .status()
        .doing(format!("run {program}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::Failed(format!("{program} failed ({status})")))
    }
}

/// Ends whatever still runs, puts the data disk away cleanly and cuts the power.
fn power_off() -> ! {
    for signal in [Signal::TERM, Signal::KILL] {
        for pid in others() {
            let _ = kill_process(pid, signal);
        }
        for _ in 0..50 {
            if others().is_empty() {
                break;
            }
            let _ = waitpid(None, WaitOptions::NOHANG);
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }
    rustix::fs::sync();
    match unmount(DATA, UnmountFlags::empty()) {
        // Not mounted: the guest never got that far.
        Ok(()) | Err(rustix::io::Errno::INVAL) => {}
        Err(error) => log(format_args!("the data disk was still in use at power-off: {error}")),
    }
    rustix::fs::sync();
    let _ = reboot(RebootCommand::PowerOff);
    // Power-off can't fail for process 1; if it somehow does, leaving would panic the kernel.
    loop {
        std::thread::park();
    }
}

/// Every process but this one that is not a kernel thread.
fn others() -> Vec<Pid> {
    let Ok(entries) = fs::read_dir("/proc") else { return Vec::new() };
    entries
        .filter_map(|entry| entry.ok()?.file_name().to_str()?.parse::<i32>().ok())
        .filter(|&pid| pid > 1)
        .filter(|pid| {
            fs::read_to_string(format!("/proc/{pid}/cmdline")).is_ok_and(|line| !line.is_empty())
        })
        .filter_map(Pid::from_raw)
        .collect()
}
