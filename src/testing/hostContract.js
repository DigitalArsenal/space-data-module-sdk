/**
 * Declared host-contract surfaces and forbidden import classes.
 *
 * The isomorphism law says a module's differences are absorbed ONLY in SDK
 * host shims — never in module code, and never by a runtime-specific glue
 * layer baked into the artifact. That makes an artifact's IMPORT SECTION the
 * primary, checkable statement of what host it demands:
 *
 *   - every import must be a member of the surface the artifact DECLARES;
 *   - no import may belong to a FORBIDDEN class (emscripten glue: EH
 *     trampolines, `__cxa_*`, JS-library `__syscall_*`, `emscripten_*`
 *     runtime hooks, or the minified `a`-module shape emcc emits for the
 *     browser target). Those are `emcc`-shaped artifacts — browser-only,
 *     not instantiable on a plain WasmEdge host — which the standing module
 *     contract auto-rejects.
 *
 * This module is pure/structural and runs anywhere. It is NOT a substitute
 * for real instantiation (see parityGate.js, which does both); it is what
 * lets a real instantiation failure be CLASSIFIED — "this artifact wants a
 * capability the contract grants but this lane's runner does not supply" is a
 * completely different fact from "this artifact wants emscripten glue", and a
 * gate that cannot tell them apart is a gate that lies.
 */

/** WASI preview1 — every lane provides this (browser via the SDK shim). */
export const WASI_PREVIEW1_MODULE = "wasi_snapshot_preview1";

/**
 * wasi-threads: modules spawn threads by IMPORTING `wasi.thread-spawn` and
 * EXPORTING `wasi_thread_start` over a SHARED linear memory imported as
 * `env.memory`. This is the clang `wasm32-wasip1-threads` shape — the ONLY
 * sanctioned threading shape. `emcc -pthread` produces a different, browser-
 * only shape and is rejected by the forbidden classes below.
 */
export const WASI_THREADS_IMPORTS = Object.freeze([
  "wasi.thread-spawn",
  "env.memory",
]);

/**
 * The sanctioned synchronous hostcall bridge. This ONE import module carries
 * the entire generic hook set (`http`/`tcp`/`wallet_sign`/`keyslot.sign`/
 * clock/fs) as operations inside a binary envelope — that is why an SDK module
 * needs no per-capability imports, and why any NEW private import is a NEW
 * HOST CAPABILITY (an owner decision, never a PR).
 *
 * Supplied identically by both lanes: the browser/Node JS harness
 * (`src/host/abi.js:10`) and the Go host bridge WasmEdge embeds
 * (`kubo/sdn/modulert/hostbridge.go`). Names must match byte-for-byte in both.
 */
export const HOSTCALL_IMPORT_MODULE = "space_data_module_host";
export const HOSTCALL_IMPORTS = Object.freeze([
  `${HOSTCALL_IMPORT_MODULE}.call`,
  `${HOSTCALL_IMPORT_MODULE}.response_len`,
  `${HOSTCALL_IMPORT_MODULE}.read_response`,
  `${HOSTCALL_IMPORT_MODULE}.clear_response`,
  `${HOSTCALL_IMPORT_MODULE}.last_status_code`,
  // Compiled flow-runtime artifacts dispatch the current invocation back
  // through the same bridge (src/runtime/compiledRuntimeAbi.json).
  `${HOSTCALL_IMPORT_MODULE}.dispatch_current_invocation`,
  // Legacy compiled-flow artifacts import the same entry on `sdn_flow_host`;
  // the SDK stubs it in both lanes (src/flow/flowRuntimeHost.js:241).
  "sdn_flow_host.dispatch_current_invocation",
]);

/**
 * The seven FlatSQL VFS host functions, exactly as the engine imports them.
 * Offsets are f64 (never i64): emscripten legalizes i64 across the JS
 * boundary for the browser target and not for STANDALONE_WASM, which would
 * give one import two different signatures in the two lanes.
 */
export const FLATSQL_IO_IMPORTS = Object.freeze([
  "env.flatsql_io_open",
  "env.flatsql_io_read",
  "env.flatsql_io_write",
  "env.flatsql_io_truncate",
  "env.flatsql_io_sync",
  "env.flatsql_io_size",
  "env.flatsql_io_close",
]);

