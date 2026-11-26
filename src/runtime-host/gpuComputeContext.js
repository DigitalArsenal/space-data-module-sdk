// Host-owned shared GPU compute context and opaque buffer-handle registry (SDK GPU Module ABI v2).
//
// Enables independent modules (for example propagator/sdn-ap and analysis/conjunction-assessment)
// to share one host-owned GPUDevice and exchange GPU buffers via opaque numeric handle ids with
// zero CPU round-trip, while cleanly detecting GPU availability and falling back to CPU when
// WebGPU/Dawn is absent.

export const SDN_GPU_ABI_VERSION = 2;
export const SDN_GPU_CAPABILITY_ID = "gpu_compute";
export const SDN_GPU_CAPABILITY_SCOPE_V1 = "webgpu.v1";
export const SDN_GPU_CAPABILITY_SCOPE_V2 = "webgpu.v2";

export const SDN_GPU_STATUS = Object.freeze({
  OK: 0,
  UNAVAILABLE: 1,
  UNSUPPORTED_ABI: 2,
  INVALID_DESCRIPTOR: 3,
  LIMIT_EXCEEDED: 4,
  DISPATCH_FAILED: 5,
  OUTPUT_OVERFLOW: 6,
  UNKNOWN_HANDLE: 7,
  DEVICE_MISMATCH: 8,
});

export const SDN_GPU_BACKEND = Object.freeze({
  UNKNOWN: 0,
  BROWSER_WEBGPU: 1,
  DAWN_NATIVE: 2,
  CPU_FALLBACK: 3,
});

export const SDN_GPU_BUFFER_ROLE = Object.freeze({
  STORAGE_READ: 1 << 0,
  STORAGE_WRITE: 1 << 1,
  UNIFORM: 1 << 2,
  INDIRECT: 1 << 3,
  SHARED_EXCHANGE: 1 << 4,
});

export const SDN_GPU_SCALAR_FORMAT = Object.freeze({
  U8: 1,
  U32: 2,
  I32: 3,
  F32: 4,
  SPLIT_F64: 5,
  IEEE754_F64_U32X2: 6,
});

const _f64Scratch = new ArrayBuffer(8);
const _f64View = new Float64Array(_f64Scratch);
const _u32View = new Uint32Array(_f64Scratch);

/** Pack an IEEE-754 binary64 number into little-endian { lo, hi } u32 pair (0 ULP loss). */
export function packF64Bits(value) {
  _f64View[0] = value;
  return { lo: _u32View[0], hi: _u32View[1] };
}

/** Unpack little-endian (lo, hi) u32 pair into an exact IEEE-754 binary64 number. */
export function unpackF64Bits(lo, hi) {
  _u32View[0] = lo >>> 0;
  _u32View[1] = hi >>> 0;
  return _f64View[0];
}

/** Reinterpret a Float64Array as little-endian Uint32Array (pairs of [lo, hi]) without copying. */
export function f64ArrayToU32Pairs(f64) {
  return new Uint32Array(f64.buffer, f64.byteOffset, f64.length * 2);
}

/** Reinterpret little-endian Uint32Array pairs [lo, hi] as Float64Array without copying. */
export function u32PairsToF64Array(u32) {
  if ((u32.byteLength & 7) !== 0) {
    throw new RangeError("u32 byteLength must be a multiple of 8 for IEEE-754 f64 pairs.");
  }
  return new Float64Array(u32.buffer, u32.byteOffset, u32.byteLength / 8);
}

let nextDeviceId = 1;

/**
 * Probes whether WebGPU is available in the current host without throwing.
 * Returns { available: false, backendKind: 'cpu-fallback', reason, context: null }
 * when unavailable, or { available: true, backendKind: 'browser-webgpu', adapter, device, context }.
 */
