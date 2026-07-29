# lab/isomorphic-toolchain — boxed compile toolchain, four-lane spike

Feasibility harness for `sdk-isomorphic-toolchain-*` (graph). NOT shipped, NOT
imported by `src/`. It proves the compile toolchain itself is isomorphic: ONE
`llvm-box.wasm` + ONE content-addressed `wasm32-wasip1-threads` sysroot emit a
BYTE-IDENTICAL object in browser, Node, and WasmEdge.

## Inputs (not in git — content-addressed, staged locally)

`~/.spacedatanetwork/flowcc-toolchain/flowcc-toolchain-v2.tar.gz` (pins in
space-data-network `kubo/sdn/flowcc/toolchain/SHA256SUMS`), extracted to
`$TC/flowcc-toolchain/`:

| member | role |
|---|---|
| `llvm-box.wasm` | emception clang+wasm-ld, ONE artifact, argv[0] selects the tool |
| `sysroot-wasi-threads/` | wasi-sdk-24 `wasm32-wasip1-threads` sysroot + compiler-rt builtins |

Emception's `build/emception/llvm/llvm-box.mjs` supplies the Emscripten glue.
Node >= 20 needs the SDK's own patch (`src/compiler/emceptionNode.js`):
replace `scriptDirectory=__dirname+"/"` with an `import.meta.url` expression,
else Node rejects the file (`ERR_AMBIGUOUS_MODULE_SYNTAX`).

## Lanes

| script | runtime | notes |
|---|---|---|
| `spike.mjs` | Node | boxed vs native `wasm32-wasi-clang`, same flags |
| `browserlane.mjs` | headless Chrome | serves box + sysroot pack over COOP/COEP localhost; never jsdom |
| `wasmedge-lane.go.txt` | native WasmEdge | `flowcc.NewWithSysroot`; drop at `kubo/sdn/flowcc/cmd/boxspike/main.go` |
| `cxxfix.mjs` | Node | C++17 probe WITH the clang builtin-header graft |
| `bigcxx.mjs` | Node | largest real guest TU (`foundation/orbits`) boxed vs native |

`mkamalgam.mjs` reproduces the POCKET+ single guest TU exactly as
`codec/ccsds124-pocketplus/build.mjs` does.

## Flags under test

The SDK's canonical wasi-threads guest-TU compile — `compileModule.js`
`buildSourceCompilerArgs` + `wasiThreadsToolchain.js` `toolchainArgs`:

```
--target=wasm32-wasip1-threads --sysroot=<sysroot> [-resource-dir=<rd>]
-c <tu> -O3 -mbulk-memory -DNDEBUG -matomics -fno-exceptions -pthread [-std=c++17]
```
