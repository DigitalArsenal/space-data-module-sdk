// The seven `env.flatsql_io_*` imports, built over a synchronous I/O provider.
//
// This is the guest-facing edge of every SDK FlatSQL host: the SAB I/O channel
// client (browser pool workers and the engine worker, sabIoChannel.js) and the
// Node sync-fs provider (nodeSyncFsIo.js) both plug in here. The wasm-side
// contract is flatsql cpp/include/flatsql/flatsql_io.h: i32/f64 only, errors as
// negative returns, never a throw (a throw out of an import is a trap, and a
// trap poisons the instance).
//
// A provider has the synchronous methods
//   open(pathBytes: Uint8Array, flags) -> handle | status
//   read(handle, ptr, len, offset)     -> bytes  | status   (ptr in the guest memory)
//   write(handle, ptr, len, offset)    -> bytes  | status
//   truncate(handle, size) / sync(handle) / close(handle) -> status
//   size(handle)                       -> f64    | status
//
// Several providers (sharded reader I/O workers, A7) are routed by a hash of the
// path at open; the provider index rides in bits 24..30 of the returned handle.
//
// Built-in `extraImports` descriptors (structured-cloneable, so they reach pool
// workers, including the blob-bundled ones of A39):
//   { provider: "flatsql-io", instanceId, channels: [SharedArrayBuffer, ...],
//     mirror?: { buffer, suffixes }, trace?: { buffer } }

import {
  FLATSQL_IO_ERR_BADHANDLE,
  FLATSQL_IO_ERR_GENERIC,
  FLATSQL_IO_ERR_IO,
  FLATSQL_IO_MAX_PATH_BYTES,
  hashFlatsqlIoPath,
} from "./flatsqlIoContract.js";
import { createSabIoClient } from "./sabIoChannel.js";
import {
  createSabIoMirrorMatcher,
  findSabIoMirrorEntry,
  readSabIoMirrorEntry,
} from "./sabIoMirror.js";

export const FLATSQL_IO_PROVIDER_DESCRIPTOR = "flatsql-io";

/** Trace op codes recorded per import call. */
export const FLATSQL_IO_TRACE_OPS = Object.freeze({
  open: 1,
  read: 2,
  write: 3,
  truncate: 4,
  sync: 5,
  size: 6,
  close: 7,
  mirrorRead: 8,
});

const ROUTE_SHIFT = 24;
const LOCAL_HANDLE_MASK = 0xffffff;

function nowMicros() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now() * 1000
    : Date.now() * 1000;
}

/**
 * A shared latency trace: every import call appends (op, microseconds) when a
 * trace is configured. Diagnostic; the browser acceptance suite reads it to
 * compute guest-observed I/O percentiles.
 */
export function createFlatsqlIoTraceBuffer(capacity = 65536) {
  const buffer = new SharedArrayBuffer(16 + capacity * 8 + capacity);
  const header = new Int32Array(buffer, 0, 4);
  header[1] = capacity;
  return buffer;
}

export function readFlatsqlIoTrace(buffer) {
  const header = new Int32Array(buffer, 0, 4);
  const capacity = header[1];
  const count = Math.min(Atomics.load(header, 0), capacity);
  const micros = new Float64Array(buffer, 16, capacity);
  const ops = new Uint8Array(buffer, 16 + capacity * 8, capacity);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push({ op: ops[i], micros: micros[i] });
  }
  return { recorded: Atomics.load(header, 0), capacity, samples: out };
}

function createTracer(trace) {
  if (!trace?.buffer) return null;
  const header = new Int32Array(trace.buffer, 0, 4);
  const capacity = header[1];
  const micros = new Float64Array(trace.buffer, 16, capacity);
  const ops = new Uint8Array(trace.buffer, 16 + capacity * 8, capacity);
  return (op, started) => {
    const index = Atomics.add(header, 0, 1);
    if (index < capacity) {
      micros[index] = nowMicros() - started;
      ops[index] = op;
    }
  };
}

function copyPath(memory, ptr, len) {
  if (!memory || len <= 0 || len > FLATSQL_IO_MAX_PATH_BYTES || ptr < 0) return null;
  const buffer = memory.buffer ?? memory;
  if (ptr + len > buffer.byteLength) return null;
  // slice() copies out of the (possibly shared) memory before anyone decodes.
  return new Uint8Array(buffer, ptr, len).slice();
}

