# AGENTS

Apply the root `AGENTS.md` first. Examples are checked-in proofs of how the SDK
is intended to be used.

## How Authors Should Use These Examples

- Keep examples runnable from the repo without hidden setup beyond documented
  toolchain requirements.
- `examples/isomorphic-loader` must demonstrate loading the exact same compiled
  artifact in both the browser and WasmEdge.
- `examples/single-file-bundle` is the reference for REC+MBL single-file delivery.
- `examples/flatsql-store-local` is a legacy migration example. The canonical
  replacement example must load FlatSQL as a signed WASM node, feed canonical
  binary FlatBuffer streams, exercise aligned routing, and run the exact same
  artifact under browser and WasmEdge harnesses.
- If an example emits generated artifacts, keep their location aligned with the
  canonical module repo layout.

## Note

Start from the nearest example instead of editing SDK internals. Only change the
examples here when the canonical example path itself needs to change.
