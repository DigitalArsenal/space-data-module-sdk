# AGENTS

You are in `src/compliance`, which defines what counts as a compliant module or
artifact.

## Rules

- Treat this directory as policy, not convenience code.
- When tightening validation, update tests and error messages together so the
  failure mode is actionable.
- When relaxing validation, make sure the compiler, docs, and examples still
  describe the broader contract accurately.

## Check Before You Finish

- `npm test`
- `npm run check:compliance`
- `node --test test/module-sdk.test.js test/compliance.test.js`
