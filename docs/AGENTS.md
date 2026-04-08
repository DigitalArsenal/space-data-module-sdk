# AGENTS

Apply the root `AGENTS.md` first. The docs in this repo are normative whenever
they use words like "canonical", "required", or "must".

## What Authors Should Expect From These Docs

- When behavior changes, update the relevant doc in the same change. Do not let
  README, examples, and normative docs drift.
- Keep browser/WasmEdge portability aligned with
  `docs/browser-wasmedge-isomorphic.md`.
- Keep publication layout and release expectations aligned with
  `docs/module-publication-standard.md`.
- Keep binary FlatBuffer ingest guidance aligned with
  `docs/flatsql-streaming-standard.md`.
- Keep testing claims aligned with `docs/testing-harness.md`.
- If you change user-facing behavior, update the nearest example README as well.

## Read These First

- `docs/browser-wasmedge-isomorphic.md`
- `docs/flatsql-streaming-standard.md`
- `docs/module-publication-standard.md`
- `docs/testing-harness.md`

## Note

If you are only authoring a module, prefer following these docs over editing
them. Edit docs here only when the canonical guidance itself needs to change.
