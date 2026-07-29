import { createBrowserModuleHarness } from "../testing/browserModuleHarness.js";
import { sha256Bytes } from "../utils/crypto.js";
import { bytesToHex } from "../utils/encoding.js";
import { createFlowRuntimeHost } from "./flowRuntimeHost.js";

function exactArtifactBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  throw new TypeError(
    "Isomorphic child wasmSource must be exact Uint8Array-compatible signed artifact bytes.",
  );
}

function normalizePluginId(value) {
  const pluginId = String(value ?? "").trim();
  if (!pluginId) throw new TypeError("Isomorphic child pluginId is required.");
  return pluginId;
}

function frameU32(value, label) {
  const numeric = Number(value ?? 0);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 0xffffffff) {
    throw new RangeError(`${label} must fit an unsigned 32-bit integer.`);
  }
  return numeric;
}

function childRequestFrame(frame) {
  if (frame?.wireFormat === "aligned-binary") {
    throw new Error(
      "Separate isomorphic child instances require canonical FlatBuffer fallback; aligned frames need a proven shared arena.",
    );
  }
  return {
    portId: frame.portId,
    typeRef: frame.typeRef,
    payload: frame.bytes,
    streamId: frameU32(frame.streamId, "Input streamId"),
    sequence: frameU32(frame.sequence, "Input sequence"),
    endOfStream: frame.endOfStream,
    frameId: frame.frameId,
    ownership: "host-owned",
    mutability: "immutable",
  };
}

function flowOutputFrame(frame) {
  const wireFormat = frame?.typeRef?.wireFormat ?? frame?.wireFormat ?? "flatbuffer";
  if (wireFormat === "aligned-binary") {
    throw new Error(
      "Separate isomorphic child instances must emit canonical FlatBuffer fallback unless a shared arena is proven.",
    );
  }
  return {
    portId: frame.portId,
    typeRef: frame.typeRef,
    bytes: frame.payload,
    wireFormat,
    streamId: frameU32(frame.streamId, "Output streamId"),
    sequence: frameU32(frame.sequence, "Output sequence"),
    endOfStream: frame.endOfStream,
    frameId: frame.frameId,
    ownership: "host-owned",
    mutability: "immutable",
  };
}

/**
 * Instantiate one compiled flow runtime plus its exact hash-bound signed child
 * modules. The graph remains inside the parent WASM runtime: this adapter only
 * services graph-selected `isomorphic` invocation descriptors and converts
 * generic PIV/TAB frame envelopes without inspecting application schemas.
 */
export async function createIsomorphicFlowRuntimeHost(options = {}) {
  const parent = await createFlowRuntimeHost({
    wasmSource: options.wasmSource,
    imports: options.imports,
  });
  const declared = new Map();
  for (let index = 0; index < parent.dependencyCount; index += 1) {
    const descriptor = parent.getDependencyDescriptor(index);
    if (declared.has(descriptor.pluginId)) {
      throw new Error(`Flow declares duplicate dependency "${descriptor.pluginId}".`);
    }
    declared.set(descriptor.pluginId, descriptor);
  }

  const childRecords = new Map();
  const handlers = {};
  try {
    for (const child of options.children ?? []) {
      const pluginId = normalizePluginId(child?.pluginId);
      if (childRecords.has(pluginId)) {
        throw new Error(`Isomorphic child "${pluginId}" is supplied more than once.`);
      }
      const descriptor = declared.get(pluginId);
      if (!descriptor || !descriptor.sha256) {
        throw new Error(
          `Isomorphic child "${pluginId}" is not bound by a parent dependency SHA-256 descriptor.`,
        );
      }
      const artifactBytes = exactArtifactBytes(child.wasmSource);
      const sha256 = bytesToHex(await sha256Bytes(artifactBytes));
      if (sha256 !== descriptor.sha256) {
        throw new Error(
          `Isomorphic child "${pluginId}" hash mismatch: expected ${descriptor.sha256}, received ${sha256}.`,
        );
      }
      const harness = await createBrowserModuleHarness({
        wasmSource: artifactBytes,
        manifest: child.manifest,
        surface: child.surface ?? "direct",
        verifySignature: child.verifySignature,
        host: child.host,
        hostcallDispatch: child.hostcallDispatch,
        imports: child.imports,
      });
      const record = { pluginId, sha256, descriptor, harness };
      childRecords.set(pluginId, record);
      handlers[pluginId] = async ({ methodId, frames }) => {
        const response = await harness.invoke({
          methodId,
          inputs: frames.map(childRequestFrame),
        });
        return {
          statusCode: response.statusCode,
          yielded: response.yielded,
          backlogRemaining: response.backlogRemaining,
          outputs: response.outputs.map(flowOutputFrame),
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
        };
      };
    }

    for (let index = 0; index < parent.nodeCount; index += 1) {
      const node = parent.getNodeDispatchDescriptor(index);
      if (node.dispatchModel !== "isomorphic") continue;
      if (!childRecords.has(node.pluginId)) {
        throw new Error(
          `Flow is missing exact isomorphic child artifact "${node.pluginId}" for node "${node.nodeId}".`,
        );
      }
    }
  } catch (error) {
    for (const record of childRecords.values()) record.harness.destroy();
    throw error;
  }

  return {
    ...parent,
    parent,
    children: childRecords,
    async drain(drainOptions = {}) {
      const customHandlers = drainOptions.handlers ?? {};
      return parent.drain(
        { ...customHandlers, ...handlers },
        {
          ...drainOptions,
          handlers: undefined,
        },
      );
    },
    destroy() {
      for (const record of childRecords.values()) record.harness.destroy();
    },
  };
}
