# sdn-flow WASM-First TODO

## Goal

Reduce `sdn-flow` to a host/editor shell and move all deterministic flow/runtime behavior into compiled WASM modules plus a typed hostcall ABI.

## Phase 1: Stop ABI Drift

- [ ] Replace local dependency invoke defaults with SDK canonical exports.
  - Files:
    - `src/runtime/constants.js`
    - `src/runtime/normalize.js`
    - `src/host/dependencyRuntime.js`
  - Change:
    - Import `DefaultInvokeExports`, `DefaultManifestExports`, and `InvokeSurface` from `space-data-module-sdk/runtime`.
    - Stop defaulting dependency runtime symbols to `plugin_init` / `plugin_destroy` / `malloc` / `free`.
    - Default direct invocation to SDK symbols: `plugin_invoke_stream`, `plugin_alloc`, `plugin_free`.
    - Treat `initSymbol` and `destroySymbol` as optional extras, not canonical defaults.

- [ ] Replace sibling-source constant copying with public SDK runtime exports.
  - Files:
    - `scripts/build-shared-runtime-constants.mjs`
    - `src/generated/sharedRuntimeConstants.generated.js`
    - `src/runtime/constants.js`
  - Change:
    - Point the generator at `space-data-module-sdk/runtime`, not `../space-data-module-sdk/src/runtime/constants.js`.
    - Include `DefaultInvokeExports` and `InvokeSurface` in the generated snapshot.
    - Keep the generated snapshot only where executable closure really requires it.

## Phase 2: Make Compilation Actually WASM-Resident

- [ ] Replace the filesystem-backed fake emception adapter with the real SDK emception session/runtime.
  - Files:
    - `src/editor/compileArtifact.js`
    - `src/compiler/EmceptionCompilerAdapter.js`
    - any editor compile subprocess wrappers
  - Change:
    - Remove `createFilesystemEmception()` shelling out to host `em++`.
    - Reuse the SDK emception runtime/session model instead of a host process shim.
    - Keep host subprocess usage only for editor supervision, not compilation.

- [ ] Collapse the four duplicated compile entry paths into one lowering path and one subprocess bridge.
  - Files:
    - `src/editor/compilePreview.js`
    - `src/editor/compileArtifact.js`
    - `src/editor/compilePreviewSubprocess.js`
    - `src/editor/compileArtifactSubprocess.js`
  - Change:
    - Share `normalizeString`, node resolution, subprocess setup, and lowering steps.
    - Make preview vs artifact a mode flag, not separate stacks.

## Phase 3: Shrink runtimeManager Into a Shell

- [ ] Freeze new built-in JS node handlers in `runtimeManager`.
  - File:
    - `src/editor/runtimeManager.js`
  - Rule:
    - No new execution semantics in JS.
    - New behavior must land as compiled/WASM runtime logic or host ABI support.

- [ ] Move deterministic built-in node families out of JS and into compiled/WASM implementations.
  - Priority order:
    - `change`
    - `json`
    - `range`
    - `template`
  - Current JS locations:
    - `applySdnFlowEditorChangeNodeMessage`
    - `applySdnFlowEditorJsonNodeMessage`
    - `applySdnFlowEditorTemplateNodeMessage`
    - `applySdnFlowEditorRangeNodeMessage`
    - all in `src/editor/runtimeManager.js`

- [ ] Reduce `runtimeManager` to editor supervision only.
  - Keep host-side:
    - compile/load/hot-reload
    - debug event streaming
    - process restart supervision
    - editor asset serving
    - hostcall adapter wiring
  - Remove from JS runtime path:
    - graph execution
    - queueing/drain logic
    - built-in transform semantics
    - request/response normalization
    - dependency/module invocation orchestration

## Phase 4: Replace JSON msg Plumbing With Typed Frames

- [ ] Stop using JSON payload encode/decode as the runtime contract.
  - File:
    - `src/editor/runtimeManager.js`
  - Current functions:
    - `encodeRuntimePayload`
    - `decodeRuntimePayload`
  - Change:
    - Replace ad hoc JSON `msg` objects with typed ingress/egress frame schemas.
    - Push request metadata, payload bytes, and output frame metadata through typed ABI layouts.

- [ ] Move HTTP request/response shaping behind the runtime ABI.
  - Files:
    - `src/editor/runtimeManager.js`
    - `src/host/fetchService.js`
    - `src/host/httpHostAdapters.js`
  - Change:
    - Build typed HTTP ingress frames in the host layer.
    - Let the runtime consume typed frames instead of synthetic Node-RED-style `msg.req` / `msg.res`.
    - Reuse one request/response normalization path across editor and host.

## Phase 5: Stabilize The Host Boundary

- [ ] Keep OS/network/filesystem ownership host-side, but expose more of it through typed hostcalls.
  - Goal:
    - More orchestration in WASM, less JS glue.
  - Needed ABI work:
    - async request/response handles
    - byte-oriented payload transfer
    - explicit resource lifetimes
    - stream-oriented host interactions for HTTP/websocket/MQTT/TCP/UDP/TLS/context/exec

- [ ] Decide what to do with function-node semantics.
  - Pick one:
    - embed a JS engine in WASM
    - compile user functions ahead of time into modules
    - keep function nodes explicitly host-side
  - Do not leave this implicit.

## Phase 6: Cleanup After The Boundary Is Right

- [ ] Deduplicate `normalizeString` and related helpers after the compile/runtime split settles.
- [ ] Deduplicate `isObject` / `isPlainObject`.
- [ ] Collapse duplicate HTTP normalization between editor and host.
- [ ] Simplify executable rebuild/relaunch flows into one owner path.
- [ ] Remove pure pass-through facades only if package-surface compatibility does not need them.

## Validation

- [ ] Add tests that confirm SDK-built modules run in `sdn-flow` without local symbol remapping.
- [ ] Add tests for typed frame transport through the editor/runtime boundary.
- [ ] Add tests that deterministic built-in nodes behave identically before and after WASM migration.
- [ ] Add tests that the editor compile path does not shell out to host `em++`.
