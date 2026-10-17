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

/// A piece of a container's output, as Docker delivered it; it may hold several lines or part of one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LogChunk {
    pub stream: LogStream,
    pub text: String,
}

impl From<LogOutput> for LogChunk {
    fn from(output: LogOutput) -> Self {
        let stream = if matches!(output, LogOutput::StdErr { .. }) {
            LogStream::Stderr
        } else {
            LogStream::Stdout
        };
        Self { stream, text: output.to_string() }
    }
}

impl Docker {
    /// The last `tail` lines of a container's output, then new output as it comes when `follow`.
    pub fn logs(
        &self,
        id: &str,
        tail: usize,
        follow: bool,
    ) -> impl Stream<Item = Result<LogChunk>> + use<> {
        let options = LogsOptionsBuilder::new()
            .stdout(true)
            .stderr(true)
            .follow(follow)
            .tail(&tail.to_string())
            .build();
        self.api
            .logs(id, Some(options))
            .map(|output| output.map(LogChunk::from).map_err(Into::into))
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::*;

    #[test]
    fn keeps_which_stream_the_output_came_from() {
        let chunk = LogChunk::from(LogOutput::StdErr { message: Bytes::from_static(b"boom\n") });
        assert_eq!(chunk, LogChunk { stream: LogStream::Stderr, text: "boom\n".into() });
    }
}
