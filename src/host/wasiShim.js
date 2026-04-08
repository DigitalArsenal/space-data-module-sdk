/**
 * Browser-compatible WASI preview1 shim.
 *
 * Provides the wasi_snapshot_preview1 import namespace so that standalone
 * WASI modules (the same .wasm that runs in WasmEdge) can be instantiated
 * directly in the browser via WebAssembly.instantiate().
 *
 * Covers the 11 imports observed across all SDN plugin standalone builds:
 *   clock_time_get, fd_write, fd_read, fd_close, fd_seek, fd_fdstat_get,
 *   environ_sizes_get, environ_get, proc_exit, args_get, args_sizes_get
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

export function createBrowserWasiShim(options = {}) {
  const args = options.args ?? [];
  const env = options.env ?? {};
  const stdoutChunks = [];
  const stderrChunks = [];

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
      nanos = BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6));
    } else if (clockId === CLOCKID_MONOTONIC) {
      nanos = BigInt(Math.round(performance.now() * 1e6));
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
      target.push(bytes.slice(ptr, ptr + len));
      totalWritten += len;
    }

    dv.setUint32(nwrittenPtr, totalWritten, true);
    return ERRNO_SUCCESS;
  }

  function fd_read(_fd, _iovsPtr, _iovsLen, nreadPtr) {
    view().setUint32(nreadPtr, 0, true);
    return ERRNO_BADF;
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

  function proc_exit(code) {
    // Flush stdout/stderr to console before exiting
    flushOutput();
    throw new WasiExitError(code);
  }

  // --- Output helpers ---

  function flushOutput() {
    if (stdoutChunks.length > 0) {
      const combined = concatChunks(stdoutChunks);
      const text = new TextDecoder().decode(combined);
      if (text) console.log(text);
      stdoutChunks.length = 0;
    }
    if (stderrChunks.length > 0) {
      const combined = concatChunks(stderrChunks);
      const text = new TextDecoder().decode(combined);
      if (text) console.warn(text);
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
        environ_sizes_get,
        environ_get,
        args_sizes_get,
        args_get,
        proc_exit,
      },
    },
    setMemory,
    getMemory,
    flushOutput,
    get stdout() {
      return concatChunks(stdoutChunks);
    },
    get stderr() {
      return concatChunks(stderrChunks);
    },
  };
}
