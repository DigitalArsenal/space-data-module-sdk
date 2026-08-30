# Can emception build the shared-memory wasm-engine? — verdict

**Verdict: NO.** Recorded 2026-08-30 by `obc-05-emception-lane`
(`graph/tasks/obc-05-emception-lane.md`, OrbPro Build Cutter program). Measured
in headless Chromium against the real target's real flags. Three independent
blockers, any one of them fatal; the third is the one that settles it.

The user-module lane — Phase B — **works**, and ships. See §4.

Harness, fixtures and the raw record:
`OrbPro/packages/orbpro-integration/build-cutter/emception/`
(`spike/run.mjs` produces `results/emception-lane.json`).

---

## 1. The question

`packages/wasm-engine/build-sdn.sh` builds two Emscripten targets from
`packages/wasm-engine/src/cpp/CMakeLists.txt`. One of them,
**`wasm_engine_sdn_browser_shared`**, is the browser presentation artifact:
`-s IMPORTED_MEMORY=1 -s SHARED_MEMORY=1 -matomics -mbulk-memory` on top of
`-s STANDALONE_WASM=1`, with a 4 GiB ceiling.

Could the Build Cutter recompile *that* target in a browser tab, with the
runtime lock (`allowedDomains`, `compiledAtMs`, `ttlDays`) as compiled-in
constants, so a cut's domain lock lives inside the WASM instead of only in the
JS mirror?

## 2. What was measured

| | |
| --- | --- |
| Target | `wasm_engine_sdn_browser_shared` |
| Compiler under test | `sdn-emception@1.0.0`, vendored same-origin |
| Its Emscripten | **3.1.24** (`/emscripten/emscripten-version.txt`, read at run time) |
| The engine's Emscripten | **6.0.1** (`build-sdn.sh`, `./emsdk install 6.0.1`) |
| Page | headless Chromium, own ephemeral port, `COOP: same-origin` + `COEP: require-corp`, `crossOriginIsolated === true` |
| Probe source | `fixtures/engine-lock-probe.cpp` — the lock's three fields as `constexpr`, the JS mirror's predicate, `std::atomic` and `std::thread` |
| Flags | transcribed from `src/cpp/CMakeLists.txt`, not invented — `compileArgs.mjs` |

## 3. The three blockers, verbatim

### 3.1 The target is a CMake target, and there is no CMake

`build-sdn.sh` runs `emcmake cmake -S src/cpp -B build-wasm` and then
`cmake --build --target wasm_engine_sdn_browser_shared`. Emception ships
`/emscripten/emcmake.py` but no `cmake`, no `make`, no `ninja` and no `git`
(measured; `git` matters because the target's `CMakeLists.txt` pulls GLM in
through `FetchContent_Declare(... GIT_REPOSITORY ...)`, and the tab has no
network beyond its own origin).

```
$ emcmake cmake -S /working/build-cutter/src-cpp -B /working/build-cutter/build-wasm -DCMAKE_BUILD_TYPE=Release
configure: cmake -S /working/build-cutter/src-cpp -B /working/build-cutter/build-wasm -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=/emscripten/cmake/Modules/Platform/Emscripten.cmake -DCMAKE_CROSSCOMPILING_EMULATOR=/usr/bin/node;--experimental-wasm-threads
Not found: cmake
emcmake: error: 'cmake -S /working/build-cutter/src-cpp -B /working/build-cutter/build-wasm -DCMAKE_BUILD_TYPE=Release -DCMAKE_TOOLCHAIN_FILE=/emscripten/cmake/Modules/Platform/Emscripten.cmake -DCMAKE_CROSSCOMPILING_EMULATOR=/usr/bin/node;--experimental-wasm-threads' failed (returned 1)
```

### 3.2 The engine's own flags do not exist in this Emscripten

Driving `em++` directly, bypassing CMake, with the target's exact flags:

```
$ em++ -c engine_lock_probe.cpp -std=c++17 -O3 -flto -ffast-math -fno-finite-math-only \
    -DNDEBUG -msimd128 -fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0 -matomics -mbulk-memory -o engine_lock_probe.o
em++: error: Attempt to set a non-existent setting: 'WASM_LEGACY_EXCEPTIONS'
 - did you mean one of ABORT_ON_WASM_EXCEPTIONS, LEGACY_SETTINGS?
 - perhaps a typo in emcc's  -sX=Y  notation?
 - (see src/settings.js for valid values)
```

The link step fails identically. Removing `-fwasm-exceptions` and
`-sWASM_LEGACY_EXCEPTIONS=0` and asking again produces the next one:

```
em++: error: Attempt to set a non-existent setting: 'STACK_SIZE'
 - did you mean one of ASYNCIFY_STACK_SIZE?
```

This is the 3.1.24-versus-6.0.1 gap, one setting at a time. The spike drops
each named setting and re-asks (`engine-shared-link-relaxed-<n>`, advisory
probes) rather than reporting only the first — the point is the size of the
gap, not its first symptom.

### 3.3 This Emscripten refuses the combination outright

With every version-gated setting removed, the shared-memory link finally runs —
and this is the answer:

```
$ em++ engine_lock_probe_relaxed.o -O3 -flto -s EXPORTED_FUNCTIONS=[...] -s MODULARIZE=1 \
    -s EXPORT_NAME='WasmEngineSharedModule' -s EXPORT_ES6=1 -s STANDALONE_WASM=1 \
    -s IMPORTED_MEMORY=1 -s SHARED_MEMORY=1 -matomics -mbulk-memory ... -o engine_shared_probe_relaxed.js

error: library_pthread_stub.js:11: #error "STANDALONE_WASM does not support shared memories yet"

warning: undefined symbol: main/__main_argc_argv (referenced by top-level compiled C/C++ code)
warning: To build in STANDALONE_WASM mode without a main(), use emcc --no-entry
```

