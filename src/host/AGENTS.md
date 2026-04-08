# AGENTS

Apply the root and `src/AGENTS.md` files first.

## Area Ownership

This directory owns the Node reference host, browser host, browser edge shims,
WASI shims, the sync `sdn_host` ABI bridge, WasmEdge launch planning, and the
isomorphic loader path.

## Host Rules

- Shared browser/WasmEdge artifacts must stay within standalone WASI plus the
  optional `sdn_host` bridge. Raw WasmEdge-native extension imports are not
  browser-isomorphic.
- Browser shims are host-side replacements, not a promise that the guest can
  import WasmEdge-native sockets, TLS, or filesystem extensions directly.
- Keep the sync guest-host ABI narrow and deliberate. Avoid adding new hostcalls
  unless the Node host, browser path, docs, and tests all agree on semantics.
- Scope host capabilities tightly: filesystem roots, network allowlists, TLS,
  exec, timers, and crypto should stay explicit.

## Key Files

- `abi.js`
- `browserEdgeShims.js`
- `browserHost.js`
- `isomorphicLoader.js`
- `nodeHost.js`
- `wasiShim.js`

## Verification

- `node --test test/node-host.test.js test/host-abi.test.js`
- `node --test test/browser-harness.test.js test/isomorphic-loader.test.js`
- `node --test test/process-invoke.test.js`
- `node --test test/wasmedge-runner-build.test.js`
- `node --test test/wasmedge-runner-runtime.test.js` when WasmEdge behavior is
  part of the change
