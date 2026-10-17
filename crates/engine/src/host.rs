use std::process::Command;

/// Whether this Mac can run full VMs inside the engine: nested virtualization needs an M3 or newer
/// chip and macOS 15 or newer.
#[must_use]
pub fn supports_nested_virtualization() -> bool {
    let chip = sysctl("machdep.cpu.brand_string").as_deref().and_then(chip_generation);
    let macos = sysctl("kern.osproductversion").as_deref().and_then(major_version);
    chip.is_some_and(|generation| generation >= 3) && macos.is_some_and(|major| major >= 15)
}

fn sysctl(key: &str) -> Option<String> {
    let output = Command::new("/usr/sbin/sysctl").args(["-n", key]).output().ok()?;
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
