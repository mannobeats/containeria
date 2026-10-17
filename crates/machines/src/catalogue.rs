use serde::Serialize;

/// A release of a distribution, as aliased on images.linuxcontainers.org (`ubuntu/24.04`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub alias: &'static str,
    pub label: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Distro {
    /// The images server's name for it, also the hint for its logo.
    pub id: &'static str,
    pub name: &'static str,
    /// Newest first; the first is the default.
    pub releases: &'static [Release],
}

impl Distro {
    /// The image alias for `release`, if this distribution offers it.
    #[must_use]
    pub fn image(&self, release: &str) -> Option<String> {
        self.releases
            .iter()
            .any(|known| known.alias == release)
            .then(|| format!("{}/{release}", self.id))
    }
}

const fn release(alias: &'static str, label: &'static str) -> Release {
    Release { alias, label }
}

// ponytail: a curated list, refreshed with each release of Containeria. Read the images server's
// simplestreams index instead if users need releases between updates.
pub const DISTROS: &[Distro] = &[
    Distro {
        id: "ubuntu",
        name: "Ubuntu",
        releases: &[
            release("24.04", "24.04 LTS"),
            release("26.04", "26.04 LTS"),
            release("22.04", "22.04 LTS"),
        ],
    },
    Distro {
        id: "debian",
        name: "Debian",
        releases: &[release("13", "13 trixie"), release("12", "12 bookworm")],
    },
    Distro { id: "fedora", name: "Fedora", releases: &[release("44", "44"), release("43", "43")] },
    Distro { id: "archlinux", name: "Arch Linux", releases: &[release("current", "rolling")] },
    Distro {
        id: "alpine",
        name: "Alpine",
        releases: &[release("3.24", "3.24"), release("3.23", "3.23"), release("edge", "edge")],
    },
    Distro {
        id: "nixos",
        name: "NixOS",
        releases: &[release("26.05", "26.05"), release("unstable", "unstable")],
    },
    Distro {
        id: "opensuse",
        name: "openSUSE",
        releases: &[release("tumbleweed", "Tumbleweed"), release("16.0", "Leap 16.0")],
    },
    Distro {
        id: "rockylinux",
        name: "Rocky Linux",
        releases: &[release("10", "10"), release("9", "9")],
    },
    Distro { id: "kali", name: "Kali", releases: &[release("current", "rolling")] },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_distro_offers_a_release() {
        assert_eq!(DISTROS.len(), 9);
        assert!(DISTROS.iter().all(|distro| !distro.releases.is_empty()));
    }

    #[test]
    fn builds_the_image_alias_only_for_known_releases() {
        let ubuntu = DISTROS.iter().find(|distro| distro.id == "ubuntu").unwrap();
        assert_eq!(ubuntu.image("24.04").as_deref(), Some("ubuntu/24.04"));
        assert_eq!(ubuntu.image("9.04"), None);
    }
}
