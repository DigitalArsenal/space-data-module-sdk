# AGENTS

This directory is the reference implementation for REC+MBL single-file module
packaging and wasm section handling.

## What Authors Should Use It For

- Single-file delivery uses one appended `REC` trailer carrying an `MBL`
  record.
- Keep the runtime payload canonical `.wasm`; publication/container metadata
  lives in the REC trailer.
- Use the public bundle helpers and CLI from this repo rather than inventing a
  custom one-file format.
- Load through `openModuleArtifact` (bytes) or `stageModuleArtifact`
  (`./bundle/stage`, a file for WasmEdge/wasmedgec/Docker): the signature is
  checked and the trailer stripped in one step. Never strip a trailer by hand
  and hand the result to an engine; `toLoadableWasmBytes` is for inspection.

## Note

Only edit this directory when you are intentionally changing bundle behavior for
all consumers.
