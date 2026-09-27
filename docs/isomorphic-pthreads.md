# Isomorphic Pthreads: Enforced, Validated wasi-threads Artifacts

`space-data-module-sdk` is the **enforced source of truth** for isomorphic
pthreads module artifacts. When a module is compiled for the pthreads thread
model, the SDK guarantees two things that used to be optional and unchecked:

1. The final link **cannot omit** the thread-enabling flags, and it targets the
   **wasi-threads** toolchain (not Emscripten's browser Web-Worker model).
2. The emitted `.wasm` is **parsed and validated** to be a real wasi-threads
   artifact. A module that claims pthreads but does not emit the wasi-threads
   contract **fails the compile** — it does not ship.

The goal is one compiled `.wasm` that threads in **both** the browser (via
`SharedArrayBuffer` + a wasi-threads Worker shim) and WasmEdge (via wasi-threads),
mirroring the `analysis/conjunction-assessment` module's `std::thread` workers.

## Why wasi-threads and NOT Emscripten `-pthread`

This is the load-bearing decision. Emscripten's `-pthread` — even with
`-s STANDALONE_WASM=1` — emits the **browser-only** thread model:

- it imports `env.__pthread_create_js` and `env._emscripten_*` mailbox /
  `postMessage` hooks (a JS Web Worker protocol), and
- it has **no** wasi thread-spawn contract.

That artifact **cannot spawn threads under WasmEdge** — there is no JS runtime to
satisfy those imports; instantiation fails on the unknown imports, and stubbing
them would require host-side thread orchestration (which is separately
forbidden). It has shared memory and atomics, but those are **necessary, not
sufficient**: a browser-only Emscripten build has them too.

WasmEdge's actual thread mechanism is **wasi-threads**: the guest imports
`wasi.thread-spawn` and exports `wasi_thread_start` over an imported shared
memory. Compiling with `clang --target=wasm32-wasip1-threads -pthread`
(wasi-sdk / wasi-libc + wasi-runtimes threads sysroot) produces exactly that
contract, which threads under WasmEdge and loads in the browser through a
wasi-threads shim.

`-mthreads` is likewise never used — it is a MinGW driver flag, invalid for the
wasm target.

## Thread Models

`ModuleThreadModel` (see `src/compiler/compileModule.js`):

- `single-thread` — portable, no shared memory, no atomics. Default for
  `runtimeTargets: ["browser"]` and `["browser", "wasmedge"]`. Built with
  Emscripten (emception, in-process).
- `emscripten-pthreads` — the isomorphic threaded model (the enum value string
  is historical; it now compiles to a **wasi-threads** artifact, not an
  Emscripten Web-Worker build). Default for `runtimeTargets: ["wasmedge"]`.
  Built with the wasi-threads toolchain.

`resolveThreadModel({ manifest, threadModel })` resolves the model; an explicit
`threadModel` option always wins over `runtimeTargets` inference.

## 1. Enforced Flags (non-bypassable)

The pthreads final link routes through one flag-assembler (`buildCompilerArgs` in
`src/compiler/compileModule.js`, backed by `PTHREAD_FINAL_LINK_FLAGS` in
`src/compiler/pthreadArtifactGuard.js`). For the pthreads model it **always**
carries the wasm-ld / clang flags:

```
-pthread -matomics -mbulk-memory -Wl,--import-memory -Wl,--shared-memory -Wl,--max-memory=2147483648
```

plus the toolchain args resolved by `src/compiler/wasiThreadsToolchain.js`
(`--target=wasm32-wasip1-threads --sysroot=… -resource-dir=…`). Object files are
compiled `-matomics -fno-exceptions -pthread` (the wasi-threads libc++ is built
without exceptions, so throwing code otherwise fails to link).

`buildCompilerArgs` asserts its own output (`assertPthreadFlagsPresent`) so a
future edit that removes a mandated flag fails loudly. There are deliberately
**no** Emscripten `-s` settings here — those produce the browser-only build.

The toolchain is resolved with sensible defaults and env overrides
(`SDN_WASI_CLANG`, `SDN_WASI_CLANGXX`, `SDN_WASI_TARGET`, `SDN_WASI_SYSROOT`,
`SDN_WASI_RESOURCE_DIR`). If a wasi-threads sysroot is unavailable, the pthreads
compile fails with a clear, actionable error.

## 2. Validated Artifact (the part that matters most)

After the final `.wasm` is emitted, `compileModuleFromSource` calls
`assertPthreadArtifact(wasmBytes)` for the pthreads model. It parses the wasm and
REJECTS the compile unless ALL of the following hold:

- **Shared memory** — an imported or declared memory with the shared limits flag
  (`flags & 0x02`, i.e. `0x03`/`0x07`).
- **Atomics usage** — the code section is walked with a real instruction decoder
  that counts genuine `0xFE`-prefixed atomic instructions. This is **not** a byte
  scan: a naive scan for `0xFE` false-positives on `i32.const` / LEB128 /
  memory-offset immediates (memory load/store opcodes `0x28`–`0x3E` carry a
  memarg). `target_features` is honored when present.
- **wasi thread-spawn import** — `wasi.thread-spawn` (the host contract WasmEdge
  invokes to spawn a guest thread).
- **`wasi_thread_start` export** — the entry a host calls to run a spawned
  thread.
- **No Emscripten thread hooks** — the artifact must NOT import
  `env.__pthread_create_js` or the `env._emscripten_*` mailbox/postMessage hooks.
  Their presence means it is a browser-only Web-Worker build and it is rejected.

Shared memory + atomics **alone** are necessary but insufficient (the browser-only
Emscripten build has both), which is exactly why the wasi-threads contract check
exists. The analysis is returned on the compilation result as
`result.threadFeatures` (`{ hasSharedMemory, usesAtomics, atomicInstructionCount,
hasWasiThreadSpawnImport, hasWasiThreadStartExport, emscriptenThreadHooks,
isIsomorphicPthreads, … }`).

`analyzeWasmThreadFeatures(wasmBytes)` and `assertPthreadArtifact(wasmBytes)` are
exported from `src/compiler/index.js` (and the package root) for reuse by
downstream validators, deploy gates, and tests.

Note that the wasi-threads contract (thread-spawn import + `wasi_thread_start`
export) appears only when the module **actually spawns threads** — the linker
pulls in that machinery on demand. A module declared `emscripten-pthreads` that
never spawns a thread will therefore fail this guardrail; such a module should
use the `single-thread` model instead.

## Guest-link symbol namespacing (collision-proof, metadata-authoritative)

For monolithic flow composition, each module also emits a **guest-link** wasm
object whose exported method symbols are namespaced by a per-plugin prefix so
that independently-built modules can be linked together with `wasm-ld -r` without
symbol clashes. `guestLinkSymbolPrefix(pluginId)` in
`src/compiler/compileModule.js` produces that prefix as:

```
sdm_guest_<full-lowercase-hex-of-pluginId-UTF8-bytes>_
```

The prefix uses the **full** hex encoding of the pluginId — it is **not**
truncated. Hex encoding is injective, so distinct pluginIds always map to
distinct prefixes. (A prior `.slice(0, 24)` truncation to 12 bytes collided real
plugin ids that share a 12-byte stem — e.g. `com.orbpro.iss-source` and
`com.orbpro.intelsat-source` both collapsed to `hex("com.orbpro.i")`
`636f6d2e6f726270726f2e69`, which would silently merge/clash their symbols at
compose time.) Wasm symbol names have no meaningful length limit, so the full hex
is always safe.

The emitted `symbolPrefix` and the per-method `methodSymbols` map are recorded in
the guest-link **metadata** (`sds.guest-link`). **That metadata is the sole
authoritative source consumers read at compose time** — `generateFlowTables` in
`src/flow/flowCompiler.js` declares and calls
`dependency.guestLink.metadata.methodSymbols[methodId]` and never re-derives the
prefix from the pluginId. This keeps already-committed artifacts compatible: an
object that shipped with a legacy (e.g. truncated) prefix still composes, because
its own metadata carries the exact symbol names its object bytes define.

## 3. Compile-Time vs. Runtime: an honest boundary

Passing this guardrail proves the **artifact** is a valid wasi-threads
shared-memory/atomics wasm. It does **not** prove that a given WasmEdge build
actually spawns and runs guest threads.

> **Rule:** Do not claim WasmEdge thread support until a real runtime invocation
> spawns threads and runs. Compile-time validation (wasi-threads contract +
> shared memory + atomics) is necessary but not sufficient; runtime thread-spawn
> verification must exercise the actual host and linked runtime used in deployment.

Record any WasmEdge runtime limitation honestly. An artifact that validates here
but only compiles — and does not instantiate/spawn threads under the target
runtime — must be reported as such.

### SDK 0.8.20 command hosts

WasmEdge 0.16.4's CLI enables atomics with `--enable-threads` but does not
provide `wasi.thread-spawn`. For artifacts importing that function, the SDK's
native parity lane and `createStandaloneHarness("wasmedge", ...)` automatically
build and cache the C API command runner from
`src/testing/native/wasmedge_wasi_threads_runner.c`. The runner links against
WasmEdge **0.16.4**, uses one executor and shared imported memory, and creates a
fresh module instance for each `wasi_thread_start(tid, arg)`. It limits live
workers to 32 and cancels the command group on a worker trap. Guest arguments,
environment, stdin, stdout and stderr use WASI preview1.

The automatic build requires Git, CMake, Ninja, and a C/C++ compiler. It builds
an isolated, cached WasmEdge 0.16.4 runtime with the SDN atomic-wait correction:
unmodified 0.16.4 can lose a notification between comparing memory and sleeping,
and does not correctly wake on notification without a memory store. The patch
also preserves waiter iterators when other waiters register. The installed
`~/.wasmedge` SDK and CLI are unchanged.

Set both `WASMEDGE_INCLUDE_DIR` and `WASMEDGE_LIB_DIR` to supply an operator-built
runtime with the same correction. An explicit `wasmEdgeRunnerBinary` selects a
prebuilt command runner. The builder is
`buildWasmEdgeWasiThreadsRunner` in `src/testing/buildWasmEdgeRunner.js`.
The Docker parity image builds the same corrected runtime and runner for threaded
artifacts; modules without `wasi.thread-spawn` keep the ordinary CLI path.
The Docker runner image includes a source digest in its tag to avoid stale
runner reuse.

Direct-only threaded reactors have no `_start`. For those artifacts the runner
calls `_initialize`, stages the raw request through `plugin_alloc`, and invokes
`plugin_invoke_stream`. The parity harness selects the browser direct surface
automatically as well. This is one request per process; the legacy resident
runner's framing protocol remains separate. Module-owned external memory regions
are not materialized by this one-shot transport; outputs containing pointers
into guest memory are not portable byte-level parity results.

The browser command harness runs `_start` exactly once per request, after
installing stdin. Pthreads share one process input cursor and output buffers,
as well as argv and environment. Each command owns and terminates its workers.
The real-browser parity lane runs in an owning worker with a warmed pthread
pool, enabling blocking `pthread_join` outside the browser's main thread.
Parity reports include `spawnCount`; requested thread counts alone are not
evidence of actual spawning.

The regression compiles a real pthread guest, validates distinct binary
requests, and checks command/direct output and actual spawn counts at 1, 2, 4
and 8 workers through the SDK parity CLI:

```sh
SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PARITY=1 \
SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY=1 \
node --test test/wasi-threads-command.test.js
```

### SDK 0.8.21: constructors on the direct surface

An artifact built with both the `direct` and the `command` surface links the
WASI command runtime. Its `_start` sets up the main thread's pthread descriptor,
runs the global constructors, then runs `main`, which reads stdin. A host that
serves the direct surface never enters `_start`. From 0.8.21 such an artifact
also exports `__wasm_call_ctors`: the same descriptor setup and constructors,
without `main`, at most once per instance. Reactors keep `_initialize`.

A direct host runs `_initialize` if the module exports it, otherwise
`__wasm_call_ctors`, once per instance, before the first direct call. The
browser harness does this for `surface: "direct"`; a command instance only
enters `_start`. The wasi-threads runner serves the direct surface of a command
artifact with `--sdm-direct`, selected by
`createStandaloneHarness("wasmedge", path, { surface: "direct" })` and by
`runParityHarness({ surface: "direct" })`. The SDN node uses the same order.

Artifacts built with 0.8.20 or earlier have no such export. On their direct
surface the constructors never run, in every runtime, and a threaded artifact's
main thread has no pthread descriptor, so a recursive mutex held by the main
thread does not exclude other threads. Rebuild them with 0.8.21.

```sh
SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PARITY=1 \
SPACE_DATA_MODULE_SDK_ENABLE_TRI_RUNTIME_PARITY=1 \
node --test test/direct-call-constructors.test.js
```

### Guest thread faults

A guest thread that traps never finishes the pthread exit protocol. WasmEdge
cancels the whole command. In the browser and Node harnesses the joining thread
stays blocked inside the guest and cannot run the worker's error event, so the
worker itself writes `[wasi-thread] guest thread N trapped: ...` to stderr
(Node) or the console (browser). The call still does not return.

V8 (Node 20 to 25) checks bulk memory operations, and every access when the
WebAssembly trap handler is off (Node on Linux arm64), against a per-instance
copy of a shared memory's size. That copy is refreshed asynchronously after
another thread grows the memory, so a thread that writes into memory another
thread has just grown can trap with "memory access out of bounds", even after
synchronizing with the growing thread. The guest's allocator uses the heap the
artifact was linked with and then grows the memory, so a larger imported initial
memory does not prevent it.

The old source path `src/testing/browserModuleHarness.js` remains a pure
compatibility re-export. New browser consumers should use the public
`space-data-module-sdk/host/browser-module` entry point.

## 4. Integrators: the browser worker anchor (REQUIRED when you bundle)

The browser leg of the wasi-threads host runs each guest pthread on a pooled
module `Worker`. That worker is a **served asset**, and the SDK cannot guess
where your build published it.

By default the host anchors the worker to its own package layout:

```js
new URL("./wasiThreadBrowserWorker.mjs", import.meta.url);
```

That default is correct **only when this source is served unbundled** (Node, and
plain dev servers). Any bundler inlines the host and rewrites `import.meta.url`
to the *bundle's* URL — so the worker is requested next to your bundle, where it
was never emitted, and the request 404s. This shipped: an engine artifact asked
for `Build/CesiumUnminified/wasiThreadBrowserWorker.mjs` while the bucket served
the chain under `js/vendor/space-data-module-sdk/src/host/`.

**If you bundle the host, pass the anchor.** Two equivalent forms:

```js
// A. Per-harness (or per-createWasiThreadSpawn) option.
await createBrowserModuleHarness({
  wasmBytes,
  // The directory YOUR build serves the SDK host chain from.
  wasiThreadWorkerBaseUrl: "js/vendor/space-data-module-sdk/src/host/",
});

// B. Process-wide, installed once by the host shim.
import { setBrowserWasiThreadWorkerBase } from "space-data-module-sdk/browser";
setBrowserWasiThreadWorkerBase("js/vendor/space-data-module-sdk/src/host/");
```

Resolution precedence, highest first — deterministic, and nothing else
participates:

| Source | Option / API |
| --- | --- |
| 1. Explicit worker file | `browserWorkerUrl` / `wasiThreadWorkerUrl` |
| 2. Explicit directory | `browserWorkerBaseUrl` / `wasiThreadWorkerBaseUrl` |
| 3. Process-wide base | `setBrowserWasiThreadWorkerBase(base)` |
| 4. Packaged sibling | `new URL("./wasiThreadBrowserWorker.mjs", import.meta.url)` |

Rules that make this contract honest:

- **The anchor names a DIRECTORY that serves the WHOLE chain.**
  `wasiThreadBrowserWorker.mjs` imports `./wasiThreadWorkerRuntime.js`. Staging
  the single `.mjs` next to your bundle does **not** work.
- **A relative base resolves against the document**; absolute URLs pass through
  unchanged.
- **No consumer-side `location` sniffing.** Forking worker resolution per
  consumer is not the contract; you already know your build's layout, so state
  it.
- **No fetch-and-retry probe.** Resolution never touches the network: Node never
  fetches, and browser thread count may not become a function of network timing.
- **An unreachable worker fails LOUD.** When the pooled path was requested
  (threads enabled + cross-origin isolated + shared memory) and the worker asset
  at the resolved anchor never loads, `createWasiThreadSpawn` **throws**
  `WasiThreadWorkerUnreachableError` naming the URL it tried. It does not drop
  quietly to one thread — a silent sequential fallback is how a deployment defect
  hid behind a passing gate as a pure performance loss.

Genuine capability negotiation is unaffected and stays soft: a worker that loads
and reports it cannot instantiate the module, a probe timeout, a non-isolated
context, non-shared memory, or a 1-core host all still disable threading and let
the guest run its proven sequential path (`wasi.thread-spawn` -> `-1`).

## 5. FlatSQL partition store host I/O (SDK 0.8.22)

The FlatSQL partition store (stack design `docs/architecture/flatsql-partition-store.md`,
§5.5, §5.6, §18 T9, A7, A36, A38, A39) runs one wasi-threads artifact as a
writer instance and reader instances, each with guest threads that call
FlatSQL's seven `env.flatsql_io_*` imports. This section is the SDK half: the
thread pool, the I/O channel and workers, the Node provider, link shim v2, the
worker bundles and the browser capability probe.

### Explicit pool size, partial spawns, supervision hooks

`createWasiThreadSpawn` options added in 0.8.22:

| Option | Effect |
| --- | --- |
| `poolSize` | Browser: pre-start exactly this many workers, independent of `hardwareConcurrency - 1` (pools are sized for isolation: writers + lanes). Node: cap on live guest threads. Arming is partial: workers that fail to start are dropped, the rest serve. |
| `extraImports` | Per-worker import objects, as structured-cloneable descriptors (below). Factories run once per worker. |
| `instanceId`, `onGuestError(instanceId, tid, error)` | Called when a guest thread traps or its worker dies (A36). A dead pooled worker leaves the pool. |
| `onSpawnDeclined({ reason, poolSize, declined })` | Called for every spawn that returns -1. Reasons: `pool-exhausted`, `pool-not-armed`, `threads-unavailable`, `pool-empty`, `worker-create-failed`, `dispatch-failed`, `hostcall-channel-missing`, `terminated`. |
| `probeTimeoutMs` | Browser warm-pool probe deadline. |
| `browserWorkerType: "classic"` | Spawn classic workers, for the blob bundles below. |

The returned host adds `spawnReport()`: `{ poolSize, armed, failedToArm, spawned,
declined, declinedByReason, lastDeclineReason, active, idle }`. The implicit
(no `poolSize`) path keeps its all-or-nothing arming.

`extraImports` entries (the same descriptors work in the engine worker through
`resolveExtraImports`):

| Descriptor | Imports |
| --- | --- |
| `{ provider: "flatsql-io", instanceId, channels, mirror?, trace? }` | `env.flatsql_io_*` over one SAB I/O channel per I/O worker. Each worker claims its own request slot. |
| `{ provider: "flatsql-io-node", root, table, instanceId }` | `env.flatsql_io_*` over synchronous `fs` (Node workers). |
| `{ moduleUrl, exportName?, config? }` | A factory module (module workers and Node only). |

A module that bundles this host into an IIFE or a blob: module worker has no
usable `import.meta.url`. `DEFAULT_BROWSER_WORKER_URL` is then `null` instead of
a module-evaluation `TypeError`, and such hosts pass `browserWorkerUrl`.

### Flags and statuses

The partition store adds three open flags and one status. They are flags, so the
import set stays at seven. flatsql's `flatsql_io.h` (T1) must carry the same
values.

| Name | Value | Meaning |
| --- | --- | --- |
| `FLATSQL_IO_CREATE_PARENTS` | `0x0100` | mkdir -p; sync each new directory's parent, and the parent of a new file. Best effort on OPFS. |
| `FLATSQL_IO_UNLINK_IF_UNUSED` | `0x0200` | Unlink, or `BUSY` while any handle names the path. |
| `FLATSQL_IO_OPEN_DEFERRED` | `0x0400` | Return a handle before the open finishes; the first use waits, or fails with the open's status. Synchronous hosts treat it as a plain open. |
| `FLATSQL_IO_ERR_BUSY` | `-7` | Path in use, or its lock held elsewhere. |

Every SDK host maps `EEXIST` to `GENERIC` (the Go host's mapping), a write on a
read-only handle and a read on a write-only handle to `IO`, and `..` to
`ACCESS`. OPFS errors map as NotFound -> `NOENT`, NoModificationAllowed ->
`BUSY`, QuotaExceeded -> `NOSPACE`; WebKit refuses a second sync handle with
InvalidStateError (measured), which maps to `BUSY` during an open.

### The SAB I/O channel and the I/O worker

`sabIoChannel.js` extends `sabHostcallChannel.js` to many guest threads and one
server:

- A request ring of slots in one SharedArrayBuffer. Each request owns a slot
  until its result is read, so a guest never queues behind another guest's
  request and a slow open blocks only its caller. Idle threads hold no slot, so
  terminating a pool leaks none; `reclaimSabIoSlots(buffer, instanceId)` frees
  the slots of requests that were in flight when an instance's threads died.
- Doorbell: `Atomics.waitAsync` on a header word. The server publishes the mode;
  in message mode (`doorbell: "message"`, or no `waitAsync`) clients also post
  on a BroadcastChannel. Completions for non-blocking callers without
  `waitAsync` arrive the same way (22.3a-5).
- No timeout, no throw (A36). Blocking waits run in 250 ms slices forever. A
  supervisor that sees the I/O worker die calls `failPendingSabIoRequests`,
  which completes every pending slot with `IO`.
- Data moves directly between the instance's shared memory and the file when the
  instance's memory is attached to the I/O worker, else through the slot's data
  area. Paths are always copied out of shared memory before decoding.
- Revocation (A36): `revokeSabIoInstance(buffer, id)` resolves after the server
  has closed the instance's handles; later requests get `ACCESS` and no byte of
  the instance is written after it resolves.

`opfsIoWorker.mjs` runs `flatsqlIoServer.js` over a backend:

- `opfs`: every open is async (`getDirectoryHandle`, `getFileHandle`,
  `createSyncAccessHandle`) and awaited on the worker's event loop while the
  requester waits on its slot. One sync handle per path, shared by all virtual
  handles. Handles open in `"readwrite-unsafe"` mode where it exists, so a
  reader I/O worker can read files a writer I/O worker holds (A7). Views over a
  SharedArrayBuffer go straight to `read`/`write`; a user agent that rejects
  them gets a private scratch copy.
- `memory`: the dashboard window store (§5.5). Nothing reaches OPFS;
  `reset()` drops it; `memoryMaxBytes` is the per-tab budget (`NOSPACE`).

Roles (A7): one writer I/O worker per writer holds the writer's active files;
reader I/O workers (one, or two when `hardwareConcurrency >= 8`) hold sealed
files. Reads and writes run in steps of at most 256 KiB with the slots rescanned
between steps, so a small read never waits for a whole large write. With
several reader I/O workers, `createFlatsqlIoImports` routes each open by a path
hash and every later call to the same worker (the worker index rides in handle
bits 24-30).

`createFlatsqlIoWorker(options)` spawns and supervises one I/O worker:
`attachMemory`, `revoke`, `preopen(paths)` (A38: open the registry's active
files in parallel at start; later guest opens of those paths return at once),
`releasePreopen`, `stats`, `reset`, `clear`, `stop`, and `onError` plus
`restart: true` (A36: pending requests fail with `IO`, a replacement starts on
the same channel with the live memories re-attached; handles do not survive).

Store lock (A37): with `lock: { name }` the I/O worker takes that Web Lock
before it opens any handle and releases it only after `stop()` has closed them,
so the lock lives exactly as long as the handles. `ifAvailable: true` fails the
start with `lockUnavailable` instead of waiting; `busyRetry` retries a handle a
previous leader still holds, with backoff. Measured takeover (holder `stop()` to
successor ready): 5 ms Chromium, 52 ms Firefox, 5 ms WebKit. Leadership,
follower proxying and heartbeats are the engine's (sdn-js, T10).

Head mirror (A7): with `mirror: { buffer, suffixes: ["/h.fsh"] }`, the writer
I/O worker copies every write to a matching path into a seqlock mirror in a
SharedArrayBuffer (`sabIoMirror.js`), and reader imports configured with the
same mirror serve reads of those paths from it without a round trip.

### Node synchronous fs (§5.6)

`nodeSyncFsIo.js`: synchronous `fs` in each worker over a shared virtual-handle
table in a SharedArrayBuffer (`createNodeSyncFsIoTable`). A handle is
`(slot << 8) | gen`; each worker opens its own fd for a slot on first use and
drops stale fds when the generation moves. Paths are confined below `root`,
including through symlinked parents. `sync` is `fdatasync` (libuv issues
`F_FULLFSYNC` on darwin). `revokeNodeSyncFsIoInstance` follows A23: it sets the
revoked flag and waits for the instance's in-flight calls to drain. Fault
injection (§19, 22.3a-7) belongs to FlatSQL's Node host (T4); `interpose` wraps
every syscall for it.

### Link shim v2

`FLATSQL_LINK_SHIM_V2_WASM` (`src/flow/flatsqlLinkShim.js`) is a deterministic
module that imports the reader instance's SHARED lane memory as
`flatsql.memory` and gives a linked flow the lane mailbox as direct calls. v1 is
unchanged (sha256 `8d83e69b…`), because today's linked flows use it. v2 sha256:
`67d5b2d9bc2d1b346a14a253a586fd4d08c8056d54eb62701b48000585ed9613`.

| Export | Result |
| --- | --- |
| `mb_submit(mailbox, op, req_ptr, req_len)` | `seq`, or -1 when the mailbox holds a request |
| `mb_poll(mailbox, seq)` | 1 when complete |
| `mb_wait(mailbox, seq, poll_ns: i64, max_polls)` | the lane's status, or -110 after `max_polls` bounded waits (`max_polls <= 0`: no limit) |
| `mb_release(mailbox, seq)` | 0, or -1 when not complete |
| `mb_cancel(mailbox, seq)` | 0; the lane polls the cancel word |
| `load32_acquire`, `store32_release`, `peek8/32/64`, `poke8/32`, `fnv1a64`, `count_frames` | as in v1, over lane memory |

Mailbox, 64 bytes, 8-aligned, little-endian: `+0 state` (IDLE 0, SUBMITTED 1,
CLAIMED 2, DONE 3, SUBMITTING 4), `+4 seq`, `+8 done_seq`, `+12 op`,
`+16 req_ptr`, `+20 req_len`, `+24 status`, `+28 resp_ptr`, `+32 resp_len`,
`+36 doorbell`, `+40 cancel`, `+44 flags`, `+48 generation (u64)`. A lane waits
(bounded) on the doorbell, CASes SUBMITTED -> CLAIMED, writes the result,
stores `done_seq = seq`, stores DONE and notifies the state word.

`mb_wait` never waits unboundedly: each `memory.atomic.wait32` lasts `poll_ns`
and every wake re-reads the mailbox. WasmEdge keeps waiters per executor, so a
lane's notify may never reach a flow on another executor; a lost notify then
costs one poll interval and never a completion. `poll_ns = 0` polls without
executing a wait (contexts that may not block).

### Worker bundles (A39)

The dashboard is one HTML file under `worker-src 'self' blob:`.
`space-data-module-sdk/host/worker-bundles` ships the pool worker and the I/O
worker as self-contained classic scripts (esbuild IIFE, built by
`scripts/build-host-worker-bundles.mjs` into `src/host/hostWorkerBundleSources.js`):

```js
import { hostWorkerBundleUrl } from "space-data-module-sdk/host/worker-bundles";
import { createWasiThreadSpawn } from "space-data-module-sdk/host/wasi-threads";
import { createFlatsqlIoWorker } from "space-data-module-sdk/host/flatsql-io";

const writerIo = await createFlatsqlIoWorker({
  workerUrl: hostWorkerBundleUrl("flatsql-io"), workerType: "classic",
  backend: "opfs", role: "writer", rootDirectory: "sdn-store",
});
await writerIo.attachMemory(1, writerMemory);
const pool = await createWasiThreadSpawn({
  wasmModule, memory: writerMemory, poolSize: 1 + 2, instanceId: 1,
  enableBrowserThreads: true,
  browserWorkerUrl: hostWorkerBundleUrl("wasi-thread-pool"), browserWorkerType: "classic",
  extraImports: [{ provider: "flatsql-io", instanceId: 1, channels: [writerIo.buffer] }],
  onGuestError: (instanceId, tid, error) => supervisor.poison(instanceId, tid, error),
});
```

### Browser capability matrix

`probeBrowserCapabilities()` probes the page and a blob worker;
`flatsqlLocalStoreGate(matrix)` is the store gate: cross-origin isolation,
shared memory, OPFS sync handles in a worker, `Atomics.wait` in workers, and
shared sync-handle modes (§22.4-6: without them there is no local store).
Measured 2026-09-27 on the owner's Mac Studio (Apple M3 Ultra, macOS 26.3.1),
headless, Playwright 1.63.0, under the dashboard CSP with COOP/COEP:

| | Chromium 153.0.8010.12 | Firefox 155.0 | WebKit 26.6 |
| --- | --- | --- | --- |
| `crossOriginIsolated`, shared wasm memory | yes | yes | yes |
| `Atomics.waitAsync` (page and worker) | yes | yes | yes |
| OPFS sync access handle in a worker | yes | yes | yes (persistent profile only) |
| Second default handle on one file | NoModificationAllowedError | NoModificationAllowedError | InvalidStateError |
| Shared modes (`readwrite-unsafe` x 2) | yes | no (mode ignored) | no (mode ignored) |
| SharedArrayBuffer views in `read`/`write` | yes | yes | yes |
| Wasm shared-memory views in `read` | yes | yes | yes |
| `removeEntry` of an open file | NoModificationAllowedError | NoModificationAllowedError | NoModificationAllowedError |
| Nested blob workers | yes | yes | yes |
| `performance.now()` resolution | 5 µs | 20 µs | 20 µs |
| Local-store gate | supported | no (shared modes) | no (shared modes) |

WebKit refuses OPFS in Playwright's ephemeral context (`UnknownError`); the suite
uses a persistent profile.

### Conformance

`runFlatsqlIoConformance(io)` (`flatsqlIoConformance.js`) is one script for every
host (22.3a-6): 15 cases covering statuses, short reads, sparse writes,
truncation, EXCL/TRUNC/PROBE/UNLINK/UNLINK_IF_UNUSED/CREATE_PARENTS/
DELETE_ON_CLOSE/OPEN_DEFERRED, access modes, confinement and multi-handle
visibility. It passes on the Node sync-fs provider, on the channel over the
memory backend (blocking and async clients, both doorbells), on the blob bundle
run as a standalone script, and on OPFS and memory in Chromium, Firefox and
WebKit. Plain `UNLINK` of an open path is `BUSY` in the I/O worker (OPFS cannot
remove a file with an open sync handle) and succeeds on POSIX hosts; the script
does not test it.

### Measured acceptance (§18 T9, A7, A38)

Owner's Mac Studio (Apple M3 Ultra, 28 cores, macOS 26.3.1), 2026-09-27,
headless, final full run of `test/opfs-io-worker.browser.test.js`. The machine
was shared with other lanes (load average 23-33 on 28 cores). Latencies are
guest-observed import calls (`trace`), in microseconds.

| Item | Chromium 153 | Firefox 155 | WebKit 26.6 |
| --- | --- | --- | --- |
| #1 8 threads, mixed I/O + 200 async opens + 50 unlinks through 1 I/O worker: errors / lost writes | 0 / 0 | 0 / 0 | 0 / 0 |
| same run, 4 KiB read p50 / p99 | 50 / 2145 | 260 / 8180 | 60 / 2660 |
| same run, message doorbell: errors / lost writes | 0 / 0 | 0 / 0 | 0 / 0 |
| A7 lane 4 KiB read p99 during 100 x 4 MiB write+flush, same partition | 790 (active file, shared mode) | 120 (sealed segment) | 40 (sealed segment) |
| A7 same, other partition | 45 | 120 | 40 |
| A7 writer flush p50 / p99 (4 MiB) | 6365 / 28945 | 3540 / 27740 | 5260 / 70700 |
| #2 500 ms open, median of 3 runs: other threads' read p99, baseline / during | 85 / 85 | 440 / 400 | 60 / 60 |
| #2 longest other-thread read while the open was pending | 1020 | 18500 | 320 |
| A38 OPEN_DEFERRED: open returns in / first write waits (ms) | 3.8 / 504 | 28.8 / 511 | 5.2 / 755 |
| #3 `poolSize=6` on `hardwareConcurrency=2` | 6 workers; 7th spawn -1, reported `pool-exhausted` | same | same |
| #5 link shim v2 (Node 25): 10,000 calls, lost completions | 0 with a notifying lane, 0 with a lane that never notifies, 0 spinning (`poll_ns = 0`) | | |

Chromium's same-partition A7 p99 varies with host load: 90, 110, 295 and 790
over four runs with the adaptive spin (below), and 125-1165 over four runs
before it. The original #1 target (4 KiB read p99 <= 200 µs under the mixed
load) is not met through one I/O worker; A7 replaced #1 with the <= 1 ms lane
target, which is met. Firefox and WebKit have no shared handle modes, so their
lanes read a partition's sealed segment; per §22.4-6 those browsers get no
local store.

Adaptive waits: an idle I/O worker polls its doorbell for 50 µs, and a blocking
client polls for its answer for 20 µs, before sleeping (`spinMicros`), so
back-to-back requests skip a thread wake-up. In the Node channel test this took
the fast-thread read p50 from 30-39 µs to 11-12 µs.

## Tests

- `test/wasi-thread-bundled-consumer-anchor.test.js` — the **bundled-consumer
  guardrail**: the host source is run through esbuild into a directory that does
  not hold the worker chain (the published-bucket geometry), driven by a Worker
  mock that resolves URLs on the filesystem the way a browser resolves them
  against an origin. With no anchor the pooled path must throw
  `WasiThreadWorkerUnreachableError` (the silent sequential fallback is a HARD
  failure); with an explicit base — or the process-wide setter — the same bundle
  arms its pool and spawns threads. Also pins the precedence table and asserts
  the resolver neither fetches nor sniffs `location`.
- `test/wasi-thread-host-browser-pool.test.js` — warm-pool arming, short-circuit
  on the first not-ready, probe-deadline bound, idle reuse/teardown, and the
  fail-loud split between an unreachable worker asset and a negotiated fallback.
- `test/pthreads-artifact-guardrail.test.js` — flag-assembler invariants; a
  positive compile that emits a validated wasi-threads shared-memory/atomics
  wasm; a single-thread artifact rejected; a **browser-only Emscripten `-pthread`
  artifact rejected** (has shared memory + atomics but no wasi-threads contract);
  a shared-flag-stripped artifact rejected; and a false-positive guard proving
  the atomics decoder ignores `0xFE` immediates.
- `test/guest-link-symbol-prefix.test.js` — the guest-link prefix is the full
  injective hex of the pluginId; two previously-colliding ids now get distinct
  prefixes; fresh prefixes match the committed modules-branch artifacts
  byte-for-byte; and the compose path treats the guest-link metadata's
  `symbolPrefix` / `methodSymbols` as authoritative (never re-derived), keeping a
  legacy truncated-prefix artifact compatible.

- `test/wasi-thread-pool-size.test.js` — explicit `poolSize` (6 workers on
  `hardwareConcurrency=2`, the 7th spawn -1 and reported), partial arming,
  extraImports delivery, `onGuestError`, classic workers.
- `test/sab-io-channel.test.js` — the I/O channel under a real wasi-threads
  guest (`test/support/flatsql-io/ioGuestWasm.mjs`): 8 threads of mixed I/O in
  both doorbell modes, a 500 ms open blocking only its caller, OPEN_DEFERRED,
  revocation, a dead I/O worker, supervisor restart, 256 KiB steps, the head
  mirror, scratch vs direct transfers, pre-open, and path-hash routing.
- `test/node-sync-fs-io.test.js` — shared handles across workers, stale handles,
  CREATE_PARENTS, UNLINK_IF_UNUSED, confinement, A23 revocation.
- `test/flatsql-io-conformance.test.js` — the conformance script on every Node host.
- `test/host-worker-bundles.test.js` — the bundles equal a fresh build, and the
  I/O worker bundle passes the conformance script standalone.
- `test/link-shim-v2.test.js` — shim v2 bytes, contract, and 10,000 calls
  against a stub lane with and without notify.
- `test/opfs-io-worker.browser.test.js` — the real-browser suite above
  (env-gated):

```sh
SPACE_DATA_MODULE_SDK_ENABLE_BROWSER_IO=1 node --test test/opfs-io-worker.browser.test.js
```

## See also

- [`docs/browser-wasmedge-isomorphic.md`](./browser-wasmedge-isomorphic.md) —
  the one-artifact browser + WasmEdge loading profile.
- `.claude/skills/wasmedge-pthreads/Skills.md` — the operating rules.
- `src/host/wasiThreadHost.js` — the isomorphic `wasi.thread-spawn` host:
  `createWasiThreadSpawn`, the browser worker anchor
  (`setBrowserWasiThreadWorkerBase`, `resolveBrowserWorkerUrl`), and
  `WasiThreadWorkerUnreachableError`.
- `src/compiler/pthreadArtifactGuard.js` — the flag list + wasm validator.
- `src/compiler/wasiThreadsToolchain.js` — the wasi-threads toolchain resolver.
- `src/host/sabIoChannel.js`, `src/host/flatsqlIoServer.js`,
  `src/host/opfsIoWorker.mjs`, `src/host/flatsqlIoWorkers.js`,
  `src/host/nodeSyncFsIo.js`, `src/host/sabIoMirror.js`,
  `src/host/flatsqlIoConformance.js`, `src/host/browserCapabilityProbe.js`,
  `src/host/hostWorkerBundles.js` — the FlatSQL partition store host I/O (§5).
- `src/compiler/compileModule.js` — `ModuleThreadModel`, `buildCompilerArgs`,
  `compileWithWasiThreads`, `resolveThreadModel`, `compileModuleFromSource`.
