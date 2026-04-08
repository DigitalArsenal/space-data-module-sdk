const textEncoder = new TextEncoder();

const FILE_ENTRY = "file";
const DIRECTORY_ENTRY = "directory";

export class BrowserFilesystemScopeError extends Error {
  constructor(requestedPath, filesystemRoot) {
    super(`Path "${requestedPath}" escapes the configured filesystem root.`);
    this.name = "BrowserFilesystemScopeError";
    this.code = "filesystem-scope-violation";
    this.requestedPath = requestedPath;
    this.filesystemRoot = filesystemRoot;
  }
}

function normalizePath(path) {
  const raw = String(path ?? "").trim();
  const absolute = raw.startsWith("/") ? raw : `/${raw}`;
  const segments = [];
  for (const segment of absolute.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        throw new BrowserFilesystemScopeError(path, "/");
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function joinPaths(basePath, requestedPath) {
  const base = normalizePath(basePath ?? "/");
  const requested = String(requestedPath ?? "").trim();
  if (!requested || requested === ".") {
    return base;
  }
  if (requested.startsWith("/")) {
    return normalizePath(requested);
  }
  return normalizePath(`${base}/${requested}`);
}

function assertWithinRoot(resolvedPath, filesystemRoot, requestedPath) {
  const root = normalizePath(filesystemRoot ?? "/");
  if (
    resolvedPath !== root &&
    root !== "/" &&
    !resolvedPath.startsWith(`${root}/`)
  ) {
    throw new BrowserFilesystemScopeError(requestedPath, root);
  }
}

function getParentPath(path) {
  if (path === "/") {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return "/";
  }
  return `/${segments.slice(0, -1).join("/")}`;
}

function getBaseName(path) {
  if (path === "/") {
    return "/";
  }
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1];
}

function cloneEntry(entry) {
  if (!entry) {
    return null;
  }
  if (entry.kind === FILE_ENTRY) {
    return {
      ...entry,
      bytes: new Uint8Array(entry.bytes),
    };
  }
  return { ...entry };
}

function toUint8Array(value, encoding = null) {
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).slice();
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  if (value == null) {
    return new Uint8Array();
  }
  if (encoding) {
    return textEncoder.encode(String(value));
  }
  return textEncoder.encode(String(value));
}

