# AGENTS

Apply the root and `src/AGENTS.md` files first.

## Area Ownership

This directory owns SDK test harnesses and runtime-facing helper surfaces used
by examples and downstream consumers: browser harnesses, generic process invoke
clients, runtime-matrix helpers, and resident-module FlatBuffer pumps.

## Harness Rules

- Keep browser harness behavior aligned with the same standalone artifacts that
  WasmEdge runs.
- Prefer portable invoke envelopes and portable WASI behavior over runtime-
  specific shortcuts.
- `createModuleFlatBufferStreamPump(...)` is the canonical no-JSON path for
  feeding binary FlatBuffer streams into a resident module instance.
- Avoid hiding stateful behavior inside one-off demos; if a harness contract is
  real, test it here.

## Key Files

- `browserModuleHarness.js`
- `moduleFlatbufferStreamPump.js`
- `processInvoke.js`

## Verification

- `node --test test/browser-harness.test.js`
- `node --test test/isomorphic-loader.test.js`
- `npm run test:module-stream`
- `node --test test/process-invoke.test.js`
