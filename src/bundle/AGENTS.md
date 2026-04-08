# AGENTS

This directory is the reference implementation for `sds.bundle` and wasm
custom-section packaging.

## What Authors Should Use It For

- `sds.bundle` is the single-file delivery format.
- Put bundle data in a wasm custom section; do not append raw bytes after the
  wasm binary.
- Use the public bundle helpers and CLI from this repo rather than inventing a
  custom one-file format.

## Note

Only edit this directory when you are intentionally changing bundle behavior for
all consumers.