export function createMemoryFilesystemEdgeShim(options = {}) {
  const filesystemRoot = normalizePath(options.filesystemRoot ?? "/");
  const entries = new Map();
  const now = Date.now();
  entries.set(filesystemRoot, {
    kind: DIRECTORY_ENTRY,
    ctimeMs: now,
    mtimeMs: now,
  });

  function resolvePath(requestedPath = ".") {
    const resolvedPath = joinPaths(filesystemRoot, requestedPath);
    assertWithinRoot(resolvedPath, filesystemRoot, requestedPath);
    return resolvedPath;
  }

  function getEntry(path) {
    return entries.get(path) ?? null;
  }

  function requireEntry(path) {
    const entry = getEntry(path);
    if (!entry) {
      throw new Error(`Path "${path}" does not exist.`);
    }
    return entry;
  }

  function requireDirectory(path) {
    const entry = requireEntry(path);
    if (entry.kind !== DIRECTORY_ENTRY) {
      throw new Error(`Path "${path}" is not a directory.`);
    }
    return entry;
  }

  function requireParentDirectory(path) {
    const parentPath = getParentPath(path);
    if (!parentPath) {
      return null;
    }
    return requireDirectory(parentPath);
  }

  function touch(path) {
    const entry = requireEntry(path);
    entry.mtimeMs = Date.now();
  }

  function ensureDirectory(path, recursive = false) {
    const resolvedPath = resolvePath(path);
    const existing = getEntry(resolvedPath);
    if (existing) {
      if (existing.kind !== DIRECTORY_ENTRY) {
        throw new Error(`Path "${resolvedPath}" already exists and is not a directory.`);
      }
      return resolvedPath;
    }

    const parentPath = getParentPath(resolvedPath);
    if (parentPath && !getEntry(parentPath)) {
      if (!recursive) {
        throw new Error(`Parent directory "${parentPath}" does not exist.`);
      }
      ensureDirectory(parentPath, true);
    }
    requireParentDirectory(resolvedPath);
    const nowMs = Date.now();
    entries.set(resolvedPath, {
      kind: DIRECTORY_ENTRY,
      ctimeMs: nowMs,
      mtimeMs: nowMs,
    });
    if (parentPath) {
      touch(parentPath);
    }
    return resolvedPath;
  }

  function setFileBytes(resolvedPath, bytes) {
    const parentPath = getParentPath(resolvedPath);
    if (parentPath) {
      requireDirectory(parentPath);
    }
    const existing = getEntry(resolvedPath);
    const nowMs = Date.now();
    entries.set(resolvedPath, {
      kind: FILE_ENTRY,
      bytes,
      ctimeMs: existing?.ctimeMs ?? nowMs,
      mtimeMs: nowMs,
    });
    if (parentPath) {
      touch(parentPath);
    }
  }

  return Object.freeze({
    filesystemRoot,
    resolvePath,
    async readFile(path, options = {}) {
      const resolvedPath = resolvePath(path);
      const entry = requireEntry(resolvedPath);
      if (entry.kind !== FILE_ENTRY) {
        throw new Error(`Path "${resolvedPath}" is not a file.`);
      }
      if (options.encoding) {
        return new TextDecoder(options.encoding).decode(entry.bytes);
      }
      return new Uint8Array(entry.bytes);
    },
    async writeFile(path, value, options = {}) {
      const resolvedPath = resolvePath(path);
      setFileBytes(resolvedPath, toUint8Array(value, options.encoding ?? null));
      return { path: resolvedPath };
    },
    async appendFile(path, value, options = {}) {
      const resolvedPath = resolvePath(path);
      const existing = getEntry(resolvedPath);
      const nextBytes = toUint8Array(value, options.encoding ?? null);
      if (!existing) {
        setFileBytes(resolvedPath, nextBytes);
        return { path: resolvedPath };
      }
      if (existing.kind !== FILE_ENTRY) {
        throw new Error(`Path "${resolvedPath}" is not a file.`);
      }
      const combined = new Uint8Array(existing.bytes.length + nextBytes.length);
      combined.set(existing.bytes, 0);
      combined.set(nextBytes, existing.bytes.length);
      setFileBytes(resolvedPath, combined);
      return { path: resolvedPath };
    },
    async deleteFile(path) {
      const resolvedPath = resolvePath(path);
      const entry = requireEntry(resolvedPath);
      if (entry.kind !== FILE_ENTRY) {
        throw new Error(`Path "${resolvedPath}" is not a file.`);
      }
      entries.delete(resolvedPath);
      const parentPath = getParentPath(resolvedPath);
      if (parentPath) {
        touch(parentPath);
      }
      return { path: resolvedPath };
    },
    async mkdir(path, options = {}) {
      const resolvedPath = ensureDirectory(path, options.recursive === true);
      return { path: resolvedPath };
    },
    async readdir(path = ".") {
      const resolvedPath = resolvePath(path);
      requireDirectory(resolvedPath);
      const children = [];
      for (const [entryPath, entry] of entries.entries()) {
        if (entryPath === resolvedPath) {
          continue;
        }
        const parentPath = getParentPath(entryPath);
        if (parentPath !== resolvedPath) {
          continue;
        }
        children.push({
          name: getBaseName(entryPath),
          isFile: entry.kind === FILE_ENTRY,
          isDirectory: entry.kind === DIRECTORY_ENTRY,
        });
      }
      children.sort((left, right) => left.name.localeCompare(right.name));
      return children;
    },
    async stat(path) {
      const resolvedPath = resolvePath(path);
      const entry = requireEntry(resolvedPath);
      return {
        path: resolvedPath,
        size: entry.kind === FILE_ENTRY ? entry.bytes.length : 0,
        isFile: entry.kind === FILE_ENTRY,
        isDirectory: entry.kind === DIRECTORY_ENTRY,
        ctimeMs: entry.ctimeMs,
        mtimeMs: entry.mtimeMs,
      };
    },
    async rename(fromPath, toPath) {
      const resolvedFromPath = resolvePath(fromPath);
      const resolvedToPath = resolvePath(toPath);
      requireEntry(resolvedFromPath);
      if (getEntry(resolvedToPath)) {
        throw new Error(`Path "${resolvedToPath}" already exists.`);
      }
      const targetParentPath = getParentPath(resolvedToPath);
      if (targetParentPath) {
        requireDirectory(targetParentPath);
      }

      const moves = Array.from(entries.entries())
        .filter(([entryPath]) =>
          entryPath === resolvedFromPath ||
          entryPath.startsWith(`${resolvedFromPath}/`),
        )
        .sort((left, right) => left[0].length - right[0].length);

      for (const [entryPath, entry] of moves) {
        const suffix = entryPath.slice(resolvedFromPath.length);
        entries.set(`${resolvedToPath}${suffix}`, cloneEntry(entry));
      }
      for (const [entryPath] of moves) {
        entries.delete(entryPath);
      }

      if (targetParentPath) {
        touch(targetParentPath);
      }
      const fromParentPath = getParentPath(resolvedFromPath);
      if (fromParentPath && fromParentPath !== targetParentPath) {
        touch(fromParentPath);
      }

      return {
        from: resolvedFromPath,
        to: resolvedToPath,
      };
    },
  });
}

export function createBrowserEdgeShims(options = {}) {
  return Object.freeze({
    fetch: options.fetch ?? globalThis.fetch?.bind(globalThis),
    WebSocket: options.WebSocket ?? globalThis.WebSocket,
    crypto: options.crypto ?? globalThis.crypto,
    performance: options.performance ?? globalThis.performance,
    filesystem:
      options.filesystem ??
      createMemoryFilesystemEdgeShim({
        filesystemRoot: options.filesystemRoot ?? "/",
      }),
  });
}
