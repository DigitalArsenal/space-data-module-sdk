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

## Key Files To Read

- `browserModuleHarness.js`
- `moduleFlatbufferStreamPump.js`
- `processInvoke.js`

## Note

Use these helpers from your module repo or app harnesses. Only edit them when
you are intentionally changing the SDK testing/runtime contract.
