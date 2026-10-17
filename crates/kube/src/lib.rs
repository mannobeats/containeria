//! Containeria's view of the k3s cluster Colima runs inside the engine, through the Kubernetes API.

mod apply;
mod model;
mod shell;
mod streams;

use std::ffi::OsString;
use std::path::PathBuf;

use k8s_openapi::api::apps::v1::Deployment;
use k8s_openapi::api::core::v1::{ConfigMap, Event, Namespace, Pod, Secret, Service};
use k8s_openapi::api::networking::v1::Ingress;
use kube::api::{DeleteParams, ListParams, ObjectMeta, Patch, PatchParams, PostParams};
use kube::config::KubeConfigOptions;
use kube::{Api, Client, Config, Resource};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

pub use model::{
    Cluster, ConfigKind, ConfigSummary, DeploymentSummary, IngressRoute, IngressSummary, KubeEvent,
    PodSummary, ServicePort, ServiceSummary,
};
pub use shell::{PodResize, PodShell};

/// The kubeconfig context Colima writes for the `containeria` profile: `colima-` plus the profile.
pub const CONTEXT: &str = "colima-containeria";

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("the cluster isn't reachable: {0}")]
    Unreachable(String),

    #[error("{0} was not found")]
    NotFound(String),

    #[error("the manifest couldn't be read: {0}")]
    Manifest(String),

    #[error("{0}")]
    Api(String),
}

impl From<kube::Error> for Error {
    fn from(error: kube::Error) -> Self {
        match error {
            kube::Error::Api(status) if status.code == 404 => Self::NotFound(status.message),
            kube::Error::Api(status) => Self::Api(status.message),
            other => Self::Unreachable(other.to_string()),
        }
    }
}

/// Objects whose YAML the UI can show.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ResourceKind {
    Pod,
    Deployment,
    Service,
}

/// A connection to the cluster.
#[derive(Clone)]
pub struct Kube {
    client: Client,
}

impl std::fmt::Debug for Kube {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.debug_struct("Kube").finish_non_exhaustive()
    }
}

impl Kube {
    /// Connects with a kubeconfig context, from `$KUBECONFIG` or `~/.kube/config` as `kubectl` does.
    ///
    /// # Errors
    /// Fails when the context doesn't exist or the API server doesn't answer.
    pub async fn connect(context: &str) -> Result<Self> {
        let options =
            KubeConfigOptions { context: Some(context.to_owned()), ..KubeConfigOptions::default() };
        let config = Config::from_kubeconfig(&options)
            .await
            .map_err(|error| Error::Unreachable(error.to_string()))?;
        let client =
            Client::try_from(config).map_err(|error| Error::Unreachable(error.to_string()))?;
        client.apiserver_version().await?;
        Ok(Self { client })
    }

    fn all<K>(&self) -> Api<K>
    where
        K: Resource<Scope = k8s_openapi::NamespaceResourceScope>,
        <K as Resource>::DynamicType: Default,
    {
        Api::all(self.client.clone())
    }

    fn namespaced<K>(&self, namespace: &str) -> Api<K>
    where
        K: Resource<Scope = k8s_openapi::NamespaceResourceScope>,
        <K as Resource>::DynamicType: Default,
    {
        Api::namespaced(self.client.clone(), namespace)
    }

    async fn list<K, T>(&self) -> Result<Vec<T>>
    where
        K: Resource<Scope = k8s_openapi::NamespaceResourceScope>
            + Clone
            + DeserializeOwned
            + std::fmt::Debug,
        <K as Resource>::DynamicType: Default,
        for<'a> T: From<&'a K>,
    {
        let list = self.all::<K>().list(&ListParams::default()).await?;
        Ok(list.items.iter().map(T::from).collect())
    }

