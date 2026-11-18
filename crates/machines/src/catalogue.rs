use serde::Serialize;

/// A release of a distribution, by the tag of its image.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub alias: &'static str,
    pub label: &'static str,
}

/// How a distribution installs packages and which init it boots with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Family {
    Apt,
    Dnf,
    Zypper,
    Apk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Distro {
    /// Short name, also the hint for its logo.
    pub id: &'static str,
    pub name: &'static str,
    /// Newest first; the first is the default.
    pub releases: &'static [Release],
    /// The distribution's own image on Docker Hub, built for Apple silicon.
    #[serde(skip)]
    pub(crate) repository: &'static str,
    #[serde(skip)]
    pub(crate) family: Family,
}

impl Distro {
    /// The image for `release`, if this distribution offers it.
    #[must_use]
    pub fn image(&self, release: &str) -> Option<String> {
        self.releases
            .iter()
            .any(|known| known.alias == release)
            .then(|| format!("{}:{release}", self.repository))
    }

    pub(crate) fn find(id: &str) -> Option<&'static Self> {
        DISTROS.iter().find(|distro| distro.id == id)
    }
}

const fn release(alias: &'static str, label: &'static str) -> Release {
    Release { alias, label }
}

// ponytail: a curated list, refreshed with each release of Containeria. Read Docker Hub's tags
// instead if users need releases between updates.
pub const DISTROS: &[Distro] = &[
    Distro {
        id: "ubuntu",
        name: "Ubuntu",
        releases: &[
            release("24.04", "24.04 LTS"),
            release("26.04", "26.04 LTS"),
            release("22.04", "22.04 LTS"),
        ],
        repository: "ubuntu",
        family: Family::Apt,
    },
    Distro {
        id: "debian",
        name: "Debian",
        releases: &[release("13", "13 trixie"), release("12", "12 bookworm")],
        repository: "debian",
        family: Family::Apt,
    },
    Distro {
        id: "fedora",
        name: "Fedora",
        releases: &[release("44", "44"), release("43", "43")],
        repository: "fedora",
        family: Family::Dnf,
    },
    Distro {
        id: "alpine",
        name: "Alpine",
        releases: &[release("3.24", "3.24"), release("3.23", "3.23"), release("edge", "edge")],
        repository: "alpine",
        family: Family::Apk,
    },
    Distro {
        id: "opensuse",
        name: "openSUSE",
        releases: &[release("latest", "Tumbleweed")],
        repository: "opensuse/tumbleweed",
        family: Family::Zypper,
    },
    Distro {
        id: "rockylinux",
        name: "Rocky Linux",
        releases: &[release("10", "10"), release("9", "9")],
        repository: "rockylinux/rockylinux",
        family: Family::Dnf,
    },
    Distro {
        id: "kali",
        name: "Kali Linux",
        releases: &[release("latest", "rolling")],
        repository: "kalilinux/kali-rolling",
        family: Family::Apt,
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_image_is_the_distributions_repository_and_the_release() {
        let ubuntu = Distro::find("ubuntu").unwrap();
        assert_eq!(ubuntu.image("24.04").as_deref(), Some("ubuntu:24.04"));
        let suse = Distro::find("opensuse").unwrap();
        assert_eq!(suse.image("latest").as_deref(), Some("opensuse/tumbleweed:latest"));
    }

    #[test]
    fn a_release_the_catalogue_doesnt_list_has_no_image() {
        assert_eq!(Distro::find("ubuntu").unwrap().image("9.04"), None);
        assert!(Distro::find("plan9").is_none());
    }

    #[test]
    fn every_distribution_has_a_default_release() {
        assert!(DISTROS.iter().all(|distro| !distro.releases.is_empty()));
    }
}
