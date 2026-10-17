use std::pin::pin;

use bollard::query_parameters::{ImportImageOptionsBuilder, ListImagesOptionsBuilder};
use futures::StreamExt;

use crate::{Docker, Error, Result};

impl Docker {
    /// Every tagged image, as `repository:tag`. Untagged layers aren't worth moving.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn image_references(&self) -> Result<Vec<String>> {
        let images = self.api.list_images(Some(ListImagesOptionsBuilder::new().build())).await?;
        let mut references: Vec<String> = images
            .into_iter()
            .flat_map(|image| image.repo_tags)
            .filter(|tag| tag != "<none>:<none>")
            .collect();
        references.sort();
        references.dedup();
        Ok(references)
    }

    /// Streams one image from `self` into `target` the way `docker save | docker load` does,
    /// without writing the archive to disk.
    ///
    /// # Errors
    /// Fails when either engine refuses or the image doesn't exist in `self`.
    pub async fn copy_image_to(&self, target: &Docker, reference: &str) -> Result<()> {
        let archive = self.api.export_image(reference);
        let options = ImportImageOptionsBuilder::new().quiet(true).build();
        let mut loading = pin!(target.api.import_image_stream(options, archive, None));
        while let Some(progress) = loading.next().await {
            if let Some(message) = progress?.error_detail.and_then(|detail| detail.message) {
                return Err(Error::Engine(message));
            }
        }
        Ok(())
    }
}
