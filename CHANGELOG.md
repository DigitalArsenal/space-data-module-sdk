# Changelog

## 0.9.3

- `sdm_piv::Config` (typedHostcall.hpp): a path to an item past the end of a NumberList or StringList
  ("targets.0.sources.5") is missing, like any other missing key. It used to answer the list's entry, so `has()`
  stayed true and a module finding a list's end by probing "key.N" looped forever.
- `encodeModuleConfig` leaves out keys whose value is null (it threw), as the Go node does.
- `ConfigTable::count(key)`: the length of a NumberList, StringList or TableList, so a module iterates 0..count-1
  instead of probing.

## 0.9.2

### plugin.getConfig answers with one ModuleConfig FlatBuffer

- `plugin.getConfig` answers on raw `config` with one `ModuleConfig` FlatBuffer (`schemas/runtime/ModuleConfig.fbs`,
  file identifier `MCFG`, not size-prefixed) in place of the list `entries` of aligned `ConfigEntry` records. Each
  aligned record was about 536 bytes whatever it held, and nested values were flattened to dotted keys. A
  terrain-serving module with a 2.8 MB number index went from 601 to 2,422 wasm memory pages per instance. The
  FlatBuffer stores values compactly: a list of 1,000,000 numbers is 8 MB, and the guest's heap grows by that much.
- HostOps changes (the Go node mirrors these): the HostOps `ConfigEntry` table and the `configEntryKind` enum are
  gone, and `HOST_OPERATIONS["plugin.getConfig"]` is `{ rawOut: ["config"] }`.
- The JS hosts (`src/host/typedDispatch.js`) encode the host's `config` option with `encodeModuleConfig`. Number
  arrays become `NumberList`, string arrays `StringList`, and nested objects or arrays of objects `TableList`. Keys are
  sorted and `null` / `undefined` values are left out. A value with no config kind (a Date, or a list mixing kinds) is
  a typed `failed`.
- `typedHostcall.hpp` gains `sdm_piv::get_config()`. It returns an `sdm_piv::Config` that keeps the response, verifies
  the `ModuleConfig` and reads it in place: `ok()`, `error_code()`, `error_message()`, `root()` (the verified
  `sdn::runtime::ModuleConfig`), `byte_size()`. Lookups by key or dotted path are `string(key, def)`,
  `number(key, def)`, `boolean(key, def)`, `numbers(key)` (an `sdm_piv::Span<double>` in place), `strings(key)`,
  `tables(key)`, `table(key, i)` / `table(key)` (an `sdm_piv::ConfigTable` with the same lookups), `entry(key)`,
  `has(key)` and `kind(key)`. Dotted paths keep the old flattened names working: `targets.0.provider_id`,
  `widths.1`, and `settings.depth` for a nested object. Modules that read `entries` port mechanically.

## 0.9.1

### The JS hosts answer the Go node's operations completely

- `src/host/typedDispatch.js` has adapters for `plugin.getConfig`, `node.peerId` / `node.publicKey`, `secrets.*`,
  every `storage.*` operation (`write`, `query`, `delete`, `expire`, `ingest_with_source`, `flatsql_query_stream`,
  `flatsql_epoch_stream`, `query_sandboxed`, `query_surface`, `flatsql_cache_key`), `p2p.peers_snapshot` /
  `standards_snapshot` / `pnm_history` / `latest_dataset`, `node_status_read.status` and
  `node_activity_read.activity`. They used to take the generic path, which dropped their list and raw ports. The
  mapping mirrors the Go node's typed path (`sdn-server/internal/modulert/typed_hostcall_ops.go`): the same
  handler-shaped requests and answers, with bytes as `Uint8Array` instead of base64. `plugin.getConfig` flattens the
  config into dotted `ConfigEntry` keys (`targets.0.provider_id`).
- NodeHost and BrowserHost serve `plugin.getConfig` from a new `config` option (default `{}`), and serve the secrets,
  storage, p2p and node operations through capability adapters (`capabilityAdapters.secrets` / `storage` / `p2p` /
  `node`, see `src/host/adapterOperations.js`). An adapter method can answer synchronously, in which case it also works on
  the sync bridge, or with a Promise. Both hosts list the operations and their capabilities (`secrets`,
  `storage_ingest`, `p2p_read`, `node_status_read`, `node_activity_read`, and on NodeHost also `storage_query` /
  `storage_write`).
