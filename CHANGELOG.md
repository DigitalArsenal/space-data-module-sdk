# Changelog

## 0.8.21

- A module built with both the direct and the command surface exports
  `__wasm_call_ctors`: the main-thread pthread setup and the global
  constructors, without `main`, at most once per instance. Direct hosts run
  `_initialize`, otherwise `__wasm_call_ctors`, before the first direct call:
  the browser harness (`surface: "direct"`), the wasi-threads WasmEdge runner
  (`--sdm-direct`), `createStandaloneHarness("wasmedge", path, { surface:
  "direct" })` and `runParityHarness({ surface: "direct" })`. In 0.8.20 the
  direct surface of such a module ran neither, so namespace-scope C++ objects
  stayed zero-filled and a threaded module's main thread had no pthread
  descriptor. Rebuild those modules with 0.8.21.
- A guest thread that traps is reported by its own worker, on stderr in Node
  and on the console in a browser. The thread joining it stays blocked.
