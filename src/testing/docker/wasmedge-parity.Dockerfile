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
    && apt-get install -y --no-install-recommends curl ca-certificates build-essential git cmake ninja-build \
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

COPY native/wasmedge_wasi_threads_runner.c /tmp/sdm-wasi-threads-runner.c
# The SDN WasmEdge 0.16.4 patch series, byte-identical to SDN's testdata/
# (sdn-server/internal/wasmrt/SUBSTRATE.md): 01-atomic-wait, 02-stop-token,
# 03-fault-jmp, 04-atomic-memarg-offset. Order matters (02 and 04 both touch
# lib/llvm/compiler.cpp) and matches SDN's build-static-wasmedge.sh.
# The ordinary CLI (above) keeps its release library. Only the SDK thread
# runner links this patched build, matching the native (non-Docker) build in
# buildWasmEdgeRunner.js. Configured -DWASMEDGE_USE_LLVM=OFF, which in 0.16.4
# also gates WASMEDGE_BUILD_AOT_RUNTIME: this library can neither compile nor
# load AOT code. Patches 02-04 therefore patch code this runner never
# executes (Interruptible-AOT stop-token traffic, the AOT fault path, and the
# LLVM AOT compiler); only 01 changes this image's observable behaviour
# today. They stay applied so this image's WasmEdge checkout never drifts
# from SDN's patched baseline. This is also why no memarg-offset (04)
# regression test runs against this image: there is no AOT lane here to run
# SDN's substrate probe against.
COPY native/wasmedge-0.16.4-atomic-wait.patch /tmp/01-atomic-wait.patch
COPY native/wasmedge-0.16.4-stop-token.patch /tmp/02-stop-token.patch
COPY native/wasmedge-0.16.4-fault-jmp.patch /tmp/03-fault-jmp.patch
COPY native/wasmedge-0.16.4-atomic-memarg-offset.patch /tmp/04-atomic-memarg-offset.patch
RUN git clone --depth 1 --branch 0.16.4 https://github.com/WasmEdge/WasmEdge.git /tmp/wasmedge-source \
    && test "$(git -C /tmp/wasmedge-source rev-parse HEAD)" = be85c2fbba68318f103b4a766728f6946e65abf8 \
    && git -C /tmp/wasmedge-source apply /tmp/01-atomic-wait.patch \
    && git -C /tmp/wasmedge-source apply /tmp/02-stop-token.patch \
    && git -C /tmp/wasmedge-source apply /tmp/03-fault-jmp.patch \
    && git -C /tmp/wasmedge-source apply /tmp/04-atomic-memarg-offset.patch \
    && cmake -S /tmp/wasmedge-source -B /tmp/wasmedge-build -G Ninja \
       -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/sdm-wasmedge \
       "-DCMAKE_CXX_FLAGS=-Wno-error=maybe-uninitialized -Wno-error=array-bounds" \
       -DWASMEDGE_USE_LLVM=OFF -DWASMEDGE_BUILD_PLUGINS=OFF \
       -DWASMEDGE_BUILD_TOOLS=OFF -DWASMEDGE_FORCE_DISABLE_LTO=ON \
    && cmake --build /tmp/wasmedge-build -j 4 \
    && cmake --install /tmp/wasmedge-build \
    && rm -rf /tmp/wasmedge-source /tmp/wasmedge-build \
       /tmp/01-atomic-wait.patch /tmp/02-stop-token.patch /tmp/03-fault-jmp.patch /tmp/04-atomic-memarg-offset.patch
RUN cc /tmp/sdm-wasi-threads-runner.c -std=c11 -O2 -pthread -Wall -Wextra -Werror \
    -I/opt/sdm-wasmedge/include -L/opt/sdm-wasmedge/lib64 -L/opt/sdm-wasmedge/lib -lwasmedge \
    -Wl,--disable-new-dtags,-rpath,/opt/sdm-wasmedge/lib64,-rpath,/opt/sdm-wasmedge/lib \
    -o /opt/wasmedge/bin/sdm-wasi-threads-runner \
    && /opt/wasmedge/bin/sdm-wasi-threads-runner --version \
    && rm /tmp/sdm-wasi-threads-runner.c

# The parity harness always runs this image with an explicit wasmedge argv
# (flags + guest module + guest args) so the container is a pure runtime shell.
ENTRYPOINT ["wasmedge"]