- Typed error codes: a BrowserHost capability refusal is `not-authorized`, and a string or list that does not fit
  its aligned record is `too-large` (as on the Go node).

### HostOps changes (the Go node mirrors these)

- SQL values travel in FlatSQL's own tagged parameter encoding: value after value, a u8 tag (0 null, 1 bool, 2 i64,
  3 f64, 4 string, 5 bytes), a u32 little-endian payload length, then the payload. Text and bytes can be any length.
  `storage.flatsql_query_stream`, `storage.query_sandboxed` and `storage.flatsql_cache_key` take raw `params` in
  place of the list `sql_params`. A `query_sandboxed` rows answer carries raw `cells` (row-major) in place of the list
  `cells`. The `SqlValue` table and the `sqlValueKind` enum are gone. `encodeSqlValues` / `decodeSqlValues` and
  `SQL_VALUE_TAGS` (`space-data-module-sdk/runtime-contracts`), and `sdm_piv::SqlValues` / `read_sql_values`
  (`typedHostcall.hpp`), write and read the encoding.
- `storage.ingest_with_source` takes a new list `provenance_attributes` (`ProvenanceAttribute {NAME 128, VALUE
  255}`) for descriptive provenance (method, units, date range, counts). The runtime `IngestRequest` Provenance has
  the same information as `ATTRIBUTES: [Header]`.
- Wider identity fields: `P2pPnmEntry.FILE_ID` and `P2pLatestDataset.PNM_FILE_ID` 16 -> 255;
  `StoredRecordMeta.LICENSE` and `StorageIngestParams.LICENSE` 64 -> 128; `StorageIngestParams.CONTENT_KEY_ID`
  64 -> 128; `Provenance.ETAG` 128 -> 255, `PARSER` 64 -> 128, `PARSER_VERSION` 32 -> 64.
- `secrets`, `node_status_read` and `node_activity_read` are in `RecommendedCapabilityIds`.

## 0.9.0

Typed contracts 1.0: the module runtime's frames and hostcalls are SDS FlatBuffers; the JSON hostcall envelope is
still answered until every module is typed.

### The SDK JS hosts answer typed hostcalls

- `createHostcallBridge` (and with it NodeHost, BrowserHost, the browser and worker harnesses and the WASI thread
  pool) answers an SDS `$PIV` hostcall with a `$PIV` response. `src/host/typedDispatch.js` turns the call's aligned
  records and raw / list frames into the arguments each host operation already takes, and the operation's answer
  into its result record and frames. Errors come back as `ERROR_CODE` (`not-authorized`, `sandbox`, `unsupported`,
  `invalid-params`, `timeout`, `too-large`, `failed`). The JSON envelope is still answered until every module is
  typed (sdk-compliance-typed-only).
- The SDK compiler stages the typed module runtime in every C++ compile: `typedHostcall.hpp` (`sdm_piv::call`) with
  `HostOps_aligned.h`, and the runtime types a module's ports carry (`HttpRequest_generated.h`,
  `IngestRequest_generated.h`, `FlowNotice_generated.h`, ...).
- `http.request` passes the redirect mode to fetch (typed `NO_REDIRECTS`). BrowserHost answers with the response url.
- The sync bridge no longer leaves a refused async operation's rejected promise unhandled (it crashed the process
  when the operation's capability was not granted).

### Hostcalls on the invoke ABI (SDS $PIV, aligned-binary records + raw frames)

Hostcalls on the SDK's documented invoke ABI (typed contracts 1.0: the JSON interface replaced, nothing else changed).

- A module's call to its host is an SDS `$PIV` request in the module -> host direction, the same envelope as the
  README's "Canonical Invoke ABI": `PIVRequest.METHOD_ID` is the operation and its frames sit in `PAYLOAD_ARENA`,
  named by `TAB.PORT_ID`. The host answers with a `$PIV` response carrying the result frames, or `STATUS` FAILED with
  `ERROR_CODE` (`HOSTCALL_ERROR_CODES`) and `ERROR_MESSAGE`. This replaces the JSON meta and binary segments; no
  base64 is involved.
