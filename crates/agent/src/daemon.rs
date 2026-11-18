//! Docker's `daemon.json` in the guest: what the engine asks for, under what the guest decides.

use serde_json::{Value, json};

/// Where Docker listens inside the guest.
pub const SOCKET: &str = "/run/docker.sock";
/// The control group Docker itself runs in. Containers, builds and pods each get a group of
/// their own beside it, which is how the agent tells work from the engine.
pub const GROUP: &str = "engine";
/// The name Docker runs the agent by to publish a port.
pub const PORT_PROXY: &str = "/usr/local/bin/containeria-port-proxy";

/// The settings Docker starts with. `custom` comes from the engine (registry mirrors and the
/// like); the keys the guest depends on can't be changed by it. `host-gateway` stands for the
/// Mac, as `host.docker.internal` does.
#[must_use]
pub fn settings(custom: &Value) -> Value {
    let mut settings = custom.as_object().cloned().unwrap_or_default();
    let fixed = json!({
        "host-gateway-ip": containeria_proto::MAC.to_string(),
        "hosts": [format!("unix://{SOCKET}")],
        "group": "root",
        "data-root": "/var/lib/docker",
        "userland-proxy": true,
        "userland-proxy-path": PORT_PROXY,
    });
    settings.extend(fixed.as_object().cloned().unwrap_or_default());
    Value::Object(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_what_the_engine_asks_for() {
        let made = settings(&json!({ "registry-mirrors": ["https://mirror.gcr.io"] }));
        assert_eq!(made["registry-mirrors"], json!(["https://mirror.gcr.io"]));
        assert_eq!(made["hosts"], json!(["unix:///run/docker.sock"]));
    }

    #[test]
    fn the_engine_cant_move_what_the_guest_depends_on() {
        let made = settings(&json!({ "data-root": "/tmp", "userland-proxy": false }));
        assert_eq!(made["data-root"], "/var/lib/docker");
        assert_eq!(made["userland-proxy"], true);
        assert_eq!(made["userland-proxy-path"], PORT_PROXY);
    }

    #[test]
    fn settings_that_are_not_an_object_are_ignored() {
        assert_eq!(settings(&Value::Null)["group"], "root");
    }

    #[test]
    fn host_gateway_is_the_mac() {
        let made = settings(&json!({ "host-gateway-ip": "10.0.0.1" }));
        assert_eq!(made["host-gateway-ip"], "198.18.0.1");
    }
}
