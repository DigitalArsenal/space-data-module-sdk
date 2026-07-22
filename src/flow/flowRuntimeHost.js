/**
 * JS host for compiled SDN flow artifacts (WS3.2) — the browser/node
 * counterpart of the Go host (sdn-server internal/flowrt): the SAME
 * runtime.wasm produced by the flow compiler composes linked-direct chains
 * in the browser harness.
 *
 * Binds the space_data_module_runtime_* ABI (with `_`-prefixed fallbacks),
 * reads/writes the descriptor structs byte-for-byte as abi.go does
 * (dispatch 60B / dependency 72B / frame 48B / invocation 24B / node state
 * 32B / ingress state 24B, all little-endian), and provides the drain loop:
 * ready node -> begin invocation -> host handler OR linked-direct dispatch
 * -> apply -> complete. Linked-direct nodes run entirely inside the
 * artifact's linear memory; host-model nodes dispatch to the handler map
 * (keys resolved as pluginId:methodId, then dependencyId, nodeId, methodId).
 */

import { createBrowserWasiShim } from "../host/wasiShim.js";
import {
  isPayloadSchemaHashValid,
  normalizePayloadSchemaHash,
} from "../manifest/typeRefs.js";
import {
  ENGINE_REF_ENTRY_SIZE,
  instantiateFlatsqlLinkShim,
  isEngineBodyRefToken,
  readEngineRefEntry,
} from "./flatsqlLinkShim.js";

export const FLOW_INVALID_INDEX = 0xffffffff;

const FRAME_DESCRIPTOR_SIZE = 48;
const INVOCATION_DESCRIPTOR_SIZE = 24;
const DISPATCH_DESCRIPTOR_SIZE = 60;
const DEPENDENCY_DESCRIPTOR_SIZE = 72;
const NODE_STATE_SIZE = 32;
const INGRESS_STATE_SIZE = 24;
const ROUTING_STATE_SIZE = 32;

const WireFormatCode = Object.freeze({
  flatbuffer: 0,
  "aligned-binary": 1,
});
const OwnershipCode = Object.freeze({
  "host-owned": 0,
  "plugin-owned": 1,
  transferred: 2,
});
const MutabilityCode = Object.freeze({
  immutable: 0,
  mutable: 1,
  "single-writer-mutable": 1,
  "append-only": 2,
});

function normalizeWireFormat(value) {
  const normalized = String(value ?? "").toLowerCase().replace(/_/g, "-");
  if (value === 1 || normalized === "aligned-binary") return "aligned-binary";
  if (
    value === 0 ||
    value === undefined ||
    value === null ||
    normalized === "" ||
    normalized === "flatbuffer"
  ) {
    return "flatbuffer";
  }
  throw new TypeError(`Unsupported frame wire format: ${String(value)}.`);
}

function normalizeOwnership(value) {
  const normalized = String(value ?? "host-owned").toLowerCase().replace(/_/g, "-");
  if (value === 1 || normalized === "plugin-owned" || normalized === "producer-owned") {
    return "plugin-owned";
  }
  if (value === 2 || normalized === "transferred" || normalized === "shared") {
    return "transferred";
  }
  if (value === 0 || normalized === "host-owned" || normalized === "borrowed") {
    return "host-owned";
  }
  throw new TypeError(`Unsupported frame ownership: ${String(value)}.`);
}

function normalizeMutability(value) {
  const normalized = String(value ?? "immutable").toLowerCase().replace(/_/g, "-");
  if (value === 2 || normalized === "append-only") return "append-only";
  if (value === 1 || normalized === "mutable" || normalized === "single-writer-mutable") {
    return "single-writer-mutable";
  }
  if (value === 0 || normalized === "immutable") return "immutable";
  throw new TypeError(`Unsupported frame mutability: ${String(value)}.`);
}

function isPowerOfTwo(value) {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= 0xffff &&
    (value & (value - 1)) === 0
  );
}

function bytesEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function typeRefMatchesDescriptor(typeRef = {}, descriptor, wireFormat) {
  if (typeRef.schemaName && typeRef.schemaName !== descriptor.schemaName) return false;
  if (typeRef.fileIdentifier && typeRef.fileIdentifier !== descriptor.fileIdentifier) return false;
  if (typeRef.rootTypeName && typeRef.rootTypeName !== descriptor.rootTypeName) return false;
  if (typeRef.schemaVersion && typeRef.schemaVersion !== descriptor.schemaVersion) return false;

  const schemaHashInput = typeRef.schemaHash;
  if (schemaHashInput !== undefined && schemaHashInput !== null) {
    if (!isPayloadSchemaHashValid(schemaHashInput)) return false;
    const schemaHash = normalizePayloadSchemaHash(schemaHashInput);
    if (schemaHash?.length > 0 && !bytesEqual(schemaHash, descriptor.schemaHash)) return false;
  }

  if (wireFormat === "aligned-binary") {
    if (!descriptor.alignedEligible) return false;
    if (Number(typeRef.byteLength ?? 0) !== descriptor.alignedByteLength) return false;
    if (Number(typeRef.requiredAlignment ?? 0) !== descriptor.alignedRequiredAlignment) {
      return false;
    }
    if (
      typeRef.fixedStringLength !== undefined &&
      Number(typeRef.fixedStringLength) !== descriptor.alignedFixedStringLength
    ) {
      return false;
    }
  }
  return true;
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function exportFn(exports, name) {
  const fn = exports[name] ?? exports[`_${name}`];
  return typeof fn === "function" ? fn : null;
}

// Publication-protected artifacts (docs/module-publication-standard.md) append
// an SDS $REC record collection: payload || REC bytes || uint32le(REC length)
// || "$REC". Loaders strip the trailer before wasm compilation (loader
// expectation 6); signature/bundle-metadata verification stays a separate
// concern (bundle/signing.js verifyModuleArtifact).
const REC_TRAILER_FOOTER_LENGTH = 8;
const REC_TRAILER_MAGIC = [0x24, 0x52, 0x45, 0x43]; // "$REC"

export function stripPublicationTrailer(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < REC_TRAILER_FOOTER_LENGTH) {
    return bytes;
  }
  const footer = bytes.length - REC_TRAILER_FOOTER_LENGTH;
  for (let i = 0; i < 4; i += 1) {
    if (bytes[footer + 4 + i] !== REC_TRAILER_MAGIC[i]) return bytes;
  }
  const recLength =
    (bytes[footer] |
      (bytes[footer + 1] << 8) |
      (bytes[footer + 2] << 16) |
      (bytes[footer + 3] << 24)) >>>
    0;
  const payloadLength = footer - recLength;
  if (recLength === 0 || payloadLength < 0) return bytes;
  return bytes.subarray(0, payloadLength);
}

