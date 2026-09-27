// The FlatSQL host I/O contract, as the SDK's JavaScript hosts implement it.
//
// FlatSQL's engine reaches files only through seven `env.flatsql_io_*` imports
// (flatsql cpp/include/flatsql/flatsql_io.h). Every host satisfies the same
// seven names with the same signatures: the SDN node's C host module, the Go
// HostIO, the Node sync-fs provider (nodeSyncFsIo.js) and the browser I/O
// workers (opfsIoWorker.mjs behind sabIoChannel.js). This file holds the
// constants those hosts share, so the flag and status values are defined once.
//
// SIGNATURE LAW: i32 and f64 only. Offsets and sizes cross as f64.
// ERROR LAW: errors are negative return values, never throws. A throw out of an
// import is a trap, and a trap poisons the calling instance.
//
// The partition store (docs/architecture/flatsql-partition-store.md §5.4, A12,
// A38) adds three open flags and one status. They are flags, not imports, so the
// import set stays at seven.

/** Open flags. Values must stay identical to flatsql_io.h. */
export const FLATSQL_IO_READ = 0x0001;
export const FLATSQL_IO_WRITE = 0x0002;
export const FLATSQL_IO_CREATE = 0x0004;
export const FLATSQL_IO_EXCL = 0x0008;
export const FLATSQL_IO_TRUNC = 0x0010;
/** Advisory: the host drops the file when its last handle closes. */
export const FLATSQL_IO_DELETE_ON_CLOSE = 0x0020;
/** xAccess: returns 0 when the path exists, NOENT otherwise. No handle. */
export const FLATSQL_IO_PROBE = 0x0040;
/** xDelete: removes the path. No handle. */
export const FLATSQL_IO_UNLINK = 0x0080;
/**
 * mkdir -p the parent directories. Each created directory's parent is synced,
 * and the parent directory is synced when the file itself is newly created.
 * (OPFS directory durability is best effort; see §7 and 22.3a-4.)
 */
export const FLATSQL_IO_CREATE_PARENTS = 0x0100;
/** Unlink, but return BUSY while any handle on the path is open. */
export const FLATSQL_IO_UNLINK_IF_UNUSED = 0x0200;
/**
 * Return a handle before the open completes (A38). The first read or write on
 * the handle blocks only if the open is still pending, and fails with the
 * open's status if it failed. Hosts whose opens are synchronous (WasmEdge,
 * Node) treat the flag as a plain open.
 */
export const FLATSQL_IO_OPEN_DEFERRED = 0x0400;

/** Status codes. Every one is negative. */
export const FLATSQL_IO_OK = 0;
export const FLATSQL_IO_ERR_GENERIC = -1;
export const FLATSQL_IO_ERR_NOENT = -2;
export const FLATSQL_IO_ERR_ACCESS = -3;
export const FLATSQL_IO_ERR_IO = -4;
export const FLATSQL_IO_ERR_NOSPACE = -5;
export const FLATSQL_IO_ERR_BADHANDLE = -6;
/** A12: the path is in use (UNLINK_IF_UNUSED), or its lock is held elsewhere. */
export const FLATSQL_IO_ERR_BUSY = -7;

export const FLATSQL_IO_FLAGS = Object.freeze({
  READ: FLATSQL_IO_READ,
  WRITE: FLATSQL_IO_WRITE,
  CREATE: FLATSQL_IO_CREATE,
  EXCL: FLATSQL_IO_EXCL,
  TRUNC: FLATSQL_IO_TRUNC,
  DELETE_ON_CLOSE: FLATSQL_IO_DELETE_ON_CLOSE,
  PROBE: FLATSQL_IO_PROBE,
  UNLINK: FLATSQL_IO_UNLINK,
  CREATE_PARENTS: FLATSQL_IO_CREATE_PARENTS,
  UNLINK_IF_UNUSED: FLATSQL_IO_UNLINK_IF_UNUSED,
  OPEN_DEFERRED: FLATSQL_IO_OPEN_DEFERRED,
});

export const FLATSQL_IO_STATUS = Object.freeze({
  OK: FLATSQL_IO_OK,
  GENERIC: FLATSQL_IO_ERR_GENERIC,
  NOENT: FLATSQL_IO_ERR_NOENT,
  ACCESS: FLATSQL_IO_ERR_ACCESS,
  IO: FLATSQL_IO_ERR_IO,
  NOSPACE: FLATSQL_IO_ERR_NOSPACE,
  BADHANDLE: FLATSQL_IO_ERR_BADHANDLE,
  BUSY: FLATSQL_IO_ERR_BUSY,
});

/** The seven import names, module "env". */
export const FLATSQL_IO_IMPORT_MODULE = "env";
export const FLATSQL_IO_IMPORT_NAMES = Object.freeze([
  "flatsql_io_open",
  "flatsql_io_read",
  "flatsql_io_write",
  "flatsql_io_truncate",
  "flatsql_io_sync",
  "flatsql_io_size",
  "flatsql_io_close",
]);

/** Longest path any SDK host accepts, in UTF-8 bytes (the Go host's limit). */
export const FLATSQL_IO_MAX_PATH_BYTES = 4096;

