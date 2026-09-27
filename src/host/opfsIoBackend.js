// OPFS backend for the FlatSQL I/O server (docs/architecture/flatsql-partition-store.md
// §5.5, A7, A13, 22.3a-6).
//
// Every open is async by construction (getDirectoryHandle, getFileHandle,
// createSyncAccessHandle), and runs inside the I/O worker, which awaits it
// without blocking any other guest thread. The files it returns ARE
// FileSystemSyncAccessHandles, whose read/write/truncate/flush/getSize are
// synchronous and serve the guest's blocking imports directly.
//
// Handle modes (A7). A sync access handle is exclusive per file by default. A
// reader I/O worker can only read a file the writer I/O worker holds when both
// open it in "readwrite-unsafe" mode. Chromium supports the mode; Firefox 155
// and WebKit 26.6 ignore it (measured: the second handle fails). The owner
// ruled (§22.4-6) that a browser without shared handle modes gets no local
// store; `probeOpfsSharedHandleModes` is the gate's measurement.
//
// Directory durability on OPFS is best effort (22.3a-4); CREATE_PARENTS
// creates the directories and cannot fsync them.

import {
  FLATSQL_IO_CREATE,
  FLATSQL_IO_CREATE_PARENTS,
  FLATSQL_IO_ERR_GENERIC,
  FLATSQL_IO_EXCL,
  FLATSQL_IO_TRUNC,
  FlatsqlIoStatusError,
} from "./flatsqlIoContract.js";

export const OPFS_SHARED_HANDLE_MODE = "readwrite-unsafe";