export const FLATSQL_IO_SIGNATURES = Object.freeze({
  flatsql_io_open: { params: ["i32", "i32", "i32"], result: "i32" },
  flatsql_io_read: { params: ["i32", "i32", "i32", "f64"], result: "i32" },
  flatsql_io_write: { params: ["i32", "i32", "i32", "f64"], result: "i32" },
  flatsql_io_truncate: { params: ["i32", "f64"], result: "i32" },
  flatsql_io_sync: { params: ["i32"], result: "i32" },
  flatsql_io_size: { params: ["i32"], result: "f64" },
  flatsql_io_close: { params: ["i32"], result: "i32" },
});

/**
 * Named host-contract surfaces. `wasiAny: true` means "any function on the
 * WASI preview1 module is in-surface" — the WASI set is large, stable, and
 * supplied wholesale by every lane; enumerating it would only rot.
 */
export const HOST_SURFACES = Object.freeze({
  /** An SDK module: WASI + wasi-threads + the ONE sanctioned hostcall bridge.
   *  Nothing else — the generic hook set rides inside that bridge, so private
   *  per-capability imports are always a contract violation. */
  module: Object.freeze({
    id: "module",
    wasiAny: true,
    extra: Object.freeze([...WASI_THREADS_IMPORTS, ...HOSTCALL_IMPORTS]),
    description:
      "WASI preview1 + wasi-threads (clang wasm32-wasip1-threads) + the space_data_module_host bridge",
  }),
  /** A WASI-only module: no hostcall bridge at all. The strictest surface. */
  "module-standalone": Object.freeze({
    id: "module-standalone",
    wasiAny: true,
    extra: WASI_THREADS_IMPORTS,
    description: "WASI preview1 + wasi-threads ONLY (no hostcall bridge)",
  }),
  /** The FlatSQL engine artifact: WASI + the seven declared VFS functions. */
  "flatsql-engine": Object.freeze({
    id: "flatsql-engine",
    wasiAny: true,
    extra: Object.freeze([...WASI_THREADS_IMPORTS, ...FLATSQL_IO_IMPORTS]),
    description: "WASI preview1 + the seven declared flatsql_io_* VFS imports",
  }),
});

/**
 * Forbidden import classes. Matching ANY of these is an auto-reject, in every
 * lane, whether or not the lanes agree with each other: agreement that an
 * artifact is broken everywhere is not parity.
 */
export const FORBIDDEN_IMPORT_CLASSES = Object.freeze([
  Object.freeze({
    id: "emscripten-eh",
    test: (module, name) =>
      module === "env" &&
      (/^invoke_[a-z]+$/.test(name) ||
        name === "__resumeException" ||
        name === "llvm_eh_typeid_for" ||
        name.startsWith("__cxa_")),
    reason:
      "emscripten exception-handling glue (invoke_* trampolines / __cxa_* / __resumeException). Modules are EH-free; this artifact was built with emcc, not clang wasm32-wasip1-threads.",
  }),
  Object.freeze({
    id: "emscripten-syscall",
    test: (module, name) => module === "env" && name.startsWith("__syscall_"),
    reason:
      "emscripten JS-library syscall shims (__syscall_*). A WASI artifact reaches the filesystem through WASI or a declared VFS capability, never through JS syscalls.",
  }),
  Object.freeze({
    id: "emscripten-runtime",
    test: (module, name) =>
      module === "env" &&
      name.startsWith("emscripten_") &&
      !name.startsWith("emscripten_notify_construct"),
    reason:
      "emscripten runtime hooks (emscripten_*, e.g. emscripten_resize_heap / emscripten_notify_memory_growth). These resolve only against the emscripten JS runtime — browser-only by construction.",
  }),
  Object.freeze({
    id: "emscripten-minified",
    // The emcc browser target emits a single-letter import module ("a") with
    // single/double-letter member names. Nothing hand-written looks like this.
    test: (module, name) => /^[a-z]$/.test(module) && /^[A-Za-z_$]{1,3}$/.test(name),
    reason:
      "minified emscripten browser artifact (single-letter import module). This is the emcc browser build, not the isomorphic artifact.",
  }),
]);

// --- Minimal wasm binary reader (type + import sections) ----------------------
//
// WebAssembly.Module.imports() reports names and kinds but NOT descriptors, and
// a probe that guesses a shared-memory descriptor or a function arity is a
// probe that can fail for reasons unrelated to the artifact. Read the real
// thing: exact signatures let both lanes synthesize EXACTLY the declared host
// surface, so a LinkError means what it says.

