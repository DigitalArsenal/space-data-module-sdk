# WASI Cross-Language Test Matrix

## Goal

Build a manifest-driven module/flow test generator and language adapters that
exercise the SDK's WASI and host ABI surfaces across the languages supported by
`../flatbuffers/wasm`.

## Deliverables

- [ ] Common manifest-driven harness generator for modules and flows
- [ ] Shared test vector format for invoke, stdio, filesystem, and hostcall cases
- [ ] Node reference adapter with full coverage
- [ ] Go adapter
- [ ] Python adapter
- [ ] C# adapter
- [ ] Java adapter
- [ ] Rust adapter
- [ ] Swift adapter
- [ ] Cross-language smoke tests wired into `node --test`
- [ ] Edge-case documentation for unsupported/partial runtime features

## Coverage Targets

- [ ] Network
- [ ] Pipes
- [ ] stdin
- [ ] stdout
- [ ] stderr
- [ ] direct method calling
- [ ] filesystem access
- [ ] WASI environment/args/preopens where applicable
- [ ] host ABI operations for Node-RED-style capabilities:
  - [ ] http
  - [ ] tcp
  - [ ] udp
  - [ ] tls
  - [ ] websocket
  - [ ] mqtt
  - [ ] process exec
  - [ ] clock/random/schedule/context/crypto

## Constraints

- Use WASI-native execution where the runtime supports it cleanly.
- Where a language runtime lacks a clean WASI path, fall back to the best
  available pure-WASM execution strategy and document the gap.
- Keep the generator manifest-driven so arbitrary compliant modules can be
  smoke-tested without handwritten harness code.
- Treat flows as manifest-driven modules for harness generation purposes.

## Notes

- The canonical SDK host ABI is currently sync JSON-over-memory; use that as the
  common contract for generated hostcall tests.
- Comprehensive semantic validation for arbitrary modules still requires
  scenario-specific expectations in addition to generated contract tests.
