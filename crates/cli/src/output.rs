use contena_docker::{ContainerState, ContainerSummary, Port, PortProtocol};
use contena_net::{DomainPorts, container_host};

/// Lines up `rows` under `header`, two spaces between columns, no trailing spaces.
pub(crate) fn table(header: &[&str], rows: &[Vec<String>]) -> String {
    let widths: Vec<usize> = (0..header.len())
        .map(|column| {
            rows.iter()
                .map(|row| row.get(column).map_or(0, |cell| cell.chars().count()))
                .chain([header[column].len()])
                .max()
                .unwrap_or(0)
        })
        .collect();
    let line = |cells: Vec<&str>| {
        let padded: Vec<String> =
            cells.iter().zip(&widths).map(|(cell, width)| format!("{cell:<width$}")).collect();
        format!("{}\n", padded.join("  ").trim_end())
    };
    let mut out = line(header.to_vec());
    for row in rows {
        out.push_str(&line(row.iter().map(String::as_str).collect()));
    }
    out
}

fn ports(ports: &[Port]) -> String {
    let published: Vec<String> = ports
        .iter()
        .filter_map(|port| {
            let host = port.host?;
            let udp = if port.protocol == PortProtocol::Udp { "/udp" } else { "" };
            Some(if host == port.container {
                format!("{host}{udp}")
            } else {
                format!("{host}:{}{udp}", port.container)
            })
        })
        .collect();
    if published.is_empty() { "-".to_owned() } else { published.join(", ") }
}

fn state(container: &ContainerSummary) -> &'static str {
    match container.state {
        ContainerState::Running => "running",
        ContainerState::Paused => "paused",
        ContainerState::Restarting => "restarting",
        ContainerState::Created => "created",
        ContainerState::Removing => "removing",
        ContainerState::Exited | ContainerState::Dead => "stopped",
    }
}

/// `cx ps`: one line per container, Kubernetes pods left out.
/// One line saying what the engine is doing, with the size of its VM while that runs.
pub(crate) fn engine(status: &contena_engine::Status, created: bool) -> String {
    use contena_engine::{ClusterState, Phase};
    let phase = match status.phase {
        Phase::Stopped if !created => "not set up yet",
        Phase::Stopped => "stopped",
        Phase::Starting => "starting",
        Phase::Running => "running",
        Phase::Asleep => "asleep: nothing runs, and the next docker command wakes it",
        Phase::Stopping => "stopping",
        Phase::Failed => "failed",
    };
    let mut parts = vec![phase.to_owned()];
    if let Some(vm) = &status.vm {
        let tenths = vm.memory.used_bytes.saturating_mul(10) >> 30;
        parts.push(format!("{} CPUs", vm.cpus));
        parts.push(format!(
            "{}.{} of {} GiB in use",
            tenths / 10,
            tenths % 10,
            vm.memory.ceiling_bytes >> 30
        ));
    }
    if status.kubernetes == ClusterState::Running {
        parts.push("Kubernetes on".to_owned());
    }
    let line = parts.join(" · ");
    match &status.problem {
        Some(problem) => format!("{line}: {problem}"),
        None => line,
    }
}

pub(crate) fn containers(list: &[ContainerSummary], tld: &str) -> String {
    let rows: Vec<Vec<String>> = list
        .iter()
        .filter(|container| container.pod.is_none())
        .map(|container| {
            vec![
                container.name.clone(),
                container.project.clone().unwrap_or_else(|| "-".to_owned()),
                state(container).to_owned(),
                ports(&container.ports),
                container_host(
                    &container.name,
                    container.project.as_deref(),
                    container.service.as_deref(),
                    tld,
                )
                .unwrap_or_else(|| "-".to_owned()),
            ]
        })
        .collect();
    table(&["NAME", "PROJECT", "STATE", "PORTS", "DOMAIN"], &rows)
}