const WASM_VALTYPE = new Map([
  [0x7f, "i32"],
  [0x7e, "i64"],
  [0x7d, "f32"],
  [0x7c, "f64"],
  [0x7b, "v128"],
  [0x70, "funcref"],
  [0x6f, "externref"],
]);

function makeReader(bytes) {
  let offset = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    get offset() {
      return offset;
    },
    set offset(value) {
      offset = value;
    },
    get done() {
      return offset >= bytes.length;
    },
    u8() {
      return bytes[offset++];
    },
    u32() {
      const value = view.getUint32(offset, true);
      offset += 4;
      return value;
    },
    varuint() {
      let result = 0;
      let shift = 0;
      let byte;
      do {
        byte = bytes[offset++];
        result |= (byte & 0x7f) << shift;
        shift += 7;
      } while (byte & 0x80);
      return result >>> 0;
    },
    bytes(length) {
      const slice = bytes.subarray(offset, offset + length);
      offset += length;
      return slice;
    },
    name() {
      const length = this.varuint();
      return new TextDecoder().decode(this.bytes(length));
    },
  };
}

/**
 * Read import descriptors with exact detail:
 *   function -> {kind:"function", params:[valtype], results:[valtype]}
 *   memory   -> {kind:"memory", initial, maximum?, shared}
 *   table    -> {kind:"table", element, initial, maximum?}
 *   global   -> {kind:"global", valtype, mutable}
 */
export function readWasmImportDescriptors(bytes) {
  const reader = makeReader(bytes);
  const magic = reader.u32();
  const version = reader.u32();
  if (magic !== 0x6d736100) throw new Error("not a wasm binary (bad magic)");
  if (version !== 1) throw new Error(`unsupported wasm version ${version}`);

  const types = [];
  const imports = [];

  while (!reader.done) {
    const sectionId = reader.u8();
    const sectionLength = reader.varuint();
    const sectionEnd = reader.offset + sectionLength;
    if (sectionId === 1) {
      const count = reader.varuint();
      for (let index = 0; index < count; index += 1) {
        const form = reader.u8(); // 0x60 func
        if (form !== 0x60) {
          types.push(null);
          reader.offset = sectionEnd;
          break;
        }
        const paramCount = reader.varuint();
        const params = [];
        for (let p = 0; p < paramCount; p += 1) {
          params.push(WASM_VALTYPE.get(reader.u8()) ?? "unknown");
        }
        const resultCount = reader.varuint();
        const results = [];
        for (let r = 0; r < resultCount; r += 1) {
          results.push(WASM_VALTYPE.get(reader.u8()) ?? "unknown");
        }
        types.push({ params, results });
      }
    } else if (sectionId === 2) {
      const count = reader.varuint();
      for (let index = 0; index < count; index += 1) {
        const moduleName = reader.name();
        const fieldName = reader.name();
        const kindByte = reader.u8();
        if (kindByte === 0x00) {
          const typeIndex = reader.varuint();
          const type = types[typeIndex] ?? { params: [], results: [] };
          imports.push({
            module: moduleName,
            name: fieldName,
            kind: "function",
            params: type.params,
            results: type.results,
          });
        } else if (kindByte === 0x01) {
          const element = reader.u8();
          const limitsFlag = reader.varuint();
          const initial = reader.varuint();
          const maximum = limitsFlag & 0x01 ? reader.varuint() : undefined;
          imports.push({
            module: moduleName,
            name: fieldName,
            kind: "table",
            element: element === 0x70 ? "anyfunc" : "externref",
            initial,
            maximum,
          });
        } else if (kindByte === 0x02) {
          const limitsFlag = reader.varuint();
          const initial = reader.varuint();
          const maximum = limitsFlag & 0x01 ? reader.varuint() : undefined;
          imports.push({
            module: moduleName,
            name: fieldName,
            kind: "memory",
            initial,
            maximum,
            shared: Boolean(limitsFlag & 0x02),
          });
        } else if (kindByte === 0x03) {
          const valtype = WASM_VALTYPE.get(reader.u8()) ?? "unknown";
          const mutable = reader.u8() === 1;
          imports.push({
            module: moduleName,
            name: fieldName,
            kind: "global",
            valtype,
            mutable,
          });
        } else {
          throw new Error(`unknown import kind 0x${kindByte.toString(16)}`);
        }
      }
      // Import section fully read; the type section preceded it, so stop.
      reader.offset = sectionEnd;
      break;
    }
    reader.offset = sectionEnd;
  }

  return imports;
}

