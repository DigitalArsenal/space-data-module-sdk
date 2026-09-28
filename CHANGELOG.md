# Changelog

## 0.8.23

- The emcc single-thread lane (emception, and system Emscripten for
  `sharedMemory` builds) compiles the generated invoke bridge and the embedded
  manifest with the module source's own flags (`-O3 -mbulk-memory -DNDEBUG`).
  Every earlier release built both objects at `-O0`. The bridge copies every
  request and response payload. Measured under the WasmEdge 0.16.4
  interpreter on an echo module, a payload byte that goes in on stdin and
  comes back on stdout cost 878 wasm instructions before this change and
  about 2 after it. That is roughly 285 per request byte and 565 per
  response byte before.
- The wasi-sequential and wasi-threads lanes already used these flags and are
  unchanged.
- Artifact bytes change for every emcc-lane module, so rebuild those modules
  with 0.8.23. The single-file bundle vectors are regenerated for the same
  reason.

## 0.8.22

Host I/O for the FlatSQL partition store (docs/isomorphic-pthreads.md §5).

- `createWasiThreadSpawn` takes an explicit `poolSize`: the browser pre-starts
  exactly that many workers, independent of `hardwareConcurrency - 1`, and Node
  caps its live guest threads. Explicit pools arm partially. Spawns beyond the
  pool return -1 and are reported through `onSpawnDeclined` and
  `spawnReport()`. `onGuestError(instanceId, tid, error)` reports guest traps
  and dead pooled workers. `extraImports` descriptors give every worker its own
  import objects, such as FlatSQL's `env.flatsql_io_*`.
- The FlatSQL I/O worker (`space-data-module-sdk/host/flatsql-io`): a
  multi-slot SharedArrayBuffer request ring, an I/O worker over OPFS or memory
  that holds every handle and never blocks, deferred opens and pre-open,
  256 KiB write steps, revocation, supervision and restart, a head mirror, and
  the store Web Lock. Every request completes with a status; nothing times
  out or throws into a guest.
- `space-data-module-sdk/host/flatsql-io/node`: synchronous `fs` per worker
  over a shared virtual-handle table.
- New `flatsql_io` flags `CREATE_PARENTS` (0x0100), `UNLINK_IF_UNUSED` (0x0200)
  and `OPEN_DEFERRED` (0x0400), and status `BUSY` (-7).
- One `flatsql_io` conformance script for every host, and a browser capability
  probe with the local-store gate.
- `space-data-module-sdk/host/worker-bundles`: the pool worker and the I/O
  worker as self-contained scripts for blob: URLs.
- FlatSQL link shim v2 (`FLATSQL_LINK_SHIM_V2_WASM`): a mailbox over shared lane
  memory with polling-bounded waits. v1 is unchanged.
- The wasi-threads host no longer throws while loading when it is bundled
  without `import.meta.url` (IIFE bundles, blob: module workers).

## 0.8.21

- A module built with both the direct and the command surface exports
  `__wasm_call_ctors`: the main-thread pthread setup and the global
  constructors, without `main`, at most once per instance. Direct hosts run
  `_initialize`, otherwise `__wasm_call_ctors`, before the first direct call:
  the browser harness (`surface: "direct"`), the wasi-threads WasmEdge runner
  (`--sdm-direct`), `createStandaloneHarness("wasmedge", path, { surface:
  "direct" })` and `runParityHarness({ surface: "direct" })`. In 0.8.20 the
  direct surface of such a module ran neither, so namespace-scope C++ objects
  stayed zero-filled and a threaded module's main thread had no pthread
  descriptor. Rebuild those modules with 0.8.21.
- A guest thread that traps is reported by its own worker, on stderr in Node
  and on the console in a browser. The thread joining it stays blocked.
