# syntax=docker/dockerfile:1
# Builds what the engine boots: the kernel (`Image`) and the read-only system image
# (`rootfs.erofs`), with the kernel's full configuration beside them. Run through
# scripts/build-guest.sh, which builds the agent first and passes it in as the `agent` context.

ARG ALPINE=3.24.4

FROM alpine:${ALPINE} AS kernel
RUN apk add --no-cache bash bc bison build-base diffutils elfutils-dev findutils flex \
    linux-headers openssl-dev patch perl xz
ARG KERNEL=6.18.63
ARG KERNEL_SHA256=81764a545072d160748beff4d9de2e7d95aa9f16e8261110288f067a2cc61d71
ADD --checksum=sha256:${KERNEL_SHA256} \
    https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-${KERNEL}.tar.xz /linux.tar.xz
RUN mkdir /linux && tar -xJf /linux.tar.xz -C /linux --strip-components=1 && rm /linux.tar.xz
WORKDIR /linux
# Ours, on top of the release: each file says what it is for.
COPY patches /patches
RUN for change in /patches/*.patch; do patch -p1 --no-backup-if-mismatch < "$change" || exit 1; done
COPY kernel.config /kernel.config
# An option allnoconfig drops has an unmet dependency; fail rather than ship a kernel without it.
RUN make -s ARCH=arm64 allnoconfig KCONFIG_ALLCONFIG=/kernel.config \
    && grep -E '^CONFIG_[A-Z0-9_]+=' /kernel.config | grep -vxFf .config | sed 's/^/not applied: /' >&2 \
    ; ! grep -E '^CONFIG_[A-Z0-9_]+=' /kernel.config | grep -qvxFf .config
RUN make -s -j"$(nproc)" ARCH=arm64 Image

FROM alpine:${ALPINE} AS docker
ARG DOCKER=29.9.3
ARG DOCKER_SHA256=1b27fd739378ef938401e81ce5afb73b7ad7432d4f598814a9ff5f826bb464d2
ADD --checksum=sha256:${DOCKER_SHA256} \
    https://download.docker.com/linux/static/stable/aarch64/docker-${DOCKER}.tgz /docker.tgz
RUN mkdir /out && tar -xzf /docker.tgz -C /out --strip-components=1 \
    docker/dockerd docker/containerd docker/containerd-shim-runc-v2 docker/runc \
    docker/docker-init docker/docker-proxy

FROM alpine:${ALPINE} AS image
RUN apk add --no-cache erofs-utils
# Assembled under /rootfs, not as this stage's own root: a build step can't replace the
# /etc/resolv.conf and /etc/hosts Docker mounts into it.
RUN apk add --root /rootfs --initdb --no-cache --keys-dir /etc/apk/keys \
      --repositories-file /etc/apk/repositories \
      alpine-baselayout busybox ca-certificates-bundle curl e2fsprogs git iptables
COPY --from=docker /out/ /rootfs/usr/local/bin/
COPY --from=agent containeria-agent /rootfs/sbin/containeria-agent
COPY rootfs/ /rootfs/
# Docker runs the agent under this name for each published port (see crates/agent/src/proxy.rs).
RUN ln -s /sbin/containeria-agent /rootfs/usr/local/bin/containeria-port-proxy \
    && ln -s ../../etc/os-release /rootfs/usr/lib/os-release \
    && rm -rf /rootfs/var/cache/apk /rootfs/etc/resolv.conf \
    && mkfs.erofs -zlz4hc -T 0 -U 00000000-0000-0000-0000-000000000000 /rootfs.erofs /rootfs

FROM scratch
COPY --from=kernel /linux/arch/arm64/boot/Image /
COPY --from=kernel /linux/.config /kernel.config
COPY --from=image /rootfs.erofs /
