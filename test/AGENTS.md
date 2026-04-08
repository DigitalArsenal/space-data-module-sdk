# AGENTS

Apply the root `AGENTS.md` first. This directory is the verification cookbook
module authors can borrow from.

## Verification Recipes

- Always run:
  - `npm test`
  - `npm run check:compliance`
- Manifest/compiler/compliance changes:
  - `node --test test/module-sdk.test.js test/compliance.test.js`
- Host ABI, Node host, browser harness, or isomorphic loader changes:
  - `node --test test/node-host.test.js test/host-abi.test.js`
  - `node --test test/browser-harness.test.js test/isomorphic-loader.test.js`
- Bundle changes:
  - `node --test test/module-bundle.test.js test/module-bundle-vectors.test.js test/module-bundle-cli.test.js test/module-bundle-go.test.js test/module-bundle-python.test.js`
- Runtime-host or binary stream changes:
  - `npm run test:stream-ingest`
  - `npm run test:module-stream`
  - `node --test test/flatsql-local-node.test.js`

## Env-Gated Suites

- `SPACE_DATA_MODULE_SDK_ENABLE_1GB_STREAM_TEST=1` enables the host-owned
  1 GiB stream benchmark.
- `SPACE_DATA_MODULE_SDK_ENABLE_1GB_MODULE_STREAM_TEST=1` enables the resident-
  module 1 GiB stream benchmark.
- `SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PARITY=1` enables browser/WasmEdge
  same-artifact parity checks.
- `SPACE_DATA_MODULE_SDK_ENABLE_WASMEDGE_PLUGIN_PARITY=1` enables sibling-plugin
  WasmEdge parity checks.
- `SPACE_DATA_NETWORK_PLUGINS_ROOT=/path/to/space-data-network-plugins` points
  real-plugin loading tests at a sibling plugin workspace.
- `SPACE_DATA_MODULE_SDK_ENABLE_RUNTIME_MATRIX=1` enables the broader runtime
  matrix suite.

## Note

- Skip cleanly when external dependencies such as WasmEdge or sibling plugin
  artifacts are unavailable.
- If you are only authoring a module, use these tests as patterns and recipes.
- Only change this directory when you are intentionally changing the SDK
  verification contract.
