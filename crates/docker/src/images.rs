use std::collections::{BTreeMap, HashMap};

use bollard::models::{
    CreateImageInfo, ImageHistoryResponseItem, ImageInspect, ImageSearchResponseItem,
};
use bollard::query_parameters::{
    CreateImageOptionsBuilder, ListContainersOptionsBuilder, ListImagesOptions,
    PruneImagesOptionsBuilder, RemoveImageOptionsBuilder, SearchImagesOptionsBuilder,
    TagImageOptionsBuilder,
};
use futures::{Stream, StreamExt};
use serde::{Deserialize, Serialize};

use crate::{Docker, Error, PruneReport, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageSummary {
    pub id: String,
    /// `None` for a dangling build layer, which has no name.
    pub repository: Option<String>,
    pub tag: Option<String>,
    /// Every `repository:tag` pointing at this image.
    pub references: Vec<String>,
    #[specta(type = specta_typescript::Number)]
    pub size_bytes: u64,
    #[specta(type = specta_typescript::Number)]
    pub created_at: i64,
    /// How many containers, running or not, were created from this image.
    pub containers: u32,
    pub dangling: bool,
}

/// `ghcr.io:443/acme/api:1.2` → (`ghcr.io:443/acme/api`, `1.2`). A colon only marks a tag after the
/// last slash; a reference without one is `latest`.
#[must_use]
pub fn split_reference(reference: &str) -> (String, String) {
    if let Some((repository, digest)) = reference.split_once('@') {
        let short = digest.split_once(':').map_or(digest, |(_, hex)| hex);
        return (repository.to_owned(), format!("@{}", &short[..short.len().min(12)]));
    }
    let name_start = reference.rfind('/').map_or(0, |slash| slash + 1);
    match reference[name_start..].rfind(':') {
        Some(colon) => {
            let at = name_start + colon;
            (reference[..at].to_owned(), reference[at + 1..].to_owned())
        }
        None => (reference.to_owned(), "latest".to_owned()),
    }
}

fn summarize(
    raw: bollard::models::ImageSummary,
    containers: &HashMap<String, u32>,
) -> ImageSummary {
    let references: Vec<String> =
        raw.repo_tags.into_iter().filter(|reference| reference != "<none>:<none>").collect();
    let (repository, tag) = references
        .first()
        .map(|reference| split_reference(reference))
        .map_or((None, None), |(repository, tag)| (Some(repository), Some(tag)));
    ImageSummary {
        containers: containers.get(&raw.id).copied().unwrap_or(0),
        dangling: references.is_empty(),
        id: raw.id,
        repository,
        tag,
        references,
        size_bytes: u64::try_from(raw.size).unwrap_or(0),
        created_at: raw.created,
    }
}

/// One line of pull progress. Layers report several times as they download and extract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PullProgress {
    /// The layer id, or `None` for messages about the whole image.
    pub layer: Option<String>,
    pub status: String,
    #[specta(type = Option<specta_typescript::Number>)]
    pub current: Option<u64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub total: Option<u64>,
}

impl TryFrom<CreateImageInfo> for PullProgress {
    type Error = Error;

