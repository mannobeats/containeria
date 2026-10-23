//! Build history: every `BuildKit` build the engine ran, started from the app or from a terminal,
//! read with buildx's `history` commands.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::cli::{self, DockerCli};
use crate::{EnvVar, Error, Result};

/// The engine's own `docker`-driver builder. Naming it keeps the user's other buildx builders,
/// which may point at other engines or be broken, out of every history command.
const BUILDER: &str = "default";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum BuildStatus {
    Running,
    Completed,
    Failed,
    Canceled,
}

impl BuildStatus {
    /// `history ls` says `Error` where `history inspect` says `failed`.
    fn parse(raw: &str) -> Option<Self> {
        match raw.to_ascii_lowercase().as_str() {
            "running" => Some(Self::Running),
            "completed" => Some(Self::Completed),
            "error" | "failed" => Some(Self::Failed),
            "canceled" => Some(Self::Canceled),
            _ => None,
        }
    }
}

/// One build in the engine's history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BuildRecord {
    /// What `docker buildx history logs`, `inspect` and `rm` take.
    pub id: String,
    /// The folder, or `project (service)` for Compose. Empty when buildx didn't name it.
    pub name: String,
    pub status: BuildStatus,
    #[specta(type = specta_typescript::Number)]
    pub started_at_ms: i64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub completed_at_ms: Option<i64>,
    /// `BuildKit` counts steps when a build ends: all three are 0 while it runs.
    pub total_steps: u32,
    pub completed_steps: u32,
    pub cached_steps: u32,
}

#[derive(Deserialize)]
struct RawRecord {
    #[serde(rename = "ref")]
    reference: String,
    #[serde(default)]
    name: String,
    status: String,
    created_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
    #[serde(default)]
    total_steps: u32,
    #[serde(default)]
    completed_steps: u32,
    #[serde(default)]
    cached_steps: u32,
}

impl RawRecord {
    fn into_record(raw: Self) -> Option<BuildRecord> {
        let id = raw.reference.rsplit('/').next().unwrap_or(&raw.reference).to_owned();
        Some(BuildRecord {
            id,
            name: raw.name,
            status: BuildStatus::parse(&raw.status)?,
            started_at_ms: raw.created_at.timestamp_millis(),
            completed_at_ms: raw.completed_at.map(|at| at.timestamp_millis()),
            total_steps: raw.total_steps,
            completed_steps: raw.completed_steps,
            cached_steps: raw.cached_steps,
        })
    }
}

/// `history ls --format json` prints one record per line; a line it can't read is skipped.
fn parse_records(output: &str) -> Vec<BuildRecord> {
    output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let record =
                serde_json::from_str::<RawRecord>(line).ok().and_then(RawRecord::into_record);
            if record.is_none() {
                tracing::warn!(line, "skipped an unreadable build record");
            }
            record
        })
        .collect()
}

/// Why a build failed: the step that broke, `BuildKit`'s message and the step's last output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BuildError {
    pub step: Option<String>,
    pub message: String,
    pub logs: Vec<String>,
}

