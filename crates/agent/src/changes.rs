//! Changes to the Mac's files, as the guest's kernel is told of them, and which of the Mac's
//! folders running containers have mounted.

use contena_proto::{Change, Changed};
use serde::Deserialize;

/// Where the kernel takes changes made outside it (see `guest/patches`).
pub const RELAY: &str = "/proc/fs/fsnotify_relay";

/// One change as the kernel reads it, when something watches for it: the kernel raises its
/// events, and stops trusting what it remembers of the path.
#[must_use]
pub fn record(change: &Change) -> Vec<u8> {
    let kind = match change.what {
        Changed::Appeared => 'c',
        Changed::Contents => 'm',
        Changed::Attributes => 'a',
        Changed::Gone { folder: false } => 'd',
        Changed::Gone { folder: true } => 'D',
    };
    format!("{kind} {}", change.path).into_bytes()
}

/// A change nothing watches for: the kernel only stops trusting what it remembers of `path`, so
/// a file saved on the Mac is the new file to whoever opens it next.
#[must_use]
pub fn forget(path: &str) -> Vec<u8> {
    format!("i {path}").into_bytes()
}

/// What asks the kernel whether anything watches the filesystem `folder` is on.
#[must_use]
pub fn watched(folder: &str) -> Vec<u8> {
    format!("w {folder}").into_bytes()
}

/// The one of `shares` that `path` is in or is.
#[must_use]
pub fn share_of<'a>(path: &str, shares: &'a [String]) -> Option<&'a str> {
    shares.iter().map(String::as_str).find(|share| {
        path.strip_prefix(share).is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Container {
    #[serde(default)]
    mounts: Vec<Mount>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Mount {
    #[serde(rename = "Type")]
    kind: String,
    #[serde(default)]
    source: String,
}

/// The Mac's folders and files that the containers in Docker's list have mounted: each once, in
/// order. `shares` are the paths under which the guest sees the Mac.
///
/// # Errors
/// Fails when `containers` is not Docker's list of containers.
pub fn mounted(containers: &[u8], shares: &[String]) -> serde_json::Result<Vec<String>> {
    let containers: Vec<Container> = serde_json::from_slice(containers)?;
    let mut mounted: Vec<String> = containers
        .into_iter()
        .flat_map(|container| container.mounts)
        .filter(|mount| mount.kind == "bind" && share_of(&mount.source, shares).is_some())
        .map(|mount| mount.source)
        .collect();
    mounted.sort();
    mounted.dedup();
    Ok(mounted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shares() -> Vec<String> {
        vec!["/Users".to_owned(), "/Volumes".to_owned(), "/tmp".to_owned()]
    }

    #[test]
    fn writes_changes_as_the_kernel_reads_them() {
        let change = |what| Change { path: "/Users/ada/shop/a b.rs".to_owned(), what };
        assert_eq!(record(&change(Changed::Contents)), b"m /Users/ada/shop/a b.rs");
        assert_eq!(record(&change(Changed::Appeared)), b"c /Users/ada/shop/a b.rs");
        assert_eq!(record(&change(Changed::Attributes)), b"a /Users/ada/shop/a b.rs");
        assert_eq!(record(&change(Changed::Gone { folder: false })), b"d /Users/ada/shop/a b.rs");
        assert_eq!(record(&change(Changed::Gone { folder: true })), b"D /Users/ada/shop/a b.rs");
        assert_eq!(watched("/Users"), b"w /Users");
        assert_eq!(forget("/Users/ada/shop/a b.rs"), b"i /Users/ada/shop/a b.rs");
    }

    #[test]
    fn a_path_belongs_to_the_share_it_is_under() {
        let shares = shares();
        assert_eq!(share_of("/Users/ada/shop", &shares), Some("/Users"));
        assert_eq!(share_of("/Users", &shares), Some("/Users"));
        assert_eq!(share_of("/Usersx/ada", &shares), None);
        assert_eq!(share_of("/var/lib/docker/volumes/x/_data", &shares), None);
    }

    #[test]
    fn finds_the_macs_folders_among_what_containers_mount() {
        // As `GET /containers/json` answers, cut to what matters here.
        let containers = br#"[
            {"Id":"a","Mounts":[
                {"Type":"bind","Source":"/Users/ada/shop","Destination":"/app","RW":true},
                {"Type":"volume","Name":"db","Source":"/var/lib/docker/volumes/db/_data","Destination":"/data"},
                {"Type":"bind","Source":"/run/docker.sock","Destination":"/var/run/docker.sock"}]},
            {"Id":"b","Mounts":[
                {"Type":"bind","Source":"/Volumes/Work/blog","Destination":"/site"},
                {"Type":"bind","Source":"/Users/ada/shop","Destination":"/src"}]},
            {"Id":"c"}
        ]"#;
        let mounted = mounted(containers, &shares()).unwrap();
        assert_eq!(mounted, ["/Users/ada/shop", "/Volumes/Work/blog"]);
    }

    #[test]
    fn what_is_not_dockers_list_is_an_error() {
        assert!(mounted(b"{\"message\":\"no\"}", &shares()).is_err());
    }
}
