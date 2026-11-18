use std::collections::HashMap;

use bollard::query_parameters::{
    InspectContainerOptions, ListImagesOptionsBuilder, RemoveImageOptionsBuilder,
    RenameContainerOptionsBuilder, StartContainerOptions,
};
use serde::Serialize;

use crate::machine::{Shape, USER, container, mounted_home};
use crate::name::{validate_name, validate_snapshot_name};
use crate::{Error, Machines, Result};

/// Snapshots are images in this repository, tagged with the machine's name, a dot and the
/// snapshot's. A machine's name has no dot, so the first one divides them. Labels wouldn't do:
/// a machine restored from a snapshot inherits the image's, and so would every copy of it.
const SNAPSHOTS: &str = "containeria/machine-snapshot";
/// The image a machine's container was made from when that isn't a distribution's shared one: a
/// clone's source, an imported disk.
const OWN_IMAGE: &str = "containeria/machine-image";

/// A saved state of a machine's disk that it can go back to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MachineSnapshot {
    pub name: String,
    pub created_at: String,
}

fn reference(machine: &str, snapshot: &str) -> Result<String> {
    validate_name(machine)?;
    validate_snapshot_name(snapshot)?;
    Ok(format!("{SNAPSHOTS}:{machine}.{snapshot}"))
}

pub(crate) fn own_image(machine: &str) -> String {
    format!("{OWN_IMAGE}:{machine}")
}

impl Machines {
    /// The machine's snapshots, newest first.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn snapshots(&self, machine: &str) -> Result<Vec<MachineSnapshot>> {
        validate_name(machine)?;
        let of_machine = format!("{SNAPSHOTS}:{machine}.*");
        let filters = HashMap::from([("reference", vec![of_machine.as_str()])]);
        let options = ListImagesOptionsBuilder::new().filters(&filters).build();
        let mut images = self.api.list_images(Some(options)).await?;
        images.sort_by_key(|image| std::cmp::Reverse(image.created));
        let prefix = format!("{SNAPSHOTS}:{machine}.");
        Ok(images
            .into_iter()
            .filter_map(|image| {
                let created = jiff::Timestamp::from_second(image.created).ok()?;
                let name = image.repo_tags.iter().find_map(|tag| tag.strip_prefix(&prefix))?;
                Some(MachineSnapshot { name: name.to_owned(), created_at: created.to_string() })
            })
            .collect())
    }

    /// Saves the disk as it is now. A running machine pauses for the moment it takes.
    ///
    /// # Errors
    /// Fails when the machine doesn't exist or the name is taken or invalid.
    pub async fn snapshot(&self, machine: &str, snapshot: &str) -> Result<()> {
        let reference = reference(machine, snapshot)?;
        if self.api.inspect_image(&reference).await.is_ok() {
            return Err(Error::Invalid(format!("A snapshot named {snapshot} already exists.")));
        }
        self.commit(&container(machine), &reference).await
    }

    /// Puts the disk back as it was in the snapshot; everything since is lost. A running machine
    /// restarts. The machine as it was stays until the restored one exists.
    ///
    /// # Errors
    /// Fails when the machine or the snapshot doesn't exist.
    pub async fn restore(&self, machine: &str, snapshot: &str) -> Result<()> {
        let reference = reference(machine, snapshot)?;
        self.api.inspect_image(&reference).await?;
        let (shape, running) = self.shape_of(machine).await?;
        let (name, aside) = (container(machine), format!("{}-replaced", container(machine)));
        let _ = self.remove(&aside).await;
        let options = RenameContainerOptionsBuilder::new().name(&aside).build();
        self.api.rename_container(&name, options).await?;
        if let Err(error) = self.create_container(&shape, &reference).await {
            let options = RenameContainerOptionsBuilder::new().name(&name).build();
            self.api.rename_container(&aside, options).await?;
            return Err(error);
        }
        self.remove(&aside).await?;
        if running {
            self.api.start_container(&name, None::<StartContainerOptions>).await?;
        }
        Ok(())
    }

    /// # Errors
    /// Fails when the snapshot doesn't exist.
    pub async fn delete_snapshot(&self, machine: &str, snapshot: &str) -> Result<()> {
        // Forced: a machine restored from the snapshot still uses the image, which then stays
        // without its name until that machine goes.
        let options = RemoveImageOptionsBuilder::new().force(true).build();
        self.api.remove_image(&reference(machine, snapshot)?, Some(options), None).await?;
        Ok(())
    }

    /// A stopped copy of `from` named `to`, as `from` is on disk right now, without its snapshots.
    ///
    /// # Errors
    /// Fails when `from` doesn't exist or `to` is taken or invalid.
    pub async fn copy(&self, from: &str, to: &str) -> Result<()> {
        validate_name(to)?;
        if self.api.inspect_container(&container(to), None::<InspectContainerOptions>).await.is_ok()
        {
            return Err(Error::Invalid(format!("A machine named {to} already exists.")));
        }
        let (shape, _) = self.shape_of(from).await?;
        let image = own_image(to);
        self.commit(&container(from), &image).await?;
        self.create_container(&Shape { name: to.to_owned(), ..shape }, &image).await
    }

    /// Removes the image only `machine` was made from, if it has one.
    pub(crate) async fn forget_image(&self, machine: &str) {
        let options = RemoveImageOptionsBuilder::new().force(true).build();
        let _ = self.api.remove_image(&own_image(machine), Some(options), None).await;
    }

    /// How a machine's container was made, and whether it runs.
    pub(crate) async fn shape_of(&self, machine: &str) -> Result<(Shape, bool)> {
        validate_name(machine)?;
        let inspect = self
            .api
            .inspect_container(&container(machine), None::<InspectContainerOptions>)
            .await?;
        let running = inspect.state.and_then(|state| state.running).unwrap_or(false);
        let config = inspect.config.unwrap_or_default();
        let host = inspect.host_config.unwrap_or_default();
        let labels = config.labels.unwrap_or_default();
        let label = |key: &str| labels.get(key).cloned().unwrap_or_default();
        let shape = Shape {
            name: machine.to_owned(),
            distro: label("dev.containeria.machine.distro"),
            release: label("dev.containeria.machine.release"),
            user: label(USER),
            init: config
                .cmd
                .and_then(|cmd| cmd.into_iter().next())
                .unwrap_or_else(|| "/sbin/init".to_owned()),
            stop_signal: config.stop_signal.unwrap_or_else(|| "SIGTERM".to_owned()),
            cpus: u16::try_from(host.nano_cpus.unwrap_or(0) / 1_000_000_000).unwrap_or(0).max(1),
            memory_gib: u16::try_from(host.memory.unwrap_or(0) >> 30).unwrap_or(0).max(1),
            home: mounted_home(host.binds),
        };
        Ok((shape, running))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_snapshot_is_an_image_named_after_its_machine() {
        assert_eq!(
            reference("dev", "before-upgrade").unwrap(),
            "containeria/machine-snapshot:dev.before-upgrade"
        );
    }

    #[test]
    fn refuses_names_that_are_not_names() {
        assert!(reference("Dev", "ok").is_err());
        assert!(reference("dev", "has space").is_err());
        assert!(reference("dev", "").is_err());
    }
}
