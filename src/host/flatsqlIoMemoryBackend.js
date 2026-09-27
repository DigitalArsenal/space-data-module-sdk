// In-memory backend for the FlatSQL I/O server: the dashboard window store
// (docs/architecture/flatsql-partition-store.md §5.5 "Window store", 22.3a-8).
//
// The dashboard's ephemeral window store runs the same artifact over this
// backend inside its I/O worker. It writes nothing to OPFS and is dropped on
// every UI-state change; there is never a full local mirror. It is also the
// backend the Node channel tests serve.
//
// Files follow FileSystemSyncAccessHandle's synchronous shape (read/write with
// {at}, truncate, flush, getSize, close), so the server treats this backend and
// OPFS identically. Directories are explicit: creating a file under a missing
// directory is NOENT unless CREATE_PARENTS is set, as on every other host.

import {
  FLATSQL_IO_CREATE,
  FLATSQL_IO_CREATE_PARENTS,
  FLATSQL_IO_ERR_ACCESS,
  FLATSQL_IO_ERR_GENERIC,
  FLATSQL_IO_ERR_NOENT,
  FLATSQL_IO_ERR_NOSPACE,
  FLATSQL_IO_EXCL,
  FLATSQL_IO_TRUNC,
  FlatsqlIoStatusError,
} from "./flatsqlIoContract.js";

class MemoryFile {
  constructor() {
    this.bytes = new Uint8Array(0);
    this.length = 0;
  }

  ensureCapacity(size, budget) {
    if (size <= this.bytes.length) return;
    let capacity = Math.max(64, this.bytes.length);
    while (capacity < size) capacity *= 2;
    budget.reserve(capacity - this.bytes.length);
    const next = new Uint8Array(capacity);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
  }
}

/**
 * @param {object} [options]
 * @param {number} [options.maxBytes=Infinity] total capacity budget; a write
 *   past it fails with NOSPACE (the per-tab budget row, 22.3a-8).
 */
export function createFlatsqlIoMemoryBackend(options = {}) {
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : Infinity;
  const files = new Map();
  const directories = new Set([""]);
  let allocated = 0;

  const budget = {
    reserve(bytes) {
      if (allocated + bytes > maxBytes) {
        throw new FlatsqlIoStatusError(FLATSQL_IO_ERR_NOSPACE, "memory store budget exhausted");
      }
      allocated += bytes;
    },
    release(bytes) {
      allocated = Math.max(0, allocated - bytes);
    },
  };

  function parentOf(components) {
    return components.slice(0, -1).join("/");
  }

  function handleFor(key) {
    let closed = false;
    const live = () => {
      if (closed) {
        const error = new Error("handle closed");
        error.name = "InvalidStateError";
        throw error;
      }
      const file = files.get(key);
      if (!file) {
        const error = new Error("file removed");
        error.name = "NotFoundError";
        throw error;
      }
      return file;
    };
    return {
      read(view, { at = 0 } = {}) {
        const file = live();
        if (at >= file.length) return 0;
        const n = Math.min(view.length, file.length - at);
        view.set(file.bytes.subarray(at, at + n), 0);
        return n;
      },
      write(view, { at = 0 } = {}) {
        const file = live();
        const end = at + view.length;
        file.ensureCapacity(end, budget);
        if (at > file.length) file.bytes.fill(0, file.length, at);
        file.bytes.set(view, at);
        if (end > file.length) file.length = end;
        return view.length;
      },
      truncate(size) {
        const file = live();
        if (size > file.length) {
          file.ensureCapacity(size, budget);
          file.bytes.fill(0, file.length, size);
        }
        file.length = size;
      },
      flush() {
        live();
      },
      getSize() {
        return live().length;
      },
      close() {
        closed = true;
      },
    };
  }

  return {
    kind: "memory",
    openFile(path, components, flags) {
      const parent = parentOf(components);
      if (!directories.has(parent)) {
        if (!(flags & FLATSQL_IO_CREATE_PARENTS) || !(flags & FLATSQL_IO_CREATE)) {
          throw new FlatsqlIoStatusError(FLATSQL_IO_ERR_NOENT, `no directory ${parent}`);
        }
        for (let i = 1; i < components.length; i += 1) {
          directories.add(components.slice(0, i).join("/"));
        }
      }
      if (directories.has(path)) {
        throw new FlatsqlIoStatusError(FLATSQL_IO_ERR_ACCESS, `${path} is a directory`);
      }
      let file = files.get(path);
      if (file && flags & FLATSQL_IO_EXCL) {
        throw new FlatsqlIoStatusError(FLATSQL_IO_ERR_GENERIC, `${path} exists`);
      }
      if (!file) {
        if (!(flags & FLATSQL_IO_CREATE)) {
          throw new FlatsqlIoStatusError(FLATSQL_IO_ERR_NOENT, `no file ${path}`);
        }
        file = new MemoryFile();
        files.set(path, file);
      } else if (flags & FLATSQL_IO_TRUNC) {
        file.length = 0;
      }
      return handleFor(path);
    },
    exists(path) {
      return files.has(path) || directories.has(path);
    },
    remove(path) {
      const file = files.get(path);
      if (!file) {
        throw new FlatsqlIoStatusError(FLATSQL_IO_ERR_NOENT, `no file ${path}`);
      }
      budget.release(file.bytes.length);
      files.delete(path);
    },
    /** Drop everything (the window store is dropped on every UI-state change). */
    reset() {
      files.clear();
      directories.clear();
      directories.add("");
      allocated = 0;
    },
    usage() {
      return { files: files.size, allocatedBytes: allocated };
    },
    list() {
      return Array.from(files.keys()).sort();
    },
  };
}
