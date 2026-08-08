# The Tri-Runtime Parity GATE

`docs/tri-runtime-parity.md` describes the parity **harness**: one
`module.wasm`, one fixture, byte-identical stdout across browser / native
WasmEdge / Docker WasmEdge. This document describes the **gate** — the thing
the dev-graph gauntlet actually runs, and the thing an isomorphism claim is
accepted against.

## Why a gate and not just the harness

The harness is necessary and not sufficient:

- it can only speak about artifacts that already instantiate in every lane, so
  the most important failure — *an artifact that is not isomorphic at all* —
  is invisible to it;
- it takes ONE artifact, so it says nothing about the artifact **set** a
  release ships;
- and until this gate landed, the gauntlet slot that was supposed to enforce
  it was a hardcoded `echo TODO …; exit 1` marked `required: false`. It failed
  on every run for every task, so every receipt read PASS-WITH-GAPS and the
  red became background noise. That is the worst state a gate can be in:
  present enough to look like coverage, incapable of ever providing it.

```
space-data-module parity-gate                       # the certified set
space-data-module parity-gate --json                # machine receipt
space-data-module parity-gate --gate-manifest ./parity/negative-control.json --expect-fail
```

## What it checks

### Tier A — host-contract conformance (REAL instantiation, per lane)

Every artifact in the certified set is really instantiated:

| lane | what it actually is | what it proves |
| --- | --- | --- |
| `browser` | real headless Chrome behind COOP/COEP (cross-origin isolated, SAB-capable). Never jsdom. | The artifact instantiates against **exactly** the declared host surface — WASI preview1 stubs plus the declared capability imports, with signatures read from the binary. Anything else it demands is a `LinkError` naming the offender. |
| `wasmedge-native` | a native WasmEdge binary, version-checked against `src/testing/wasmedgePin.json`. | The artifact links on the real production runtime. |
| `wasmedge-docker` | the pinned WasmEdge container (image tag **derived** from the same pin). | Same, in the container the fleet ships. |

Alongside the runtime probes, every artifact's import section is classified
structurally against its declared surface, because *why* an instantiation
failed is the entire content of the finding:

- **forbidden import class** — `invoke_*` / `__cxa_*` / `__resumeException` /
  `llvm_eh_typeid_for` (emscripten EH), `__syscall_*` (emscripten JS-library
  syscalls), `emscripten_*` (emscripten runtime hooks), or a single-letter
  import module (the minified emcc browser build). These are `emcc`-shaped
  artifacts: browser-only by construction, EH-carrying, not instantiable on a
  plain WasmEdge host. **Auto-reject.**
- **outside the declared surface** — a private import is a NEW HOST
  CAPABILITY, which is an owner decision, never a PR.
- **in-surface** — WASI plus, at most, the declared capability imports.

### Tier B — behavioral parity

Artifacts with `profile: "command"` and a fixture additionally go through
`runParityHarness()`: identical stdin bytes, identical explicit guest env,
byte-identical stdout and identical trap classes across every lane × thread
count (1/2/4/8).

## Declared host surfaces

| surface | contents |
| --- | --- |
| `module` | WASI preview1 + wasi-threads (`wasi.thread-spawn`, `env.memory`) + the ONE sanctioned hostcall bridge `space_data_module_host.{call,response_len,read_response,clear_response,last_status_code,dispatch_current_invocation}` (plus the legacy `sdn_flow_host.dispatch_current_invocation`). The generic hook set (`http`/`tcp`/`wallet_sign`/`keyslot.sign`/clock/fs) rides *inside* that bridge, which is why a module needs no per-capability imports. |
| `module-standalone` | WASI preview1 + wasi-threads only. |
| `flatsql-engine` | WASI preview1 + exactly the seven `flatsql_io_*` VFS imports. Offsets are **f64, never i64** — emscripten legalizes i64 across the JS boundary for the browser target and not for `STANDALONE_WASM`, which would give one import two different signatures in the two lanes. |

## Verdicts

| verdict | meaning |
| --- | --- |
| `satisfied` | instantiated on the declared surface. |
| `runner-cannot-supply-declared-capability` | did **not** instantiate, and the only blocker is a DECLARED capability the lane runner cannot register. The bare WasmEdge CLI has no mechanism for host functions, so an engine artifact reports this while the browser lane reports `satisfied`. **This is recorded verbatim, never counted as a silent pass**, and the two are treated as agreeing. Upgrade path: graph task `module-sdk-parity-lane-embedded-wasmedge` (run the guest through the node's real WasmEdge *embedding*, which also unlocks threaded guests — `--enable-threads` enables only the threads proposal, not the wasi-threads host module). |
| `violated` | forbidden class, out-of-surface import, or a link error the contract does not explain. **FAIL.** |
| `shim-gap` | a lane that *does* supply the declared surface still failed to link a declared capability — an SDK host-shim defect. **FAIL.** |
| `lane-unavailable` | the lane could not run. **FAIL**, and kept lexically distinct from divergence: a harness that cannot run and a runtime that disagrees must never look alike in a receipt. |

Rules, all hard: forbidden class ⇒ FAIL even when every lane agrees (lanes
agreeing that an artifact is broken everywhere is not parity); lane
disagreement ⇒ FAIL as a P1 cross-runtime divergence; behavioral divergence ⇒
FAIL.

## The certified set — and fresh-worktree isolation

`parity/gate.json` lists the artifacts this SDK certifies. **Every entry
resolves inside this repo** — a repo-relative path or a node-resolved
dependency. That is deliberate: the previous tri-lane test defaulted its
artifact path to a sibling checkout that does not exist on a normal machine,
so the acceptance instrument was silently un-runnable and nobody who did not
set an env var by hand had ever seen it work (graph:
`parity-harness-cannot-run-locally`). The gate must run in ANY fresh worktree.

Artifacts owned by other repos are **injected by the caller**:

```
space-data-module parity-gate \
  --artifact rf-fspl=./packages/rf-fspl/dist/isomorphic/module.wasm:module
```

so the owning repo's gauntlet profile supplies its own artifacts and this repo
never depends on that checkout.

## The WasmEdge pin

`src/testing/wasmedgePin.json` remains the single source. Native and container
runtimes are both version-checked against it; drift is a loud failure, not a
warning. When no native WasmEdge exists on the box, the report carries an
explicit `pinVerification.native = absent` gap — the host/container pin PAIR
could not be cross-verified, which is *recorded*, not passed. Hosts that
provision the binary run with `--require-native-wasmedge`, which turns the gap
into a failure.

## Negative control

`parity/negative-control.json` declares a known-bad artifact and is run with
`--expect-fail`; a PASS there is itself an error (exit 3). Keep it. A gate
nobody has watched fail is indistinguishable from a gate that cannot fail.