    fn try_from(info: CreateImageInfo) -> Result<Self> {
        if let Some(message) = info.error_detail.and_then(|detail| detail.message) {
            return Err(Error::Engine(message));
        }
        let detail = info.progress_detail.unwrap_or_default();
        let bytes = |value: Option<i64>| {
            value.and_then(|value| u64::try_from(value).ok()).filter(|&value| value > 0)
        };
        Ok(Self {
            layer: info.id,
            status: info.status.unwrap_or_default(),
            current: bytes(detail.current),
            total: bytes(detail.total),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageLayer {
    /// 1 for the base layer, counting up in Dockerfile order.
    pub step: u32,
    /// The Dockerfile instruction that made this layer.
    pub created_by: String,
    #[specta(type = specta_typescript::Number)]
    pub size_bytes: u64,
}

fn layer(step: u32, item: &ImageHistoryResponseItem) -> ImageLayer {
    let instruction = item.created_by.trim();
    let instruction = instruction.strip_prefix("/bin/sh -c #(nop) ").unwrap_or(instruction).trim();
    ImageLayer {
        step,
        created_by: instruction.to_owned(),
        size_bytes: u64::try_from(item.size).unwrap_or(0),
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageDetail {
    pub id: String,
    pub references: Vec<String>,
    pub platform: String,
    pub user: String,
    pub entrypoint: Vec<String>,
    pub command: Vec<String>,
    pub working_dir: String,
    pub exposed_ports: Vec<String>,
    pub env: Vec<String>,
    pub labels: BTreeMap<String, String>,
    /// Oldest first, as the Dockerfile reads.
    pub layers: Vec<ImageLayer>,
}

fn detail(inspect: ImageInspect, history: Vec<ImageHistoryResponseItem>) -> ImageDetail {
    let config = inspect.config.unwrap_or_default();
    let platform = [inspect.os, inspect.architecture, inspect.variant]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join("/");
    let layers =
        history.into_iter().rev().zip(1..).map(|(item, step)| layer(step, &item)).collect();
    ImageDetail {
        id: inspect.id.unwrap_or_default(),
        references: inspect.repo_tags.unwrap_or_default(),
        platform,
        user: config.user.unwrap_or_default(),
        entrypoint: config.entrypoint.unwrap_or_default(),
        command: config.cmd.unwrap_or_default(),
        working_dir: config.working_dir.unwrap_or_default(),
        exposed_ports: config.exposed_ports.unwrap_or_default(),
        env: config.env.unwrap_or_default(),
        labels: config.labels.unwrap_or_default().into_iter().collect(),
        layers,
    }
}

/// A Docker Hub search result for the pull sheet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HubImage {
    pub name: String,
    pub description: String,
    pub official: bool,
    pub stars: u32,
}

impl From<ImageSearchResponseItem> for HubImage {
    fn from(item: ImageSearchResponseItem) -> Self {
        Self {
            name: item.name.unwrap_or_default(),
            description: item.description.unwrap_or_default(),
            official: item.is_official.unwrap_or(false),
            stars: item.star_count.and_then(|stars| u32::try_from(stars).ok()).unwrap_or(0),
        }
    }
}

impl Docker {
    /// Every image, named ones first, with how many containers use each.
    ///
    /// # Errors
    /// Fails when the engine can't be reached.
    pub async fn images(&self) -> Result<Vec<ImageSummary>> {
        let raw = self.api.list_images(None::<ListImagesOptions>).await?;
        let options = ListContainersOptionsBuilder::new().all(true).build();
        let mut containers: HashMap<String, u32> = HashMap::new();
        for container in self.api.list_containers(Some(options)).await? {
            *containers.entry(container.image_id.unwrap_or_default()).or_default() += 1;
        }
        let mut images: Vec<ImageSummary> =
            raw.into_iter().map(|image| summarize(image, &containers)).collect();
        images.sort_by(|a, b| {
            (a.dangling, &a.repository, &a.tag).cmp(&(b.dangling, &b.repository, &b.tag))
        });
        Ok(images)
    }

    /// Pulls `reference`, reporting layer progress until the image is stored.
    pub fn pull(&self, reference: &str) -> impl Stream<Item = Result<PullProgress>> + use<> {
        let (repository, tag) = split_reference(reference);
        let options = CreateImageOptionsBuilder::new().from_image(&repository).tag(&tag).build();
        self.api
            .create_image(Some(options), None, None)
            .map(|info| info.map_err(Error::from).and_then(PullProgress::try_from))
    }

    /// # Errors
    /// Fails when the image is used by a container and `force` is off.
    pub async fn remove_image(&self, id: &str, force: bool) -> Result<()> {
        let options = RemoveImageOptionsBuilder::new().force(force).build();
        self.api.remove_image(id, Some(options), None).await?;
        Ok(())
    }

    /// # Errors
    /// Fails when the image doesn't exist or the reference is invalid.
    pub async fn tag_image(&self, id: &str, reference: &str) -> Result<()> {
        let (repository, tag) = split_reference(reference);
        let options = TagImageOptionsBuilder::new().repo(&repository).tag(&tag).build();
        Ok(self.api.tag_image(id, Some(options)).await?)
    }

    /// Writes the image to `path` as a `docker save` archive another engine can load.
    ///
    /// # Errors
    /// Fails when the image doesn't exist or the file can't be written.
    pub async fn export_image(&self, reference: &str, path: &std::path::Path) -> Result<()> {
        use tokio::io::AsyncWriteExt;
        let mut file = tokio::fs::File::create(path).await?;
        let mut chunks = std::pin::pin!(self.api.export_image(reference));
        while let Some(chunk) = chunks.next().await {
            file.write_all(&chunk?).await?;
        }
        file.flush().await?;
        Ok(())
    }

    /// Deletes images no container uses. With `all` off, only dangling build layers go.
    ///
    /// # Errors
    /// Fails when the engine refuses.
    pub async fn prune_images(&self, all: bool) -> Result<PruneReport> {
        let filters = HashMap::from([("dangling", vec![(!all).to_string()])]);
        let options = PruneImagesOptionsBuilder::new().filters(&filters).build();
        let response = self.api.prune_images(Some(options)).await?;
        Ok(PruneReport::new(
            response.images_deleted.map_or(0, |deleted| deleted.len()),
            response.space_reclaimed,
        ))
    }

    /// # Errors
    /// Fails when the image doesn't exist.
    pub async fn image(&self, id: &str) -> Result<ImageDetail> {
        let inspect = self.api.inspect_image(id).await?;
        let history = self.api.image_history(id).await?;
        Ok(detail(inspect, history))
    }

    /// Docker Hub search, through the engine.
    ///
    /// # Errors
    /// Fails when the engine can't reach Docker Hub.
    pub async fn search_hub(&self, term: &str) -> Result<Vec<HubImage>> {
        let options = SearchImagesOptionsBuilder::new().term(term).limit(25).build();
        let mut images: Vec<HubImage> =
            self.api.search_images(options).await?.into_iter().map(Into::into).collect();
        images.sort_by_key(|image| (!image.official, std::cmp::Reverse(image.stars)));
        Ok(images)
    }
}

#[cfg(test)]
mod tests {
    use bollard::models::{ErrorDetail, ImageConfig, ProgressDetail};

    use super::*;

    #[test]
    fn shows_a_digest_reference_as_a_short_digest() {
        let (repository, tag) =
            split_reference("postgres@sha256:d3e1620b530c944afa9e887d22eb899824da68");
        assert_eq!((repository.as_str(), tag.as_str()), ("postgres", "@d3e1620b530c"));
    }

    #[test]
    fn splits_references_with_registry_ports_and_digests_of_tags() {
        assert_eq!(split_reference("postgres:18"), ("postgres".into(), "18".into()));
        assert_eq!(split_reference("redis"), ("redis".into(), "latest".into()));
        assert_eq!(
            split_reference("localhost:5000/acme/api:1.2"),
            ("localhost:5000/acme/api".into(), "1.2".into())
        );
        assert_eq!(
            split_reference("localhost:5000/api"),
            ("localhost:5000/api".into(), "latest".into())
        );
    }

    #[test]
    fn a_nameless_image_is_a_dangling_layer_and_counts_its_containers() {
        let raw = bollard::models::ImageSummary {
            id: "sha256:abc".into(),
            repo_tags: vec!["<none>:<none>".into()],
            size: 1_000,
            ..Default::default()
        };
        let image = summarize(raw, &HashMap::from([("sha256:abc".to_owned(), 2)]));
        assert!(image.dangling);
        assert_eq!(image.repository, None);
        assert_eq!(image.containers, 2);
        assert_eq!(image.size_bytes, 1_000);
    }

    #[test]
    fn names_an_image_by_its_first_reference() {
        let raw = bollard::models::ImageSummary {
            id: "sha256:def".into(),
            repo_tags: vec!["shop/api:dev".into(), "shop/api:latest".into()],
            ..Default::default()
        };
        let image = summarize(raw, &HashMap::new());
        assert_eq!(
            (image.repository.as_deref(), image.tag.as_deref()),
            (Some("shop/api"), Some("dev"))
        );
        assert_eq!(image.references.len(), 2);
        assert!(!image.dangling);
    }

    #[test]
    fn reads_pull_progress_and_errors() {
        let progress = PullProgress::try_from(CreateImageInfo {
            id: Some("a2318d6c47ec".into()),
            status: Some("Downloading".into()),
            progress_detail: Some(ProgressDetail { current: Some(512), total: Some(2_048) }),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(progress.layer.as_deref(), Some("a2318d6c47ec"));
        assert_eq!((progress.current, progress.total), (Some(512), Some(2_048)));

        let error = PullProgress::try_from(CreateImageInfo {
            error_detail: Some(ErrorDetail {
                message: Some("manifest unknown".into()),
                code: None,
            }),
            ..Default::default()
        });
        assert!(matches!(error, Err(Error::Engine(message)) if message == "manifest unknown"));
    }

    #[test]
    fn lists_layers_oldest_first_without_the_nop_prefix() {
        let history = vec![
            ImageHistoryResponseItem {
                created_by: "/bin/sh -c #(nop)  CMD [\"nginx\"]".into(),
                size: 0,
                ..Default::default()
            },
            ImageHistoryResponseItem {
                created_by: "ADD rootfs.tar.xz /".into(),
                size: 75_000,
                ..Default::default()
            },
        ];
        let inspect = ImageInspect {
            os: Some("linux".into()),
            architecture: Some("arm64".into()),
            config: Some(ImageConfig { user: Some("nginx".into()), ..Default::default() }),
            ..Default::default()
        };
        let detail = detail(inspect, history);
        assert_eq!(detail.platform, "linux/arm64");
        assert_eq!(detail.layers[0].created_by, "ADD rootfs.tar.xz /");
        assert_eq!(detail.layers[1].created_by, "CMD [\"nginx\"]");
        assert_eq!((detail.layers[0].step, detail.layers[1].step), (1, 2));
        assert_eq!(detail.user, "nginx");
    }
}
