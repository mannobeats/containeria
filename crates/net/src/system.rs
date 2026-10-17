//! The two places Containeria changes the Mac outside its own folder: the resolver file that sends
//! `*.containeria.local` lookups to its DNS server, and the Keychain trust for its certificate
//! authority. Both run only when the user asks, behind a macOS prompt they confirm.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tokio::process::Command;

use crate::ca::CA_NAME;
use crate::error::{Error, Result};

/// Whether macOS sends the zone's lookups to Containeria.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ResolverState {
    Installed,
    /// The file exists but points somewhere else, usually an old port.
    Stale,
    Missing,
}

#[must_use]
pub(crate) fn resolver_path(zone: &str) -> PathBuf {
    Path::new("/etc/resolver").join(zone)
}

#[must_use]
pub(crate) fn resolver_contents(port: u16) -> String {
    format!(
        "# Added by Containeria. Remove it in Containeria > Domains.\nnameserver 127.0.0.1\nport {port}\n"
    )
}

#[must_use]
pub(crate) fn resolver_state(path: &Path, port: u16) -> ResolverState {
    match std::fs::read_to_string(path) {
        Ok(contents) if contents == resolver_contents(port) => ResolverState::Installed,
        Ok(_) => ResolverState::Stale,
        Err(_) => ResolverState::Missing,
    }
}

/// Quotes `text` as an `AppleScript` string literal.
fn applescript_string(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// The `AppleScript` that runs `shell` as root after the user confirms the macOS password prompt.
fn privileged_script(shell: &str, prompt: &str) -> String {
    format!(
        "do shell script {} with prompt {} with administrator privileges",
        applescript_string(shell),
        applescript_string(prompt)
    )
}

/// The shell command that writes the resolver file. `zone` must be a validated host name.
fn install_command(zone: &str, port: u16) -> String {
    let contents = resolver_contents(port).replace('\n', "\\n");
    format!("/bin/mkdir -p /etc/resolver && /usr/bin/printf '{contents}' > /etc/resolver/{zone}")
}

async fn run(action: &'static str, program: &str, args: &[&str]) -> Result<()> {
    let output = Command::new(program).args(args).kill_on_drop(true).output().await?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    // osascript reports a cancelled password prompt as error -128.
    if message.contains("-128") || message.contains("canceled") || message.contains("cancelled") {
        return Err(Error::Cancelled);
    }
    Err(Error::Command { action, message })
}

/// Runs `shell` as root after the user approves the macOS administrator prompt showing `prompt`.
///
/// # Errors
/// Fails with `Cancelled` when the user dismisses the prompt, or with the command's error.
pub async fn privileged(action: &'static str, shell: &str, prompt: &str) -> Result<()> {
    run(action, "/usr/bin/osascript", &["-e", &privileged_script(shell, prompt)]).await
}

/// Writes `/etc/resolver/<zone>` after the user approves the macOS administrator prompt.
///
/// # Errors
/// Fails if the zone isn't a valid host name, the user cancels, or the write fails.
pub(crate) async fn install_resolver(zone: &str, port: u16) -> Result<()> {
    let zone = crate::host::normalize(zone).ok_or_else(|| Error::InvalidHost(zone.to_owned()))?;
    let prompt =
        format!("Containeria wants to send .{zone} lookups on this Mac to its own DNS server.");
    privileged("Setting up domains", &install_command(&zone, port), &prompt).await
}

/// Removes `/etc/resolver/<zone>` after the user approves the macOS administrator prompt.
///
/// # Errors
/// Fails if the zone isn't a valid host name, the user cancels, or the removal fails.
pub(crate) async fn uninstall_resolver(zone: &str) -> Result<()> {
    let zone = crate::host::normalize(zone).ok_or_else(|| Error::InvalidHost(zone.to_owned()))?;
    let prompt = format!("Containeria wants to stop answering .{zone} lookups on this Mac.");
    privileged("Removing domains", &format!("/bin/rm -f /etc/resolver/{zone}"), &prompt).await
}

fn login_keychain() -> Option<String> {
    std::env::home_dir()
        .map(|home| home.join("Library/Keychains/login.keychain-db").to_string_lossy().into_owned())
}

/// Whether macOS trusts the certificate authority for websites.
pub(crate) async fn is_trusted(cert: &Path) -> bool {
    let cert = cert.to_string_lossy();
    run(
        "Checking the certificate",
        "/usr/bin/security",
        &["verify-cert", "-c", &cert, "-l", "-L", "-q", "-p", "ssl"],
    )
    .await
    .is_ok()
}

/// Adds the certificate authority to the login keychain as trusted for websites. macOS asks the
/// user to confirm with their password or Touch ID.
///
/// # Errors
/// Fails if the user cancels or the keychain refuses.
pub(crate) async fn trust(cert: &Path) -> Result<()> {
    let keychain = login_keychain().ok_or(Error::Command {
        action: "Trusting the certificate",
        message: "no home folder".into(),
    })?;
    let cert = cert.to_string_lossy();
    run(
        "Trusting the certificate",
        "/usr/bin/security",
        &["add-trusted-cert", "-r", "trustRoot", "-p", "ssl", "-k", &keychain, &cert],
    )
    .await
}

/// Removes the trust setting and the certificate from the login keychain.
///
/// # Errors
/// Fails if the user cancels or the keychain refuses.
pub(crate) async fn untrust(cert: &Path) -> Result<()> {
    let keychain = login_keychain().ok_or(Error::Command {
        action: "Removing the certificate",
        message: "no home folder".into(),
    })?;
    let cert = cert.to_string_lossy();
    run("Removing the certificate", "/usr/bin/security", &["remove-trusted-cert", &cert]).await?;
    run(
        "Removing the certificate",
        "/usr/bin/security",
        &["delete-certificate", "-c", CA_NAME, &keychain],
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_resolver_file_with_the_dns_port() {
        assert_eq!(
            install_command("containeria.local", 15353),
            "/bin/mkdir -p /etc/resolver && /usr/bin/printf '# Added by Containeria. Remove it in Containeria > Domains.\\nnameserver 127.0.0.1\\nport 15353\\n' > /etc/resolver/containeria.local"
        );
    }

    #[test]
    fn quotes_the_shell_command_inside_applescript() {
        let script = privileged_script(r#"echo "a\b""#, "Why");
        assert_eq!(
            script,
            r#"do shell script "echo \"a\\b\"" with prompt "Why" with administrator privileges"#
        );
    }

    #[test]
    fn reads_the_resolver_state() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("containeria.local");
        assert_eq!(resolver_state(&path, 15353), ResolverState::Missing);
        std::fs::write(&path, resolver_contents(15353)).unwrap();
        assert_eq!(resolver_state(&path, 15353), ResolverState::Installed);
        assert_eq!(resolver_state(&path, 15354), ResolverState::Stale);
    }

    #[tokio::test]
    async fn refuses_to_touch_the_system_for_an_invalid_zone() {
        assert!(matches!(install_resolver("evil; rm -rf /", 1).await, Err(Error::InvalidHost(_))));
    }
}