/**
 * Build the import object fragment `{ env: { flatsql_io_* } }`.
 *
 * @param {object} options
 * @param {() => WebAssembly.Memory} options.getMemory the instance's memory.
 *   Re-read on every call: a grown memory has a new buffer.
 * @param {object|object[]} options.provider one provider, or an array routed
 *   by path hash.
 * @param {{ buffer: SharedArrayBuffer, suffixes?: string[] }} [options.mirror]
 *   serve reads of matching paths (heads) from the SAB mirror (A7).
 * @param {{ buffer: SharedArrayBuffer }} [options.trace] latency trace.
 */
export function createFlatsqlIoImports(options = {}) {
  const getMemory = options.getMemory;
  if (typeof getMemory !== "function") {
    throw new TypeError("createFlatsqlIoImports requires getMemory().");
  }
  const providers = Array.isArray(options.provider) ? options.provider : [options.provider];
  if (providers.length === 0 || providers.some((p) => !p || typeof p.open !== "function")) {
    throw new TypeError("createFlatsqlIoImports requires at least one provider.");
  }
  if (providers.length > 127) {
    throw new RangeError("At most 127 providers can be routed.");
  }
  const routed = providers.length > 1;
  const trace = createTracer(options.trace);
  const mirrorBuffer = options.mirror?.buffer ?? null;
  const mirrorMatch = mirrorBuffer
    ? createSabIoMirrorMatcher(options.mirror.suffixes ?? ["/h.fsh"])
    : null;
  const mirroredHandles = new Map();
  const decoder = new TextDecoder();

  function route(handle) {
    if (!routed) return { provider: providers[0], local: handle };
    const index = handle >>> ROUTE_SHIFT;
    const provider = providers[index];
    return provider ? { provider, local: handle & LOCAL_HANDLE_MASK } : null;
  }

  function guard(op, fallback, fn) {
    const started = trace ? nowMicros() : 0;
    let result;
    try {
      result = fn();
    } catch {
      result = fallback;
    }
    if (trace) trace(op, started);
    return result;
  }

  const env = {
    flatsql_io_open(pathPtr, pathLen, flags) {
      return guard(FLATSQL_IO_TRACE_OPS.open, FLATSQL_IO_ERR_GENERIC, () => {
        const bytes = copyPath(getMemory(), pathPtr, pathLen);
        if (!bytes) return FLATSQL_IO_ERR_GENERIC;
        const index = routed ? hashFlatsqlIoPath(bytes) % providers.length : 0;
        const handle = providers[index].open(bytes, flags | 0);
        if (handle < 0) return handle;
        if (routed && handle > LOCAL_HANDLE_MASK) return FLATSQL_IO_ERR_IO;
        const exposed = routed ? (index << ROUTE_SHIFT) | handle : handle;
        if (mirrorMatch) {
          const path = decoder.decode(bytes);
          if (mirrorMatch(path)) mirroredHandles.set(exposed, path);
        }
        return exposed;
      });
    },
    flatsql_io_read(handle, dstPtr, len, offset) {
      if (mirrorBuffer && mirroredHandles.has(handle)) {
        const started = trace ? nowMicros() : 0;
        try {
          const memory = getMemory();
          const buffer = memory.buffer ?? memory;
          if (dstPtr >= 0 && len >= 0 && dstPtr + len <= buffer.byteLength) {
            const index = findSabIoMirrorEntry(mirrorBuffer, mirroredHandles.get(handle));
            if (index >= 0) {
              const n = readSabIoMirrorEntry(
                mirrorBuffer,
                index,
                new Uint8Array(buffer, dstPtr, len),
                offset,
              );
              if (n >= 0) {
                if (trace) trace(FLATSQL_IO_TRACE_OPS.mirrorRead, started);
                return n;
              }
            }
          }
        } catch {
          // fall through to the file
        }
      }
      return guard(FLATSQL_IO_TRACE_OPS.read, FLATSQL_IO_ERR_IO, () => {
        const target = route(handle);
        if (!target) return FLATSQL_IO_ERR_BADHANDLE;
        return target.provider.read(target.local, dstPtr, len, offset);
      });
    },
    flatsql_io_write(handle, srcPtr, len, offset) {
      return guard(FLATSQL_IO_TRACE_OPS.write, FLATSQL_IO_ERR_IO, () => {
        const target = route(handle);
        if (!target) return FLATSQL_IO_ERR_BADHANDLE;
        return target.provider.write(target.local, srcPtr, len, offset);
      });
    },
    flatsql_io_truncate(handle, size) {
      return guard(FLATSQL_IO_TRACE_OPS.truncate, FLATSQL_IO_ERR_IO, () => {
        const target = route(handle);
        if (!target) return FLATSQL_IO_ERR_BADHANDLE;
        return target.provider.truncate(target.local, size);
      });
    },
    flatsql_io_sync(handle) {
      return guard(FLATSQL_IO_TRACE_OPS.sync, FLATSQL_IO_ERR_IO, () => {
        const target = route(handle);
        if (!target) return FLATSQL_IO_ERR_BADHANDLE;
        return target.provider.sync(target.local);
      });
    },
    flatsql_io_size(handle) {
      return guard(FLATSQL_IO_TRACE_OPS.size, FLATSQL_IO_ERR_IO, () => {
        const target = route(handle);
        if (!target) return FLATSQL_IO_ERR_BADHANDLE;
        return target.provider.size(target.local);
      });
    },
    flatsql_io_close(handle) {
      return guard(FLATSQL_IO_TRACE_OPS.close, FLATSQL_IO_ERR_IO, () => {
        mirroredHandles.delete(handle);
        const target = route(handle);
        if (!target) return FLATSQL_IO_ERR_BADHANDLE;
        return target.provider.close(target.local);
      });
    },
  };
  return { env };
}

