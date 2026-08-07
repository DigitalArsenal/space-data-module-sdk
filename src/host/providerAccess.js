/**
 * Provider Access port — host side.
 *
 * `createProviderAccessPort({ adapters })` owns the provider registry, the
 * pinned-buffer handle table, and every `provider.*` control operation. It is
 * transport-agnostic: it never learns which runtime it is in, and it never
 * touches guest memory.
 *
 * `createProviderAccessBridge({ getMemory, dispatch, directRead })` is the
 * guest-facing half: the three `space_data_provider` imports. It is the ONLY
 * place that knows the memory topology, and therefore the only place that
 * decides whether a read costs one copy or two.
 *
 * See docs/provider-access-abi.md.
 */

import {
  DEFAULT_MAX_COST,
  PROVIDER_IMPORT_MODULE,
  PROVIDER_TILE_DESC_BYTES,
  ProviderAccessError,
  ProviderCost,
  ProviderError,
  ProviderFlags,
  ProviderKind,
  encodeTileDescriptor,
  encodingLayout,
  providerErrorCodeOf,
  providerErrorName,
  providerSourceId,
} from "./providerAccessAbi.js";

const textDecoder = new TextDecoder();

function isThenable(value) {
  return value !== null && typeof value?.then === "function";
}

/**
 * Continue on a value that MAY be a promise, without forcing one.
 *
 * This matters: a native host call under WasmEdge is synchronous, and if the
 * port turned every synchronous adapter into a promise the guest bridge could
 * never complete inside one import call. Adapters that are synchronous stay
 * synchronous all the way to the guest; adapters that are asynchronous block
 * on the transport (the SAB Atomics.wait channel in a browser worker), exactly
 * as `http` and `storage` already do.
 */
function then(value, onValue) {
  return isThenable(value) ? value.then(onValue) : onValue(value);
}

const KIND_BY_NAME = Object.freeze({
  terrain: ProviderKind.TERRAIN,
  imagery: ProviderKind.IMAGERY,
});

function normalizeKind(kind) {
  if (kind === null || kind === undefined || kind === "") return null;
  if (typeof kind === "number") return kind;
  const normalized = KIND_BY_NAME[String(kind).toLowerCase()];
  if (!normalized) {
    throw new ProviderAccessError(
      ProviderError.INVALID_REQUEST,
      `Unknown provider kind "${kind}".`,
    );
  }
  return normalized;
}

function assertWithinCost(adapter, costClass, request) {
  const maxCost = Number.isInteger(request?.maxCost)
    ? request.maxCost
    : DEFAULT_MAX_COST;
  if (costClass > maxCost) {
    throw new ProviderAccessError(
      ProviderError.UNSUPPORTED,
      `Provider "${adapter.id}" can only serve this at cost class ${costClass} ` +
        `(${maxCost} allowed). Raise "maxCost" to opt in explicitly.`,
      { providerId: adapter.id },
    );
  }
}

function requireAdapterMethod(adapter, method, operation) {
  if (typeof adapter[method] !== "function") {
    throw new ProviderAccessError(
      ProviderError.UNSUPPORTED,
      `Provider "${adapter.id}" does not implement ${method}().`,
      { operation, providerId: adapter.id },
    );
  }
  return adapter[method].bind(adapter);
}

/**
 * Public description of an adapter. Deliberately a fixed shape: the
 * "nothing configured" answer and the "fully configured" answer differ only in
 * array length, never in structure, so modules cannot grow runtime-shaped
 * branches around them.
 */
function describeAdapter(adapter) {
  return {
    id: adapter.id,
    kind: adapter.kind === ProviderKind.TERRAIN ? "terrain" : "imagery",
    name: adapter.name ?? adapter.id,
    ready: adapter.ready !== false,
    minLevel: adapter.minLevel ?? 0,
    maxLevel: adapter.maxLevel ?? 0,
    tileWidth: adapter.tileWidth ?? 0,
    tileHeight: adapter.tileHeight ?? 0,
    encoding: adapter.encoding ?? 0,
    costClass: adapter.costClass ?? ProviderCost.RESIDENT,
    credit: adapter.credit ?? "",
    fixture: adapter.fixture === true,
  };
}

