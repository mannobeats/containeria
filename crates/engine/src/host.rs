use tokio::process::Command;

use crate::error::{Error, Result};

/// The Mac the engine runs on, for sizing the engine's limits.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub chip: String,
    pub cores: u16,
    #[specta(type = specta_typescript::Number)]
    pub memory_bytes: u64,
}

impl Host {
    /// Reads the chip, core count and memory from `sysctl`.
    ///
    /// # Errors
    /// Fails when `sysctl` can't run or prints something unexpected.
    pub async fn detect() -> Result<Self> {
        let output = Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string", "hw.ncpu", "hw.memsize"])
            .output()
            .await?;
        Self::parse(&String::from_utf8_lossy(&output.stdout))
    }

    fn parse(sysctl: &str) -> Result<Self> {
        let unexpected =
            || Error::Command { action: "sysctl", message: format!("unexpected output: {sysctl}") };
        let mut lines = sysctl.lines().map(str::trim);
        let chip = lines.next().filter(|chip| !chip.is_empty()).ok_or_else(unexpected)?.to_owned();
        let cores = lines.next().and_then(|cores| cores.parse().ok()).ok_or_else(unexpected)?;
        let memory_bytes =
            lines.next().and_then(|bytes| bytes.parse().ok()).ok_or_else(unexpected)?;
        Ok(Self { chip, cores, memory_bytes })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_sysctl_output() {
        let host = Host::parse("Apple M1 Max\n10\n34359738368\n").unwrap();
        assert_eq!(
            host,
            Host { chip: "Apple M1 Max".into(), cores: 10, memory_bytes: 34_359_738_368 }
        );
    }

    #[test]
    fn rejects_missing_values() {
        assert!(Host::parse("Apple M1 Max\n").is_err());
        assert!(Host::parse("").is_err());
    }
}
