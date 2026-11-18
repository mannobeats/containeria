# Bundled tools

`scripts/fetch-tools.sh` fills this folder with the pinned, checksum-verified command-line tools the
app ships beside its engine: the Docker CLI with Compose and Buildx, and kubectl. The release build
adds `cx`. Only this README is committed. Without the tools, the app uses the copies Homebrew
installed.

| Tool | Where | License | Source |
|---|---|---|---|
| Docker CLI | `bin/docker` | Apache-2.0 | github.com/docker/cli |
| Docker Compose | `cli-plugins/docker-compose` | Apache-2.0 | github.com/docker/compose |
| Docker Buildx | `cli-plugins/docker-buildx` | Apache-2.0 | github.com/docker/buildx |
| kubectl | `bin/kubectl` | Apache-2.0 | github.com/kubernetes/kubernetes |
