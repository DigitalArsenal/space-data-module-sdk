# AGENTS

This directory is the reference implementation for manifest encoding,
normalization, and round-trip behavior.

## What Authors Should Use It For

- Keep manifest encode/decode round-trips stable.
- Prefer canonical SDS schema names and file identifiers; do not add repo-local
  aliases when a standards name already exists.
- Every input and output accepted type set carries a canonical FlatBuffer entry
  and an aligned-binary entry with the same SDS schema name, file identifier,
  root type, version, and hash when present. Aligned layout metadata is an
  execution optimization, not a second logical type.

## Note

Use the public manifest helpers from this repo to build manifests. Only edit
this directory when you are intentionally changing the manifest standard.
