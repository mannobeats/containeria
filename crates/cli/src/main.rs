//! `cx`: Containeria from the terminal. Talks to the engine directly, so it works without the app.

mod databases;
mod output;

use std::error::Error;
use std::io::{self, Write};
use std::path::PathBuf;
use std::pin::pin;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use containeria_docker::{ContainerAction, ContainerSummary, Docker, LogStream};
use containeria_engine::{Colima, Home, InstanceStatus, Profile};
use futures::StreamExt;

type Result<T = (), E = Box<dyn Error>> = std::result::Result<T, E>;

#[derive(Debug, Parser)]
#[command(name = "cx", version, about = "Containeria from the terminal")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// List containers, with their ports and domains.
    Ps,
    /// Start one or more containers.
    Start { names: Vec<String> },
    /// Stop one or more containers.
    Stop { names: Vec<String> },
    /// Restart one or more containers.
    Restart { names: Vec<String> },
    /// Print a container's output.
    Logs {
        name: String,
        /// Keep printing new output until Ctrl-C.
        #[arg(short, long)]
        follow: bool,
        /// How many lines of history to print first.
        #[arg(short = 'n', long, default_value_t = 200)]
        tail: usize,
    },
    /// Open a container in the browser, by its domain when the app serves domains.
    Open { name: String },
    /// Start, stop or check the engine.
    Engine {
        #[command(subcommand)]
        action: EngineAction,
    },
    /// List databases running in containers, with a URL to connect.
    Data,
}

#[derive(Debug, Subcommand)]
enum EngineAction {
    Start,
    Stop,
    Status,
}

fn home() -> Result<Home> {
    Ok(Home::from_env()?)
}

fn docker() -> Result<Docker> {
    let socket = std::env::var_os("CONTAINERIA_DOCKER_SOCKET")
        .map_or_else(|| home().map(|home| home.docker_socket()), |path| Ok(PathBuf::from(path)))?;
    Docker::connect(&socket)
        .map_err(|_| "the engine isn't running; start it with `cx engine start`".into())
}

async fn find(docker: &Docker, name: &str) -> Result<ContainerSummary> {
    pick(docker.containers().await?, name)
}

/// A name wins over an ID prefix, since names like `db` or `cafe` are valid hex too. An ID prefix
/// counts only when one container has it.
fn pick(mut containers: Vec<ContainerSummary>, name: &str) -> Result<ContainerSummary> {
    if let Some(index) = containers.iter().position(|container| container.name == name) {
        return Ok(containers.swap_remove(index));
    }
    let mut by_id = containers.into_iter().filter(|container| container.id.starts_with(name));
    match (by_id.next(), by_id.next()) {
        (Some(container), None) => Ok(container),
        (Some(_), Some(_)) => Err(format!(
            "{name} starts more than one container ID; use more of the ID, or the container's name"
        )
        .into()),
        (None, _) => Err(format!(
            "no container is named {name} or has an ID starting with it; `cx ps` lists them"
        )
        .into()),
    }
}

async fn act(names: &[String], action: ContainerAction) -> Result {
    if names.is_empty() {
        return Err("name at least one container".into());
    }
    let docker = docker()?;
    for name in names {
        let container = find(&docker, name).await?;
        docker.act(&container.id, action).await?;
        writeln!(io::stdout(), "{}", container.name)?;
    }
    Ok(())
}

async fn logs(name: &str, tail: usize, follow: bool) -> Result {
    let docker = docker()?;
    let container = find(&docker, name).await?;
    let mut chunks = pin!(docker.raw_logs(&container.id, tail, follow));
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk?;
        match chunk.stream {
            LogStream::Stdout => write!(io::stdout(), "{}", chunk.text)?,
            LogStream::Stderr => write!(io::stderr(), "{}", chunk.text)?,
        }
    }
    Ok(())
}

async fn open(name: &str) -> Result {
    let container = find(&docker()?, name).await?;
    let served = containeria_net::running_ports(&home()?.root().join("net"));
    let url = output::open_url(&container, containeria_net::DEFAULT_TLD, served)
        .ok_or_else(|| format!("{name} publishes no port and Containeria isn't serving domains"))?;
    tokio::process::Command::new("/usr/bin/open").arg(&url).status().await?;
    writeln!(io::stdout(), "{url}")?;
    Ok(())
}

