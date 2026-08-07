# AGENTS

Apply the root and `src/AGENTS.md` files first. This directory contains the
author-facing harnesses and streaming helpers.

## What Authors Should Use From Here

- `createBrowserModuleHarness(...)` is the browser-side proof path for shared
  standalone artifacts.
- `createModuleHarness(...)` is the generic process-side harness.
- `createModuleFlatBufferStreamPump(...)` is the canonical no-JSON path for
  streaming size-prefixed FlatBuffer frames into a resident module instance.

## Harness Rules

- Keep browser harness behavior aligned with the same standalone artifacts that
  WasmEdge runs.
- Prefer portable invoke envelopes and portable WASI behavior over runtime-
  specific shortcuts.
- `createModuleFlatBufferStreamPump(...)` is the canonical no-JSON path for
  feeding binary FlatBuffer streams into a resident module instance.
- Avoid hiding stateful behavior inside one-off demos; if a harness contract is
  real, test it here.

## Browser-Facing Code Does NOT Live Here (ruling 2026-08-07)

`src/testing/**` is HARNESS surface: it spawns WasmEdge, shells out, and opens
files. NOTHING browser-facing may resolve into it, because a browser bundler
resolves every branch statically and emits `node:` specifiers the browser then
tries to FETCH — that is how all 275 OrbPro gallery demos went dark
(`orbpro-engine-bundle-ships-node-builtins`).

The browser runtime surfaces moved OUT of here and into `src/host/`:

| was | is |
| --- | --- |
| `testing/browserModuleHarness.js` | `host/browserModuleHarness.js` (`./host/browser-module`) |
| `testing/workerModuleHarness.js` | `host/workerModuleHarness.js` (`./host/worker-module`) |
| `testing/moduleFlatbufferStreamPump.js` | `host/moduleFlatbufferStreamPump.js` |
| `toLoadableWasmBytes` | `bundle/artifactBytes.js` (`./bundle`) |

`./testing/browser` survives as `browser.js`, a pure re-export shim of those
runtime surfaces and nothing else. Both guards
(`test/browser-reachable-node-builtins.test.js`,
`test/browser-bundle-node-builtins.test.js`) enforce this with no exception
list; the second one bundles the artifact and greps it.

## Key Files To Read

- `moduleHarness.js`
- `parityHarness.js`
- `processInvoke.js`

## Note

Use these helpers from your module repo or app harnesses. Only edit them when
you are intentionally changing the SDK testing/runtime contract.