/**
 * Parse just the import section. Deliberately NOT `new WebAssembly.Module()`:
 * compiling a 1.8 MB engine to read its import list is wasteful, and the
 * structural verdict must be computable for artifacts a given engine refuses
 * (that refusal is exactly what we are classifying).
 */
export function readWasmImports(bytes) {
  return readWasmImportDescriptors(bytes).map((entry) => ({
    module: entry.module,
    name: entry.name,
    kind: entry.kind,
  }));
}

export function readWasmExportNames(bytes) {
  const module = new WebAssembly.Module(bytes);
  return WebAssembly.Module.exports(module).map((entry) => entry.name);
}

export function resolveHostSurface(surfaceId) {
  const surface = HOST_SURFACES[String(surfaceId)];
  if (!surface) {
    throw new Error(
      `Unknown host-contract surface "${surfaceId}". Known: ${Object.keys(HOST_SURFACES).join(", ")}.`,
    );
  }
  return surface;
}

export function importKey(entry) {
  return `${entry.module}.${entry.name}`;
}

/**
 * Classify an artifact's imports against a declared surface.
 *
 * Returns:
 *   {
 *     verdict: "in-surface" | "outside-surface" | "forbidden" | "malformed",
 *     imports, importCount, importDigestSource,
 *     forbidden: [{import, classId, reason}],
 *     outsideSurface: [key],
 *     capabilityImports: [key]   // in-surface, non-WASI (needs a host shim)
 *   }
 *
 * "forbidden" outranks "outside-surface": naming the auto-reject class is the
 * useful fact.
 */
export function classifyArtifactImports(bytes, surfaceId) {
  const surface = resolveHostSurface(surfaceId);
  let imports;
  try {
    imports = readWasmImports(bytes);
  } catch (error) {
    return {
      verdict: "malformed",
      surface: surface.id,
      error: error?.message ?? String(error),
      imports: [],
      importCount: 0,
      forbidden: [],
      outsideSurface: [],
      capabilityImports: [],
    };
  }

  const allowedExtra = new Set(surface.extra);
  const forbidden = [];
  const outsideSurface = [];
  const capabilityImports = [];

  for (const entry of imports) {
    const key = importKey(entry);
    const forbiddenClass = FORBIDDEN_IMPORT_CLASSES.find((klass) =>
      klass.test(entry.module, entry.name),
    );
    if (forbiddenClass) {
      forbidden.push({
        import: key,
        classId: forbiddenClass.id,
        reason: forbiddenClass.reason,
      });
      continue;
    }
    if (surface.wasiAny && entry.module === WASI_PREVIEW1_MODULE) continue;
    if (allowedExtra.has(key)) {
      capabilityImports.push(key);
      continue;
    }
    outsideSurface.push(key);
  }

  let verdict = "in-surface";
  if (forbidden.length > 0) verdict = "forbidden";
  else if (outsideSurface.length > 0) verdict = "outside-surface";

  return {
    verdict,
    surface: surface.id,
    imports: imports.map(importKey),
    importCount: imports.length,
    forbidden,
    outsideSurface,
    capabilityImports,
  };
}

/**
 * Summarize a classification in one line — used verbatim in gate reports so
 * the receipt names the defect class, not just "failed".
 */
export function describeClassification(classification) {
  switch (classification.verdict) {
    case "malformed":
      return `malformed wasm (${classification.error})`;
    case "forbidden": {
      const classes = [
        ...new Set(classification.forbidden.map((item) => item.classId)),
      ].join(", ");
      const sample = classification.forbidden
        .slice(0, 3)
        .map((item) => item.import)
        .join(", ");
      return `FORBIDDEN import class [${classes}] — ${classification.forbidden.length} import(s), e.g. ${sample}`;
    }
    case "outside-surface":
      return `imports outside declared surface "${classification.surface}": ${classification.outsideSurface.slice(0, 6).join(", ")}`;
    default:
      return classification.capabilityImports.length > 0
        ? `in-surface (WASI + declared capabilities: ${classification.capabilityImports.length})`
        : "in-surface (WASI only)";
  }
}
