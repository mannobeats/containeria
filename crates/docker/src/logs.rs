use bollard::container::LogOutput;
use bollard::query_parameters::LogsOptionsBuilder;
use futures::{Stream, StreamExt};
use serde::Serialize;

use crate::{Docker, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    Error,
    Warning,
    Info,
    Debug,
}

/// One line of a container's output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub stream: LogStream,
    /// RFC 3339 with nanoseconds, as Docker stamps it.
    pub timestamp: Option<String>,
    pub level: Level,
    pub message: String,
}

/// Only the start of a line is read for a level: that's where every logger puts it.
const LEVEL_WINDOW: usize = 120;

/// Reads the level from the first level word near the start of the line: `ERROR`, `level=warn`,
/// `"level":"debug"`, nginx's `[error]`, Postgres's `FATAL:`. Lines without one are info.
fn level(message: &str) -> Level {
    let window = message.get(..LEVEL_WINDOW).unwrap_or(message);
    window
        .split(|char: char| !char.is_ascii_alphanumeric())
        .find_map(|word| match word.to_ascii_lowercase().as_str() {
            "error" | "err" | "fatal" | "panic" | "crit" | "critical" | "emerg" | "alert" => {
                Some(Level::Error)
            }
            "warn" | "warning" => Some(Level::Warning),
            "debug" | "trace" => Some(Level::Debug),
            "info" | "notice" | "log" => Some(Level::Info),
            _ => None,
        })
        .unwrap_or(Level::Info)
}

fn entry(stream: LogStream, line: &str) -> LogEntry {
    let line = line.trim_end_matches('\r');
    let (timestamp, message) = match line.split_once(' ') {
        Some((stamp, rest)) if stamp.len() > 20 && stamp.as_bytes()[10] == b'T' => {
            (Some(stamp.to_owned()), rest)
        }
        _ => (None, line),
    };
    LogEntry { stream, timestamp, level: level(message), message: message.to_owned() }
}

// ponytail: splits each chunk on newlines; a TTY container can split one line across chunks,
// which then shows as two entries. Buffer partial lines per stream if that becomes visible.
fn entries(output: &LogOutput) -> Vec<LogEntry> {
    let (stream, bytes) = match output {
        LogOutput::StdErr { message } => (LogStream::Stderr, message),
        LogOutput::StdOut { message } | LogOutput::Console { message } => {
            (LogStream::Stdout, message)
        }
        LogOutput::StdIn { .. } => return Vec::new(),
    };
    String::from_utf8_lossy(bytes)
        .split('\n')
        .filter(|line| !line.trim().is_empty())
        .map(|line| entry(stream, line))
        .collect()
}

impl Docker {
    /// The last `tail` lines, then new lines as they're written, in batches.
    pub fn logs(&self, id: &str, tail: u32) -> impl Stream<Item = Result<Vec<LogEntry>>> + use<> {
        let options = LogsOptionsBuilder::new()
            .follow(true)
            .stdout(true)
            .stderr(true)
            .timestamps(true)
            .tail(&tail.to_string())
            .build();
        self.api
            .logs(id, Some(options))
            .map(|output| output.map(|output| entries(&output)).map_err(Into::into))
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;

    #[test]
    fn finds_the_level_however_the_logger_writes_it() {
        let cases = [
            ("2026/10/17 12:00:00 [error] 29#29: connect() failed", Level::Error),
            ("ERROR:  relation \"orders\" does not exist", Level::Error),
            ("FATAL: password authentication failed", Level::Error),
            (r#"{"level":"warn","msg":"slow query"}"#, Level::Warning),
            ("time=\"x\" level=debug msg=tick", Level::Debug),
            ("LOG:  checkpoint complete", Level::Info),
            ("GET /errors 200 1.2ms", Level::Info),
            ("listening on 0.0.0.0:80", Level::Info),
        ];
        for (line, expected) in cases {
            assert_eq!(level(line), expected, "{line}");
        }
    }

    #[test]
    fn splits_off_docker_timestamps() {
        let entry = entry(LogStream::Stdout, "2026-10-17T12:04:09.877000000Z ready to accept\r");
        assert_eq!(entry.timestamp.as_deref(), Some("2026-10-17T12:04:09.877000000Z"));
        assert_eq!(entry.message, "ready to accept");
    }

    #[test]
    fn keeps_lines_without_a_timestamp_whole() {
        let entry = entry(LogStream::Stderr, "short line");
        assert_eq!(entry.timestamp, None);
        assert_eq!(entry.message, "short line");
    }

    #[test]
    fn splits_a_chunk_into_lines_and_drops_blank_ones() {
        let output = LogOutput::StdErr { message: Bytes::from("one\n\ntwo\n") };
        let lines: Vec<_> = entries(&output).into_iter().map(|entry| entry.message).collect();
        assert_eq!(lines, ["one", "two"]);
        assert_eq!(entries(&LogOutput::StdIn { message: Bytes::from("x") }), Vec::new());
    }
}
