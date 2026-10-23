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
        let output = tokio::process::Command::new("/usr/sbin/sysctl")
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

/// Whether this Mac can run full VMs inside the engine: nested virtualization needs an M3 or newer
/// chip and macOS 15 or newer.
#[must_use]
pub fn supports_nested_virtualization() -> bool {
    let chip = sysctl("machdep.cpu.brand_string").as_deref().and_then(chip_generation);
    let macos = sysctl("kern.osproductversion").as_deref().and_then(major_version);
    chip.is_some_and(|generation| generation >= 3) && macos.is_some_and(|major| major >= 15)
}

fn sysctl(key: &str) -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/sysctl").args(["-n", key]).output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// "Apple M3 Pro" → 3. Intel chips have no generation.
fn chip_generation(brand: &str) -> Option<u8> {
    let rest = brand.strip_prefix("Apple M")?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

fn major_version(version: &str) -> Option<u8> {
    version.split('.').next()?.parse().ok()
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

    #[test]
    fn reads_the_apple_silicon_generation() {
        assert_eq!(chip_generation("Apple M1 Max"), Some(1));
        assert_eq!(chip_generation("Apple M3"), Some(3));
        assert_eq!(chip_generation("Apple M12 Ultra"), Some(12));
        assert_eq!(chip_generation("Intel(R) Core(TM) i9-9980HK CPU @ 2.40GHz"), None);
    }

    #[test]
    fn reads_the_macos_major_version() {
        assert_eq!(major_version("26.7.1"), Some(26));
        assert_eq!(major_version("14.5"), Some(14));
        assert_eq!(major_version(""), None);
    }
}
