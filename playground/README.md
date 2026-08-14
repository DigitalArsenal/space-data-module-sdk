# SDK playground — compile a harness module in your browser

Pick a harness-family example, edit the C++, and compile it to WebAssembly **in
the tab**. Then drive the compiled module through the family's shipped
conformance kit and run it against an independent reference.

```
npm run playground:build     # generate assets + bundle + copy the compiler
npm run playground:serve     # http://localhost:8099/
npm run playground:gate      # the real-browser gate (headless Chrome)
```

## The compiler is not new

The browser-compile lane already exists in this stack. `sdn-emception` ships
emception's **llvm-box** — clang and wasm-ld compiled to wasm — and it is the
same artifact that:

- the SDK's own node compiler drives (`src/compiler/compileModule.js` →
  `compileWithEmception`), and
- the SDN node's isomorphic flow compiler hosts under WasmEdge
  (`space-data-network/kubo/sdn/flowcc`).

`build.mjs` **copies** that package into `public/vendor/emception`. It does not
vendor a second LLVM, and it does not build one. The page therefore loads zero
external-origin bytes, which the real-browser gate asserts rather than assumes.

## What runs where

`build.mjs` (node, build time) runs the SDK generators the browser cannot:
the embedded-manifest source, the invoke bridge, the flatbuffers C++ runtime
headers and the generated SDS schema headers (flatc-wasm over the pinned
`spacedatastandards.org` tarball), plus the family's generated ABI header. They
are emitted as `public/assets/families.json`.

`src/compileWorker.js` (browser, a Web Worker) writes exactly those bytes into
emception's filesystem and runs exactly the SDK's `em++` command sequence.
Compiler diagnostics are surfaced **verbatim**.

`src/verify.js` (browser) instantiates the emitted bytes under the SDK's
browser WASI shim and runs the SDK's **shipped** propagator conformance suite —
Tier 0 exports, Tier B numeric anchors, Tier C invariants, Tier 4 lifecycle —
with the corpus generated from `twoBodyReference.js`, an implementation
independent of any module under test.

## The honesty boundary

Per Janus's ruling (2026-08-14), the browser lane compiles with
`em++ -s STANDALONE_WASM=1` (single-thread). Those bytes are a **teaching
artifact**:

- they are never written to `dist/isomorphic/module.wasm`;
- they are never called *conformant* — the UI renders the verdict the suite
  actually returned, gaps included;
- the module's real isomorphic `wasm32-wasip1-threads` (`wasi-sequential`)
  artifact is built by the SDK's node lane via a system clang. There is no
  browser path to it, so the playground does not pretend to have one — it is
  named in the UI as a server-deferred gap, alongside the tri-runtime parity
  gate, manifest/standards validation, and signing/publication.

## Families

The roster in `src/families.mjs` follows the ratified taxonomy in
`graph/tasks/module-sdk-harness-family-matrix.md`. Only **propagator** is
SHIPPED with a conformance kit, so only propagator carries compilable examples.
Every other family renders as NOT YET RATIFIED with the reason. `data-source`
is a shipped *shape* whose template carries no manifest or source scaffold; the
playground says so rather than inventing one.

Two propagator examples ship:

| example | what it is |
| --- | --- |
| **Two-body (worked)** | The template with its two physics TODOs filled in: closed-form Kepler, PQW → ECI → ECEF with the velocity transport term. Reproduces the Tier-B anchors to ~2e-9 m. |
| **Scaffold** | `templates/propagator-module` verbatim. Compiles cleanly, exercises every byte of the wire contract, and **fails Tier B** because the entity does not move. That failure is the gate working. |

The real-browser gate asserts both: the worked example must reach
`PASS-WITH-GAPS` with `tier0/parity-gate` as its only gap, and the scaffold
must `FAIL`. A conformance check never observed to fail proves nothing.

## Known costs

`public/bundle/app.js` is ~3 MB minified. The conformance driver reaches
`src/bundle/wasm.js` for the wasm section parser, and that module's graph pulls
in the whole `spacedatastandards.org` JS record library. Splitting that graph
belongs to the SDK's module layout, not to this page.

## Not in scope here

Publishing. The docs-site task owns the published surface and will embed this;
`server.mjs` is a local serve surface with no deploy path. An OrbPro/Cesium
viewport for the RUN stage is a follow-up — v1 proves the loop with numbers
next to an independent reference, which a globe would not have added to.