- Frames use the FlatBuffers aligned binary layout. "params" and "result" are one fixed-size record each
  (`WIRE_FORMAT` ALIGNED_BINARY, `TYPE_REF` `HostOps.fbs` + root type + `BYTE_LENGTH`). A list port is a run of
  records at a fixed stride (`BYTE_LENGTH` 0, a variable-length aligned stream). A raw port carries unbounded bytes
  verbatim: bodies, record streams, urls, sql, paths.
- `schemas/runtime/HostOps.fbs` holds the operations' records, generated with `--aligned` into
  `src/generated/runtime/aligned/` (TS/JS, plus `HostOps_enums`) and `cpp/HostOps_aligned.h` (with its enums).
  Strings are capped at 255 bytes or less. A value that does not fit is refused, never truncated. Aligned records
  have no schema defaults, so every field is phrased so that zero is the default (`NO_REDIRECTS`, `NO_PIN`, ...).
- `HOST_OPERATIONS`: every operation the hosts serve today, under its current name (the Go node's and the JS
  hosts'), with its params / result records, list ports, raw ports and capability.
- `encodeHostCall` / `decodeHostCall` / `encodeHostCallResult` / `decodeHostCallResult` / `isTypedHostCall` are built
  on the existing `src/invoke/codec.js`. `encodeHostOpsRecord` / `encodeHostOpsList` build records from field values.
  `src/host/cpp/typedHostcall.hpp` is the C++ guest call: `sdm_piv::call` takes an aligned struct plus
  `sdm_piv::raw` / `sdm_piv::list` frames, and results are read in place. It refuses a truncated response; the JSON
  bridge cut one silently.
- `src/invoke/codec.js`: the encoder now accepts a variable-length aligned stream (`byteLength` 0), as the decoder and
  the guest glue (`OutputTypeMatches`) already did.

### Module runtime contracts as typed FlatBuffers

The module runtime contracts as typed FlatBuffers (typed-contracts 1.0, owner 2026-10-13: "flatbuffer SDS only"; no
JSON forms kept).

- `schemas/runtime/*.fbs` (namespace `sdn.runtime`): `TimerTick` (TICK), `HttpRequest` (HREQ), `HttpResponse` (HRSP),
  `ModuleConfig` (MCFG), `IngestRequest` (INGQ), `IngestResult` (INGR), `FlowNotice` (FNTC). TICK, HREQ and HRSP were
  registered in the shared catalog by name only; they now have IDL. MCFG, INGQ, INGR and FNTC are new catalog entries.
- `npm run generate:runtime-contracts` (`scripts/generate-runtime-bindings.mjs`) emits TS/JS (object API, schema case
  kept, as the SDS bindings) and C++ headers into `src/generated/runtime/`.
- `space-data-module-sdk/runtime-contracts`: the bindings plus `encode*` / `decode*` per frame over plain objects and
  `identifierOf`. An HttpRequest's CONTEXT (a typed FlatBuffer the module chooses) comes back verbatim in its
  HttpResponse, so a module's job state travels typed with its request.
- These replace, in the node and the modules that follow: the `sdn-timer-tick` frame, the `hostcap/http-request` JSON
  request and JSON / `$HRB` response, the `plugin.getConfig` JSON, the `storage.ingest_with_source` meta and result
  JSON, and the JSON status / report / unchanged-notice frames.

### Tests

- The opt-in runtime matrix (`SPACE_DATA_MODULE_SDK_ENABLE_RUNTIME_MATRIX=1`) runs again: its fixture declares
  concrete SDS port types (its own `RuntimeMatrix.fbs` / `RTMX` identity through the compiler's `catalog` option)
  instead of wildcard ports, which the tightened manifest rules refuse.

## 0.8.27

The licensing challenge request can carry the requester's \$EPM.

- `encodeLicensingChallengeRequest({ ..., requesterEpm })` writes
  `REQUESTER_EPM`. The key server keeps it and, for a module published with an
  xpub allowlist, verifies it when the requester proves its signing key: the
  EPM must be signed by that key and carry the account key's proof that it
  authorised the key. Without the field an allowlisted grant cannot succeed.
  Optional: omitted, the request is byte-identical to 0.8.26's.

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
