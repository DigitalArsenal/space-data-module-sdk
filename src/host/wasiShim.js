/**
 * Browser-compatible WASI preview1 shim.
 *
 * Provides the wasi_snapshot_preview1 import namespace so that standalone
 * WASI modules (the same .wasm that runs in WasmEdge) can be instantiated
 * directly in the browser via WebAssembly.instantiate().
 *
 * Covers the preview1 imports observed across SDN plugin standalone builds:
 *   clock_time_get, fd_write, fd_read, fd_close, fd_seek, fd_fdstat_get,
 *   fd_fdstat_set_flags, fd_prestat_get, fd_prestat_dir_name, path_open,
 *   environ_sizes_get, environ_get, proc_exit, args_get, args_sizes_get,
 *   random_get
 *
 * No filesystem is exposed: prestat/path_open report no preopened
 * directories, so wasi-libc file APIs fail cleanly inside the guest.
 */

const ERRNO_SUCCESS = 0;
const ERRNO_BADF = 8;
const ERRNO_INVAL = 28;
const ERRNO_NOSYS = 52;
const ERRNO_SPIPE = 70;

const CLOCKID_REALTIME = 0;
const CLOCKID_MONOTONIC = 1;

const FILETYPE_CHARACTER_DEVICE = 2;

export class WasiExitError extends Error {
  constructor(code) {
    super(`WASI exit with code ${code}`);
    this.name = "WasiExitError";
    this.code = code;
  }
}

// One process owns its descriptors, even when libc executes main on a pthread.
// Offsets are atomically reserved so concurrent readers/writers never duplicate
// input or overwrite another thread's output. Overflow is an explicit WASI error.
export function createSharedWasiProcess({ args = [], env = {}, stdinBytes = [], maxOutputBytes = 16 * 1024 * 1024 } = {}) {
  const bytes = new Uint8Array(stdinBytes);
  const input = new Uint8Array(new SharedArrayBuffer(bytes.length));
  input.set(bytes);
  return {
    args, env, input,
    control: new Int32Array(new SharedArrayBuffer(5 * 4)),
    stdout: new Uint8Array(new SharedArrayBuffer(maxOutputBytes)),
    stderr: new Uint8Array(new SharedArrayBuffer(maxOutputBytes)),
  };
}

function reserve(control, index, length, capacity) {
  for (;;) {
    const offset = Atomics.load(control, index);
    if (length > capacity - offset) return -1;
    if (Atomics.compareExchange(control, index, offset, offset + length) === offset) return offset;
  }
}

