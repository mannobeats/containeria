use std::collections::HashMap;
use std::time::Duration;

use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::models::{
    ContainerCreateBody, ContainerInspectResponse, ContainerStateStatusEnum, HostConfig,
    HostConfigCgroupnsModeEnum, RestartPolicy, RestartPolicyNameEnum,
};
use bollard::query_parameters::{
    CommitContainerOptionsBuilder, CreateContainerOptionsBuilder, CreateImageOptionsBuilder,
    InspectContainerOptions, ListContainersOptionsBuilder, RemoveContainerOptionsBuilder,
    RestartContainerOptionsBuilder, StartContainerOptions, StatsOptionsBuilder,
    StopContainerOptionsBuilder,
};
use containeria_proto::SSH_AGENT;
use futures::StreamExt;
use futures::future::join_all;
use serde::{Deserialize, Serialize};

use crate::catalogue::Distro;
use crate::name::validate_name;
use crate::provision;
use crate::{Error, Machines, Result};

/// On every machine's container, with the machine's name.
pub(crate) const LABEL: &str = "dev.containeria.machine";
const DISTRO: &str = "dev.containeria.machine.distro";
const RELEASE: &str = "dev.containeria.machine.release";
pub(crate) const USER: &str = "dev.containeria.machine.user";
/// A distribution's image once set up, shared by every machine of that release.
const BASE: &str = "containeria/machine-base";
const GIB: i64 = 1 << 30;
/// How long a machine's init gets to shut its services down.
const STOP_SECONDS: i32 = 20;

/// The container behind the machine `name`.
pub(crate) fn container(name: &str) -> String {
    format!("containeria-machine-{name}")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MachineState {
    Running,
    Stopped,
    Frozen,
    Error,
    Busy,
}

impl From<Option<ContainerStateStatusEnum>> for MachineState {
    fn from(status: Option<ContainerStateStatusEnum>) -> Self {
        match status {
            Some(ContainerStateStatusEnum::RUNNING) => Self::Running,
            Some(ContainerStateStatusEnum::PAUSED) => Self::Frozen,
            Some(ContainerStateStatusEnum::CREATED | ContainerStateStatusEnum::EXITED) => {
                Self::Stopped
            }
            Some(ContainerStateStatusEnum::DEAD) => Self::Error,
            _ => Self::Busy,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    pub name: String,
    /// The distribution's short name: "ubuntu", "debian".
    pub distro: String,
    pub release: String,
    /// Who a shell opens as.
    pub user: String,
    pub state: MachineState,
    pub ipv4: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub memory_bytes: u64,
    /// CPU time since start; two readings give a percentage.
    pub cpu_seconds: f64,
    pub processes: u32,
    pub cpu_limit: Option<String>,
    pub memory_limit: Option<String>,
    /// The Mac folder mounted into the machine, if any.
    pub home: Option<String>,
    pub created_at: String,
}

/// What a running machine uses right now.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Usage {
    memory_bytes: u64,
    cpu_seconds: f64,
    processes: u32,
}

impl Machine {
    fn read(inspect: ContainerInspectResponse, usage: Usage) -> Option<Self> {
        let mut labels = inspect.config.and_then(|config| config.labels).unwrap_or_default();
        let host = inspect.host_config.unwrap_or_default();
        let ipv4 = inspect
            .network_settings
            .and_then(|settings| settings.networks)
            .into_iter()
            .flatten()
            .find_map(|(_, network)| network.ip_address.filter(|address| !address.is_empty()));
        Some(Self {
            name: labels.remove(LABEL)?,
            distro: labels.remove(DISTRO).unwrap_or_default(),
            release: labels.remove(RELEASE).unwrap_or_default(),
            user: labels.remove(USER).unwrap_or_else(|| "root".to_owned()),
            state: inspect.state.and_then(|state| state.status).into(),
            ipv4,
            memory_bytes: usage.memory_bytes,
            cpu_seconds: usage.cpu_seconds,
            processes: usage.processes,
            cpu_limit: host.nano_cpus.filter(|&nano| nano > 0).map(cpus),
            memory_limit: host
                .memory
                .filter(|&bytes| bytes > 0)
                .map(|bytes| format!("{}GiB", bytes / GIB)),
            home: mounted_home(host.binds),
            created_at: inspect.created.unwrap_or_default(),
        })
    }
}

/// Billionths of a CPU as the number of CPUs: `2`, or `1.5`.
fn cpus(nano: i64) -> String {
    let whole = nano / 1_000_000_000;
    let tenths = nano % 1_000_000_000 / 100_000_000;
    if tenths == 0 { whole.to_string() } else { format!("{whole}.{tenths}") }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum MachineAction {
    Start,
    Stop,
    Restart,
}

/// What the new-machine sheet asks for.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateMachine {
    pub name: String,
    pub distro: String,
    pub release: String,
    pub cpus: u16,
    pub memory_gib: u16,
    pub mount_home: bool,
}

/// Whose machine it is: the person at the Mac.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    pub name: String,
    pub uid: u32,
    /// Their home folder on the Mac, mounted in the machine at the same path when asked for.
    pub home: Option<String>,
}

/// The Mac's home folder among what a machine's container has mounted: the one thing besides
/// the SSH agent, which every machine has.
pub(crate) fn mounted_home(binds: Option<Vec<String>>) -> Option<String> {
    binds
        .into_iter()
        .flatten()
        .filter_map(|bind| bind.split(':').next().map(str::to_owned))
        .find(|source| source != SSH_AGENT)
}

/// Everything a machine's container is made with, apart from its image.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Shape {
    pub(crate) name: String,
    pub(crate) distro: String,
    pub(crate) release: String,
    pub(crate) user: String,
    /// The init system's path: the container's command.
    pub(crate) init: String,
    pub(crate) stop_signal: String,
    pub(crate) cpus: u16,
    pub(crate) memory_gib: u16,
    pub(crate) home: Option<String>,
}