/// What a build was asked to do and what it made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BuildDetail {
    pub id: String,
    pub name: String,
    pub dockerfile: Option<String>,
    /// The folder sent to the builder, or the Git URL of a remote build.
    pub context: Option<String>,
    pub target: Option<String>,
    pub platforms: Vec<String>,
    pub vcs_repository: Option<String>,
    pub vcs_revision: Option<String>,
    pub build_args: Vec<EnvVar>,
    pub labels: Vec<EnvVar>,
    pub error: Option<BuildError>,
    /// The image it made, as the engine's image id. The image may have been deleted since.
    pub image_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawDetail {
    #[serde(rename = "Ref")]
    reference: String,
    #[serde(default)]
    name: String,
    dockerfile: Option<String>,
    context: Option<String>,
    target: Option<String>,
    #[serde(default)]
    platform: Vec<String>,
    #[serde(rename = "VCSRepository")]
    vcs_repository: Option<String>,
    #[serde(rename = "VCSRevision")]
    vcs_revision: Option<String>,
    #[serde(default)]
    build_args: Vec<RawPair>,
    #[serde(default)]
    labels: Vec<RawPair>,
    error: Option<RawError>,
    #[serde(default)]
    attachments: Vec<RawAttachment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawPair {
    name: String,
    #[serde(default)]
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawError {
    #[serde(default)]
    message: String,
    name: Option<String>,
    #[serde(default)]
    logs: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawAttachment {
    digest: String,
    #[serde(rename = "Type")]
    kind: String,
    platform: Option<String>,
}

const INDEX: &str = "application/vnd.oci.image.index.v1+json";

fn pairs(raw: Vec<RawPair>) -> Vec<EnvVar> {
    raw.into_iter().map(|pair| EnvVar { key: pair.name, value: pair.value }).collect()
}

impl From<RawDetail> for BuildDetail {
    fn from(raw: RawDetail) -> Self {
        let manifests = || raw.attachments.iter().filter(|item| item.kind.contains("manifest"));
        let image_id = raw
            .attachments
            .iter()
            .find(|item| item.kind == INDEX)
            .or_else(|| manifests().next())
            .map(|item| item.digest.clone());
        let platforms = if raw.platform.is_empty() {
            manifests().filter_map(|item| item.platform.clone()).collect()
        } else {
            raw.platform
        };
        Self {
            id: raw.reference,
            name: raw.name,
            dockerfile: raw.dockerfile,
            context: raw.context,
            target: raw.target,
            platforms,
            vcs_repository: raw.vcs_repository,
            vcs_revision: raw.vcs_revision,
            build_args: pairs(raw.build_args),
            labels: pairs(raw.labels),
            error: raw.error.map(|error| BuildError {
                step: error.name,
                message: error.message,
                logs: error.logs,
            }),
            image_id,
        }
    }
}

/// Build ids are lowercase letters and digits; anything else can't be one, and mustn't reach the
/// command line where it could pass for a flag.
fn checked(id: &str) -> Result<&str> {
    if !id.is_empty() && id.chars().all(|char| char.is_ascii_alphanumeric()) {
        Ok(id)
    } else {
        Err(Error::NotFound(format!("Build {id}")))
    }
}

impl DockerCli {
    fn history(&self, verb: &str, args: &[&str]) -> Result<tokio::process::Command> {
        let mut all = vec!["buildx", "history", verb, "--builder", BUILDER];
        all.extend(args);
        self.command(all)
    }

    async fn history_output(&self, verb: &str, args: &[&str]) -> Result<String> {
        let output = self.history(verb, args)?.output().await?;
        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
        }
        let line = cli::last_line(&String::from_utf8_lossy(&output.stderr), "buildx");
        let line = line.strip_prefix("ERROR: ").unwrap_or(&line);
        if line.starts_with("no record found") || line.ends_with("is deleted: file does not exist")
        {
            return Err(Error::NotFound("That build".to_owned()));
        }
        Err(Error::Engine(line.to_owned()))
    }

    /// Every build in the engine's history, as buildx lists them (newest first).
    ///
    /// # Errors
    /// Fails when buildx is missing or the engine doesn't answer.
    pub async fn builds(&self) -> Result<Vec<BuildRecord>> {
        Ok(parse_records(&self.history_output("ls", &["--format", "json"]).await?))
    }

    /// What build `id` was asked to do, what it made, and why it failed.
    ///
    /// # Errors
    /// Fails with `NotFound` when the build isn't in the history.
    pub async fn build_detail(&self, id: &str) -> Result<BuildDetail> {
        let json = self.history_output("inspect", &["--format", "json", checked(id)?]).await?;
        let raw: RawDetail = serde_json::from_str(&json)
            .map_err(|error| Error::Engine(format!("buildx printed unreadable JSON: {error}")))?;
        Ok(raw.into())
    }

    /// Passes the build's plain progress output to `on_line`. For a running build it follows the
    /// output live and returns when the build ends.
    ///
    /// # Errors
    /// Fails when the build isn't in the history.
    pub async fn build_logs(&self, id: &str, on_line: impl FnMut(String)) -> Result<()> {
        let command = self.history("logs", &["--progress", "plain", checked(id)?])?;
        cli::stream(command, "Reading the build log", on_line).await
    }

    /// Removes one build from the history. The image it made stays.
    ///
    /// # Errors
    /// Fails when the build isn't in the history.
    pub async fn remove_build(&self, id: &str) -> Result<()> {
        self.history_output("rm", &[checked(id)?]).await.map(drop)
    }

    /// Empties the build history. Images stay.
    ///
    /// # Errors
    /// Fails when the engine doesn't answer.
    pub async fn clear_builds(&self) -> Result<()> {
        self.history_output("rm", &["--all"]).await.map(drop)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = r#"{"cached_steps":0,"completed_steps":0,"created_at":"2026-10-18T02:02:42.491024952Z","name":"cx-slow","ref":"default/default/b7xv8g2gf3oh7saibzp1r917h","status":"Running","total_steps":0}
{"cached_steps":1,"completed_at":"2026-10-18T02:03:30.100485937Z","completed_steps":5,"created_at":"2026-10-18T02:03:29.952068243Z","name":"cx-fail","ref":"default/default/xcyl1oxyd7pczrg4v7njqb1ef","status":"Error","total_steps":5}
{"cached_steps":0,"completed_at":"2026-10-18T01:51:01.332462097Z","completed_steps":10,"created_at":"2026-10-18T01:50:56.101499812Z","name":"infra (worker)","ref":"default/default/vz73j982nfapcjly5dsdomi65","status":"Completed","total_steps":10}
"#;

    #[test]
    fn reads_a_running_build_without_an_end_or_step_counts() {
        let records = parse_records(LIST);
        assert_eq!(
            records[0],
            BuildRecord {
                id: "b7xv8g2gf3oh7saibzp1r917h".to_owned(),
                name: "cx-slow".to_owned(),
                status: BuildStatus::Running,
                started_at_ms: 1_792_288_962_491,
                completed_at_ms: None,
                total_steps: 0,
                completed_steps: 0,
                cached_steps: 0,
            }
        );
    }

    #[test]
    fn reads_failed_and_finished_builds_with_their_steps() {
        let records = parse_records(LIST);
        assert_eq!(records[1].status, BuildStatus::Failed);
        assert_eq!(records[1].completed_at_ms, Some(1_792_289_010_100));
        assert_eq!(records[1].cached_steps, 1);
        assert_eq!(records[2].status, BuildStatus::Completed);
        assert_eq!(records[2].name, "infra (worker)");
        assert_eq!(records[2].total_steps, 10);
    }

    #[test]
    fn skips_a_line_it_cannot_read() {
        let records = parse_records(
            "not json\n{\"ref\":\"x\",\"status\":\"Paused\",\"created_at\":\"2026-10-18T02:02:42Z\"}\n",
        );
        assert!(records.is_empty());
    }

    #[test]
    fn reads_why_a_build_failed() {
        let raw: RawDetail = serde_json::from_str(
            r#"{
  "Name": "cx-fail",
  "Ref": "xcyl1oxyd7pczrg4v7njqb1ef",
  "Context": "/tmp/cx-fail",
  "Dockerfile": "Dockerfile",
  "Platform": ["linux/arm64"],
  "StartedAt": "2026-10-17T22:03:29.952068243-04:00",
  "Duration": 148417694,
  "Status": "failed",
  "Error": {
    "Code": 2,
    "Message": "process \"/bin/sh -c echo about to fail && exit 3\" did not complete successfully: exit code: 3",
    "Name": "[2/2] RUN echo about to fail && exit 3",
    "Logs": ["about to fail"],
    "Sources": "RG9ja2VyZmlsZToz"
  },
  "NumCompletedSteps": 5,
  "NumTotalSteps": 5,
  "NumCachedSteps": 1,
  "BuildArgs": [{"Name": "X", "Value": "2"}],
  "Config": {"ImageResolveMode": "local"}
}"#,
        )
        .unwrap();
        let detail = BuildDetail::from(raw);
        assert_eq!(detail.context.as_deref(), Some("/tmp/cx-fail"));
        assert_eq!(detail.platforms, ["linux/arm64"]);
        assert_eq!(detail.build_args, [EnvVar { key: "X".to_owned(), value: "2".to_owned() }]);
        let error = detail.error.unwrap();
        assert_eq!(error.step.as_deref(), Some("[2/2] RUN echo about to fail && exit 3"));
        assert!(error.message.ends_with("exit code: 3"));
        assert_eq!(error.logs, ["about to fail"]);
        assert_eq!(detail.image_id, None);
    }

    #[test]
    fn finds_the_image_and_platform_a_compose_build_made() {
        let raw: RawDetail = serde_json::from_str(
            r#"{
  "Name": "infra (worker)",
  "Ref": "vz73j982nfapcjly5dsdomi65",
  "Dockerfile": "infra/Dockerfile",
  "VCSRepository": "https://github.com/acme/store.git",
  "VCSRevision": "435f3569f50906d3e15a440470bc8c4e7e0d54b9",
  "Target": "worker",
  "Status": "completed",
  "Labels": [{"Name": "com.docker.compose.project", "Value": "store"}],
  "Attachments": [
    {"Digest": "sha256:006ab7", "Type": "application/vnd.oci.image.index.v1+json"},
    {"Digest": "sha256:91f361", "Type": "https://slsa.dev/provenance/v1"},
    {"Digest": "sha256:b895e9", "Platform": "linux/arm64", "Type": "application/vnd.oci.image.manifest.v1+json"}
  ]
}"#,
        )
        .unwrap();
        let detail = BuildDetail::from(raw);
        assert_eq!(detail.image_id.as_deref(), Some("sha256:006ab7"));
        assert_eq!(detail.platforms, ["linux/arm64"]);
        assert_eq!(detail.target.as_deref(), Some("worker"));
        assert_eq!(detail.labels[0].value, "store");
        assert!(detail.error.is_none());
    }

    #[test]
    fn refuses_an_id_that_could_pass_for_a_flag() {
        assert!(checked("--all").is_err());
        assert!(checked("").is_err());
        assert_eq!(checked("vz73j982nfapcjly5dsdomi65").unwrap(), "vz73j982nfapcjly5dsdomi65");
    }
}
