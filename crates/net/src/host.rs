/// The top-level domain every container gets a name under.
pub const DEFAULT_TLD: &str = "containeria.local";

/// A host name as it may appear in a Host header, an SNI or a DNS query, reduced to the canonical
/// form routes are keyed by: lowercase, no port, no trailing dot. `None` when it isn't a valid
/// name of at least two labels.
#[must_use]
pub(crate) fn normalize(raw: &str) -> Option<String> {
    let name = raw.trim();
    let name = name.split_once(':').map_or(name, |(host, _port)| host);
    let name = name.strip_suffix('.').unwrap_or(name).to_ascii_lowercase();
    let labels: Vec<&str> = name.split('.').collect();
    let valid =
        name.len() <= 253 && labels.len() >= 2 && labels.iter().all(|label| is_label(label));
    valid.then_some(name)
}

fn is_label(label: &str) -> bool {
    (1..=63).contains(&label.len())
        && label.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && !label.starts_with('-')
        && !label.ends_with('-')
}

/// Turns a container, project or service name into one DNS label: `My_App.v2` → `my-app-v2`.
fn label(name: &str) -> Option<String> {
    let mut out = String::with_capacity(name.len());
    for char in name.chars() {
        if char.is_ascii_alphanumeric() {
            out.push(char.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed: String = out.trim_matches('-').chars().take(63).collect();
    let trimmed = trimmed.trim_end_matches('-');
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// `web.shop.containeria.local` for service `web` of Compose project `shop`, `redis.containeria.local`
/// for a container started on its own.
#[must_use]
pub fn container_host(
    name: &str,
    project: Option<&str>,
    service: Option<&str>,
    tld: &str,
) -> Option<String> {
    let host = match (project, service) {
        (Some(project), Some(service)) => format!("{}.{}.{tld}", label(service)?, label(project)?),
        _ => format!("{}.{tld}", label(name)?),
    };
    normalize(&host)
}

/// Whether `name` is `zone` itself or a name under it.
#[must_use]
pub(crate) fn is_within(name: &str, zone: &str) -> bool {
    name == zone || name.strip_suffix(zone).is_some_and(|prefix| prefix.ends_with('.'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_what_browsers_and_resolvers_send() {
        assert_eq!(
            normalize("Web.Shop.Containeria.Local:443").as_deref(),
            Some("web.shop.containeria.local")
        );
        assert_eq!(normalize("shop.test.").as_deref(), Some("shop.test"));
    }

    #[test]
    fn rejects_names_that_are_not_host_names() {
        for bad in [
            "",
            "localhost",
            "a..b",
            "-a.test",
            "a-.test",
            "sh op.test",
            "x\".test",
            &"a".repeat(64),
        ] {
            assert_eq!(normalize(bad), None, "{bad}");
        }
    }

    #[test]
    fn names_compose_services_under_their_project() {
        assert_eq!(
            container_host("shop-web-1", Some("shop"), Some("web"), DEFAULT_TLD).as_deref(),
            Some("web.shop.containeria.local")
        );
        assert_eq!(
            container_host("My_Redis", None, None, DEFAULT_TLD).as_deref(),
            Some("my-redis.containeria.local")
        );
        assert_eq!(container_host("___", None, None, DEFAULT_TLD), None);
    }

    #[test]
    fn matches_a_zone_and_names_under_it_only() {
        assert!(is_within("containeria.local", "containeria.local"));
        assert!(is_within("api.shop.test", "shop.test"));
        assert!(!is_within("myshop.test", "shop.test"));
    }
}