export function createBrowserWasiShim(options = {}) {
  const shared = options.processState;
  const args = shared?.args ?? options.args ?? [];
  const env = shared?.env ?? options.env ?? {};
  const stdinBytes = shared?.input ?? new Uint8Array(options.stdinBytes ?? []);
  const logOutput = options.logOutput === true;
  const performanceApi = options.performance ?? globalThis.performance ?? {
    now: () => Date.now(),
    timeOrigin: 0,
  };
  const cryptoApi = options.crypto ?? globalThis.crypto ?? null;
  const stdoutChunks = [];
  const stderrChunks = [];
  let stdinOffset = 0;

  let memory = null;

  function setMemory(mem) {
    memory = mem;
  }

  function getMemory() {
    return memory;
  }

  function mem8() {
    return new Uint8Array(memory.buffer);
  }
  function view() {
    return new DataView(memory.buffer);
  }

  // --- Environment encoding helpers ---

  const envEntries = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  const encodedEnvEntries = envEntries.map((e) => new TextEncoder().encode(e));
  const encodedArgs = args.map((a) => new TextEncoder().encode(a));

  // --- WASI functions ---

  function clock_time_get(clockId, _precisionBigInt, resultPtr) {
    let nanos;
    if (clockId === CLOCKID_REALTIME) {
      nanos = BigInt(
        Math.round((performanceApi.timeOrigin + performanceApi.now()) * 1e6),
      );
    } else if (clockId === CLOCKID_MONOTONIC) {
      nanos = BigInt(Math.round(performanceApi.now() * 1e6));
    } else {
      return ERRNO_INVAL;
    }
    view().setBigUint64(resultPtr, nanos, true);
    return ERRNO_SUCCESS;
  }

  function fd_write(fd, iovsPtr, iovsLen, nwrittenPtr) {
    if (fd !== 1 && fd !== 2) return ERRNO_BADF;

    const target = fd === 1 ? stdoutChunks : stderrChunks;
    let totalWritten = 0;
    const dv = view();
    const bytes = mem8();

    for (let i = 0; i < iovsLen; i++) {
      const base = iovsPtr + i * 8;
      const ptr = dv.getUint32(base, true);
      const len = dv.getUint32(base + 4, true);
      if (shared) {
        const output = fd === 1 ? shared.stdout : shared.stderr;
        const offset = reserve(shared.control, fd, len, output.length);
        if (offset < 0) return 51; // NOSPC: never silently truncate command output.
        output.set(bytes.subarray(ptr, ptr + len), offset);
      } else {
        target.push(bytes.slice(ptr, ptr + len));
      }
      totalWritten += len;
    }

    dv.setUint32(nwrittenPtr, totalWritten, true);
    return ERRNO_SUCCESS;
  }

  function fd_read(fd, iovsPtr, iovsLen, nreadPtr) {
    if (fd !== 0) {
      view().setUint32(nreadPtr, 0, true);
      return ERRNO_BADF;
    }

    const dv = view();
    const bytes = mem8();
    let totalRead = 0;

    for (let i = 0; i < iovsLen; i += 1) {
      const base = iovsPtr + i * 8;
      const ptr = dv.getUint32(base, true);
      const len = dv.getUint32(base + 4, true);
      let offset, count;
      if (shared) {
        do {
          offset = Atomics.load(shared.control, 0);
          count = Math.min(len, stdinBytes.length - offset);
        } while (Atomics.compareExchange(shared.control, 0, offset, offset + count) !== offset);
      } else {
        offset = stdinOffset;
        count = Math.min(len, stdinBytes.length - offset);
        stdinOffset += count;
      }
      if (count === 0) {
        if (offset >= stdinBytes.length) break;
        continue; // An empty iovec does not mean end of file.
      }
      bytes.set(stdinBytes.subarray(offset, offset + count), ptr);
      totalRead += count;
    }

    dv.setUint32(nreadPtr, totalRead, true);
    return ERRNO_SUCCESS;
  }

  function fd_close(fd) {
    if (fd <= 2) return ERRNO_SUCCESS;
    return ERRNO_BADF;
  }

  function fd_seek(fd, _offsetLo, _whence, _resultPtr) {
    if (fd <= 2) return ERRNO_SPIPE;
    return ERRNO_BADF;
  }

  function fd_fdstat_get(fd, bufPtr) {
    if (fd > 2) return ERRNO_BADF;
    const dv = view();
    // filetype (u8) at offset 0 — CHARACTER_DEVICE
    dv.setUint8(bufPtr, FILETYPE_CHARACTER_DEVICE);
    // fdflags (u16) at offset 2
    dv.setUint16(bufPtr + 2, 0, true);
    // rights_base (u64) at offset 8
    dv.setBigUint64(bufPtr + 8, 0n, true);
    // rights_inheriting (u64) at offset 16
    dv.setBigUint64(bufPtr + 16, 0n, true);
    return ERRNO_SUCCESS;
  }

  function fd_fdstat_set_flags(fd, _flags) {
    if (fd <= 2) return ERRNO_SUCCESS;
    return ERRNO_BADF;
  }

  // This browser shim exposes no ambient preopened directories. Toolchains
  // commonly probe these preview1 calls during startup; returning BADF is
  // the fail-closed WASI result and lets the guest continue without filesystem
  // authority.
  function fd_prestat_get(_fd, _bufPtr) {
    return ERRNO_BADF;
  }

  function fd_prestat_dir_name(_fd, _pathPtr, _pathLen) {
    return ERRNO_BADF;
  }

  function path_open() {
    return ERRNO_BADF;
  }


  function environ_sizes_get(countPtr, bufSizePtr) {
    const dv = view();
    dv.setUint32(countPtr, encodedEnvEntries.length, true);
    let totalSize = 0;
    for (const entry of encodedEnvEntries) {
      totalSize += entry.length + 1; // null terminator
    }
    dv.setUint32(bufSizePtr, totalSize, true);
    return ERRNO_SUCCESS;
  }

  function environ_get(environPtr, environBufPtr) {
    const dv = view();
    const bytes = mem8();
    let bufOffset = environBufPtr;

    for (let i = 0; i < encodedEnvEntries.length; i++) {
      dv.setUint32(environPtr + i * 4, bufOffset, true);
      bytes.set(encodedEnvEntries[i], bufOffset);
      bufOffset += encodedEnvEntries[i].length;
      bytes[bufOffset] = 0; // null terminator
      bufOffset += 1;
    }
    return ERRNO_SUCCESS;
  }

  function args_sizes_get(argcPtr, argvBufSizePtr) {
    const dv = view();
    dv.setUint32(argcPtr, encodedArgs.length, true);
    let totalSize = 0;
    for (const arg of encodedArgs) {
      totalSize += arg.length + 1;
    }
    dv.setUint32(argvBufSizePtr, totalSize, true);
    return ERRNO_SUCCESS;
  }

  function args_get(argvPtr, argvBufPtr) {
    const dv = view();
    const bytes = mem8();
    let bufOffset = argvBufPtr;

    for (let i = 0; i < encodedArgs.length; i++) {
      dv.setUint32(argvPtr + i * 4, bufOffset, true);
      bytes.set(encodedArgs[i], bufOffset);
      bufOffset += encodedArgs[i].length;
      bytes[bufOffset] = 0;
      bufOffset += 1;
    }
    return ERRNO_SUCCESS;
  }

  function random_get(bufPtr, bufLen) {
    if (!cryptoApi?.getRandomValues) {
      return ERRNO_NOSYS;
    }
    cryptoApi.getRandomValues(mem8().subarray(bufPtr, bufPtr + bufLen));
    return ERRNO_SUCCESS;
  }

  function proc_exit(code) {
    if (shared) {
      Atomics.store(shared.control, 4, code);
      Atomics.store(shared.control, 3, 1);
    }
    if (logOutput) {
      flushOutput();
    }
    throw new WasiExitError(code);
  }

  // wasm32-wasip1-threads (isomorphic-pthreads) modules import sched_yield —
  // pthread spin/backoff loops call it. A cooperative no-op (yield to the
  // engine) is the correct browser/Node semantics: real preemption is the
  // host's job. Present on every shim so a threaded artifact instantiates
  // (a missing import would fail instantiation for the whole module).
  function sched_yield() {
    return ERRNO_SUCCESS;
  }

  // --- Output helpers ---

  function flushOutput() {
    if (stdoutChunks.length > 0) {
      const combined = concatChunks(stdoutChunks);
      if (logOutput) {
        const text = new TextDecoder().decode(combined);
        if (text) console.log(text);
      }
      stdoutChunks.length = 0;
    }
    if (stderrChunks.length > 0) {
      const combined = concatChunks(stderrChunks);
      if (logOutput) {
        const text = new TextDecoder().decode(combined);
        if (text) console.warn(text);
      }
      stderrChunks.length = 0;
    }
  }

  function concatChunks(chunks) {
    let totalLen = 0;
    for (const chunk of chunks) totalLen += chunk.length;
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  return {
    imports: {
      wasi_snapshot_preview1: {
        clock_time_get,
        fd_write,
        fd_read,
        fd_close,
        fd_seek,
        fd_fdstat_get,
        fd_fdstat_set_flags,
        fd_prestat_get,
        fd_prestat_dir_name,
        path_open,
        environ_sizes_get,
        environ_get,
        args_sizes_get,
        args_get,
        random_get,
        proc_exit,
        sched_yield,
      },
    },
    setMemory,
    getMemory,
    flushOutput,
    get stdout() {
      return shared ? shared.stdout.slice(0, Atomics.load(shared.control, 1)) : concatChunks(stdoutChunks);
    },
    get stderr() {
      return shared ? shared.stderr.slice(0, Atomics.load(shared.control, 2)) : concatChunks(stderrChunks);
    },
  };
}