export async function detectWebGpu(options = {}) {
  const gpu = options.gpu ?? globalThis?.navigator?.gpu ?? null;
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    return {
      available: false,
      abiVersion: SDN_GPU_ABI_VERSION,
      backendKind: "cpu-fallback",
      backendCode: SDN_GPU_BACKEND.CPU_FALLBACK,
      reason: "navigator.gpu is unavailable in this runtime.",
      adapter: null,
      device: null,
      context: null,
    };
  }
  try {
    const adapter = await gpu.requestAdapter({
      powerPreference: options.powerPreference ?? "high-performance",
      forceFallbackAdapter: Boolean(options.forceFallbackAdapter),
    });
    if (!adapter) {
      return {
        available: false,
        abiVersion: SDN_GPU_ABI_VERSION,
        backendKind: "cpu-fallback",
        backendCode: SDN_GPU_BACKEND.CPU_FALLBACK,
        reason: "No WebGPU adapter returned by navigator.gpu.requestAdapter().",
        adapter: null,
        device: null,
        context: null,
      };
    }
    const requiredLimits = options.requiredLimits ?? {};
    const device = await adapter.requestDevice(
      Object.keys(requiredLimits).length > 0 ? { requiredLimits } : undefined,
    );
    const info = adapter.info ?? (typeof adapter.requestAdapterInfo === "function" ? await adapter.requestAdapterInfo() : null);
    const adapterLabel = info
      ? [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(" ") || "WebGPU"
      : "WebGPU";
    const context = createSharedGpuContext({
      device,
      adapter,
      adapterLabel,
      backendKind: "browser-webgpu",
      backendCode: SDN_GPU_BACKEND.BROWSER_WEBGPU,
    });
    return {
      available: true,
      abiVersion: SDN_GPU_ABI_VERSION,
      backendKind: "browser-webgpu",
      backendCode: SDN_GPU_BACKEND.BROWSER_WEBGPU,
      adapterLabel,
      adapter,
      device,
      context,
    };
  } catch (error) {
    return {
      available: false,
      abiVersion: SDN_GPU_ABI_VERSION,
      backendKind: "cpu-fallback",
      backendCode: SDN_GPU_BACKEND.CPU_FALLBACK,
      reason: error?.message ?? String(error),
      adapter: null,
      device: null,
      context: null,
    };
  }
}

/**
 * Host-owned shared GPU context: holds one GPUDevice and an opaque handle table so
 * independent modules (e.g. AP and CA) exchange GPU buffers without CPU round-trips.
 */
