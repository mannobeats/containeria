use crate::{Error, Result};

/// A machine name is also its host name: lowercase letters, digits and dashes, starting with a
/// letter, at most 63 characters, not ending in a dash.
///
/// # Errors
/// Returns a sentence saying what's wrong with the name.
pub fn validate_name(name: &str) -> Result<()> {
    let problem = if name.is_empty() {
        Some("Give the machine a name.")
    } else if name.len() > 63 {
        Some("Use at most 63 characters.")
    } else if !name.starts_with(|c: char| c.is_ascii_lowercase()) {
        Some("Start the name with a lowercase letter.")
    } else if name.ends_with('-') {
        Some("Don't end the name with a dash.")
    } else if !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        Some("Use lowercase letters, numbers and dashes.")
    } else {
        None
    };
    problem.map_or(Ok(()), |message| Err(Error::Invalid(message.to_owned())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_host_names() {
        for name in ["ubuntu", "dev-2", "a"] {
            assert!(validate_name(name).is_ok(), "{name}");
        }
    }

    #[test]
    fn rejects_what_incus_or_dns_would() {
        for name in ["", "2dev", "Dev", "dev-", "dev_box", "dev.box", &"a".repeat(64)] {
            assert!(validate_name(name).is_err(), "{name}");
        }
    }
}
