# Tri-runtime parity harness: Docker WasmEdge lane image.
#
# The WasmEdge version is NOT pinned here — it is injected from
# src/testing/wasmedgePin.json (the single pin source) via --build-arg by
# the parity harness (`ensureDockerParityImage`). Building this file by hand
# with a different version produces an image the harness will reject at
# version-check time.
FROM ubuntu:24.04

ARG WASMEDGE_VERSION
RUN test -n "${WASMEDGE_VERSION}" || (echo "WASMEDGE_VERSION build-arg is required (injected from src/testing/wasmedgePin.json)" && exit 1)

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    arch="$(uname -m)"; \
    case "${arch}" in \
      x86_64) triple="manylinux_2_28_x86_64" ;; \
      aarch64) triple="manylinux_2_28_aarch64" ;; \
      *) echo "unsupported architecture: ${arch}"; exit 1 ;; \
    esac; \
    curl -sSfL \
      "https://github.com/WasmEdge/WasmEdge/releases/download/${WASMEDGE_VERSION}/WasmEdge-${WASMEDGE_VERSION}-${triple}.tar.gz" \
      -o /tmp/wasmedge.tar.gz; \
    mkdir -p /opt/wasmedge; \
    # The manylinux release tarballs are rootless (bin/, lib64/, include/ at
    # the archive top level) — extract as-is, no component stripping.
    tar -xzf /tmp/wasmedge.tar.gz -C /opt/wasmedge; \
    rm /tmp/wasmedge.tar.gz; \
    LD_LIBRARY_PATH=/opt/wasmedge/lib64:/opt/wasmedge/lib /opt/wasmedge/bin/wasmedge --version

ENV PATH="/opt/wasmedge/bin:${PATH}" \
    LD_LIBRARY_PATH="/opt/wasmedge/lib64:/opt/wasmedge/lib"

# The parity harness always runs this image with an explicit wasmedge argv
# (flags + guest module + guest args) so the container is a pure runtime shell.
ENTRYPOINT ["wasmedge"]