function notFound(message) {
  const error = new Error(message);
  error.name = "NotFoundError";
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Does this context support shared sync access handles? Opens two
 * "readwrite-unsafe" handles on one probe file; both must succeed and report
 * the mode. Resolves to { supported, detail }.
 */
export async function probeOpfsSharedHandleModes(root, name = ".sdm-mode-probe") {
  let first = null;
  let second = null;
  try {
    const file = await root.getFileHandle(name, { create: true });
    first = await file.createSyncAccessHandle({ mode: OPFS_SHARED_HANDLE_MODE });
    if (first.mode !== OPFS_SHARED_HANDLE_MODE) {
      return { supported: false, detail: "mode option ignored" };
    }
    second = await file.createSyncAccessHandle({ mode: OPFS_SHARED_HANDLE_MODE });
    return { supported: true, detail: "two readwrite-unsafe handles" };
  } catch (error) {
    return { supported: false, detail: `${error?.name ?? "Error"}: ${error?.message ?? error}` };
  } finally {
    try {
      second?.close();
    } catch {
      // ignore
    }
    try {
      first?.close();
    } catch {
      // ignore
    }
    try {
      await root.removeEntry(name);
    } catch {
      // ignore
    }
  }
}

/**
 * Does this context's sync access handle accept views over a
 * SharedArrayBuffer (direct shared-memory transfer)? Resolves to a boolean.
 */
export async function probeOpfsSharedViews(root, name = ".sdm-view-probe") {
  let handle = null;
  try {
    const file = await root.getFileHandle(name, { create: true });
    handle = await file.createSyncAccessHandle();
    const shared = new Uint8Array(new SharedArrayBuffer(16));
    shared.fill(0x5a);
    const written = handle.write(shared, { at: 0 });
    const back = new Uint8Array(new SharedArrayBuffer(16));
    const read = handle.read(back, { at: 0 });
    return written === 16 && read === 16 && back[15] === 0x5a;
  } catch {
    return false;
  } finally {
    try {
      handle?.close();
    } catch {
      // ignore
    }
    try {
      await root.removeEntry(name);
    } catch {
      // ignore
    }
  }
}

/**
 * Create the OPFS backend.
 *
 * @param {object} [options]
 * @param {string} [options.rootDirectory] a directory below the origin's OPFS
 *   root that every path is confined to (created on init).
 * @param {"auto"|"shared"|"exclusive"} [options.handleMode="auto"] "shared"
 *   opens every handle "readwrite-unsafe" (requires support), "exclusive"
 *   uses the default exclusive handles, "auto" picks shared when supported.
 * @param {(path: string) => number} [options.openDelayMs] test hook: delay an
 *   open by this many milliseconds (acceptance: an open that resolves after
 *   500 ms blocks only its caller).
 * @param {FileSystemDirectoryHandle} [options.root] use this directory as the
 *   root instead of navigator.storage.getDirectory().
 * @param {{ attempts: number, baseMs?: number }} [options.busyRetry] retry a
 *   sync-handle creation refused because another context still holds the file
 *   (A37 leader takeover), with exponential backoff. Default: no retry.
 */
export function createOpfsIoBackend(options = {}) {
  let root = options.root ?? null;
  let sharedModes = false;
  let sharedViews = null;
  const handleMode = options.handleMode ?? "auto";
  const openDelayMs = typeof options.openDelayMs === "function" ? options.openDelayMs : null;
  const directoryCache = new Map();
  // A37: a new leader retries NoModificationAllowedError (WebKit:
  // InvalidStateError) with backoff while the previous leader's handles close.
  const busyRetry = {
    attempts: Math.max(0, options.busyRetry?.attempts ?? 0),
    baseMs: Math.max(1, options.busyRetry?.baseMs ?? 10),
  };

  async function createAccessHandle(fileHandle) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return sharedModes
          ? await fileHandle.createSyncAccessHandle({ mode: OPFS_SHARED_HANDLE_MODE })
          : await fileHandle.createSyncAccessHandle();
      } catch (error) {
        const busy =
          error?.name === "NoModificationAllowedError" || error?.name === "InvalidStateError";
        if (!busy || attempt >= busyRetry.attempts) throw error;
        await sleep(busyRetry.baseMs * 2 ** Math.min(attempt, 8));
      }
    }
  }

  async function init() {
    if (!root) {
      if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
        throw new FlatsqlIoStatusError(FLATSQL_IO_ERR_GENERIC, "OPFS is unavailable here");
      }
      root = await navigator.storage.getDirectory();
      if (options.rootDirectory) {
        for (const part of String(options.rootDirectory).split("/").filter(Boolean)) {
          root = await root.getDirectoryHandle(part, { create: true });
        }
      }
    }
    const probe = await probeOpfsSharedHandleModes(root);
    sharedViews = await probeOpfsSharedViews(root);
    if (handleMode === "shared" && !probe.supported) {
      throw new FlatsqlIoStatusError(
        FLATSQL_IO_ERR_GENERIC,
        `shared OPFS handle modes are unsupported here (${probe.detail})`,
      );
    }
    sharedModes = handleMode !== "exclusive" && probe.supported;
    directoryCache.set("", root);
    return { sharedModes, sharedModesDetail: probe.detail, sharedViews };
  }

  async function directoryFor(components, create) {
    const key = components.join("/");
    const cached = directoryCache.get(key);
    if (cached) return cached;
    let dir = root;
    let prefix = "";
    for (const part of components) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const known = directoryCache.get(prefix);
      if (known) {
        dir = known;
        continue;
      }
      dir = await dir.getDirectoryHandle(part, { create });
      directoryCache.set(prefix, dir);
    }
    return dir;
  }

  async function fileHandleIfExists(dir, name) {
    try {
      return await dir.getFileHandle(name);
    } catch (error) {
      if (error?.name === "NotFoundError") return null;
      throw error;
    }
  }

  return {
    kind: "opfs",
    init,
    get sharedModes() {
      return sharedModes;
    },
    get sharedViews() {
      return sharedViews;
    },
    async openFile(path, components, flags) {
      if (!root) await init();
      if (openDelayMs) {
        const delay = openDelayMs(path);
        if (delay > 0) await sleep(delay);
      }
      const create = (flags & FLATSQL_IO_CREATE) !== 0;
      const parents = create && (flags & FLATSQL_IO_CREATE_PARENTS) !== 0;
      const dir = await directoryFor(components.slice(0, -1), parents);
      const name = components[components.length - 1];
      let fileHandle = null;
      if (flags & FLATSQL_IO_EXCL) {
        if (await fileHandleIfExists(dir, name)) {
          throw new FlatsqlIoStatusError(FLATSQL_IO_ERR_GENERIC, `${path} exists`);
        }
      }
      fileHandle = await dir.getFileHandle(name, { create });
      const access = await createAccessHandle(fileHandle);
      if (flags & FLATSQL_IO_TRUNC) {
        access.truncate(0);
      }
      return access;
    },
    async exists(path, components) {
      if (!root) await init();
      let dir;
      try {
        dir = await directoryFor(components.slice(0, -1), false);
      } catch (error) {
        if (error?.name === "NotFoundError" || error?.name === "TypeMismatchError") return false;
        throw error;
      }
      const name = components[components.length - 1];
      if (await fileHandleIfExists(dir, name)) return true;
      try {
        await dir.getDirectoryHandle(name);
        return true;
      } catch {
        return false;
      }
    },
    async remove(path, components) {
      if (!root) await init();
      let dir;
      try {
        dir = await directoryFor(components.slice(0, -1), false);
      } catch (error) {
        if (error?.name === "TypeMismatchError") throw notFound(path);
        throw error;
      }
      await dir.removeEntry(components[components.length - 1]);
    },
    /** Remove everything below the root (tests, and a store wipe). */
    async clear() {
      if (!root) await init();
      for await (const name of root.keys()) {
        await root.removeEntry(name, { recursive: true });
      }
      directoryCache.clear();
      directoryCache.set("", root);
    },
  };
}