/**
 * Resolve a built-in `{ provider: "flatsql-io" }` descriptor into imports for
 * one thread: one blocking channel client (its own slot) per channel.
 *
 * @returns {{ imports: object, close: () => void }}
 */
export function resolveFlatsqlIoDescriptor(descriptor, { getMemory }) {
  const channels = Array.isArray(descriptor.channels)
    ? descriptor.channels
    : [descriptor.channel ?? descriptor.buffer];
  if (channels.length === 0 || channels.some((c) => !(c instanceof SharedArrayBuffer))) {
    throw new TypeError("A flatsql-io descriptor needs channels: SharedArrayBuffer[].");
  }
  const clients = channels.map((buffer) =>
    createSabIoClient({ buffer, instanceId: descriptor.instanceId, getMemory }),
  );
  const imports = createFlatsqlIoImports({
    getMemory,
    provider: clients,
    mirror: descriptor.mirror,
    trace: descriptor.trace,
  });
  return {
    imports,
    close() {
      for (const client of clients) client.release();
    },
  };
}

/**
 * Resolve `extraImports` entries for one thread. Each entry is a function
 * `(ctx) => importObject | { imports, close }`, or a built-in descriptor.
 * Returns the merged import fragments and a close() for their resources.
 *
 * @param {Array<Function|object>} extraImports
 * @param {{ memory: WebAssembly.Memory, getMemory: Function, tid?: number }} ctx
 */
export function resolveExtraImports(extraImports, ctx) {
  const fragments = [];
  const closers = [];
  for (const entry of extraImports ?? []) {
    let resolved;
    if (typeof entry === "function") {
      resolved = entry(ctx);
    } else if (entry && entry.provider === FLATSQL_IO_PROVIDER_DESCRIPTOR) {
      resolved = resolveFlatsqlIoDescriptor(entry, ctx);
    } else if (entry && typeof entry.factory === "function") {
      resolved = entry.factory({ ...ctx, config: entry.config });
    } else {
      throw new TypeError(
        `Unresolvable extraImports entry ${JSON.stringify(entry?.provider ?? entry?.moduleUrl ?? typeof entry)}; ` +
          "pass a factory function, a { provider: \"flatsql-io\" } descriptor, or (module workers) " +
          "a { moduleUrl } descriptor.",
      );
    }
    if (resolved && resolved.imports && typeof resolved.close === "function") {
      fragments.push(resolved.imports);
      closers.push(resolved.close);
    } else if (resolved) {
      fragments.push(resolved);
    }
  }
  return {
    fragments,
    close() {
      for (const close of closers) {
        try {
          close();
        } catch {
          // best effort
        }
      }
    },
  };
}

/** Merge import fragments into `imports`, module by module. */
export function mergeImportFragments(imports, fragments) {
  for (const fragment of fragments) {
    for (const [moduleName, values] of Object.entries(fragment ?? {})) {
      imports[moduleName] = { ...(imports[moduleName] ?? {}), ...values };
    }
  }
  return imports;
}
