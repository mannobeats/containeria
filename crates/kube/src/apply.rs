use kube::api::{DynamicObject, Patch, PatchParams};
use kube::core::GroupVersionKind;
use kube::discovery::{Scope, pinned_kind};
use kube::{Api, ResourceExt};
use serde::Deserialize;

use crate::{Error, Kube, Result};

/// The field manager name shown in `managedFields` for changes made from Containeria.
const FIELD_MANAGER: &str = "containeria";

/// Splits a manifest into its documents, skipping empty ones and `---` separators.
fn documents(manifest: &str) -> Result<Vec<DynamicObject>> {
    yaml_serde::Deserializer::from_str(manifest)
        .map(|document| {
            serde_json::Value::deserialize(document)
                .map_err(|error| Error::Manifest(error.to_string()))
        })
        .filter(|value| !matches!(value, Ok(serde_json::Value::Null)))
        .map(|value| {
            serde_json::from_value(value?).map_err(|error| Error::Manifest(error.to_string()))
        })
        .collect()
}

fn gvk(object: &DynamicObject) -> Result<GroupVersionKind> {
    let types = object
        .types
        .as_ref()
        .ok_or_else(|| Error::Manifest("a document has no apiVersion or kind".to_owned()))?;
    GroupVersionKind::try_from(types).map_err(|error| Error::Manifest(error.to_string()))
}

impl Kube {
    /// Server-side applies every document, like `kubectl apply --server-side`. Returns one line per
    /// object, in kubectl's `kind/name configured` form.
    ///
    /// # Errors
    /// Fails on the first document the manifest or the API rejects; earlier ones stay applied.
    pub async fn apply(
        &self,
        manifest: &str,
        namespace: &str,
        dry_run: bool,
    ) -> Result<Vec<String>> {
        let objects = documents(manifest)?;
        if objects.is_empty() {
            return Err(Error::Manifest("the manifest is empty".to_owned()));
        }
        let mut params = PatchParams::apply(FIELD_MANAGER).force();
        params.dry_run = dry_run;
        let mut applied = Vec::with_capacity(objects.len());
        for object in objects {
            let kind = gvk(&object)?;
            let (resource, capabilities) = pinned_kind(&self.client, &kind).await?;
            let api: Api<DynamicObject> = if capabilities.scope == Scope::Namespaced {
                let target = object.namespace().unwrap_or_else(|| namespace.to_owned());
                Api::namespaced_with(self.client.clone(), &target, &resource)
            } else {
                Api::all_with(self.client.clone(), &resource)
            };
            let name = object.name_any();
            api.patch(&name, &params, &Patch::Apply(&object)).await?;
            applied.push(format!("{}/{name} configured", resource.plural));
        }
        Ok(applied)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_document_and_skips_empty_ones() {
        let objects = documents(
            "---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n---\n\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: web\n  namespace: shop\n",
        )
        .unwrap();
        assert_eq!(objects.len(), 2);
        assert_eq!(gvk(&objects[0]).unwrap(), GroupVersionKind::gvk("apps", "v1", "Deployment"));
        assert_eq!(objects[1].namespace().as_deref(), Some("shop"));
    }

    #[test]
    fn a_document_without_a_kind_is_a_clear_error() {
        let objects = documents("metadata:\n  name: web\n").unwrap();
        assert!(gvk(&objects[0]).unwrap_err().to_string().contains("no apiVersion or kind"));
    }

    #[test]
    fn broken_yaml_is_a_manifest_error() {
        assert!(matches!(documents("kind: [unclosed"), Err(Error::Manifest(_))));
    }
}
