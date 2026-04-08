# AGENTS

Apply the root and `src/AGENTS.md` files first. This directory explains the
host/runtime boundary that compliant modules can rely on.

## What Authors Should Take From This Directory

- The portable shared path is standalone WASI, optionally plus `sdn_host`.
- Browser helpers here are host-side shims and harnesses, not proof that raw
  WasmEdge-native guest imports are browser-portable.
- The isomorphic loader and browser harness show how the same artifact is meant
  to run in both places.

## Host Rules Authors Should Follow

- Shared browser/WasmEdge artifacts must stay within standalone WASI plus the
  optional `sdn_host` bridge. Raw WasmEdge-native extension imports are not
  browser-isomorphic.
- Browser shims are host-side replacements, not a promise that the guest can
  import WasmEdge-native sockets, TLS, or filesystem extensions directly.
- Keep the sync guest-host ABI narrow and deliberate. Avoid adding new hostcalls
  unless the Node host, browser path, docs, and tests all agree on semantics.
- Scope host capabilities tightly: filesystem roots, network allowlists, TLS,
  exec, timers, and crypto should stay explicit.

## Key Files To Read

- `abi.js`
- `browserEdgeShims.js`
- `browserHost.js`
- `isomorphicLoader.js`
- `nodeHost.js`
- `wasiShim.js`

## Note

Prefer using the exported host and harness surfaces rather than editing these
files unless the task is explicitly to change the SDK host contract.