impl Shape {
    /// The container: privileged and with its own control groups, as an init system needs to
    /// run services, and restarted with the engine unless it was stopped by hand.
    pub(crate) fn body(&self, image: &str) -> ContainerCreateBody {
        let labels = [
            (LABEL, self.name.as_str()),
            (DISTRO, self.distro.as_str()),
            (RELEASE, self.release.as_str()),
            (USER, self.user.as_str()),
        ];
        ContainerCreateBody {
            image: Some(image.to_owned()),
            hostname: Some(self.name.clone()),
            cmd: Some(vec![self.init.clone()]),
            // How systemd knows it is in a container and leaves the hardware alone.
            env: Some(vec!["container=docker".to_owned()]),
            labels: Some(labels.map(|(key, value)| (key.to_owned(), value.to_owned())).into()),
            stop_signal: Some(self.stop_signal.clone()),
            host_config: Some(HostConfig {
                privileged: Some(true),
                cgroupns_mode: Some(HostConfigCgroupnsModeEnum::PRIVATE),
                tmpfs: Some(HashMap::from(
                    ["/run", "/run/lock"].map(|at| (at.to_owned(), String::new())),
                )),
                // The Mac's SSH agent, so `git` and `ssh` in the machine use the Mac's keys.
                binds: Some(
                    std::iter::once(format!("{SSH_AGENT}:{SSH_AGENT}"))
                        .chain(self.home.iter().map(|home| format!("{home}:{home}")))
                        .collect(),
                ),
                nano_cpus: Some(i64::from(self.cpus) * 1_000_000_000),
                memory: Some(i64::from(self.memory_gib) * GIB),
                restart_policy: Some(RestartPolicy {
                    name: Some(RestartPolicyNameEnum::UNLESS_STOPPED),
                    maximum_retry_count: None,
                }),
                ..HostConfig::default()
            }),
            ..ContainerCreateBody::default()
        }
    }
}

impl CreateMachine {
    /// The machine's shape and the image it starts from, after checking what was asked for.
    fn shape(&self, user: &User) -> Result<(Shape, &'static Distro, String)> {
        validate_name(&self.name)?;
        let unavailable =
            || Error::Invalid(format!("{} {} isn't available.", self.distro, self.release));
        let distro = Distro::find(&self.distro).ok_or_else(unavailable)?;
        let image = distro.image(&self.release).ok_or_else(unavailable)?;
        if self.cpus == 0 || self.memory_gib == 0 {
            return Err(Error::Invalid("Give the machine at least one CPU and 1 GB.".to_owned()));
        }
        let shape = Shape {
            name: self.name.clone(),
            distro: distro.id.to_owned(),
            release: self.release.clone(),
            user: provision::user_name(&user.name).to_owned(),
            init: provision::init(distro.family).to_owned(),
            stop_signal: provision::stop_signal(distro.family).to_owned(),
            cpus: self.cpus,
            memory_gib: self.memory_gib,
            home: user.home.clone().filter(|_| self.mount_home),
        };
        Ok((shape, distro, image))
    }
}

