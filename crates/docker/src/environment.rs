use std::collections::HashMap;

use bollard::query_parameters::InspectContainerOptions;

use crate::{Docker, Result};

impl Docker {
    /// A container's environment variables, such as the credentials a database image was started
    /// with. Treat the values as secrets.
    ///
    /// # Errors
    /// Fails when the container doesn't exist or the engine can't be reached.
    pub async fn container_env(&self, id: &str) -> Result<HashMap<String, String>> {
        let inspected = self.api.inspect_container(id, None::<InspectContainerOptions>).await?;
        let pairs = inspected.config.and_then(|config| config.env).unwrap_or_default();
        Ok(parse_env(&pairs))
    }
}

fn parse_env(pairs: &[String]) -> HashMap<String, String> {
    pairs
        .iter()
        .filter_map(|pair| pair.split_once('='))
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_on_the_first_equals_sign() {
        let env = parse_env(&["POSTGRES_PASSWORD=a=b".into(), "EMPTY=".into(), "BROKEN".into()]);
        assert_eq!(env.get("POSTGRES_PASSWORD").map(String::as_str), Some("a=b"));
        assert_eq!(env.get("EMPTY").map(String::as_str), Some(""));
        assert!(!env.contains_key("BROKEN"));
    }
}
