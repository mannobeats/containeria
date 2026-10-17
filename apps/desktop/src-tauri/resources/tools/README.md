# Bundled tools

`scripts/fetch-tools.sh` fills this folder with the pinned, checksum-verified command-line tools the
app ships: Colima and Lima (the engine), the Docker CLI with Compose and Buildx, kubectl and the
Incus client. Only this README is committed. Without the tools, the app uses the copies Homebrew
installed.