    /// Reads every object the Kubernetes view shows.
    ///
    /// # Errors
    /// Fails when the API server doesn't answer.
    pub async fn cluster(&self) -> Result<Cluster> {
        let (version, namespaces, pods, deployments, services, ingresses, maps, secrets) = futures::try_join!(
            async { Ok(self.client.apiserver_version().await?.git_version) },
            self.namespaces(),
            self.list::<Pod, PodSummary>(),
            self.list::<Deployment, DeploymentSummary>(),
            self.list::<Service, ServiceSummary>(),
            self.list::<Ingress, IngressSummary>(),
            self.list::<ConfigMap, ConfigSummary>(),
            self.list::<Secret, ConfigSummary>(),
        )?;
        let mut config: Vec<ConfigSummary> = maps.into_iter().chain(secrets).collect();
        config.sort_by(|a, b| (&a.namespace, &a.name).cmp(&(&b.namespace, &b.name)));
        Ok(Cluster { version, namespaces, pods, deployments, services, ingresses, config })
    }

    async fn namespaces(&self) -> Result<Vec<String>> {
        let list = Api::<Namespace>::all(self.client.clone()).list(&ListParams::default()).await?;
        Ok(list.items.into_iter().filter_map(|namespace| namespace.metadata.name).collect())
    }

    /// # Errors
    /// Fails when `name` isn't a DNS-1123 label, the namespace exists, or the API refuses.
    pub async fn create_namespace(&self, name: &str) -> Result<()> {
        check_namespace_name(name)?;
        let namespace = Namespace {
            metadata: ObjectMeta { name: Some(name.to_owned()), ..ObjectMeta::default() },
            ..Namespace::default()
        };
        Api::<Namespace>::all(self.client.clone())
            .create(&PostParams::default(), &namespace)
            .await?;
        Ok(())
    }

    /// Deletes a pod; its controller schedules a replacement.
    ///
    /// # Errors
    /// Fails when the pod is gone or the API refuses.
    pub async fn delete_pod(&self, namespace: &str, name: &str) -> Result<()> {
        self.namespaced::<Pod>(namespace).delete(name, &DeleteParams::default()).await?;
        Ok(())
    }

    /// # Errors
    /// Fails when the deployment is gone or the API refuses.
    pub async fn delete_deployment(&self, namespace: &str, name: &str) -> Result<()> {
        self.namespaced::<Deployment>(namespace).delete(name, &DeleteParams::default()).await?;
        Ok(())
    }

    /// Rolls out fresh pods, the same way `kubectl rollout restart` does.
    ///
    /// # Errors
    /// Fails when the deployment is gone or the API refuses.
    pub async fn restart_deployment(&self, namespace: &str, name: &str) -> Result<()> {
        let now = jiff_now();
        let patch = serde_json::json!({ "spec": { "template": { "metadata": { "annotations": {
            "kubectl.kubernetes.io/restartedAt": now
        } } } } });
        self.namespaced::<Deployment>(namespace)
            .patch(name, &PatchParams::default(), &Patch::Merge(patch))
            .await?;
        Ok(())
    }

    /// # Errors
    /// Fails when the deployment is gone or the API refuses.
    pub async fn scale_deployment(&self, namespace: &str, name: &str, replicas: u16) -> Result<()> {
        let patch = serde_json::json!({ "spec": { "replicas": replicas } });
        self.namespaced::<Deployment>(namespace)
            .patch(name, &PatchParams::default(), &Patch::Merge(patch))
            .await?;
        Ok(())
    }

    /// The object as YAML, without the server-side bookkeeping people never edit.
    ///
    /// # Errors
    /// Fails when the object is gone.
    pub async fn yaml(&self, kind: ResourceKind, namespace: &str, name: &str) -> Result<String> {
        let mut value = match kind {
            ResourceKind::Pod => to_value(self.namespaced::<Pod>(namespace).get(name).await?),
            ResourceKind::Deployment => {
                to_value(self.namespaced::<Deployment>(namespace).get(name).await?)
            }
            ResourceKind::Service => {
                to_value(self.namespaced::<Service>(namespace).get(name).await?)
            }
        };
        if let Some(metadata) = value.get_mut("metadata").and_then(serde_json::Value::as_object_mut)
        {
            metadata.remove("managedFields");
        }
        yaml_serde::to_string(&value).map_err(|error| Error::Manifest(error.to_string()))
    }