impl Machines {
    /// Every machine with its live state, by name.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn machines(&self) -> Result<Vec<Machine>> {
        let filters = HashMap::from([("label", vec![LABEL])]);
        let options = ListContainersOptionsBuilder::new().all(true).filters(&filters).build();
        let listed = self.api.list_containers(Some(options)).await?;
        let ids = listed.into_iter().filter_map(|container| container.id);
        let mut machines: Vec<Machine> =
            join_all(ids.map(|id| async move { self.read(&id).await.ok() }))
                .await
                .into_iter()
                .flatten()
                .collect();
        machines.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(machines)
    }

    /// # Errors
    /// Fails with `NotFound` when there is no machine of that name.
    pub async fn machine(&self, name: &str) -> Result<Machine> {
        validate_name(name)?;
        self.read(&container(name)).await
    }

    async fn read(&self, container: &str) -> Result<Machine> {
        let inspect =
            self.api.inspect_container(container, None::<InspectContainerOptions>).await?;
        let running = inspect.state.as_ref().and_then(|state| state.running).unwrap_or(false);
        let usage = if running { self.usage(container).await } else { Usage::default() };
        Machine::read(inspect, usage).ok_or_else(|| Error::NotFound(container.to_owned()))
    }

    /// One reading of a running machine. A reading that fails shows as nothing in use rather
    /// than hiding the machine.
    async fn usage(&self, container: &str) -> Usage {
        let options = StatsOptionsBuilder::new().stream(false).one_shot(true).build();
        let mut readings = std::pin::pin!(self.api.stats(container, Some(options)));
        let Some(Ok(raw)) = readings.next().await else { return Usage::default() };
        let memory = raw.memory_stats.as_ref();
        let cache = memory
            .and_then(|memory| memory.stats.as_ref())
            .and_then(|stats| stats.get("inactive_file"))
            .copied()
            .unwrap_or(0);
        let nanoseconds = raw
            .cpu_stats
            .and_then(|cpu| cpu.cpu_usage)
            .and_then(|usage| usage.total_usage)
            .unwrap_or(0);
        Usage {
            memory_bytes: memory.and_then(|memory| memory.usage).unwrap_or(0).saturating_sub(cache),
            cpu_seconds: Duration::from_nanos(nanoseconds).as_secs_f64(),
            processes: raw
                .pids_stats
                .and_then(|pids| pids.current)
                .and_then(|count| u32::try_from(count).ok())
                .unwrap_or(0),
        }
    }

    /// Makes a machine and starts it. `on_line` hears what is being done: the first machine of a
    /// release pulls its image and installs its init system, which takes a minute.
    ///
    /// # Errors
    /// Fails when the name is taken or invalid, the image can't be pulled, or its setup fails.
    pub async fn create(
        &self,
        spec: &CreateMachine,
        user: &User,
        mut on_line: impl FnMut(String),
    ) -> Result<()> {
        let (shape, distro, image) = spec.shape(user)?;
        if self
            .api
            .inspect_container(&container(&spec.name), None::<InspectContainerOptions>)
            .await
            .is_ok()
        {
            return Err(Error::Invalid(format!("A machine named {} already exists.", spec.name)));
        }
        let base = format!("{BASE}:{}-{}", distro.id, spec.release);
        if self.api.inspect_image(&base).await.is_err() {
            self.set_up(distro, &image, &base, &mut on_line).await?;
        }
        on_line(format!("Starting {}", spec.name));
        self.launch(&shape, &base).await?;
        let script = provision::user(&shape.user, user.uid, &shape.distro, &shape.release);
        self.run(&container(&spec.name), &script, &mut on_line).await
    }

    /// Turns a distribution's image into the one its machines start from.
    async fn set_up(
        &self,
        distro: &Distro,
        image: &str,
        base: &str,
        on_line: &mut impl FnMut(String),
    ) -> Result<()> {
        let (repository, tag) = image.split_once(':').unwrap_or((image, "latest"));
        let options = CreateImageOptionsBuilder::new().from_image(repository).tag(tag).build();
        let mut pulling = std::pin::pin!(self.api.create_image(Some(options), None, None));
        while let Some(progress) = pulling.next().await {
            let progress = progress?;
            on_line(format!("Pulling {image}: {}", progress.status.unwrap_or_default()));
        }
        let setup = format!("containeria-machine-setup-{}-{tag}", distro.id);
        let _ = self.remove(&setup).await;
        let body = ContainerCreateBody {
            image: Some(image.to_owned()),
            cmd: Some(["sh", "-c", "while :; do sleep 3600; done"].map(str::to_owned).into()),
            ..ContainerCreateBody::default()
        };
        let options = CreateContainerOptionsBuilder::new().name(&setup).build();
        self.api.create_container(Some(options), body).await?;
        self.api.start_container(&setup, None::<StartContainerOptions>).await?;
        on_line(format!("Setting up {} {tag}", distro.name));
        let installed = self.run(&setup, provision::setup(distro.family), on_line).await;
        let kept = match installed {
            Ok(()) => self.commit(&setup, base).await,
            Err(error) => Err(error),
        };
        let _ = self.remove(&setup).await;
        kept
    }

    /// Creates and starts a machine's container from `image`, and waits for its init.
    pub(crate) async fn launch(&self, shape: &Shape, image: &str) -> Result<()> {
        self.create_container(shape, image).await?;
        let name = container(&shape.name);
        self.api.start_container(&name, None::<StartContainerOptions>).await?;
        // The first command after a start races the machine's init; a moment is enough.
        for _ in 0..100 {
            if self.run(&name, "true", &mut |_| {}).await.is_ok() {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Err(Error::Engine(format!("{} didn't start.", shape.name)))
    }

    pub(crate) async fn create_container(&self, shape: &Shape, image: &str) -> Result<()> {
        let options = CreateContainerOptionsBuilder::new().name(&container(&shape.name)).build();
        self.api.create_container(Some(options), shape.body(image)).await?;
        Ok(())
    }

    /// Runs a shell script in a container as root, passing on what it prints.
    pub(crate) async fn run(
        &self,
        container: &str,
        script: &str,
        on_line: &mut impl FnMut(String),
    ) -> Result<()> {
        let options = CreateExecOptions {
            attach_stdout: Some(true),
            attach_stderr: Some(true),
            cmd: Some(vec!["sh", "-c", script]),
            ..CreateExecOptions::default()
        };
        let exec = self.api.create_exec(container, options).await?;
        let mut last = String::new();
        if let StartExecResults::Attached { mut output, .. } =
            self.api.start_exec(&exec.id, None).await?
        {
            while let Some(chunk) = output.next().await {
                let text = chunk?.to_string();
                for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
                    line.clone_into(&mut last);
                    on_line(line.to_owned());
                }
            }
        }
        match self.api.inspect_exec(&exec.id).await?.exit_code {
            Some(0) => Ok(()),
            code => Err(Error::Engine(format!(
                "A step failed with exit code {}: {last}",
                code.map_or_else(|| "unknown".to_owned(), |code| code.to_string())
            ))),
        }
    }

    /// Saves a container's filesystem as the image `reference`.
    pub(crate) async fn commit(&self, container: &str, reference: &str) -> Result<()> {
        let (repository, tag) = reference.split_once(':').unwrap_or((reference, "latest"));
        let options = CommitContainerOptionsBuilder::new()
            .container(container)
            .repo(repository)
            .tag(tag)
            .pause(true)
            .build();
        self.api.commit_container(options, bollard::models::ContainerConfig::default()).await?;
        Ok(())
    }

    pub(crate) async fn remove(&self, container: &str) -> Result<()> {
        let options = RemoveContainerOptionsBuilder::new().force(true).v(true).build();
        Ok(self.api.remove_container(container, Some(options)).await?)
    }

    /// # Errors
    /// Fails when there is no machine of that name or the engine refuses.
    pub async fn act(&self, name: &str, action: MachineAction) -> Result<()> {
        validate_name(name)?;
        let container = container(name);
        match action {
            MachineAction::Start => {
                self.api.start_container(&container, None::<StartContainerOptions>).await?;
            }
            MachineAction::Stop => {
                let options = StopContainerOptionsBuilder::new().t(STOP_SECONDS).build();
                self.api.stop_container(&container, Some(options)).await?;
            }
            MachineAction::Restart => {
                let options = RestartContainerOptionsBuilder::new().t(STOP_SECONDS).build();
                self.api.restart_container(&container, Some(options)).await?;
            }
        }
        Ok(())
    }

    /// Stops the machine if it runs, then deletes it, its disk and its snapshots.
    ///
    /// # Errors
    /// Fails when there is no machine of that name.
    pub async fn delete(&self, name: &str) -> Result<()> {
        validate_name(name)?;
        self.remove(&container(name)).await?;
        for snapshot in self.snapshots(name).await.unwrap_or_default() {
            let _ = self.delete_snapshot(name, &snapshot.name).await;
        }
        self.forget_image(name).await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asked() -> CreateMachine {
        CreateMachine {
            name: "dev".into(),
            distro: "ubuntu".into(),
            release: "24.04".into(),
            cpus: 2,
            memory_gib: 4,
            mount_home: true,
        }
    }

    fn ada() -> User {
        User { name: "ada".into(), uid: 501, home: Some("/Users/ada".into()) }
    }

    #[test]
    fn a_machine_is_a_privileged_container_with_its_own_init() {
        let (shape, _, image) = asked().shape(&ada()).unwrap();
        assert_eq!(image, "ubuntu:24.04");
        let body = shape.body("containeria/machine-base:ubuntu-24.04");
        assert_eq!(body.hostname.as_deref(), Some("dev"));
        assert_eq!(body.cmd, Some(vec!["/usr/lib/systemd/systemd".to_owned()]));
        assert_eq!(body.stop_signal.as_deref(), Some("SIGRTMIN+3"));
        let host = body.host_config.unwrap();
        assert_eq!(host.privileged, Some(true));
        assert_eq!(host.nano_cpus, Some(2_000_000_000));
        assert_eq!(host.memory, Some(4 * GIB));
        let agent = "/run/host-services/ssh-auth.sock:/run/host-services/ssh-auth.sock";
        assert_eq!(host.binds, Some(vec![agent.to_owned(), "/Users/ada:/Users/ada".to_owned()]));
        let labels = body.labels.unwrap();
        assert_eq!(labels[LABEL], "dev");
        assert_eq!(labels[USER], "ada");
    }

    #[test]
    fn a_machine_made_again_mounts_what_it_did() {
        let (shape, ..) = asked().shape(&ada()).unwrap();
        let binds = shape.body("image").host_config.unwrap().binds;
        assert_eq!(mounted_home(binds).as_deref(), Some("/Users/ada"));
        let (shape, ..) = CreateMachine { mount_home: false, ..asked() }.shape(&ada()).unwrap();
        assert_eq!(mounted_home(shape.body("image").host_config.unwrap().binds), None);
    }

    #[test]
    fn the_home_folder_is_mounted_only_when_asked_for() {
        let (shape, ..) = CreateMachine { mount_home: false, ..asked() }.shape(&ada()).unwrap();
        let binds = shape.body("image").host_config.unwrap().binds.unwrap();
        assert!(!binds.iter().any(|bind| bind.starts_with("/Users")), "{binds:?}");
    }

    #[test]
    fn refuses_a_release_the_catalogue_doesnt_list() {
        let error = CreateMachine { release: "9.04".into(), ..asked() }.shape(&ada()).unwrap_err();
        assert_eq!(error.to_string(), "ubuntu 9.04 isn't available.");
    }

    #[test]
    fn refuses_a_machine_with_no_cpu_or_memory() {
        assert!(CreateMachine { cpus: 0, ..asked() }.shape(&ada()).is_err());
        assert!(CreateMachine { memory_gib: 0, ..asked() }.shape(&ada()).is_err());
    }

    #[test]
    fn reads_a_machine_back_from_its_container() {
        let (shape, ..) = asked().shape(&ada()).unwrap();
        let body = shape.body("image");
        let inspect = ContainerInspectResponse {
            config: Some(bollard::models::ContainerConfig {
                labels: body.labels,
                ..Default::default()
            }),
            host_config: body.host_config,
            state: Some(bollard::models::ContainerState {
                status: Some(ContainerStateStatusEnum::RUNNING),
                ..Default::default()
            }),
            ..Default::default()
        };
        let usage = Usage { memory_bytes: 300 << 20, cpu_seconds: 2.5, processes: 12 };
        let machine = Machine::read(inspect, usage).unwrap();
        assert_eq!((machine.name.as_str(), machine.distro.as_str()), ("dev", "ubuntu"));
        assert_eq!(machine.state, MachineState::Running);
        assert_eq!(machine.cpu_limit.as_deref(), Some("2"));
        assert_eq!(machine.memory_limit.as_deref(), Some("4GiB"));
        assert_eq!(machine.home.as_deref(), Some("/Users/ada"));
        assert_eq!(machine.processes, 12);
    }

    #[test]
    fn a_container_that_is_not_a_machine_is_not_read_as_one() {
        assert_eq!(Machine::read(ContainerInspectResponse::default(), Usage::default()), None);
    }

    #[test]
    fn says_cpu_limits_as_cpus() {
        assert_eq!(cpus(2_000_000_000), "2");
        assert_eq!(cpus(1_500_000_000), "1.5");
    }

    #[test]
    fn a_container_between_states_is_busy() {
        assert_eq!(
            MachineState::from(Some(ContainerStateStatusEnum::RESTARTING)),
            MachineState::Busy
        );
        assert_eq!(
            MachineState::from(Some(ContainerStateStatusEnum::PAUSED)),
            MachineState::Frozen
        );
        assert_eq!(
            MachineState::from(Some(ContainerStateStatusEnum::EXITED)),
            MachineState::Stopped
        );
    }
}
