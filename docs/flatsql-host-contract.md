# The FlatSQL host contract (why the floor moved to ^1.4.4)

## The defect the bump repairs

The SDK floored `flatsql` at `^0.4.2`. `^0.4.2` admits nothing in 1.x, so the
floor sat a full major behind, and — the part that matters — the 0.4.x
`wasm/flatsql-wasi.wasm` is an **emscripten-glue artifact**. Measured on the
shipped bytes:

| version | imports | shape |
| --- | --- | --- |
| 0.4.2 | **69** | 59 on `env`: ~40 `invoke_*` EH trampolines, `__cxa_*`, `__resumeException`, `llvm_eh_typeid_for`, 10 `__syscall_*`, `emscripten_notify_memory_growth` |
| 1.4.4 | **13** | 7 `flatsql_io_*` + 6 WASI preview1 |

Under the pinned WasmEdge 0.16.4:

```
0.4.2 -> instantiation failed: unknown import … "env" "invoke_vi"
1.4.4 -> links; blocked only on the DECLARED capability env.flatsql_io_open
```

Modules are EH-free and `emcc`-shaped artifacts are a browser-only trap, so
`^0.4.2` pinned a **non-isomorphic engine**. That is an auto-reject under the
module contract, and the tri-runtime parity gate now says so out loud:
`flatsql-standalone :: FORBIDDEN import class [emscripten-eh,
emscripten-runtime, emscripten-syscall] — 59 import(s)`.

## What the bump costs

Nothing at the JS call sites. The SDK uses `FlatSQLDatabase.fromSchema`,
`.query`, `.insert`, and `DirectAccessor.registerAccessor`/`.registerBuilder`
(`src/runtime-host/flatsqlRuntimeStore.js`); all are present in 1.4.4, and the
C ABI went 57 → 96 exports with **zero removed**.

One real behavioral change surfaced, and it is a *fix*, not a break:

> **0.4.2 silently ignored `ORDER BY`.** `listRows()` is
> `SELECT … ORDER BY schemaFileId, rowId`, and on 0.4.2 it returned INSERTION
> order. 1.4.4 honours the clause. `test/runtime-host-stream-ingest.test.js`
> had encoded the broken behaviour (OMM-then-ENTM); it now asserts the sorted
> contract and checks payloads by handle instead of by position, so it cannot
> re-encode an engine bug as SDK semantics.

## The host contract 1.4.x makes unconditional

1.4.x imports these seven functions on module `env` **unconditionally**. A host
that does not supply them cannot instantiate the artifact, so host wiring and
the artifact bump land together or not at all:

```
i32 flatsql_io_open(ptr path, i32 pathLen, i32 flags)
i32 flatsql_io_read(i32 h, ptr dst, i32 len, f64 offset)
i32 flatsql_io_write(i32 h, ptr src, i32 len, f64 offset)
i32 flatsql_io_truncate(i32 h, f64 size)
i32 flatsql_io_sync(i32 h)
f64 flatsql_io_size(i32 h)
i32 flatsql_io_close(i32 h)
```

**Offsets are `f64`, never `i64`.** emscripten legalizes i64 across the JS
boundary for the browser target and not for `STANDALONE_WASM`; using i64 would
give one import two different signatures in the two lanes, which is the exact
shape of a cross-runtime divergence.

The SDK publishes this contract so consumers wire it identically in both lanes
rather than each inventing it:

```js
import {
  FLATSQL_IO_IMPORTS,       // the seven "env.flatsql_io_*" keys
  FLATSQL_IO_SIGNATURES,    // params/result valtypes, f64 offsets
  HOST_SURFACES,            // HOST_SURFACES["flatsql-engine"]
} from "space-data-module-sdk/testing";
```

## What the SDK does NOT do

module-sdk does not link the VFS into its own artifacts, and that is by design:
an SDK module exports **zero** `flatsql_io_*` imports. A module keeps the
generic hook set, which rides inside the one sanctioned
`space_data_module_host` bridge; a private import would be a NEW HOST
CAPABILITY, and that is an owner decision, never a dependency bump. The SDK
consumes flatsql through its **JS API** only
(`src/runtime-host/flatsqlRuntimeStore.js`); flow artifacts receive the live
engine from the caller as `engineLink` (`src/flow/flowRuntimeHost.js`), so the
host that instantiates the engine is the host that supplies the seven imports.

## Evidence

`space-data-module parity-gate` — the `flatsql-standalone` artifact resolves
through this repo's own dependency, so the gate always classifies the engine a
consumer would actually load. At 1.4.4 it reports `in-surface (WASI + declared
capabilities: 7)`, `satisfied` in the real-browser lane and
`runner-cannot-supply-declared-capability` under the bare WasmEdge CLI, naming
`env.flatsql_io_open` as the single blocker.