    /// Events about one object, newest first.
    ///
    /// # Errors
    /// Fails when the API server doesn't answer.
    pub async fn events(&self, namespace: &str, name: &str) -> Result<Vec<KubeEvent>> {
        let params = ListParams::default().fields(&format!("involvedObject.name={name}"));
        let list = self.namespaced::<Event>(namespace).list(&params).await?;
        let mut events: Vec<KubeEvent> = list.items.iter().map(KubeEvent::from).collect();
        events.sort_by_key(|event| std::cmp::Reverse(event.last_seen));
        Ok(events)
    }

    /// One value of a config map or secret, decoded. Only on request: listings carry key names.
    ///
    /// # Errors
    /// Fails when the object or key doesn't exist.
    pub async fn config_value(
        &self,
        kind: ConfigKind,
        namespace: &str,
        name: &str,
        key: &str,
    ) -> Result<String> {
        let missing = || Error::NotFound(format!("{name}/{key}"));
        match kind {
            ConfigKind::Secret => {
                let secret = self.namespaced::<Secret>(namespace).get(name).await?;
                let bytes =
                    secret.data.and_then(|mut data| data.remove(key)).ok_or_else(missing)?;
                Ok(String::from_utf8_lossy(&bytes.0).into_owned())
            }
            ConfigKind::ConfigMap => {
                let map = self.namespaced::<ConfigMap>(namespace).get(name).await?;
                map.data.and_then(|mut data| data.remove(key)).ok_or_else(missing)
            }
        }
    }
}

/// Namespace names are DNS-1123 labels: up to 63 lowercase letters, digits and `-`, starting and
/// ending with a letter or digit.
fn check_namespace_name(name: &str) -> Result<()> {
    let edge = |c: Option<char>| c.is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let valid = name.len() <= 63
        && edge(name.chars().next())
        && edge(name.chars().last())
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if valid {
        Ok(())
    } else {
        Err(Error::Api(format!(
            "\"{name}\" isn't a valid namespace name. Use up to 63 lowercase letters, digits and \
             hyphens, starting and ending with a letter or digit."
        )))
    }
}

/// The kubeconfig file `connect` reads first, as `kubectl` does: the first entry of `$KUBECONFIG`,
/// or `~/.kube/config`.
#[must_use]
pub fn kubeconfig_path() -> Option<PathBuf> {
    kubeconfig_from(std::env::var_os("KUBECONFIG"), std::env::home_dir())
}

fn kubeconfig_from(variable: Option<OsString>, home: Option<PathBuf>) -> Option<PathBuf> {
    variable
        .and_then(|paths| std::env::split_paths(&paths).find(|path| !path.as_os_str().is_empty()))
        .or_else(|| home.map(|home| home.join(".kube/config")))
}

fn to_value<T: Serialize>(object: T) -> serde_json::Value {
    serde_json::to_value(object).unwrap_or_default()
}

fn jiff_now() -> String {
    k8s_openapi::jiff::Timestamp::now().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_dns_1123_labels_as_namespace_names() {
        for name in ["shop", "a", "team-42", "9lives", &"x".repeat(63)] {
            assert!(check_namespace_name(name).is_ok(), "{name}");
        }
    }

    #[test]
    fn refuses_names_kubernetes_would_reject() {
        for name in ["", "Shop", "-shop", "shop-", "shop_db", "shop.db", "café", &"x".repeat(64)] {
            assert!(check_namespace_name(name).is_err(), "{name}");
        }
    }

    #[test]
    fn reads_the_first_kubeconfig_before_the_home_one() {
        let home = Some(PathBuf::from("/Users/ada"));
        assert_eq!(
            kubeconfig_from(Some(OsString::from(":/tmp/a.yaml:/tmp/b.yaml")), home.clone()),
            Some(PathBuf::from("/tmp/a.yaml"))
        );
        assert_eq!(kubeconfig_from(None, home), Some(PathBuf::from("/Users/ada/.kube/config")));
        assert_eq!(kubeconfig_from(None, None), None);
    }
}
