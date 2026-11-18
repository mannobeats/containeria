//! The engine's cluster in the kubeconfig file `kubectl` reads, beside whatever else is in it.

use yaml_serde::{Mapping, Value};

/// The name of the cluster, its user and its context.
pub(crate) const NAME: &str = "contena";

const SECTIONS: [&str; 3] = ["clusters", "users", "contexts"];

/// Puts the cluster k3s describes in `cluster` into the kubeconfig `existing`, reached on
/// `port` of the Mac. Other clusters stay as they are. The cluster becomes the current one when
/// `select` is set or the file has none.
pub(crate) fn with_cluster(
    existing: &str,
    cluster: &str,
    port: u16,
    select: bool,
) -> yaml_serde::Result<String> {
    let k3s: Value = yaml_serde::from_str(cluster)?;
    let mut config = parse(existing)?;
    let mut server = Mapping::new();
    server.insert("server".into(), format!("https://127.0.0.1:{port}").into());
    copy(&k3s["clusters"][0]["cluster"], &mut server, "certificate-authority-data");
    let mut user = Mapping::new();
    copy(&k3s["users"][0]["user"], &mut user, "client-certificate-data");
    copy(&k3s["users"][0]["user"], &mut user, "client-key-data");
    let mut context = Mapping::new();
    context.insert("cluster".into(), NAME.into());
    context.insert("user".into(), NAME.into());
    for (section, key, value) in
        [("clusters", "cluster", server), ("users", "user", user), ("contexts", "context", context)]
    {
        let mut entry = Mapping::new();
        entry.insert("name".into(), NAME.into());
        entry.insert(key.into(), value.into());
        let mut entries = others(&mut config, section);
        entries.push(entry.into());
        config.insert(section.into(), entries.into());
    }
    let current = config.get("current-context").and_then(Value::as_str).unwrap_or_default();
    if select || current.is_empty() {
        config.insert("current-context".into(), NAME.into());
    }
    yaml_serde::to_string(&config)
}

/// Takes the engine's cluster out of the kubeconfig `existing`.
pub(crate) fn without_cluster(existing: &str) -> yaml_serde::Result<String> {
    let mut config = parse(existing)?;
    for section in SECTIONS {
        let entries = others(&mut config, section);
        config.insert(section.into(), entries.into());
    }
    if config.get("current-context").and_then(Value::as_str) == Some(NAME) {
        config.insert("current-context".into(), "".into());
    }
    yaml_serde::to_string(&config)
}

fn parse(existing: &str) -> yaml_serde::Result<Mapping> {
    let mut config = match yaml_serde::from_str::<Value>(existing)? {
        Value::Mapping(config) => config,
        _ => Mapping::new(),
    };
    for (key, value) in [("apiVersion", "v1"), ("kind", "Config")] {
        if !config.contains_key(key) {
            config.insert(key.into(), value.into());
        }
    }
    Ok(config)
}

/// What `section` lists, taken out of the file and without the engine's own entry.
fn others(config: &mut Mapping, section: &str) -> Vec<Value> {
    let Some(Value::Sequence(mut entries)) = config.remove(section) else { return Vec::new() };
    entries.retain(|entry| entry["name"] != NAME);
    entries
}

fn copy(from: &Value, to: &mut Mapping, key: &str) {
    if let Some(value) = from.get(key) {
        to.insert(key.into(), value.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const K3S: &str = "\
apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: Q0E=
    server: https://127.0.0.1:6443
  name: default
contexts:
- context:
    cluster: default
    user: default
  name: default
current-context: default
kind: Config
users:
- name: default
  user:
    client-certificate-data: Q0VSVA==
    client-key-data: S0VZ
";

    const OTHERS: &str = "\
apiVersion: v1
kind: Config
current-context: work
clusters:
- name: work
  cluster:
    server: https://work.example:6443
users:
- name: work
  user:
    token: secret
contexts:
- name: work
  context:
    cluster: work
    user: work
";

    fn read(text: &str) -> Value {
        yaml_serde::from_str(text).unwrap()
    }

    fn named<'a>(config: &'a Value, section: &str, name: &str) -> Option<&'a Value> {
        config[section].as_sequence()?.iter().find(|entry| entry["name"] == name)
    }

    #[test]
    fn an_empty_file_gets_the_cluster_as_its_current_one() {
        let config = read(&with_cluster("", K3S, 6443, false).unwrap());
        assert_eq!(config["current-context"], NAME);
        let cluster = named(&config, "clusters", NAME).unwrap();
        assert_eq!(cluster["cluster"]["server"], "https://127.0.0.1:6443");
        assert_eq!(cluster["cluster"]["certificate-authority-data"], "Q0E=");
        let user = named(&config, "users", NAME).unwrap();
        assert_eq!(user["user"]["client-key-data"], "S0VZ");
        assert_eq!(named(&config, "contexts", NAME).unwrap()["context"]["user"], NAME);
    }

    #[test]
    fn other_clusters_stay_and_keep_being_current() {
        let config = read(&with_cluster(OTHERS, K3S, 6444, false).unwrap());
        assert_eq!(config["current-context"], "work");
        assert_eq!(named(&config, "users", "work").unwrap()["user"]["token"], "secret");
        let server = &named(&config, "clusters", NAME).unwrap()["cluster"]["server"];
        assert_eq!(*server, "https://127.0.0.1:6444");
    }

    #[test]
    fn turning_kubernetes_on_selects_the_cluster() {
        let config = read(&with_cluster(OTHERS, K3S, 6443, true).unwrap());
        assert_eq!(config["current-context"], NAME);
    }

    #[test]
    fn writing_the_cluster_again_replaces_it() {
        let once = with_cluster(OTHERS, K3S, 6443, false).unwrap();
        let config = read(&with_cluster(&once, K3S, 6450, false).unwrap());
        assert_eq!(config["clusters"].as_sequence().unwrap().len(), 2);
        let server = &named(&config, "clusters", NAME).unwrap()["cluster"]["server"];
        assert_eq!(*server, "https://127.0.0.1:6450");
    }

    #[test]
    fn removing_the_cluster_leaves_the_others() {
        let with = with_cluster(OTHERS, K3S, 6443, true).unwrap();
        let config = read(&without_cluster(&with).unwrap());
        assert!(named(&config, "clusters", NAME).is_none());
        assert!(named(&config, "contexts", NAME).is_none());
        assert!(named(&config, "clusters", "work").is_some());
        assert_eq!(config["current-context"], "");
    }
}
