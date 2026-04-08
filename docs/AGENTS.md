# AGENTS

Apply the root `AGENTS.md` first. The docs in this repo are normative whenever
they use words like "canonical", "required", or "must".

## Documentation Rules

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

## Cross-Link Expectations

- User-facing feature changes should usually touch `README.md` plus one focused
  doc file.
- If an example is the proof point for a feature, link the example from the doc
  and the doc from the example README.
- Be explicit about boundaries. If something is not browser-isomorphic or not
  part of the canonical contract, say so plainly.