`STANDALONE_WASM=1` **and** `SHARED_MEMORY=1` is exactly what
`wasm_engine_sdn_browser_shared` is, and Emscripten 3.1.24 refuses that pair
from its own sources. Not a missing flag, not a missing tool — a refused
combination. (The object file compiles clean: `-matomics -mbulk-memory
-msimd128` produce a 12,196-byte object. Atomics are not the problem.)

## 4. What this means, and what ships anyway

**The lock stays in the JS mirror.** `obc-01`'s
`isBundledWasmEngineKeyRuntimeAuthorized` (`packages/wasm-engine/index.mjs`)
remains the shipped enforcement, with its hard `E79` refusal. `obc-04`'s engine
slot takes the prebuilt engine blob, as it does today; the emception lane does
not fill it.

**Phase B ships.** A user's own C/C++ module compiles in the same worker, in
the single-thread Emscripten profile, and is labelled development-grade:

- fixture compiled and linked in **2.4–3.0 s**, producing a **597-byte** wasm;
- instantiated and called **on the page**: `build_cutter_probe(0)` returns
  `307385611`, `build_cutter_tag_length()` returns `31`;
- stamped with `runtimeTargets: ["browser"]` in the `sds.manifest` `$PLG`
  section, so `assertArtifactRuntimeTarget({leg: "wasmedge"})` throws
  `RuntimeTargetError` — asserted against the real gate, and asserted again
  against the UNSTAMPED artifact, which is admitted everywhere and proves the
  stamp is the whole refusal;
- refused by `assertSequentialArtifact(..., {target: "wasm32-emscripten"})`:
  *"the sequential model is a concurrency exemption, NOT a toolchain
  exemption."*

This is the Janus boundary of 2026-08-14 holding: nothing a browser tab
produces enters the isomorphic lane, and the refusal is mechanical.

## 5. A second finding: the shipped `.pack.br` files are not the packs

Not the question that was asked, but it blocks anyone who tries the obvious
thing. `sdn-emception@1.0.0` ships both uncompressed and brotli packs, and its
loader fetches the uncompressed ones — 143,151,779 B for the three it needs.
Pointing the fetch at the `.pack.br` siblings (21,901,402 B) produces a
compiler that cannot compile.

| pack | `.pack` | `.pack.br` decompresses to | first entry |
| --- | ---: | ---: | --- |
| `wasm` | 69,661,854 | 69,661,854 | `wasm/binaryen-box.wasm` |
| `cpython` | 9,129,156 | 9,129,487 | `usr/` |
| `emscripten` | 64,360,769 | 31,286,982 | `./` — **not** `emscripten/` |

The `.pack.br` files are a different build, not compressed copies:

1. **The emscripten one is rooted at `.`**, so unpacking it where the prefixed
   packs go scatters the emscripten tree across the filesystem root. Nothing
   throws; the next thing to fail is `python: can't open file
   '/emscripten/emcc.py': [Errno 44]`, stages later, with no hint of the cause.
2. **It omits the prebuilt sysroot.** The real `emscripten.pack` carries 7,434
   `emscripten/cache/sysroot/**` entries; the `.br` build carries none. Without
   them the first link rebuilds libc (998 inputs), libc++, compiler_rt and the
   rest inside the tab — **135 s, measured** — and then dies generating
   `struct_info.json`, because that step compiles a probe and runs it under
   emception's quicknode: `Error: not compiled for this environment`.

Proven not to be an artifact of the change: with the loader **unpatched** on
the 143 MB packs, the same fixture compiles in **3.9 s**
(`node vendor.mjs --uncompressed`, kept as the A/B control).

**What the lane does instead.** It compresses the *working* packs itself at
vendor time (brotli q11, lgwin 24) and serves those. Measured:

| | bytes |
| --- | ---: |
| Packs, upstream uncompressed lane | 143,151,779 |
| Packs, this lane | **25,851,077** |
| Cold page load + first compile, total served | **27,431,647** |
| Second page load + second compile, total served | **26,989** (0 pack bytes) |
| External-origin requests | **0** |

A 5.2× reduction on the wire, and the second compile costs nothing because the
service worker holds the packs. The task's ≤ 25 MB target is missed by 1.2 MB,
and the reason is item 2 above: the prebuilt sysroot is what makes the
difference between a 3 s compile and a 135 s failure, and it is 8.4 MB
compressed. Trading it away to hit the number would be trading the working
compiler for a byte count.

### Escalation to `sdn-emception`

Two changes, both upstream, both retiring code this lane carries:

1. **Publish `.pack.br` files that are the `.pack` files compressed** — same
   roots, same contents, including `emscripten/cache/sysroot/**`. Today's
   `emscripten.pack.br` cannot build anything.
2. **Take a `packs: "br"` constructor option**, so `#fetchAndUnpack` can be
   pointed at them without a vendor-time overlay.

Until then the overlay lives in
`OrbPro/packages/orbpro-integration/build-cutter/emception/vendor.mjs`: two
exact string rewrites, each required to match **exactly once**, so an
`sdn-emception` refresh fails the build loudly instead of silently reverting
the stack to a 143 MB download.

## 6. Reproducing

```sh
cd OrbPro/packages/orbpro-integration/build-cutter/emception
node vendor.mjs                 # copy the compiler same-origin, compress the packs
node spike/run.mjs              # one headless run -> results/emception-lane.json
node --test test/emception-lane.test.mjs
node vendor.mjs --uncompressed  # the A/B control: unpatched loader, 143 MB packs
```

`node server.mjs` serves the lane at `http://127.0.0.1:8137/` for hand
inspection. It is a dev-server page; it is not published.