export function createSharedGpuContext(options = {}) {
  const device = options.device ?? null;
  if (!device || typeof device.createBuffer !== "function") {
    throw new TypeError("createSharedGpuContext requires a valid GPUDevice (device.createBuffer).");
  }
  const deviceId = options.deviceId ?? nextDeviceId++;
  const backendKind = options.backendKind ?? "browser-webgpu";
  const backendCode = options.backendCode ?? SDN_GPU_BACKEND.BROWSER_WEBGPU;
  const adapterLabel = options.adapterLabel ?? "WebGPU";
  const handles = new Map();
  let nextHandleId = 1;
  let destroyed = false;

  const assertAlive = () => {
    if (destroyed) throw new Error("SharedGpuContext has been destroyed.");
  };

  function buildDescriptor(entry) {
    return Object.freeze({
      abiVersion: SDN_GPU_ABI_VERSION,
      handleId: entry.handleId,
      deviceId,
      byteLength: entry.byteLength,
      role: entry.role,
      scalarFormat: entry.scalarFormat,
      recordStride: entry.recordStride,
      layout: entry.layout,
      owner: entry.owner,
      metadata: entry.metadata ? { ...entry.metadata } : {},
    });
  }

  /** Register an existing GPUBuffer owned by this context's device and return its opaque handle descriptor. */
  function registerBuffer(buffer, spec = {}) {
    assertAlive();
    if (!buffer || typeof buffer.destroy !== "function") {
      throw new TypeError("registerBuffer requires a GPUBuffer.");
    }
    const handleId = nextHandleId++;
    const entry = {
      handleId,
      buffer,
      byteLength: Number(spec.byteLength ?? buffer.size ?? 0),
      role: Number(spec.role ?? (SDN_GPU_BUFFER_ROLE.STORAGE_READ | SDN_GPU_BUFFER_ROLE.STORAGE_WRITE | SDN_GPU_BUFFER_ROLE.SHARED_EXCHANGE)),
      scalarFormat: Number(spec.scalarFormat ?? SDN_GPU_SCALAR_FORMAT.U8),
      recordStride: Number(spec.recordStride ?? 0),
      layout: spec.layout ?? null,
      owner: spec.owner ?? null,
      ownedByContext: spec.ownedByContext !== false,
      metadata: spec.metadata ? { ...spec.metadata } : {},
    };
    handles.set(handleId, entry);
    return buildDescriptor(entry);
  }

  /** Allocate a GPUBuffer on the shared device and register an opaque handle for cross-module handoff. */
  function createBuffer(spec = {}) {
    assertAlive();
    const byteLength = Number(spec.byteLength ?? spec.size ?? 0);
    if (!(byteLength > 0)) {
      throw new RangeError("createBuffer requires byteLength > 0.");
    }
    const alignedSize = Math.ceil(byteLength / 4) * 4;
    const usage = spec.usage ?? (
      globalThis.GPUBufferUsage
        ? (globalThis.GPUBufferUsage.STORAGE | globalThis.GPUBufferUsage.COPY_SRC | globalThis.GPUBufferUsage.COPY_DST)
        : 0x8c
    );
    const buffer = device.createBuffer({
      size: alignedSize,
      usage,
      ...(spec.label ? { label: spec.label } : {}),
    });
    if (spec.initialData) {
      const view = ArrayBuffer.isView(spec.initialData)
        ? new Uint8Array(spec.initialData.buffer, spec.initialData.byteOffset, spec.initialData.byteLength)
        : new Uint8Array(spec.initialData);
      device.queue.writeBuffer(buffer, 0, view);
    }
    return registerBuffer(buffer, { ...spec, byteLength: alignedSize, ownedByContext: true });
  }

  function resolveEntry(handleOrId) {
    assertAlive();
    const id = typeof handleOrId === "object" && handleOrId !== null ? handleOrId.handleId : Number(handleOrId);
    if (typeof handleOrId === "object" && handleOrId !== null && handleOrId.deviceId != null && handleOrId.deviceId !== deviceId) {
      const err = new Error(`GPU buffer handle ${id} belongs to device ${handleOrId.deviceId}, not ${deviceId}.`);
      err.gpuStatus = SDN_GPU_STATUS.DEVICE_MISMATCH;
      throw err;
    }
    const entry = handles.get(id);
    if (!entry) {
      const err = new Error(`Unknown GPU buffer handle ${id}.`);
      err.gpuStatus = SDN_GPU_STATUS.UNKNOWN_HANDLE;
      throw err;
    }
    return entry;
  }

  function getBuffer(handleOrId) {
    return resolveEntry(handleOrId).buffer;
  }

  function describeBuffer(handleOrId) {
    return buildDescriptor(resolveEntry(handleOrId));
  }

  /** Read bytes from a registered shared buffer back to CPU (used only for CPU-consumer fallback or verification). */
  async function readBuffer(handleOrId, byteOffset = 0, byteLength = null) {
    const entry = resolveEntry(handleOrId);
    const length = byteLength == null ? entry.byteLength - byteOffset : Number(byteLength);
    if (length <= 0) return new Uint8Array(0);
    const aligned = Math.ceil(length / 4) * 4;
    const U = globalThis.GPUBufferUsage ?? { MAP_READ: 0x0001, COPY_DST: 0x0008 };
    const M = globalThis.GPUMapMode ?? { READ: 0x0001 };
    const staging = device.createBuffer({ size: aligned, usage: U.MAP_READ | U.COPY_DST });
    try {
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(entry.buffer, byteOffset, staging, 0, aligned);
      device.queue.submit([enc.finish()]);
      await staging.mapAsync(M.READ, 0, aligned);
      const copy = new Uint8Array(staging.getMappedRange(0, aligned).slice(0, length));
      staging.unmap();
      return copy;
    } finally {
      staging.destroy();
    }
  }

  function releaseBuffer(handleOrId) {
    const id = typeof handleOrId === "object" && handleOrId !== null ? handleOrId.handleId : Number(handleOrId);
    const entry = handles.get(id);
    if (!entry) return false;
    handles.delete(id);
    if (entry.ownedByContext) {
      entry.buffer.destroy();
    }
    return true;
  }

  function listBuffers() {
    return Array.from(handles.values(), buildDescriptor);
  }

  function getDeviceInfo() {
    const lim = device.limits ?? {};
    return Object.freeze({
      abiVersion: SDN_GPU_ABI_VERSION,
      available: !destroyed,
      backendKind,
      backendCode,
      deviceId,
      adapterLabel,
      maxStorageBufferBindingSize: Number(lim.maxStorageBufferBindingSize ?? 0),
      maxBufferSize: Number(lim.maxBufferSize ?? 0),
      maxComputeWorkgroupSizeX: Number(lim.maxComputeWorkgroupSizeX ?? 256),
      maxComputeInvocationsPerWorkgroup: Number(lim.maxComputeInvocationsPerWorkgroup ?? 256),
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const entry of handles.values()) {
      if (entry.ownedByContext) entry.buffer.destroy();
    }
    handles.clear();
  }

  const context = {
    abiVersion: SDN_GPU_ABI_VERSION,
    deviceId,
    device,
    adapter: options.adapter ?? null,
    adapterLabel,
    backendKind,
    backendCode,
    getDeviceInfo,
    createBuffer,
    registerBuffer,
    getBuffer,
    describeBuffer,
    readBuffer,
    releaseBuffer,
    listBuffers,
    destroy,
  };
  return context;
}

/** Creates a runtime-host capability adapter for `gpu_compute` implementing v2 device/buffer operations. */
export function createGpuCapabilityAdapter(contextOrNull = null) {
  return {
    "device.info.v1"() {
      if (!contextOrNull) {
        return {
          abiVersion: SDN_GPU_ABI_VERSION,
          available: false,
          backendKind: "cpu-fallback",
          backendCode: SDN_GPU_BACKEND.CPU_FALLBACK,
          deviceId: 0,
        };
      }
      return contextOrNull.getDeviceInfo();
    },
    "buffer.create.v1"(params = {}) {
      if (!contextOrNull) {
        const err = new Error("GPU compute context unavailable.");
        err.gpuStatus = SDN_GPU_STATUS.UNAVAILABLE;
        throw err;
      }
      return contextOrNull.createBuffer(params);
    },
    "buffer.describe.v1"(params = {}) {
      if (!contextOrNull) {
        const err = new Error("GPU compute context unavailable.");
        err.gpuStatus = SDN_GPU_STATUS.UNAVAILABLE;
        throw err;
      }
      return contextOrNull.describeBuffer(params.handle ?? params.handleId);
    },
    "buffer.read.v1"(params = {}) {
      if (!contextOrNull) {
        const err = new Error("GPU compute context unavailable.");
        err.gpuStatus = SDN_GPU_STATUS.UNAVAILABLE;
        throw err;
      }
      return contextOrNull.readBuffer(params.handle ?? params.handleId, params.byteOffset ?? 0, params.byteLength ?? null);
    },
    "buffer.release.v1"(params = {}) {
      if (!contextOrNull) return { released: false };
      return { released: contextOrNull.releaseBuffer(params.handle ?? params.handleId) };
    },
  };
}
