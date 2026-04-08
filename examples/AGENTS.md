# AGENTS

Apply the root `AGENTS.md` first. Examples are checked-in proofs of how the SDK
is intended to be used.

## Example Rules

- Keep examples runnable from the repo without hidden setup beyond documented
  toolchain requirements.
- `examples/isomorphic-loader` must demonstrate loading the exact same compiled
  artifact in both the browser and WasmEdge.
- `examples/single-file-bundle` is the reference for `sds.bundle`.
- `examples/flatsql-store-local` and related examples should reflect the
  canonical binary FlatBuffer ingest path when they demonstrate streaming or
  storage.
- If an example emits generated artifacts, keep their location aligned with the
  canonical module repo layout.

## When Updating Examples

- Update the example README together with code changes.
- Keep file paths, commands, and expected artifact names exact.
- Do not leave examples on deprecated APIs if the root docs describe a newer
  canonical path.
