//! The shell scripts that turn a distribution's bare image into a machine: an init system, sudo
//! and the few tools a shell needs, then a user who is the Mac's.

use contena_proto::SSH_AGENT;

use crate::catalogue::Family;

/// Installs the init system and the basics. Run once for each release; the result is kept as an
/// image every machine of that release starts from. Debian's systemd would load kernel modules
/// at boot, which a container has none of, and call the machine degraded for it.
pub(crate) const fn setup(family: Family) -> &'static str {
    match family {
        Family::Apt => {
            "export DEBIAN_FRONTEND=noninteractive && apt-get update \
             && apt-get install -y --no-install-recommends systemd systemd-sysv dbus sudo \
                ca-certificates curl iproute2 iputils-ping less nano locales openssh-client \
             && apt-get clean && rm -rf /var/lib/apt/lists/* && systemctl mask systemd-modules-load.service"
        }
        Family::Dnf => {
            "dnf install -y systemd sudo passwd shadow-utils iproute iputils procps-ng findutils \
                which less nano ncurses openssh-clients \
             && dnf clean all"
        }
        Family::Zypper => {
            "zypper --non-interactive install systemd sudo shadow iproute2 \
                iputils procps less nano openssh-clients \
             && zypper clean --all"
        }
        // OpenRC inside a container: no terminals to wait on, and nothing to do for hardware.
        Family::Apk => {
            "apk add --no-cache openrc sudo bash shadow curl less nano openssh-client iproute2 \
             && sed -i 's/^tty/#tty/' /etc/inittab \
             && sed -i 's/^#\\?rc_sys=.*/rc_sys=\"docker\"/' /etc/rc.conf \
             && rm -f /etc/init.d/hwdrivers /etc/init.d/modules /etc/init.d/machine-id"
        }
    }
}

/// The machine's process 1. systemd by its own path, which every distribution with it has;
/// `/sbin/init` only exists where a compatibility package puts it.
pub(crate) const fn init(family: Family) -> &'static str {
    match family {
        Family::Apt | Family::Dnf | Family::Zypper => "/usr/lib/systemd/systemd",
        Family::Apk => "/sbin/init",
    }
}

/// The signal that asks the machine's init to shut down.
pub(crate) const fn stop_signal(family: Family) -> &'static str {
    match family {
        Family::Apt | Family::Dnf | Family::Zypper => "SIGRTMIN+3",
        Family::Apk => "SIGUSR2",
    }
}

/// Makes `name` a user with the Mac user's number, so files in the shared home folder belong to
/// the same person on both sides, and lets them use sudo without a password. Every login shell
/// is pointed at the Mac's SSH agent. Records what the machine is, for when it is imported
/// somewhere else.
pub(crate) fn user(name: &str, uid: u32, distro: &str, release: &str) -> String {
    format!(
        "set -e; shell=$(command -v bash || echo /bin/sh); \
         if ! id {name} >/dev/null 2>&1; then \
           if command -v useradd >/dev/null 2>&1; then \
             useradd -m -u {uid} -s \"$shell\" {name} 2>/dev/null || useradd -m -s \"$shell\" {name}; \
           else adduser -D -u {uid} -s \"$shell\" {name}; fi; \
         fi; \
         mkdir -p /etc/sudoers.d && echo '{name} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/{name} \
         && chmod 440 /etc/sudoers.d/{name}; \
         mkdir -p /etc/profile.d \
         && echo 'export SSH_AUTH_SOCK={SSH_AGENT}' > /etc/profile.d/contena.sh; \
         printf '%s' '{{\"distro\":\"{distro}\",\"release\":\"{release}\",\"user\":\"{name}\"}}' \
           > /etc/contena-machine.json"
    )
}

/// A name Linux accepts for a user. The Mac's is used when it is one; `mac` otherwise.
pub(crate) fn user_name(mac: &str) -> &str {
    let mut characters = mac.chars();
    let starts = characters.next().is_some_and(|first| first.is_ascii_lowercase() || first == '_');
    let rest = characters.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "_-".contains(c));
    if starts && rest && mac.len() <= 32 { mac } else { "mac" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_mac_user_name_linux_accepts() {
        assert_eq!(user_name("ada"), "ada");
        assert_eq!(user_name("ada_l-2"), "ada_l-2");
    }

    #[test]
    fn replaces_a_mac_user_name_linux_refuses() {
        for name in ["", "Ada", "ada lovelace", "1ada", "ada;rm -rf /", "$(reboot)"] {
            assert_eq!(user_name(name), "mac", "{name:?}");
        }
    }

    #[test]
    fn the_user_script_records_what_the_machine_is() {
        let script = user("ada", 501, "ubuntu", "24.04");
        assert!(script.contains("useradd -m -u 501"));
        assert!(script.contains(r#"{"distro":"ubuntu","release":"24.04","user":"ada"}"#));
        assert!(script.contains("ada ALL=(ALL) NOPASSWD:ALL"));
    }

    #[test]
    fn distributions_with_systemd_boot_it_and_stop_by_its_signal() {
        assert_eq!(init(Family::Zypper), "/usr/lib/systemd/systemd");
        assert_eq!(stop_signal(Family::Apt), "SIGRTMIN+3");
        assert_eq!((init(Family::Apk), stop_signal(Family::Apk)), ("/sbin/init", "SIGUSR2"));
    }
}
