//! The command line Docker starts its port proxy with, once for each published port:
//!
//! ```text
//! docker-proxy -proto tcp -host-ip 0.0.0.0 -host-port 8080 -container-ip 172.17.0.2
//!     -container-port 80 -use-listen-fd
//! ```

use std::net::IpAddr;

use containeria_proto::{Port, Transport};

/// Reads the port out of the proxy's arguments, without the program name.
///
/// # Errors
/// Says which flag is missing or wrong, or that the transport is one the Mac can't listen for.
pub fn parse<S: AsRef<str>>(arguments: &[S]) -> Result<Port, String> {
    let flag = |name: &str| value(arguments, name).ok_or_else(|| format!("-{name} is missing"));
    let transport = match flag("proto")? {
        "tcp" => Transport::Tcp,
        "udp" => Transport::Udp,
        other => return Err(format!("{other} ports can't be published on the Mac")),
    };
    Ok(Port {
        transport,
        host_ip: address("host-ip", flag("host-ip")?)?,
        host_port: number("host-port", flag("host-port")?)?,
        container_ip: address("container-ip", flag("container-ip")?)?,
        container_port: number("container-port", flag("container-port")?)?,
    })
}

/// A flag's value, written the ways Go's flag package accepts: `-name value`, `-name=value`, and
/// both with two dashes.
fn value<'a, S: AsRef<str>>(arguments: &'a [S], name: &str) -> Option<&'a str> {
    let mut words = arguments.iter().map(AsRef::as_ref);
    while let Some(word) = words.next() {
        let Some(rest) = word.strip_prefix("--").or_else(|| word.strip_prefix('-')) else {
            continue;
        };
        if rest == name {
            return words.next();
        }
        if let Some(value) = rest.strip_prefix(name).and_then(|rest| rest.strip_prefix('=')) {
            return Some(value);
        }
    }
    None
}

fn address(name: &str, text: &str) -> Result<IpAddr, String> {
    text.parse().map_err(|_| format!("-{name} {text} is not an IP address"))
}

fn number(name: &str, text: &str) -> Result<u16, String> {
    text.parse().map_err(|_| format!("-{name} {text} is not a port"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOCKER_29: [&str; 11] = [
        "-proto",
        "tcp",
        "-host-ip",
        "0.0.0.0",
        "-host-port",
        "8080",
        "-container-ip",
        "172.17.0.2",
        "-container-port",
        "80",
        "-use-listen-fd",
    ];

    #[test]
    fn reads_the_port_docker_asks_for() {
        let port = parse(&DOCKER_29).unwrap();
        assert_eq!(port.transport, Transport::Tcp);
        assert_eq!(port.host().to_string(), "0.0.0.0:8080");
        assert_eq!(port.container().to_string(), "172.17.0.2:80");
    }

    #[test]
    fn reads_flags_written_with_an_equals_sign_or_two_dashes() {
        let port = parse(&[
            "--proto=udp",
            "-host-ip=::",
            "--host-port",
            "53",
            "-container-ip=fd00::2",
            "-container-port=5353",
        ])
        .unwrap();
        assert_eq!(port.transport, Transport::Udp);
        assert_eq!(port.host().to_string(), "[::]:53");
        assert_eq!(port.container().to_string(), "[fd00::2]:5353");
    }

    #[test]
    fn a_flag_is_not_mistaken_for_one_it_starts() {
        let arguments = ["-proto", "tcp", "-host-ip", "0.0.0.0", "-host-port-range", "1", "-x"];
        assert_eq!(parse(&arguments).unwrap_err(), "-host-port is missing");
    }

    #[test]
    fn says_which_flag_is_wrong() {
        let mut arguments = DOCKER_29;
        arguments[5] = "http";
        assert_eq!(parse(&arguments).unwrap_err(), "-host-port http is not a port");
    }

    #[test]
    fn refuses_a_transport_the_mac_cant_listen_for() {
        let mut arguments = DOCKER_29;
        arguments[1] = "sctp";
        assert_eq!(parse(&arguments).unwrap_err(), "sctp ports can't be published on the Mac");
    }
}