/// The URL `cx open` should open: the container's domain when the app serves domains, else the
/// first published port on localhost.
pub(crate) fn open_url(
    container: &ContainerSummary,
    tld: &str,
    domains: Option<DomainPorts>,
) -> Option<String> {
    if let Some(ports) = domains {
        let host = container_host(
            &container.name,
            container.project.as_deref(),
            container.service.as_deref(),
            tld,
        )?;
        let port = if ports.https == 443 { String::new() } else { format!(":{}", ports.https) };
        return Some(format!("https://{host}{port}"));
    }
    let port = container
        .ports
        .iter()
        .find(|port| port.protocol == PortProtocol::Tcp)
        .and_then(|port| port.host)?;
    Some(format!("http://localhost:{port}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(phase: contena_engine::Phase) -> contena_engine::Status {
        contena_engine::Status { phase, ..contena_engine::Status::stopped() }
    }

    #[test]
    fn an_engine_never_started_is_not_set_up_yet() {
        let stopped = status(contena_engine::Phase::Stopped);
        assert_eq!(engine(&stopped, false), "not set up yet");
        assert_eq!(engine(&stopped, true), "stopped");
    }

    #[test]
    fn a_running_engine_says_what_its_vm_uses() {
        let mut running = status(contena_engine::Phase::Running);
        running.vm = Some(contena_engine::Vm {
            cpus: 8,
            memory: contena_engine::MemoryUse {
                ceiling_bytes: 8 << 30,
                allowed_bytes: 2 << 30,
                used_bytes: 3 << 29,
            },
            kernel: "6.18.63".to_owned(),
        });
        running.kubernetes = contena_engine::ClusterState::Running;
        assert_eq!(
            engine(&running, true),
            "running · 8 CPUs · 1.5 of 8 GiB in use · Kubernetes on"
        );
    }

    #[test]
    fn a_failed_engine_says_why() {
        let mut failed = status(contena_engine::Phase::Failed);
        failed.problem = Some("The VM helper wasn't found.".to_owned());
        assert_eq!(engine(&failed, true), "failed: The VM helper wasn't found.");
    }

    fn container(name: &str, project: Option<&str>, ports: Vec<Port>) -> ContainerSummary {
        ContainerSummary {
            id: name.to_owned(),
            name: name.to_owned(),
            image: "img".to_owned(),
            state: ContainerState::Running,
            status: "Up".to_owned(),
            project: project.map(str::to_owned),
            service: project.map(|_| "web".to_owned()),
            pod: None,
            ports,
            address: None,
            created_at: 0,
        }
    }

    fn tcp(container: u16, host: u16) -> Port {
        Port { container, host: Some(host), protocol: PortProtocol::Tcp }
    }

    #[test]
    fn lines_up_columns_without_trailing_spaces() {
        let out = table(
            &["A", "BB"],
            &[vec!["long".into(), String::new()], vec!["x".into(), "y".into()]],
        );
        assert_eq!(out, "A     BB\nlong\nx     y\n");
    }

    #[test]
    fn lists_containers_with_ports_and_domains() {
        let mut stopped = container("redis", None, vec![]);
        stopped.state = ContainerState::Exited;
        let out = containers(
            &[
                container("shop-web-1", Some("shop"), vec![tcp(3000, 3001), tcp(9229, 9229)]),
                stopped,
            ],
            "contena.local",
        );
        assert_eq!(
            out,
            "NAME        PROJECT  STATE    PORTS            DOMAIN\n\
             shop-web-1  shop     running  3001:3000, 9229  web.shop.contena.local\n\
             redis       -        stopped  -                redis.contena.local\n"
        );
    }

    #[test]
    fn opens_the_domain_when_the_app_serves_domains() {
        let web = container("shop-web-1", Some("shop"), vec![tcp(3000, 3001)]);
        let served = DomainPorts { dns: 15353, http: 80, https: 443 };
        assert_eq!(
            open_url(&web, "contena.local", Some(served)).as_deref(),
            Some("https://web.shop.contena.local")
        );
        let fallback = DomainPorts { https: 7443, ..served };
        assert_eq!(
            open_url(&web, "contena.local", Some(fallback)).as_deref(),
            Some("https://web.shop.contena.local:7443")
        );
        assert_eq!(open_url(&web, "contena.local", None).as_deref(), Some("http://localhost:3001"));
    }
}
