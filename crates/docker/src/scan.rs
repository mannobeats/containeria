//! Vulnerability scans with Trivy (Apache-2.0), run as a short-lived container next to the image.
//! The vulnerability database is kept in a volume, so only the first scan downloads it.

use serde::{Deserialize, Serialize};

use crate::helper::Helper;
use crate::{Docker, Error, Result};

const TRIVY: &str = "aquasec/trivy:0.76.0";
const CACHE: &str = "containeria-trivy-cache";

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
    Unknown,
}

impl From<&str> for Severity {
    fn from(raw: &str) -> Self {
        match raw {
            "CRITICAL" => Self::Critical,
            "HIGH" => Self::High,
            "MEDIUM" => Self::Medium,
            "LOW" => Self::Low,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Vulnerability {
    pub id: String,
    pub package: String,
    pub installed: String,
    /// The version that fixes it, when one exists.
    pub fixed: Option<String>,
    pub severity: Severity,
    pub title: Option<String>,
    pub url: Option<String>,
    /// The layer or file it was found in, such as `debian 13.1` or `app/package-lock.json`.
    pub target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub reference: String,
    /// Worst first.
    pub vulnerabilities: Vec<Vulnerability>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawReport {
    #[serde(default)]
    results: Vec<RawResult>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawResult {
    target: String,
    #[serde(default)]
    vulnerabilities: Vec<RawVulnerability>,
}

#[derive(Deserialize)]
struct RawVulnerability {
    #[serde(rename = "VulnerabilityID")]
    id: String,
    #[serde(rename = "PkgName")]
    package: String,
    #[serde(rename = "InstalledVersion", default)]
    installed: String,
    #[serde(rename = "FixedVersion")]
    fixed: Option<String>,
    #[serde(rename = "Severity", default)]
    severity: String,
    #[serde(rename = "Title")]
    title: Option<String>,
    #[serde(rename = "PrimaryURL")]
    url: Option<String>,
}

fn read_report(reference: &str, json: &str) -> Result<ScanReport> {
    let raw: RawReport = serde_json::from_str(json)
        .map_err(|error| Error::Engine(format!("Trivy printed unreadable JSON: {error}")))?;
    let mut vulnerabilities: Vec<Vulnerability> = raw
        .results
        .into_iter()
        .flat_map(|result| {
            let target = result.target;
            result.vulnerabilities.into_iter().map(move |raw| Vulnerability {
                id: raw.id,
                package: raw.package,
                installed: raw.installed,
                fixed: raw.fixed.filter(|fixed| !fixed.is_empty()),
                severity: Severity::from(raw.severity.as_str()),
                title: raw.title,
                url: raw.url,
                target: target.clone(),
            })
        })
        .collect();
    vulnerabilities.sort_by(|a, b| a.severity.cmp(&b.severity).then_with(|| a.id.cmp(&b.id)));
    vulnerabilities.dedup_by(|a, b| a.id == b.id && a.package == b.package);
    Ok(ScanReport { reference: reference.to_owned(), vulnerabilities })
}

impl Docker {
    /// Scans a local image for known vulnerabilities in its OS packages and app dependencies.
    ///
    /// # Errors
    /// Fails when Trivy can't be pulled, can't reach its database, or can't read the image.
    pub async fn scan_image(&self, reference: &str) -> Result<ScanReport> {
        let helper = Helper::create_from(
            self,
            TRIVY,
            true,
            vec![
                "/var/run/docker.sock:/var/run/docker.sock".to_owned(),
                format!("{CACHE}:/root/.cache"),
            ],
            &["image", "--format", "json", "--quiet", "--scanners", "vuln", reference],
        )
        .await?;
        let output = helper.run().await;
        helper.remove().await?;
        read_report(reference, &output?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_trivy_json_worst_first() {
        let json = r#"{"Results":[
            {"Target":"debian 13.1","Vulnerabilities":[
                {"VulnerabilityID":"CVE-2026-2","PkgName":"zlib","InstalledVersion":"1.3","FixedVersion":"","Severity":"LOW"},
                {"VulnerabilityID":"CVE-2026-1","PkgName":"openssl","InstalledVersion":"3.5.0","FixedVersion":"3.5.1","Severity":"CRITICAL","Title":"Overflow","PrimaryURL":"https://avd.aquasec.com/nvd/cve-2026-1"}
            ]},
            {"Target":"app/package-lock.json"}
        ]}"#;
        let report = read_report("shop:dev", json).unwrap();
        assert_eq!(report.vulnerabilities.len(), 2);
        let worst = &report.vulnerabilities[0];
        assert_eq!(worst.severity, Severity::Critical);
        assert_eq!(worst.fixed.as_deref(), Some("3.5.1"));
        assert_eq!(report.vulnerabilities[1].fixed, None);
        assert_eq!(report.vulnerabilities[1].target, "debian 13.1");
    }

    #[test]
    fn reads_a_clean_image() {
        let report = read_report("alpine:3", r#"{"Results":[{"Target":"alpine 3.22"}]}"#).unwrap();
        assert!(report.vulnerabilities.is_empty());
    }
}
