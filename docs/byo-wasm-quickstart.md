# BYO-wasm quickstart

Bring your own WebAssembly. This is the vendor path: you compile your existing
C or C++ with your own build system, against the pinned toolchain and the
family ABI header, and hand the SDK a finished `module.wasm`. You do not need
access to any private repository, and you do not have to route your source
through the SDK's own compiler.

If you would rather have the SDK drive the compiler for you, the
`space-data-module compile` command exists and applies the same toolchain
resolution described below. The BYO lane is the supported path for a vendor
with an established build.

## 1. The toolchain pin

This is the only sanctioned toolchain for a guest module, and it is not
negotiable:

> Compile guest modules with `clang --target=wasm32-wasip1-threads` (WASI SDK,
> pinned by the repository's CI workflows). This is the ONLY sanctioned
> toolchain for `module.wasm`. `emcc -pthread` is FORBIDDEN for module
> compilation: Emscripten's pthread model is browser-only and cannot thread
> under WasmEdge, which breaks tri-runtime isomorphism (see
> [Isomorphic pthreads](isomorphic-pthreads.html)). Modules must be EH-free.
> `flowcc` composes a runtime from prebuilt objects; it is not a WASI rebuild
> step.

The template headers carry the same one-line doctrine:
`Build: clang --target=wasm32-wasip1-threads (never emcc -pthread)`.

### Toolchain triples

| Purpose | Value |
| --- | --- |
| Compile target | `wasm32-wasip1-threads` |
| Sysroot triple (threads libc / libc++) | `wasm32-wasip1-threads` |
| Resource-dir triple (compiler-rt builtins) | `wasm32-unknown-wasip1-threads` |
| Default drivers on `PATH` | `wasm32-wasi-clang`, `wasm32-wasi-clang++` |

The SDK resolves the sysroot by looking for `lib/wasm32-wasip1-threads/libc.a`
under, in order, `/opt/homebrew/share/wasi-sysroot`,
`/usr/local/share/wasi-sysroot`, `/opt/wasi-sdk/share/wasi-sysroot`, and
versioned Homebrew cellar paths. It resolves the resource directory by looking
for `lib/wasm32-unknown-wasip1-threads/libclang_rt.builtins.a` under
`/opt/homebrew/share/wasi-runtimes`, `/usr/local/share/wasi-runtimes`, and the
versioned cellar equivalents.

If nothing is found the SDK tells you exactly this:

> Install a wasi-sdk / wasi-libc+wasi-runtimes toolchain with the
> wasm32-wasip1-threads target (e.g. `brew install wasi-libc wasi-runtimes` or a
> wasi-sdk release), or set the `SDN_WASI_*` env overrides.

### Environment overrides

Set these when your toolchain lives somewhere else — for example inside your own
container image:

| Variable | Overrides |
| --- | --- |
| `SDN_WASI_CLANG` | C driver binary |
| `SDN_WASI_CLANGXX` | C++ driver binary |
| `SDN_WASI_TARGET` | Compile target triple |
| `SDN_WASI_SYSROOT` | Sysroot path |
| `SDN_WASI_RESOURCE_DIR` | compiler-rt resource directory |

## 2. The flag set

Object files are compiled with atomics, no exceptions, and threads:

```sh
wasm32-wasi-clang++ \
  --target=wasm32-wasip1-threads \
  --sysroot="$WASI_SYSROOT" \
  -resource-dir="$WASI_RESOURCE_DIR" \
  -matomics -fno-exceptions -pthread \
  -O2 -c src/my_module.cpp -o build/my_module.o
```

The link step adds the shared-memory and imported-memory contract:

```sh
wasm32-wasi-clang++ \
  --target=wasm32-wasip1-threads \
  --sysroot="$WASI_SYSROOT" \
  -resource-dir="$WASI_RESOURCE_DIR" \
  -pthread -matomics -mbulk-memory \
  -Wl,--import-memory -Wl,--shared-memory -Wl,--max-memory=2147483648 \
  -O2 build/*.o -o dist/isomorphic/module.wasm
```

`-pthread -matomics -mbulk-memory -Wl,--import-memory -Wl,--shared-memory
-Wl,--max-memory=2147483648` is the enforced flag set. A module linked without
it will not satisfy the parity gate.

### Multi-translation-unit builds

Nothing about the contract is single-file. Compile every translation unit with
the object-file flags above and link them in one step. A minimal `Makefile`:

```make
WASI_SYSROOT ?= /opt/homebrew/share/wasi-sysroot
WASI_RESOURCE_DIR ?= /opt/homebrew/share/wasi-runtimes
CXX := wasm32-wasi-clang++

TARGET_FLAGS := --target=wasm32-wasip1-threads \
                --sysroot=$(WASI_SYSROOT) \
                -resource-dir=$(WASI_RESOURCE_DIR)
CXXFLAGS := $(TARGET_FLAGS) -matomics -fno-exceptions -pthread -O2 -Iinclude
LDFLAGS  := $(TARGET_FLAGS) -pthread -matomics -mbulk-memory \
            -Wl,--import-memory -Wl,--shared-memory \
            -Wl,--max-memory=2147483648 -O2

SRCS := $(wildcard src/*.cpp)
OBJS := $(SRCS:src/%.cpp=build/%.o)

dist/isomorphic/module.wasm: $(OBJS)
	@mkdir -p $(dir $@)
	$(CXX) $(LDFLAGS) $(OBJS) -o $@

build/%.o: src/%.cpp
	@mkdir -p build
	$(CXX) $(CXXFLAGS) -c $< -o $@

clean:
	rm -rf build dist
```

Constraints that bite in practice:

- **EH-free.** Compile with `-fno-exceptions`. Do not throw across the ABI
  boundary; return a named negative error code instead.
- **No `emcc`.** Not for one translation unit, not for a dependency, not
  "temporarily for the browser build". One artifact serves every runtime.
- **No host-specific imports.** The parity gate classifies your import set
  against the declared host contract and fails on a forbidden import class.

## 3. Implement the family ABI

Pick your family from the [harness family matrix](index.html) and implement
exactly the export set that family's page names. Include the family's generated
ABI header from the SDK — do not hand-write the struct layouts, because the
headers carry `_Static_assert` size and offset locks that are the whole point of
the generated wire contract.

```cpp
#include <orbpro/orbpro_propagator_abi.h>
```

The SDK ships the headers under `include/` and exports them through the package
(`space-data-module-sdk/include/*`), so a vendor consuming the SDK from npm gets
the same bytes the generator produced.

## 4. Declare the manifest

A module carries an embedded manifest declaring its plugin id, family, invoke
surface, runtime targets, methods, ports, and the standards record types it
consumes and emits. See the
[module publication standard](module-publication-standard.html) for the record
layout and [conformance](conformance.html) for what is checked.

> **Status: still being built.** There is no tool today that stamps a manifest
> onto a binary produced by a foreign toolchain. Manifest normalization and
> codecs exist for modules authored inside the SDK's own build path, but a
> `manifest inject` verb for a BYO binary does not exist yet — it is Sprint 1 of
> the third-party integration program. Until it lands, a BYO vendor supplies the
> manifest JSON alongside the artifact and the manifest is attached for them.

## 5. Prove it, then ship it

```sh
# ABI conformance for your family
space-data-module conformance propagator --artifact ./dist/isomorphic/module.wasm

# tri-runtime parity: browser + WasmEdge + Docker WasmEdge, byte-identical
space-data-module parity \
  --wasm ./dist/isomorphic/module.wasm \
  --fixture ./fixtures/parity/basic.json \
  --lanes browser,wasmedge,docker-wasmedge
```

Then continue with [Conformance kit](conformance.html),
[Protect and sign](protect-and-sign.html), and
[Publication and listing](publication-submission.html).

## Honest gaps in this lane

These are checked statements about the SDK today, not future tense for its own
sake:

- The toolchain flags and triples above are real and enforced, but they are
  applied by the SDK's internal compiler resolver. The `Makefile` on this page
  is a documented recipe assembled from those enforced values; the repository
  does not yet ship a `Makefile`, `CMakeLists.txt` or `build.sh` template for a
  hand-rolled multi-TU build.
- `conformance --self-test` currently accepts only the `propagator` family. Any
  other family argument raises an unknown-family error.
- Manifest injection for foreign-compiled binaries does not exist yet.
- There is no self-serve listing submission command yet. See
  [Publication and listing](publication-submission.html).

An escorted pilot is possible today: a vendor delivers a BYO artifact and the
gates are run and the module listed by hand. The program above is what makes
that self-serve.
