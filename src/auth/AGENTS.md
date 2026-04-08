# AGENTS

This directory is the reference implementation for deployment authorization and
signing helpers used by compliant module distribution.

## What Authors Should Use It For

- Keep signing and authorization flows deterministic and explicit.
- Do not invent app-local signature records when a repo-level contract belongs
  here.

## Related Surfaces

- `src/transport`
- `src/deployment`
- `test/transport-records.test.js`
- `test/deployment-plan.test.js`

## Note

Use the exported helpers here rather than inventing your own signing records.
Only edit this directory when you are intentionally changing the auth contract.
