use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use rcgen::{
    BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair,
    KeyUsagePurpose,
};
use rustls::crypto::ring;
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use rustls::sign::CertifiedKey;
use time::{Duration, OffsetDateTime};

use crate::error::Result;

/// The name the authority shows in Keychain Access.
pub const CA_NAME: &str = "Containeria Local Certificate Authority";

const CERT_FILE: &str = "ca.pem";
const KEY_FILE: &str = "ca-key.pem";

/// Containeria's own certificate authority. Created once on this Mac, never leaves it, and signs a
/// short-lived certificate for each host the proxy serves.
pub(crate) struct Authority {
    cert_path: PathBuf,
    cert: CertificateDer<'static>,
    issuer: Issuer<'static, KeyPair>,
    leaves: Mutex<HashMap<String, Arc<CertifiedKey>>>,
}

impl std::fmt::Debug for Authority {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Authority")
            .field("cert_path", &self.cert_path)
            .finish_non_exhaustive()
    }
}

fn ca_params() -> Result<CertificateParams> {
    let mut params = CertificateParams::new(Vec::<String>::new())?;
    params.distinguished_name.push(DnType::CommonName, CA_NAME);
    params.distinguished_name.push(DnType::OrganizationName, "Containeria");
    params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    let now = OffsetDateTime::now_utc();
    params.not_before = now - Duration::days(1);
    params.not_after = now + Duration::days(3650);
    Ok(params)
}

/// Writes a file only the user can read.
fn write_private(path: &Path, contents: &str) -> Result<()> {
    let mut file =
        fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
    file.write_all(contents.as_bytes())?;
    Ok(())
}

impl Authority {
    /// Loads the authority from `dir`, creating it the first time.
    ///
    /// # Errors
    /// Fails when the files can't be read or written, or hold something that isn't a certificate.
    pub(crate) fn load_or_create(dir: &Path) -> Result<Self> {
        fs::create_dir_all(dir)?;
        let cert_path = dir.join(CERT_FILE);
        let key_path = dir.join(KEY_FILE);
        if !cert_path.exists() || !key_path.exists() {
            let key = KeyPair::generate()?;
            let cert = ca_params()?.self_signed(&key)?;
            write_private(&key_path, &key.serialize_pem())?;
            fs::write(&cert_path, cert.pem())?;
        }
        let key = KeyPair::from_pem(&fs::read_to_string(&key_path)?)?;
        let pem = fs::read_to_string(&cert_path)?;
        let cert = CertificateDer::from_pem_slice(pem.as_bytes())
            .map_err(|_| crate::Error::DamagedCertificate)?;
        // The stored certificate was made from these same parameters and key, so this issuer signs
        // as it: same subject, same key identifier.
        let issuer = Issuer::new(ca_params()?, key);
        Ok(Self { cert_path, cert, issuer, leaves: Mutex::new(HashMap::new()) })
    }

    /// The authority's certificate, for the Keychain.
    #[must_use]
    pub(crate) fn cert_path(&self) -> &Path {
        &self.cert_path
    }

    /// A certificate for `host`, issued on first use and kept for the life of the process.
    ///
    /// # Errors
    /// Fails when signing fails.
    pub(crate) fn leaf(&self, host: &str) -> Result<Arc<CertifiedKey>> {
        let mut leaves = self.leaves.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(leaf) = leaves.get(host) {
            return Ok(Arc::clone(leaf));
        }
        let key = KeyPair::generate()?;
        let mut params = CertificateParams::new(vec![host.to_owned()])?;
        params.distinguished_name.push(DnType::CommonName, host);
        params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        params.key_usages =
            vec![KeyUsagePurpose::DigitalSignature, KeyUsagePurpose::KeyEncipherment];
        params.use_authority_key_identifier_extension = true;
        let now = OffsetDateTime::now_utc();
        params.not_before = now - Duration::days(1);
        // Apple rejects server certificates valid for more than 825 days, even from a trusted root.
        params.not_after = now + Duration::days(397);
        let cert = params.signed_by(&key, &self.issuer)?;
        let chain = vec![cert.der().clone(), self.cert.clone()];
        let private = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.serialize_der()));
        let leaf = Arc::new(CertifiedKey::from_der(chain, private, &ring::default_provider())?);
        leaves.insert(host.to_owned(), Arc::clone(&leaf));
        Ok(leaf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_the_authority_once_with_a_private_key_only_the_user_can_read() {
        let dir = tempfile::tempdir().unwrap();
        let first = Authority::load_or_create(dir.path()).unwrap();
        let pem = fs::read_to_string(first.cert_path()).unwrap();
        let second = Authority::load_or_create(dir.path()).unwrap();
        assert_eq!(fs::read_to_string(second.cert_path()).unwrap(), pem);
        let mode = fs::metadata(dir.path().join(KEY_FILE)).unwrap().permissions();
        assert_eq!(std::os::unix::fs::PermissionsExt::mode(&mode) & 0o777, 0o600);
    }

    #[test]
    fn issues_and_caches_a_certificate_chained_to_the_authority() {
        let dir = tempfile::tempdir().unwrap();
        let authority = Authority::load_or_create(dir.path()).unwrap();
        let leaf = authority.leaf("web.shop.containeria.local").unwrap();
        assert_eq!(leaf.cert.len(), 2);
        assert_eq!(leaf.cert[1], authority.cert);
        assert!(Arc::ptr_eq(&leaf, &authority.leaf("web.shop.containeria.local").unwrap()));
    }
}