export function createProviderAccessPort(options = {}) {
  const adapters = new Map();
  const selected = new Map();
  const handles = new Map();
  let nextHandle = 1;
  let lastError = null;
  const stats = {
    acquires: 0,
    reads: 0,
    bytesCopied: 0,
    hostCopies: 0,
    pinned: 0,
  };

  for (const adapter of options.adapters ?? []) {
    registerAdapter(adapter);
  }

  function registerAdapter(adapter) {
    if (!adapter || typeof adapter !== "object" || !adapter.id) {
      throw new TypeError("A provider adapter requires an id.");
    }
    const kind = normalizeKind(adapter.kind);
    if (!kind) {
      throw new TypeError(
        `Provider adapter "${adapter.id}" requires kind "terrain" or "imagery".`,
      );
    }
    adapters.set(adapter.id, { ...adapter, kind });
    if (!selected.has(kind)) {
      selected.set(kind, adapter.id);
    }
  }

  function findAdapter(id, operation) {
    const adapter = adapters.get(id);
    if (!adapter) {
      throw new ProviderAccessError(
        ProviderError.NO_PROVIDER,
        `No provider registered with id "${id}".`,
        { operation, providerId: id },
      );
    }
    return adapter;
  }

  function resolveAdapter(params, operation) {
    const id = params?.providerId ?? params?.id;
    if (id) return findAdapter(id, operation);
    const kind = normalizeKind(params?.kind);
    const selectedId = kind ? selected.get(kind) : null;
    if (!selectedId) {
      throw new ProviderAccessError(
        ProviderError.NO_PROVIDER,
        kind
          ? `No provider selected for kind "${params?.kind}".`
          : "A providerId or kind is required.",
        { operation },
      );
    }
    return findAdapter(selectedId, operation);
  }

  /**
   * Normalize what an adapter returned into pinned planes + a descriptor.
   * Adapters return typed arrays; the port never re-encodes them.
   */
  function pin(adapter, result, request, derivedFlags) {
    const planes = (result.planes ?? [result.plane ?? result.data]).map(
      (plane) => {
        if (ArrayBuffer.isView(plane)) {
          return new Uint8Array(
            plane.buffer,
            plane.byteOffset,
            plane.byteLength,
          );
        }
        if (plane instanceof ArrayBuffer) return new Uint8Array(plane);
        throw new ProviderAccessError(
          ProviderError.HOST,
          `Provider "${adapter.id}" returned a non-buffer plane.`,
          { providerId: adapter.id },
        );
      },
    );
    if (planes.length === 0) {
      throw new ProviderAccessError(
        ProviderError.HOST,
        `Provider "${adapter.id}" returned no planes.`,
        { providerId: adapter.id },
      );
    }

    const info = result.descriptor ?? {};
    const encoding = info.encoding ?? adapter.encoding;
    const layout = encodingLayout(encoding);
    const width = info.width ?? 0;
    const costClass = info.costClass ?? adapter.costClass ?? ProviderCost.RESIDENT;

    // A result may be dearer than the adapter's declared baseline (a cache
    // miss). Re-check, so the ceiling holds on the actual cost too.
    assertWithinCost(adapter, costClass, request);

    const descriptor = {
      kind: adapter.kind,
      encoding,
      width,
      height: info.height ?? 1,
      planeCount: planes.length,
      bytesPerElement: layout.bytes,
      rowStrideBytes: info.rowStrideBytes ?? width * layout.bytes,
      byteLength: planes[0].byteLength,
      flags:
        (info.flags ?? 0) |
        derivedFlags |
        (adapter.fixture === true ? ProviderFlags.FIXTURE : 0),
      level: info.level,
      west: info.west,
      south: info.south,
      east: info.east,
      north: info.north,
      minValue: info.minValue,
      maxValue: info.maxValue,
      tileX: info.tileX,
      tileY: info.tileY,
      hostCopies: 1,
      sourceId: providerSourceId(adapter.id),
      costClass,
    };

    const handle = nextHandle++;
    handles.set(handle, { adapter, planes, descriptor });
    stats.acquires += 1;
    stats.pinned = handles.size;
    return { handle, descriptor };
  }

  const ACQUIRE_METHODS = Object.freeze({
    tile: ["acquireTile", 0],
    profile: ["acquireProfile", ProviderFlags.DERIVED],
    region: ["acquireRegion", ProviderFlags.DERIVED],
  });

  function acquire(params = {}) {
    const op = String(params.op ?? "tile");
    const selector = ACQUIRE_METHODS[op];
    if (!selector) {
      throw new ProviderAccessError(
        ProviderError.INVALID_REQUEST,
        `Unknown acquire op "${op}".`,
      );
    }
    const [method, derivedFlags] = selector;
    const adapter = resolveAdapter(params, `provider.acquire:${op}`);
    const request = { ...params, maxCost: params.maxCost ?? DEFAULT_MAX_COST };
    const fn = requireAdapterMethod(adapter, method, "provider.acquire");
    // The ceiling is enforced BEFORE the adapter is called. Checking it after
    // the fact would mean a refused acquire had already paid the network or
    // the decode it was refusing — the exact cost the caller declined.
    assertWithinCost(adapter, adapter.costClass ?? ProviderCost.RESIDENT, request);
    return then(fn(request), (result) =>
      pin(adapter, result, request, derivedFlags),
    );
  }

  function pinnedPlane(handle, plane) {
    const entry = handles.get(handle);
    if (!entry) {
      throw new ProviderAccessError(
        ProviderError.BAD_HANDLE,
        `Unknown or released provider handle ${handle}.`,
      );
    }
    const index = plane | 0;
    if (index < 0 || index >= entry.planes.length) {
      throw new ProviderAccessError(
        ProviderError.BAD_PLANE,
        `Plane ${index} is out of range for handle ${handle} (planeCount ${entry.planes.length}).`,
      );
    }
    return entry.planes[index];
  }

  /** Bytes for a read, as a VIEW on the pinned buffer — never a copy. */
  function readView(params = {}) {
    const source = pinnedPlane(params.handle, params.plane ?? 0);
    const srcOffset = params.srcOffset | 0;
    if (srcOffset < 0 || srcOffset > source.byteLength) {
      throw new ProviderAccessError(
        ProviderError.BOUNDS,
        `srcOffset ${srcOffset} is outside plane of ${source.byteLength} bytes.`,
      );
    }
    const length = Math.min(
      Math.max(params.length | 0, 0),
      source.byteLength - srcOffset,
    );
    return source.subarray(srcOffset, srcOffset + length);
  }

  function release(handle) {
    if (!handles.delete(handle)) {
      throw new ProviderAccessError(
        ProviderError.BAD_HANDLE,
        `Unknown or released provider handle ${handle}.`,
      );
    }
    stats.pinned = handles.size;
    return 0;
  }

  function recordCopies(bytes, copies) {
    stats.reads += 1;
    stats.bytesCopied += bytes;
    stats.hostCopies += copies;
  }

  const operations = {
    "provider.list": (params = {}) => {
      const kind = normalizeKind(params.kind);
      const providers = [...adapters.values()]
        .filter((adapter) => !kind || adapter.kind === kind)
        .map(describeAdapter)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { providers };
    },
    "provider.describe": (params = {}) => {
      const adapter = findAdapter(params.id, "provider.describe");
      return {
        ...describeAdapter(adapter),
        attributes: adapter.attributes ?? {},
      };
    },
    "provider.select": (params = {}) => {
      const adapter = findAdapter(params.id, "provider.select");
      const kind = normalizeKind(params.kind) ?? adapter.kind;
      if (adapter.kind !== kind) {
        throw new ProviderAccessError(
          ProviderError.INVALID_REQUEST,
          `Provider "${adapter.id}" is not of kind "${params.kind}".`,
        );
      }
      const selection =
        typeof adapter.select === "function" ? adapter.select(params) : null;
      return then(selection, () => {
        selected.set(kind, adapter.id);
        return { selected: adapter.id };
      });
    },
    "provider.configure": (params = {}) => {
      const adapter = findAdapter(params.id, "provider.configure");
      if (typeof adapter.configure !== "function") {
        return { applied: [], rejected: Object.keys(params.settings ?? {}) };
      }
      return adapter.configure(params.settings ?? {});
    },
    "provider.availability": (params = {}) => {
      const adapter = resolveAdapter(params, "provider.availability");
      if (typeof adapter.availability !== "function") {
        return { available: true, known: false };
      }
      return then(adapter.availability(params), (available) => ({
        available: !!available,
        known: true,
      }));
    },
    "provider.prefetch": (params = {}) => {
      const adapter = resolveAdapter(params, "provider.prefetch");
      if (typeof adapter.prefetch !== "function") {
        // Not an error: a camera-driven engine has no region prefetch, and
        // saying so in a field beats inventing an engine API.
        return { requested: 0, pending: 0, supported: false };
      }
      return then(adapter.prefetch(params), (result) => ({
        supported: true,
        ...result,
      }));
    },
    "provider.await": (params = {}) => {
      const adapter = resolveAdapter(params, "provider.await");
      if (typeof adapter.awaitReady !== "function") {
        return { ready: adapter.ready !== false, pending: 0 };
      }
      return adapter.awaitReady(params);
    },
    "provider.lastError": () =>
      lastError ?? {
        code: 0,
        name: "SDM_PROVIDER_OK",
        message: "",
        operation: null,
      },
    "provider.stats": () => ({ ...stats }),

    // Internal transport operations. Guests never name these — the three
    // `space_data_provider` imports do.
    "provider.acquire": (params = {}) =>
      then(acquire(params), ({ handle, descriptor }) => ({
        handle,
        descriptor: encodeTileDescriptor(descriptor),
      })),
    "provider.readRaw": (params = {}) => {
      const view = readView(params);
      // The staged transport pays a copy here; the direct transport never
      // calls this operation at all.
      const bytes = new Uint8Array(view.byteLength);
      bytes.set(view);
      recordCopies(bytes.byteLength, 2);
      return { bytes };
    },
    "provider.release": (params = {}) => ({
      released: release(params.handle),
    }),
  };

  function recordFailure(operation, error) {
    const code = providerErrorCodeOf(error);
    lastError = {
      code,
      name: providerErrorName(code),
      message: error?.message ?? String(error),
      operation: error?.operation ?? operation,
      providerId: error?.providerId ?? null,
    };
    return error;
  }

  function run(operation, params) {
    const handler = operations[operation];
    if (!handler) {
      throw new ProviderAccessError(
        ProviderError.INVALID_REQUEST,
        `Unknown provider operation "${operation}".`,
        { operation },
      );
    }
    let result;
    try {
      result = handler(params ?? {});
    } catch (error) {
      throw recordFailure(operation, error);
    }
    if (isThenable(result)) {
      return result.then(
        (value) => {
          lastError = null;
          return value;
        },
        (error) => {
          throw recordFailure(operation, error);
        },
      );
    }
    lastError = null;
    return result;
  }

  /**
   * Synchronous invoke. Used by native hosts, where a host call cannot yield.
   * An adapter that returns a promise here is a defect in THAT adapter, and it
   * is named rather than silently awaited into a different runtime's shape.
   */
  function invokeSync(operation, params = null) {
    const result = run(operation, params);
    if (isThenable(result)) {
      throw new ProviderAccessError(
        ProviderError.HOST,
        `Provider operation "${operation}" is asynchronous and needs a blocking transport.`,
        { operation },
      );
    }
    return result;
  }

  function invoke(operation, params = null) {
    try {
      return Promise.resolve(run(operation, params));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  return {
    invoke,
    invokeSync,
    operations: Object.keys(operations),
    registerAdapter,
    hasAdapter: (id) => adapters.has(id),
    /**
     * Direct-write read: copies the pinned plane straight into a caller-owned
     * destination view. ONE copy. Used only where the responder can reach guest
     * memory itself.
     */
    directReadInto(params, destination) {
      const view = readView(params);
      destination.set(view.subarray(0, destination.byteLength));
      const written = Math.min(view.byteLength, destination.byteLength);
      recordCopies(written, 1);
      return written;
    },
    releaseAll() {
      handles.clear();
      stats.pinned = 0;
    },
    get stats() {
      return { ...stats };
    },
  };
}

function getMemoryBuffer(getMemory) {
  const memory = getMemory();
  const buffer = memory?.buffer;
  if (!(buffer instanceof ArrayBuffer || buffer instanceof SharedArrayBuffer)) {
    throw new ProviderAccessError(
      ProviderError.HOST,
      "Provider access requires a WebAssembly.Memory-like object.",
    );
  }
  return buffer;
}

function guestView(getMemory, ptr, len) {
  if (!Number.isInteger(ptr) || ptr < 0 || !Number.isInteger(len) || len < 0) {
    throw new ProviderAccessError(
      ProviderError.BOUNDS,
      "Guest pointer and length must be non-negative integers.",
    );
  }
  const buffer = getMemoryBuffer(getMemory);
  if (ptr + len > buffer.byteLength) {
    throw new ProviderAccessError(
      ProviderError.BOUNDS,
      `Guest range [${ptr}, ${ptr + len}) exceeds linear memory (${buffer.byteLength} bytes).`,
    );
  }
  return new Uint8Array(buffer, ptr, len);
}

/**
 * Guest-facing bridge: the three `space_data_provider` imports.
 *
 * `dispatch(operation, params)` must be the same blocking dispatcher the
 * existing hostcall bridge uses — synchronous in-process on native hosts, and
 * the SAB Atomics.wait channel in a browser worker.
 *
 * `directRead` is optional. When supplied, a read is ONE copy: the responder
 * writes the provider's decoded bytes straight into guest linear memory. When
 * absent, the bridge falls back to the staged route (TWO copies) and marks the
 * descriptor with FLAG_STAGED so the guest can see the difference rather than
 * guess at it. Neither route ever encodes tile bytes into a hostcall envelope.
 */
export function createProviderAccessBridge(options = {}) {
  const getMemory = options.getMemory;
  const dispatch = options.dispatch;
  if (typeof getMemory !== "function") {
    throw new TypeError("createProviderAccessBridge requires getMemory().");
  }
  if (typeof dispatch !== "function") {
    throw new TypeError("createProviderAccessBridge requires dispatch().");
  }
  const directRead =
    typeof options.directRead === "function" ? options.directRead : null;
  const moduleName = options.moduleName ?? PROVIDER_IMPORT_MODULE;

  const DESC_HOST_COPIES_OFFSET = 104;
  const DESC_FLAGS_OFFSET = 40;

  function acquire(reqPtr, reqLen, descPtr) {
    try {
      const request = JSON.parse(
        textDecoder.decode(guestView(getMemory, reqPtr, reqLen)),
      );
      const result = dispatch("provider.acquire", request);
      const descriptor =
        result?.descriptor instanceof Uint8Array
          ? result.descriptor
          : new Uint8Array(result?.descriptor ?? []);
      if (descriptor.byteLength !== PROVIDER_TILE_DESC_BYTES) {
        throw new ProviderAccessError(
          ProviderError.HOST,
          `Descriptor must be ${PROVIDER_TILE_DESC_BYTES} bytes, got ${descriptor.byteLength}.`,
        );
      }
      // Transport truth is patched in HERE, by the only layer that knows the
      // memory topology. The port that produced the descriptor must not guess.
      const patched = new Uint8Array(descriptor);
      const view = new DataView(patched.buffer);
      if (!directRead) {
        view.setUint32(DESC_HOST_COPIES_OFFSET, 2, true);
        view.setUint32(
          DESC_FLAGS_OFFSET,
          view.getUint32(DESC_FLAGS_OFFSET, true) | ProviderFlags.STAGED,
          true,
        );
      }
      guestView(getMemory, descPtr, PROVIDER_TILE_DESC_BYTES).set(patched);
      return result.handle | 0;
    } catch (error) {
      return providerErrorCodeOf(error);
    }
  }

  function read(handle, plane, srcOffset, dstPtr, dstLen) {
    try {
      if (directRead) {
        return (
          directRead(
            { handle, plane, srcOffset, length: dstLen },
            guestView(getMemory, dstPtr, dstLen),
          ) | 0
        );
      }
      const result = dispatch("provider.readRaw", {
        handle,
        plane,
        srcOffset,
        length: dstLen,
      });
      const bytes =
        result?.bytes instanceof Uint8Array
          ? result.bytes
          : new Uint8Array(result?.bytes ?? []);
      const destination = guestView(getMemory, dstPtr, dstLen);
      const written = Math.min(bytes.byteLength, dstLen);
      destination.set(bytes.subarray(0, written));
      return written;
    } catch (error) {
      return providerErrorCodeOf(error);
    }
  }

  function release(handle) {
    try {
      dispatch("provider.release", { handle });
      return 0;
    } catch (error) {
      return providerErrorCodeOf(error);
    }
  }

  return {
    moduleName,
    imports: { [moduleName]: { acquire, read, release } },
    get hostCopiesPerRead() {
      return directRead ? 1 : 2;
    },
  };
}

/**
 * The always-present refusal port.
 *
 * Bound when a host has no provider access at all. It exists so the three
 * imports LINK in every runtime: a missing import is a link-time divergence,
 * the worst class there is. Every call returns a value, never a trap, and the
 * value is the same one a browser gives for an unknown provider id.
 */
export function createUnavailableProviderPort(
  code = ProviderError.PORT_UNAVAILABLE,
) {
  const detail = {
    code,
    name: providerErrorName(code),
    message: "No provider access port is bound in this runtime.",
    operation: null,
  };
  return {
    invoke(operation) {
      if (operation === "provider.list") return Promise.resolve({ providers: [] });
      if (operation === "provider.lastError") return Promise.resolve(detail);
      if (operation === "provider.stats") {
        return Promise.resolve({
          acquires: 0,
          reads: 0,
          bytesCopied: 0,
          hostCopies: 0,
          pinned: 0,
        });
      }
      return Promise.reject(
        new ProviderAccessError(code, detail.message, { operation }),
      );
    },
    operations: ["provider.list", "provider.lastError", "provider.stats"],
  };
}
