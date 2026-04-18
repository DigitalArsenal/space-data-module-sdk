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

## Note

Only edit this directory when you are intentionally changing bundle behavior for
all consumers.
