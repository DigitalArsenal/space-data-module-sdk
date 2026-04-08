# AGENTS

You are in `src/manifest`, which owns the manifest schema codecs and
normalization rules.

## Rules

- Keep manifest encode/decode round-trips stable.
- Prefer canonical SDS schema names and file identifiers; do not add repo-local
  aliases when a standards name already exists.
- If you change a manifest field or normalization rule, update the compiler,
  compliance checks, and any affected examples/tests together.

## Check Before You Finish

- `npm test`
- `npm run check:compliance`
- `node --test test/module-sdk.test.js test/compliance.test.js`
