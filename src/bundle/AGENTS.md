# AGENTS

You are in `src/bundle`, which owns `sds.bundle` and the wasm custom-section
packaging rules.

## Rules

- `sds.bundle` is the single-file delivery format.
- Put bundle data in a wasm custom section; do not append raw bytes after the
  wasm binary.
- Keep parser, encoder, CLI behavior, vectors, and cross-language fixtures in
  sync.
- If the bundle contract changes, regenerate vectors and update the bundle docs
  and demos in the same change.

## Check Before You Finish

- `npm test`
- `npm run check:compliance`
- `node --test test/module-bundle.test.js test/module-bundle-vectors.test.js test/module-bundle-cli.test.js test/module-bundle-go.test.js test/module-bundle-python.test.js`
- `npm run generate:vectors` when vectors or the contract changed