async fn engine(action: EngineAction) -> Result {
    let colima = Colima::locate(home()?, None)?;
    let progress = |line: containeria_engine::LogLine| {
        let _ = writeln!(io::stderr(), "{}", line.message);
    };
    match action {
        EngineAction::Start => colima.start(Profile::Containers, progress).await?,
        EngineAction::Stop => colima.stop(Profile::Containers, progress).await?,
        EngineAction::Status => {
            let line = match colima.instance(Profile::Containers).await? {
                None => "not set up yet".to_owned(),
                Some(instance) if instance.status == InstanceStatus::Running => {
                    format!(
                        "running · {} CPUs · {} GiB",
                        instance.cpus,
                        instance.memory_bytes / (1 << 30)
                    )
                }
                Some(instance) => format!("{:?}", instance.status).to_lowercase(),
            };
            writeln!(io::stdout(), "{line}")?;
        }
    }
    Ok(())
}

async fn run(command: Command) -> Result {
    match command {
        Command::Ps => {
            let list = docker()?.containers().await?;
            write!(io::stdout(), "{}", output::containers(&list, containeria_net::DEFAULT_TLD))?;
        }
        Command::Start { names } => act(&names, ContainerAction::Start).await?,
        Command::Stop { names } => act(&names, ContainerAction::Stop).await?,
        Command::Restart { names } => act(&names, ContainerAction::Restart).await?,
        Command::Logs { name, follow, tail } => logs(&name, tail, follow).await?,
        Command::Open { name } => open(&name).await?,
        Command::Engine { action } => engine(action).await?,
        Command::Data => {
            let rows: Vec<Vec<String>> = databases::detect(&docker()?.containers().await?)
                .into_iter()
                .map(|database| vec![database.container, database.kind.to_owned(), database.url])
                .collect();
            write!(io::stdout(), "{}", output::table(&["CONTAINER", "KIND", "URL"], &rows))?;
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(Cli::parse().command).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let _ = writeln!(io::stderr(), "cx: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;

    use super::*;

    fn container(id: &str, name: &str) -> ContainerSummary {
        ContainerSummary {
            id: id.to_owned(),
            name: name.to_owned(),
            image: "postgres".to_owned(),
            state: containeria_docker::ContainerState::Running,
            status: "Up".to_owned(),
            project: None,
            service: None,
            pod: None,
            ports: Vec::new(),
            created_at: 0,
        }
    }

    #[test]
    fn a_name_wins_over_another_containers_id_prefix() {
        let newest_first = vec![container("db41aa", "web"), container("77c0ff", "db")];
        assert_eq!(pick(newest_first, "db").unwrap().name, "db");
    }

    #[test]
    fn finds_a_container_by_a_unique_id_prefix() {
        let containers = vec![container("db41aa", "web"), container("77c0ff", "db")];
        assert_eq!(pick(containers, "77c").unwrap().name, "db");
    }

    #[test]
    fn refuses_an_id_prefix_two_containers_share() {
        let shared = vec![container("ab12", "web"), container("ab34", "api")];
        assert!(pick(shared, "ab").unwrap_err().to_string().contains("more than one"));
    }

    #[test]
    fn says_how_to_list_containers_when_none_matches() {
        let containers = vec![container("db41aa", "web")];
        assert!(pick(containers, "zz").unwrap_err().to_string().contains("cx ps"));
    }

    #[test]
    fn the_command_line_is_well_formed() {
        Cli::command().debug_assert();
    }

    #[test]
    fn parses_logs_with_follow_and_tail() {
        let cli = Cli::try_parse_from(["cx", "logs", "web", "-f", "-n", "50"]).unwrap();
        assert!(
            matches!(cli.command, Command::Logs { ref name, follow: true, tail: 50 } if name == "web")
        );
    }

    #[test]
    fn parses_several_names_and_engine_actions() {
        let cli = Cli::try_parse_from(["cx", "stop", "web", "db"]).unwrap();
        assert!(matches!(cli.command, Command::Stop { ref names } if names == &["web", "db"]));
        let cli = Cli::try_parse_from(["cx", "engine", "status"]).unwrap();
        assert!(matches!(cli.command, Command::Engine { action: EngineAction::Status }));
        assert!(Cli::try_parse_from(["cx", "engine", "explode"]).is_err());
    }
}
