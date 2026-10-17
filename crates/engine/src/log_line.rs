/// One progress line from Colima's logrus output, for the boot overlay.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub level: LogLevel,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum LogLevel {
    Info,
    Warning,
    Error,
}

impl LogLevel {
    fn parse(word: &str) -> Self {
        match word.to_ascii_lowercase().as_str() {
            "warn" | "warning" => Self::Warning,
            "error" | "erro" | "fatal" | "fata" | "panic" => Self::Error,
            _ => Self::Info,
        }
    }
}

impl LogLine {
    /// Reads `time="…" level=info msg="starting colima"` (no TTY) or `INFO[0000] starting colima`.
    #[must_use]
    pub fn parse(line: &str) -> Option<Self> {
        let line = line.trim();
        if line.is_empty() {
            return None;
        }
        if let Some((level, message)) = Self::parse_tty(line) {
            return Some(Self { level, message });
        }
        let level = field(line, "level").map_or(LogLevel::Info, LogLevel::parse);
        let message = field(line, "msg").unwrap_or(line).to_owned();
        Some(Self { level, message })
    }

    fn parse_tty(line: &str) -> Option<(LogLevel, String)> {
        let (head, rest) = line.split_once(' ')?;
        let level = head.strip_suffix(']')?.split_once('[')?.0;
        Some((LogLevel::parse(level), rest.trim().to_owned()))
    }
}

fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let start = line.find(&format!("{key}="))? + key.len() + 1;
    let value = &line[start..];
    if let Some(quoted) = value.strip_prefix('"') {
        quoted.find('"').map(|end| &quoted[..end])
    } else {
        Some(value.split_whitespace().next().unwrap_or(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_plain_logrus_lines() {
        let line =
            LogLine::parse(r#"time="2026-10-17T04:12:00Z" level=info msg="starting colima""#);
        assert_eq!(
            line,
            Some(LogLine { level: LogLevel::Info, message: "starting colima".into() })
        );
    }

    #[test]
    fn reads_tty_logrus_lines() {
        let line = LogLine::parse("WARN[0003] unable to resolve host").unwrap();
        assert_eq!(line.level, LogLevel::Warning);
        assert_eq!(line.message, "unable to resolve host");
    }

    #[test]
    fn keeps_unknown_lines_as_info() {
        let line = LogLine::parse("> provisioning docker").unwrap();
        assert_eq!(line.level, LogLevel::Info);
        assert_eq!(line.message, "> provisioning docker");
    }

    #[test]
    fn skips_blank_lines() {
        assert_eq!(LogLine::parse("   "), None);
    }
}