export async function createFlowRuntimeHost(options = {}) {
  let wasmModule = options.wasmModule ?? null;
  if (!wasmModule) {
    const source = options.wasmSource ?? options.wasmBytes;
    if (!source) {
      throw new TypeError("createFlowRuntimeHost requires wasmSource bytes or a wasmModule.");
    }
    const bytes = stripPublicationTrailer(
      source instanceof Uint8Array ? source : new Uint8Array(source),
    );
    wasmModule = await WebAssembly.compile(bytes.slice().buffer);
  }

  const wasi = createBrowserWasiShim({
    args: options.args ?? ["flow-runtime"],
    env: options.env ?? {},
    logOutput: options.logOutput === true,
  });
  const imports = { ...wasi.imports, ...(options.extraImports ?? {}) };
  // Direct engine linkage (loop C.7): a LINKED flow artifact imports the live
  // FlatSQL engine's function exports (module "flatsql") and the tiny
  // memory-crossing shim (module "flatsql_link", instantiated here against
  // the SAME engine memory) — the browser-native form of the server's
  // VM.RegisterModule instance sharing.
  const engineLink = options.engineLink ?? null;
  if (engineLink) {
    if (!engineLink.exports || !(engineLink.exports.memory instanceof WebAssembly.Memory)) {
      throw new TypeError(
        "createFlowRuntimeHost engineLink requires the live engine's exports (with memory).",
      );
    }
    const shimInstance = await instantiateFlatsqlLinkShim(engineLink.exports);
    imports.flatsql = engineLink.exports;
    imports.flatsql_link = shimInstance.exports;
  }
  if (options.legacyHostImportCompat === true) {
    // Legacy compiled-flow artifacts import a `sdn_flow_host` module; stub its
    // dispatch entry (0 = caller wins) so they instantiate under plain
    // WebAssembly.instantiate. Ported from orbpro-integration's
    // withLegacyHostImportCompat; the module name + stub are ABI contracts.
    imports.sdn_flow_host = {
      dispatch_current_invocation: () => 0,
      ...(imports.sdn_flow_host ?? {}),
    };
  }
  const instance = await WebAssembly.instantiate(wasmModule, imports);
  const exports = instance.exports;
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error("Flow artifact exports no memory.");
  }
  wasi.setMemory(memory);
  exportFn(exports, "_initialize")?.();

  if (engineLink) {
    const linkInit = exportFn(exports, "sdn_flatsql_link_init");
    if (!linkInit) {
      throw new Error(
        "engineLink was provided but the flow artifact exports no sdn_flatsql_link_init " +
          "(compile the flow with engineLinkage: \"flatsql\").",
      );
    }
    linkInit(engineLink.dbHandle | 0);
  }

  const malloc = exportFn(exports, "malloc");
  if (!malloc) {
    throw new Error("Flow artifact must export malloc for host-side frame allocation.");
  }
  const free = exportFn(exports, "free");
  if (!free) {
    throw new Error("Flow artifact must export free for host-side frame lifetime management.");
  }

  const call = (name, ...args) => {
    const fn = exportFn(exports, `space_data_module_runtime_${name}`);
    if (!fn) {
      throw new Error(`Flow artifact missing export space_data_module_runtime_${name}`);
    }
    return fn(...args);
  };
  const view = () => new DataView(memory.buffer);
  const bytesAt = (ptr, length) => new Uint8Array(memory.buffer, ptr, length).slice();

  function readCString(ptr, maxLength = 1024) {
    if (!ptr) return "";
    const heap = new Uint8Array(memory.buffer);
    let end = ptr;
    const limit = Math.min(heap.length, ptr + maxLength);
    while (end < limit && heap[end] !== 0) end++;
    return textDecoder.decode(heap.subarray(ptr, end));
  }

  function writeBytes(ptr, bytes) {
    new Uint8Array(memory.buffer).set(bytes, ptr);
  }

  function allocTracked(size, allocations, description) {
    const ptr = malloc(size);
    if (!ptr) throw new Error(`${description} malloc(${size}) failed in flow artifact`);
    allocations.push(ptr);
    return ptr;
  }

  function releaseAllocations(allocations) {
    for (let index = allocations.length - 1; index >= 0; index -= 1) {
      free(allocations[index]);
    }
    allocations.length = 0;
  }

  function allocAlignedBytes(bytes, alignment = 1, allocations = []) {
    if (!isPowerOfTwo(alignment)) {
      throw new RangeError(`Frame alignment ${alignment} must be a positive power of two.`);
    }
    if (bytes.length === 0) return 0;
    const rawPtr = allocTracked(
      bytes.length + alignment - 1,
      allocations,
      "aligned frame payload",
    );
    const ptr = Math.ceil(rawPtr / alignment) * alignment;
    writeBytes(ptr, bytes);
    return ptr;
  }

  function allocCString(text, allocations = []) {
    const encoded = textEncoder.encode(String(text ?? ""));
    const ptr = allocTracked(
      encoded.length + 1,
      allocations,
      "frame port string",
    );
    writeBytes(ptr, encoded);
    new Uint8Array(memory.buffer)[ptr + encoded.length] = 0;
    return ptr;
  }

  function writeFrameDescriptor(ptr, frame) {
    const v = view();
    v.setUint32(ptr + 0, frame.ingressIndex ?? 0, true);
    v.setUint32(ptr + 4, frame.typeDescriptorIdx ?? FLOW_INVALID_INDEX, true);
    v.setUint32(ptr + 8, frame.portIdPtr ?? 0, true);
    v.setUint32(ptr + 12, frame.alignment ?? 1, true);
    v.setUint32(ptr + 16, frame.offset ?? 0, true);
    v.setUint32(ptr + 20, frame.size ?? 0, true);
    v.setUint32(ptr + 24, frame.streamId ?? 0, true);
    v.setUint32(ptr + 28, frame.sequence ?? 0, true);
    v.setBigUint64(ptr + 32, BigInt(frame.traceToken ?? 0), true);
    v.setUint8(ptr + 40, frame.endOfStream ? 1 : 0);
    v.setUint8(ptr + 41, frame.occupied === false ? 0 : 1);
    v.setUint8(ptr + 42, frame.wireFormat ?? 0);
    v.setUint8(ptr + 43, frame.ownership ?? 0);
    v.setUint8(ptr + 44, frame.mutability ?? 0);
    v.setUint8(ptr + 45, frame.lifetime ?? 0);
    v.setUint16(ptr + 46, 0, true);
  }

  function readFrameDescriptor(ptr) {
    const v = view();
    return {
      ingressIndex: v.getUint32(ptr + 0, true),
      typeDescriptorIdx: v.getUint32(ptr + 4, true),
      portIdPtr: v.getUint32(ptr + 8, true),
      alignment: v.getUint32(ptr + 12, true),
      offset: v.getUint32(ptr + 16, true),
      size: v.getUint32(ptr + 20, true),
      streamId: v.getUint32(ptr + 24, true),
      sequence: v.getUint32(ptr + 28, true),
      traceToken: v.getBigUint64(ptr + 32, true),
      endOfStream: v.getUint8(ptr + 40) !== 0,
      occupied: v.getUint8(ptr + 41) !== 0,
      wireFormat: v.getUint8(ptr + 42),
      ownership: v.getUint8(ptr + 43),
      mutability: v.getUint8(ptr + 44),
      lifetime: v.getUint8(ptr + 45),
    };
  }

  function readU32Fields(ptr, names) {
    const v = view();
    const out = {};
    names.forEach((name, i) => {
      out[name] = v.getUint32(ptr + i * 4, true);
    });
    return out;
  }

  let nextExternalFrameId = 1n;

  const host = {
    instance,
    memory,
    nodeCount: call("get_node_descriptor_count") >>> 0,
    typeDescriptorCount: call("get_edge_descriptor_count") >>> 0,
    edgeCount: call("get_route_edge_descriptor_count") >>> 0,
    triggerCount: call("get_trigger_descriptor_count") >>> 0,
    dependencyCount: call("get_dependency_descriptor_count") >>> 0,

    resetState() {
      call("reset_state");
    },

    readCString,

    getNodeDispatchDescriptor(index) {
      const base = call("get_node_dispatch_descriptors") >>> 0;
      if (!base) throw new Error("no dispatch descriptors");
      const d = readU32Fields(base + index * DISPATCH_DESCRIPTOR_SIZE, [
        "nodeIdPtr", "nodeIndex", "dependencyIdPtr", "dependencyIndex",
        "pluginIdPtr", "methodIdPtr", "dispatchModelPtr", "entrypointPtr",
        "manifestBytesSymbolPtr", "manifestSizeSymbolPtr",
        "initSymbolPtr", "destroySymbolPtr",
        "mallocSymbolPtr", "freeSymbolPtr", "streamInvokeSymbolPtr",
      ]);
      return {
        ...d,
        nodeId: readCString(d.nodeIdPtr),
        dependencyId: readCString(d.dependencyIdPtr),
        pluginId: readCString(d.pluginIdPtr),
        methodId: readCString(d.methodIdPtr),
        dispatchModel: readCString(d.dispatchModelPtr),
      };
    },

    getDependencyDescriptor(index) {
      const base = call("get_dependency_descriptors") >>> 0;
      if (!base) throw new Error("no dependency descriptors");
      const d = readU32Fields(base + index * DEPENDENCY_DESCRIPTOR_SIZE, [
        "dependencyIdPtr", "pluginIdPtr", "versionPtr", "sha256Ptr",
        "signaturePtr", "signerPublicKeyPtr", "entrypointPtr",
        "manifestBytesSymbolPtr", "manifestSizeSymbolPtr",
        "initSymbolPtr", "destroySymbolPtr",
        "mallocSymbolPtr", "freeSymbolPtr", "streamInvokeSymbolPtr",
        "wasmBytesPtr", "wasmSize", "manifestBytesPtr", "manifestSize",
      ]);
      return {
        ...d,
        dependencyId: readCString(d.dependencyIdPtr),
        pluginId: readCString(d.pluginIdPtr),
        version: readCString(d.versionPtr),
        sha256: readCString(d.sha256Ptr) || null,
        signature: readCString(d.signaturePtr) || null,
        signerPublicKey: readCString(d.signerPublicKeyPtr) || null,
      };
    },

    getEdgeDescriptor(index) {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= this.typeDescriptorCount
      ) {
        throw new RangeError(`edge descriptor index ${index} is out of range`);
      }
      const base = call("get_edge_descriptors") >>> 0;
      if (!base) throw new Error("no edge descriptors");
      const ptr = base + index * 64;
      const d = readU32Fields(ptr, [
        "fromNode", "fromPortPtr", "toNode", "toPortPtr",
        "schemaNamePtr", "fileIdentifierPtr", "schemaVersionPtr",
        "schemaHashPtr", "schemaHashSize", "rootTypeNamePtr",
        "canonicalFallbackAvailable", "alignedEligible", "alignedLayoutFields",
        "alignedByteLength", "alignedFixedStringLength", "alignedRequiredAlignment",
      ]);
      return {
        ...d,
        fromPort: readCString(d.fromPortPtr),
        toPort: readCString(d.toPortPtr),
        schemaName: readCString(d.schemaNamePtr),
        fileIdentifier: readCString(d.fileIdentifierPtr),
        schemaVersion: readCString(d.schemaVersionPtr) || null,
        schemaHash:
          d.schemaHashPtr && d.schemaHashSize
            ? bytesAt(d.schemaHashPtr, d.schemaHashSize)
            : new Uint8Array(),
        rootTypeName: readCString(d.rootTypeNamePtr),
      };
    },

    getTypeDescriptor(index) {
      return index < this.typeDescriptorCount
        ? this.getEdgeDescriptor(index)
        : null;
    },

    getRoutingState() {
      const ptr = call("get_routing_state") >>> 0;
      if (!ptr || ptr + ROUTING_STATE_SIZE > memory.buffer.byteLength) {
        throw new Error("no routing state");
      }
      const v = view();
      return {
        alignedSharedRoutes: v.getBigUint64(ptr + 0, true),
        alignedCopiedRoutes: v.getBigUint64(ptr + 8, true),
        canonicalRoutes: v.getBigUint64(ptr + 16, true),
        rejectedFrames: v.getBigUint64(ptr + 24, true),
      };
    },

    getNodeState(index) {
      const base = call("get_node_states") >>> 0;
      if (!base) throw new Error("no node states");
      const ptr = base + index * NODE_STATE_SIZE;
      const v = view();
      return {
        invocationCount: v.getBigUint64(ptr + 0, true),
        consumedFrames: v.getBigUint64(ptr + 8, true),
        queuedFrames: v.getUint32(ptr + 16, true),
        backlogRemaining: v.getUint32(ptr + 20, true),
        lastStatus: v.getUint32(ptr + 24, true),
        ready: v.getUint8(ptr + 28) !== 0,
        yielded: v.getUint8(ptr + 29) !== 0,
      };
    },

    getIngressState(index) {
      const base = call("get_ingress_states") >>> 0;
      if (!base) throw new Error("no ingress states");
      const ptr = base + index * INGRESS_STATE_SIZE;
      const v = view();
      return {
        totalReceived: v.getBigUint64(ptr + 0, true),
        totalDropped: v.getBigUint64(ptr + 8, true),
        queuedFrames: v.getUint32(ptr + 16, true),
      };
    },

    /**
     * Engine body-reference resolution (loop C.7 direct linkage): tokens with
     * the "SDNE" magic reference an artifact materialized in ENGINE memory by
     * a direct in-wasm query. The entry lives in the flow's exported ref
     * table; the bytes are copied straight out of the engine's linear memory
     * (the JS counterpart of the Go harvest under the store engine lock —
     * single-threaded JS needs no lock). Returns null for unknown tokens.
     */
    resolveEngineBodyRef(token) {
      if (!engineLink || !isEngineBodyRefToken(token)) return null;
      const tablePtr = exportFn(exports, "sdn_flatsql_link_ref_table")?.() >>> 0;
      const slots = exportFn(exports, "sdn_flatsql_link_ref_slots")?.() >>> 0;
      if (!tablePtr || !slots) return null;
      const v = view();
      for (let i = 0; i < slots; i++) {
        const entry = readEngineRefEntry(v, tablePtr + i * ENGINE_REF_ENTRY_SIZE);
        if (!entry.used || entry.token !== BigInt(token)) continue;
        const engineHeap = new Uint8Array(engineLink.exports.memory.buffer);
        return {
          ...entry,
          bytes: engineHeap.slice(entry.enginePtr, entry.enginePtr + entry.size),
        };
      }
      return null;
    },

    enqueueTrigger(triggerIndex) {
      call("enqueue_trigger_frames", triggerIndex);
    },

    enqueueTriggerFrame(triggerIndex, frame = {}) {
      const allocations = [];
      try {
        const payload =
          frame.bytes instanceof Uint8Array
            ? frame.bytes
            : frame.bytes
              ? new Uint8Array(frame.bytes)
              : new Uint8Array(0);
        const typeRef = frame.typeRef ?? {};
        const wireFormat = normalizeWireFormat(typeRef.wireFormat ?? frame.wireFormat);
        const alignment = Number(
          frame.alignment ??
            (wireFormat === "aligned-binary" ? typeRef.requiredAlignment : 1) ??
            1,
        );
        if (!isPowerOfTwo(alignment)) {
          throw new RangeError(`Frame alignment ${alignment} must be a positive power of two.`);
        }
        if (
          wireFormat === "aligned-binary" &&
          Number(typeRef.byteLength ?? 0) !== payload.length
        ) {
          throw new RangeError(
            `Aligned frame byteLength ${typeRef.byteLength ?? 0} does not match payload length ${payload.length}.`,
          );
        }
        let typeDescriptorIdx = FLOW_INVALID_INDEX;
        const explicitType =
          wireFormat === "aligned-binary" ||
          [
            "schemaName", "fileIdentifier", "rootTypeName", "schemaVersion",
            "schemaHash", "byteLength", "fixedStringLength", "requiredAlignment",
          ].some((field) => typeRef[field] !== undefined && typeRef[field] !== null);
        if (explicitType) {
          for (let index = 0; index < this.typeDescriptorCount; index += 1) {
            const descriptor = this.getEdgeDescriptor(index);
            if (!typeRefMatchesDescriptor(typeRef, descriptor, wireFormat)) continue;
            typeDescriptorIdx = index;
            break;
          }
          if (typeDescriptorIdx === FLOW_INVALID_INDEX) {
            throw new Error("Trigger frame does not match any compiled exact SDS identity.");
          }
        }
        const ownershipName = normalizeOwnership(frame.ownership);
        const mutabilityName = normalizeMutability(frame.mutability);
        if (mutabilityName !== "immutable" && ownershipName !== "transferred") {
          throw new Error("Mutable aligned frames require transferred ownership.");
        }
        const payloadPtr =
          payload.length > 0
            ? allocAlignedBytes(payload, alignment, allocations)
            : 0;
        const portPtr = frame.portId ? allocCString(frame.portId, allocations) : 0;
        const framePtr = allocTracked(
          FRAME_DESCRIPTOR_SIZE,
          allocations,
          "frame descriptor",
        );
        const frameId = BigInt(frame.frameId ?? frame.traceToken ?? nextExternalFrameId++);
        writeFrameDescriptor(framePtr, {
          typeDescriptorIdx,
          portIdPtr: portPtr,
          alignment,
          offset: payloadPtr,
          size: payload.length,
          streamId: frame.streamId ?? 0,
          sequence: frame.sequence ?? 0,
          traceToken: frameId,
          endOfStream: frame.endOfStream === true,
          occupied: true,
          wireFormat: WireFormatCode[wireFormat],
          ownership: OwnershipCode[ownershipName],
          mutability: MutabilityCode[mutabilityName],
        });
        const enqueued = call("enqueue_trigger_frame", triggerIndex, framePtr) | 0;
        if (enqueued < 0) {
          throw new Error(`Flow runtime rejected trigger frame (${enqueued}).`);
        }
        return enqueued;
      } finally {
        releaseAllocations(allocations);
      }
    },

    /**
     * Drain the flow: mirrors the Go host loop. handlers maps
     * "pluginId:methodId" (or dependencyId / nodeId / methodId) to
     * async ({nodeIndex, pluginId, methodId, dependencyId, nodeId, frames})
     * -> { statusCode?, outputs?: [{portId, bytes, ...}] }.
     */
    async drain(handlers = {}, options = {}) {
      const maxIterations = options.maxIterations ?? 1000;
      const result = { iterations: 0, nodesInvoked: 0, handlersSkipped: 0 };
      // In-wasm scheduler loop (loop C.5c): artifacts exporting
      // space_data_module_runtime_drain_linked run all ready linked-direct
      // nodes inside ONE call; the host loop then only services host-model
      // nodes. Older artifacts fall back to per-node driving below.
      const drainLinked = exportFn(exports, "space_data_module_runtime_drain_linked");

      for (let i = 0; i < maxIterations; i++) {
        if (drainLinked) {
          const dispatched = drainLinked(maxIterations) | 0;
          if (dispatched > 0) {
            result.nodesInvoked += dispatched;
            result.iterations += dispatched;
          }
        }
        const nodeIndex = call("get_ready_node_index") >>> 0;
        if (nodeIndex === FLOW_INVALID_INDEX) break;
        result.iterations++;

        const consumed = call("begin_node_invocation", nodeIndex, options.frameBudget ?? 64);
        if (consumed < 0) {
          call("complete_node_invocation", nodeIndex);
          continue;
        }
        const descPtr = call("get_current_invocation_descriptor") >>> 0;
        if (!descPtr || descPtr === FLOW_INVALID_INDEX) {
          call("complete_node_invocation", nodeIndex);
          continue;
        }
        const inv = readU32Fields(descPtr, [
          "nodeIndex", "dispatchDescriptorIdx", "pluginIdPtr", "methodIdPtr",
          "framesPtr", "frameCount",
        ]);
        const pluginId = readCString(inv.pluginIdPtr);
        const methodId = readCString(inv.methodIdPtr);
        let dependencyId = "";
        let nodeId = "";
        let dispatchModel = "";
        if (inv.dispatchDescriptorIdx !== FLOW_INVALID_INDEX) {
          const dd = this.getNodeDispatchDescriptor(inv.dispatchDescriptorIdx);
          dependencyId = dd.dependencyId;
          nodeId = dd.nodeId;
          dispatchModel = dd.dispatchModel;
        }

        const handler =
          handlers[`${pluginId}:${methodId}`] ??
          handlers[dependencyId] ??
          handlers[nodeId] ??
          handlers[methodId] ??
          null;

        if (!handler) {
          // No host handler: linked-direct nodes run entirely inside the
          // artifact — do NOT copy their (possibly large) input frames out of
          // linear memory just to discard them (loop C.5c copy elimination;
          // mirrors the Go host's drain).
          result.handlersSkipped++;
          if (dispatchModel === "linked-direct") {
            call("dispatch_current_invocation_direct", options.frameBudget ?? 64);
            call("complete_node_invocation", nodeIndex);
            result.nodesInvoked++;
            continue;
          }
          call("complete_node_invocation", nodeIndex);
          continue;
        }

        const frames = [];
        for (let f = 0; f < inv.frameCount; f++) {
          const fd = readFrameDescriptor(inv.framesPtr + f * FRAME_DESCRIPTOR_SIZE);
          if (!fd.occupied) continue;
          const typeDescriptor = this.getTypeDescriptor(fd.typeDescriptorIdx);
          const wireFormat = fd.wireFormat === 1 ? "aligned-binary" : "flatbuffer";
          const typeRef = typeDescriptor
            ? {
                schemaName: typeDescriptor.schemaName,
                fileIdentifier: typeDescriptor.fileIdentifier,
                ...(typeDescriptor.schemaVersion
                  ? { schemaVersion: typeDescriptor.schemaVersion }
                  : {}),
                ...(typeDescriptor.schemaHash.length > 0
                  ? { schemaHash: typeDescriptor.schemaHash }
                  : {}),
                rootTypeName: typeDescriptor.rootTypeName,
                wireFormat,
                ...(wireFormat === "aligned-binary"
                  ? {
                      byteLength: typeDescriptor.alignedByteLength,
                      ...(typeDescriptor.alignedFixedStringLength > 0
                        ? { fixedStringLength: typeDescriptor.alignedFixedStringLength }
                        : {}),
                      requiredAlignment: typeDescriptor.alignedRequiredAlignment,
                    }
                  : {}),
              }
            : null;
          frames.push({
            portId: readCString(fd.portIdPtr),
            bytes: fd.size > 0 && fd.offset > 0 ? bytesAt(fd.offset, fd.size) : new Uint8Array(0),
            typeRef,
            wireFormat,
            alignment: fd.alignment,
            ownership: ["host-owned", "plugin-owned", "transferred"][fd.ownership] ?? "unknown",
            mutability: ["immutable", "single-writer-mutable", "append-only"][fd.mutability] ?? "unknown",
            frameId: fd.traceToken,
            arenaGeneration: fd.ingressIndex,
            streamId: fd.streamId,
            sequence: fd.sequence,
            endOfStream: fd.endOfStream,
          });
        }

        let handlerResult;
        try {
          handlerResult = (await handler({
            nodeIndex, pluginId, methodId, dependencyId, nodeId, frames,
          })) ?? {};
        } catch (error) {
          handlerResult = { statusCode: -1, error };
        }

        const outputs = Array.isArray(handlerResult.outputs) ? handlerResult.outputs : [];
        const allocations = [];
        let framesPtr = 0;
        try {
          if (outputs.length > 0) {
            framesPtr = allocTracked(
              outputs.length * FRAME_DESCRIPTOR_SIZE,
              allocations,
              "invocation output descriptors",
            );
            outputs.forEach((out, idx) => {
              const payload =
                out.bytes instanceof Uint8Array
                  ? out.bytes
                  : new Uint8Array(out.bytes ?? []);
              const outputTypeRef = out.typeRef ?? {};
              const outputWireFormat = normalizeWireFormat(
                outputTypeRef.wireFormat ?? out.wireFormat,
              );
              let typeDescriptorIdx = FLOW_INVALID_INDEX;
              let hasOutgoingPort = false;
              for (let edgeIndex = 0; edgeIndex < this.edgeCount; edgeIndex += 1) {
                const edge = this.getEdgeDescriptor(edgeIndex);
                if (edge.fromNode !== nodeIndex || edge.fromPort !== out.portId) continue;
                hasOutgoingPort = true;
                if (!typeRefMatchesDescriptor(outputTypeRef, edge, outputWireFormat)) continue;
                typeDescriptorIdx = edgeIndex;
                break;
              }
              if (hasOutgoingPort && typeDescriptorIdx === FLOW_INVALID_INDEX) {
                throw new Error(
                  `Output frame on port "${out.portId ?? ""}" does not match the compiled exact SDS identity.`,
                );
              }
              const alignment = Number(
                out.alignment ??
                  (outputWireFormat === "aligned-binary"
                    ? outputTypeRef.requiredAlignment
                    : 1) ??
                  1,
              );
              if (!isPowerOfTwo(alignment)) {
                throw new RangeError(
                  `Frame alignment ${alignment} must be a positive power of two.`,
                );
              }
              if (
                outputWireFormat === "aligned-binary" &&
                Number(outputTypeRef.byteLength ?? 0) !== payload.length
              ) {
                throw new RangeError(
                  `Aligned frame byteLength ${outputTypeRef.byteLength ?? 0} does not match payload length ${payload.length}.`,
                );
              }
              const ownershipName = normalizeOwnership(out.ownership);
              const mutabilityName = normalizeMutability(out.mutability);
              if (mutabilityName !== "immutable" && ownershipName !== "transferred") {
                throw new Error("Mutable aligned frames require transferred ownership.");
              }
              writeFrameDescriptor(framesPtr + idx * FRAME_DESCRIPTOR_SIZE, {
                ingressIndex: call("get_current_invocation_generation") >>> 0,
                typeDescriptorIdx,
                portIdPtr: out.portId ? allocCString(out.portId, allocations) : 0,
                alignment,
                offset:
                  payload.length > 0
                    ? allocAlignedBytes(payload, alignment, allocations)
                    : 0,
                size: payload.length,
                streamId: out.streamId ?? 0,
                sequence: out.sequence ?? 0,
                traceToken: BigInt(out.frameId ?? nextExternalFrameId++),
                endOfStream: out.endOfStream === true,
                occupied: true,
                wireFormat: WireFormatCode[outputWireFormat],
                ownership: OwnershipCode[ownershipName],
                mutability: MutabilityCode[mutabilityName],
                lifetime: 1,
              });
            });
          }
          const applied = call(
            "apply_node_invocation_result",
            nodeIndex,
            handlerResult.statusCode ?? 0,
            handlerResult.backlogRemaining ?? 0,
            handlerResult.yielded ? 1 : 0,
            framesPtr,
            outputs.length,
          ) | 0;
          if (applied < 0) {
            throw new Error(`Flow runtime rejected invocation outputs (${applied}).`);
          }
        } finally {
          releaseAllocations(allocations);
          call("complete_node_invocation", nodeIndex);
        }
        result.nodesInvoked++;
      }
      return result;
    },
  };

  return host;
}
