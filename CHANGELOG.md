# Changelog

## 0.8.26

Documents how a size-prefixed FlatBuffer record is built: by a size-prefixed
finish, not by writing a length in front of an unprefixed buffer.

- README, "Size-prefixed records": FlatBuffers aligns each field relative to the
  start of the buffer. A size-prefixed finish (`FinishSizePrefixed`,
  `finishSizePrefixed`, `flatc --binary --size-prefixed`) lays the record out
  so that the 4-byte prefix comes before an aligned root. A length written in
  front of an unprefixed buffer moves every field by 4 bytes. Eight-byte fields
  are then misaligned, and aligned `VerifySizePrefixedBuffer`, which a module's
  generated readers run, refuses the record.
- flatc-wasm's `generateBinary(schema, json, { sizePrefix: true })`, the
  default, writes the length in front in JS. Found forwarding HPOP's
  `$PRW` trajectories (PPE `double` coefficient vectors) into
  conjunction-assessment: flatc `--size-prefixed` output verified, and the
  flatc-wasm prepended record did not. Build size-prefixed records with the
  size-prefixed finish, or run flatc with `--size-prefixed`.
- Testing: the wasi-threads runner and the Docker parity image apply the full
  SDN WasmEdge 0.16.4 patch set (atomic wait, stop token, fault jump, atomic
  memarg offset), in SDN's order. The runner identity hash covers all four.

## 0.8.25

One invoke can start more wasi-threads than the pool holds, and any guest
thread can start threads. Conjunction screening spawns a coarse wave and then a
refine wave of threads in one call. With a browser pool of 8 and waves of 5, the
second wave's spawn was declined and `std::thread` aborted with `unreachable`.

- Browser and Node share one pool protocol, `src/host/wasiThreadPool.js`: a
  `SharedArrayBuffer` with a slot per worker. A pool worker blocks on its slot
  between threads. A spawner on any thread claims an idle slot, writes the tid
  and start argument, and notifies it. The worker frees the slot when
  `wasi_thread_start` returns. No step needs an event loop. Through 0.8.24 a
  browser worker was sent each thread by message and went idle only when the
  spawner, which is blocked in the guest for the whole invoke, handled its
  `{t:"exit"}`. One invoke could therefore spawn at most `poolSize` threads in
  total. A pool now bounds how many threads run at once.
- Node reuses its workers. Through 0.8.24 it started a worker per spawn, and a
  finished worker was only joined and uncounted on the blocked event loop. So
  an explicit `poolSize` had the browser's limit, and a guest that started
  thousands of threads kept thousands of workers. The pool now grows on demand,
  to `poolSize` or to 1024 workers without one, from whichever thread spawns.
  Idle workers do not keep the process alive. Measured: 14,000 threads in one
  invoke ran on 7 workers.
- A guest thread's `wasi.thread-spawn` is the pool's. Through 0.8.24 a spawn
  from any thread but the main one returned -1.
- A spawn that finds every worker busy waits up to `spawnWaitMs` (default
  250 ms) for one to finish before `wasi.thread-spawn` returns -1. Node waits at
  most 2 ms, then starts a worker if it has room. The wait covers a joined
  thread whose worker has not yet returned; measured in headless Chromium it is
  0 to 30 µs. After one wait runs out, later spawns from that thread are
  declined at once until a thread finishes. `spawnWaitMs: 0` never waits.
- `spawnReport()` counts spawns from every thread and adds `waited` (and
  `workers` in Node). `onSpawnDeclined` fires for the owning thread's spawns. A
  Node worker started by a guest thread reports a guest fault on stderr only.
- A guest thread that traps retires its worker.
- The browser harness passes `wasiThreadSpawnWaitMs` and `wasiThreadPoolSize`
  through to `createWasiThreadSpawn` (`spawnWaitMs`, `poolSize`).
- `nodeSyncFsIo` with `root: "/"` (or another filesystem root) reaches the
  paths under it. It returned `ACCESS` for every path, because the containment
  check compared against `"//"`.
- The worker scripts changed (`wasiThreadBrowserWorker.mjs`,
  `wasiThreadWorker.mjs`, the `wasi-thread-pool` blob bundle), and the browser
  worker now imports `wasiThreadPool.js`, which the served host directory must
  include. A bundle that inlines the SDK host must be rebuilt against 0.8.25. A
  browser worker script from an older SDK still works with a 0.8.25 host, with
  the old limit.
- Tests: `test/wasi-thread-pool-reuse.test.js` covers the protocol. In
  `test/wasi-thread-pool-reuse-guest.test.js` a guest spawns, in one invoke, 3
  waves of `poolSize - 1` threads, 3 waves of `poolSize`, and 3 waves spawned by
  a non-main guest thread. It runs in Node, in headless Chromium, Firefox and
  WebKit, and across the three parity lanes; the browser and parity runs are
  env-gated. The T9 browser scenario #3 now passes `spawnWaitMs: 0`: its 7th
  spawn comes while all six threads run.

## 0.8.24

Compiles stop filling the temp dir. One workstation had collected 497
per-process emception copies (about 159 MB each) and 647 compile dirs, about
79 GB.

- `compileModuleFromSource` removes its `space-data-module-sdk-compile-*` dir
  before it returns or throws. With `keepTempDir: true` a successful compile
  keeps it: `result.tempDir` is set and `cleanupCompilation(result)` frees it,
  as before. A failed compile always removes it.
- Behavior change: with neither `outputPath` nor `keepTempDir`,
  `result.outputPath` and `result.tempDir` are `null`. Use `result.wasmBytes`.
  A build that reads files from `result.tempDir`, such as the intermediate
  `plugin-invoke-bridge.o`, must pass `keepTempDir: true`.
- The patched emception tree is one shared root per user,
  `<tmpdir>/space-data-module-sdk-emception-node-v1-<version>-<fingerprint>-u<uid>`,
  instead of a copy per process that was never removed. The key covers the
  patch, the `sdn-emception` version and a sha256 of its files. The root is
  built in a staging dir and renamed into place, so concurrent processes
  share it safely. A root that fails its content check is rebuilt.
- Dirs left by 0.8.23 and earlier (`space-data-module-sdk-emception-node-<pid>`
  and `space-data-module-sdk-compile-*`) are not removed automatically.

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
