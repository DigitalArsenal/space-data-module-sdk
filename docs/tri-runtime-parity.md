# Tri-Runtime Parity Harness

ONE `dist/isomorphic/module.wasm`, THREE runtimes, IDENTICAL behavior:

1. **browser** — real headless Chrome behind COOP/COEP (cross-origin isolated,
   SAB-capable), running the SDK browser WASI shim. Never jsdom — jsdom masks
   Illegal-invocation and threading realities.
2. **wasmedge** — a native WasmEdge binary, version-locked to the pin.
3. **docker-wasmedge** — a pinned Docker WasmEdge container.

Cross-runtime divergence is a **P1 SDK defect**, never a "platform quirk".
"Works in X" is inadmissible as module evidence; module-touching work needs a
parity receipt from this harness.

## Running

```bash
space-data-module parity \
  --wasm ./dist/isomorphic/module.wasm \
  --fixture ./fixtures/parity/sgp4-command.json \
  [--lanes browser,wasmedge,docker-wasmedge] [--json] [--timeout-sec N] \
  [--wasmedge-binary <bin>] [--chrome-binary <bin>] [--docker-platform <p>]
```

- Exit `0` only when every lane × thread-count run is byte-identical and every
  error/trap class matches. Any divergence, missing lane run, pin drift, or
  lane that cannot execute exits non-zero with a per-case report (SHA-256
  digests, lengths, first divergent byte offset + hex windows).
- All three lanes run by default. `--lanes` narrows explicitly — lanes are
  never skipped silently, and fewer than two lanes is rejected
  (`--allow-single-lane` exists for lane bring-up debugging only; it can never
  produce parity evidence).
- `--self-test-divergence <lane>` is a fire drill: it XORs one output byte of
  that lane after execution to prove the diff path fails loudly end-to-end.

Programmatic API (Node): `runParityHarness`, `diffParityRuns`,
`normalizeParityFixture`, `loadWasmEdgePin` from `space-data-module-sdk/testing`.

CI wiring in this repo:

- `npm run test:parity` — always-on unit suite (pin single-sourcing, fixture
  normalization, diff loudness incl. injected divergence).
- `npm run test:parity-tri-lane` — the real three lanes against the sgp4
  module (needs Chrome, native WasmEdge at the pin, Docker).

## The WasmEdge pin: ONE place

`src/testing/wasmedgePin.json` is the single source of truth:

```json
{ "wasmedgeVersion": "0.16.4", "dockerImageRepository": "space-data-module-sdk/parity-wasmedge" }
```

- The native lane runs `wasmedge --version` and hard-fails on mismatch
  (`PARITY PIN-DRIFT`).
- The docker lane derives its image tag from the same version
  (`space-data-module-sdk/parity-wasmedge:0.16.4`), builds it on demand from
  `src/testing/docker/wasmedge-parity.Dockerfile` (version injected via
  `--build-arg` from the pin — the Dockerfile itself pins nothing), and
  version-checks the container runtime before running cases.

Host and container WasmEdge versions therefore pin and bump TOGETHER by
editing one string. Keep the pin aligned with the node host's embedded
runtime (space-data-network `scripts/install-wasmedge.sh`, currently 0.16.4 —
the verified runtime for the libwasmedge atomic-wait fixes).

## Determinism contract

Every lane receives EXACTLY the same guest-observable inputs:

- stdin bytes are encoded once by the orchestrator (`encodePluginInvokeRequest`
  for `request` cases, raw bytes otherwise) and shipped verbatim to each lane;
- guest env is delivered explicitly (`wasmedge --env`, browser shim `env`) —
  the ambient host environment never leaks into the guest;
- guest argv[0] is always `module.wasm` (relative invocation from a private
  staging dir in the wasmedge lanes, literal argv in the browser shim);
- thread counts are swept via the fixture's `threadEnvVar`
  (default `SDM_PARITY_THREADS`) — runs at 1/2/4/8 (fixture-configurable) must
  be byte-identical within a lane AND across lanes. Browser sequential
  *throughput* divergence is sanctioned until `browser-worker-topology` lands;
  results must still match byte-for-byte;
- signed/published artifacts are stripped to the canonical module payload once
  (`toLoadableWasmBytes`) so every lane executes identical wasm bytes.

## Fixtures

```json
{
  "name": "sgp4-command-parity",
  "threadEnvVar": "SDM_PARITY_THREADS",
  "threadCounts": [1, 2, 4, 8],
  "cases": [
    {
      "id": "ingest-omm",
      "expect": "ok",
      "request": {
        "methodId": "ingest_omm",
        "inputs": [{ "portId": "omm", "payloadFile": "omm-25544.fb",
                     "typeRef": { "schemaName": "orbpro.sds.omm", "fileIdentifier": "$OMM" } }]
      }
    },
    { "id": "malformed-stdin", "stdinUtf8": "not a PIV frame" }
  ]
}
```

- `request` cases go through the canonical PIV invoke codec; raw cases take
  `stdinFile` / `stdinBase64` / `stdinHex` / `stdinUtf8`.
- `expect` (`"ok" | "guest-error" | "trap"`) is optional; without it the case
  only requires the class to be IDENTICAL across lanes (malformed-input
  fixtures compare error/trap classes this way).
- Payloads: `payloadFile` (relative to the fixture), `payloadBase64`,
  `payloadHex`, `payloadUtf8`.
- Committed payload binaries are regenerated deterministically by
  `node fixtures/parity/generate-fixtures.mjs`.

## Scope and current limits (v1)

- The execution profile is the **command surface** (stdin → stdout WASI run),
  the one surface all three runtimes share without a host adapter. Output
  parity = stdout bytes + exit/trap class per run.
- Persisted-state manifests (`stateFiles`) are diffed whenever a lane reports
  them; the wasmedge lanes will populate them when fixture-declared preopens
  land. The browser shim currently has no filesystem authority
  (`fd_prestat_get` → BADF), so state-writing fixtures cannot claim tri-lane
  parity yet.
- Threaded (wasi-threads) modules run in the wasmedge lanes today; the browser
  lane's worker topology for nested-worker SAB sharing is the known open fork
  (`browser-worker-topology`). Timer restart/misfire and cursor/persist/reload
  parity ride on the same fixture schema (future case kinds) — the diff engine
  already treats every run as (class, bytes, state) so new kinds plug in
  without new comparison rules.