/**
 * Map a thrown host error to a status. Covers DOMExceptions from OPFS
 * (22.3a-6: NotFound -> NOENT, NoModificationAllowed -> BUSY, QuotaExceeded ->
 * NOSPACE) and Node system errors.
 *
 * WebKit refuses a second sync access handle with InvalidStateError rather
 * than NoModificationAllowedError (measured, WebKit 26.6), so an
 * InvalidStateError raised while OPENING maps to BUSY; pass
 * `{ during: "open" }` for that case.
 */
export function flatsqlIoStatusForError(error, { during } = {}) {
  if (!error) {
    return FLATSQL_IO_ERR_GENERIC;
  }
  const code = typeof error.code === "string" ? error.code : null;
  if (code) {
    switch (code) {
      case "ENOENT":
      case "ENOTDIR":
        return FLATSQL_IO_ERR_NOENT;
      case "EACCES":
      case "EPERM":
      case "EROFS":
        return FLATSQL_IO_ERR_ACCESS;
      case "ENOSPC":
      case "EDQUOT":
        return FLATSQL_IO_ERR_NOSPACE;
      case "EBADF":
        return FLATSQL_IO_ERR_IO;
      case "EEXIST":
        // The Go host maps os.ErrExist to GENERIC; every SDK host matches it.
        return FLATSQL_IO_ERR_GENERIC;
      case "EBUSY":
      case "ETXTBSY":
        return FLATSQL_IO_ERR_BUSY;
      case "ENAMETOOLONG":
      case "EINVAL":
        return FLATSQL_IO_ERR_GENERIC;
      default:
        return FLATSQL_IO_ERR_IO;
    }
  }
  switch (error.name) {
    case "NotFoundError":
      return FLATSQL_IO_ERR_NOENT;
    case "NoModificationAllowedError":
      return FLATSQL_IO_ERR_BUSY;
    case "InvalidStateError":
      return during === "open" ? FLATSQL_IO_ERR_BUSY : FLATSQL_IO_ERR_BADHANDLE;
    case "QuotaExceededError":
      return FLATSQL_IO_ERR_NOSPACE;
    case "TypeMismatchError":
    case "SecurityError":
    case "NotAllowedError":
      return FLATSQL_IO_ERR_ACCESS;
    case "InvalidModificationError":
      return FLATSQL_IO_ERR_BUSY;
    case "TypeError":
    case "RangeError":
      return FLATSQL_IO_ERR_GENERIC;
    default:
      return FLATSQL_IO_ERR_IO;
  }
}

/** An Error carrying a flatsql_io status, thrown inside hosts and caught at the edge. */
export class FlatsqlIoStatusError extends Error {
  constructor(status, message) {
    super(message ?? `flatsql_io status ${status}`);
    this.name = "FlatsqlIoStatusError";
    this.status = status;
  }
}

/** Status for any error thrown inside a host, honouring FlatsqlIoStatusError. */
export function flatsqlIoStatusOf(error, options) {
  if (error && typeof error.status === "number" && error.status < 0) {
    return error.status;
  }
  return flatsqlIoStatusForError(error, options);
}

/**
 * Split a guest path into components below a host root. Paths are opaque
 * host-namespace strings to the engine; confinement is the host's job and it
 * fails closed: "", ".", ".." and NUL are refused with ACCESS (".." would
 * escape) or GENERIC (malformed). A leading "/" is ignored, so "/a/b" and "a/b"
 * name the same file below the root. Returns an array of components, or a
 * negative status.
 */
export function splitFlatsqlIoPath(path) {
  if (typeof path !== "string" || path.length === 0) {
    return FLATSQL_IO_ERR_GENERIC;
  }
  if (path.includes("\0")) {
    return FLATSQL_IO_ERR_GENERIC;
  }
  const components = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      return FLATSQL_IO_ERR_ACCESS;
    }
    components.push(part);
  }
  if (components.length === 0) {
    return FLATSQL_IO_ERR_GENERIC;
  }
  return components;
}

/** Decode path bytes that may live in a SharedArrayBuffer (copied first). */
const PATH_DECODER =
  typeof TextDecoder === "function" ? new TextDecoder("utf-8", { fatal: true }) : null;

export function decodeFlatsqlIoPath(bytes) {
  if (!PATH_DECODER) {
    return FLATSQL_IO_ERR_GENERIC;
  }
  if (bytes.length === 0 || bytes.length > FLATSQL_IO_MAX_PATH_BYTES) {
    return FLATSQL_IO_ERR_GENERIC;
  }
  // TextDecoder rejects views over a SharedArrayBuffer in some engines, and a
  // shared view can change under the decoder. Decode a private copy.
  const copy =
    bytes.buffer instanceof ArrayBuffer ? bytes : new Uint8Array(bytes);
  try {
    return PATH_DECODER.decode(copy);
  } catch {
    return FLATSQL_IO_ERR_GENERIC;
  }
}

/** Word-folded-free FNV-1a 32 over path bytes; used to shard paths across workers. */
export function hashFlatsqlIoPath(bytes) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
