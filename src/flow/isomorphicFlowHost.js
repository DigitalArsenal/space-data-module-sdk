import { SDS_MANIFEST_SECTION_NAME } from "../bundle/constants.js";
import { DOMAIN_MODULE_PUBLICATION_V1 } from "../bundle/sigdomain.js";
import {
  resolveTrustedModuleSignaturePolicy,
  verifyTrustedModuleArtifact,
} from "../bundle/trustPolicy.js";
import { getWasmCustomSections } from "../bundle/wasm.js";
import { decodePlgManifest } from "../manifest/plgCodec.js";
import { createBrowserModuleHarness } from "../host/browserModuleHarness.js";
import { extractPublicationRecordCollection } from "../transport/records.js";
import { sha256Bytes } from "../utils/crypto.js";
import { bytesToHex } from "../utils/encoding.js";
import { createFlowRuntimeHost } from "./flowRuntimeHost.js";

function exactArtifactBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  }
  if (Array.isArray(source)) return new Uint8Array(source);
  throw new TypeError(
    "Isomorphic artifacts and PLG byte vectors must be exact Uint8Array-compatible bytes.",
  );
}

function normalizePluginId(value) {
  const pluginId = String(value ?? "").trim();
  if (!pluginId) throw new TypeError("Isomorphic child pluginId is required.");
  return pluginId;
}

function normalizeNodeId(value) {
  const nodeId = String(value ?? "").trim();
  if (!nodeId) throw new TypeError("Isomorphic flow nodeId is required.");
  return nodeId;
}

function decodeCanonicalPlg(bytes, description) {
  try {
    return decodePlgManifest(bytes);
  } catch (error) {
    throw new Error(
      `${description} is not a decodable canonical PLG manifest: ${error?.message ?? error}`,
    );
  }
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The parent flow's PLG manifest, read ONLY from bytes its signature covers
 * (security audit 2026-10-15, SEC-021). Per-node CONFIG comes from this
 * manifest, so reading it from an unsigned place lets a mirror or relay change
 * what a "verified" flow does without the publisher's key.
 *
 *  - bundle scope: the signature binds the MBL, so the MBL "manifest" entry is
 *    signed. The payload's sds.manifest section is not (the canonical hash
 *    strips sds.*); if one is present it must be byte-identical.
 *  - module scope under SDN-MODULE-PUBLICATION-V1 (node-signed): the signature
 *    binds sha256(portable payload), so the payload's sds.manifest section is
 *    signed and the trailer is not; a trailer manifest must match it.
 *  - legacy bare-digest module scope: neither place is signed. Refused.
 *  - verification null (explicit verifySignature: false, local debugging):
 *    either source, and two sources must agree.
 */
function embeddedFlowManifest(artifactBytes, verification) {
  const publication = extractPublicationRecordCollection(artifactBytes);
  let trailerManifest = null;
  for (const entry of publication?.mbl?.entries ?? []) {
    if (
      entry?.entryId === "manifest" ||
      entry?.sectionName === SDS_MANIFEST_SECTION_NAME
    ) {
      trailerManifest = exactArtifactBytes(entry.payload);
      break;
    }
  }
  const portableBytes = publication?.payloadBytes ?? artifactBytes;
  const sectionManifest =
    getWasmCustomSections(portableBytes, SDS_MANIFEST_SECTION_NAME)[0] ?? null;

  if (trailerManifest && sectionManifest && !bytesEqual(trailerManifest, sectionManifest)) {
    throw new Error(
      `Isomorphic flow artifact carries two different PLG manifests (MBL entry and ${SDS_MANIFEST_SECTION_NAME} section); refusing to choose one.`,
    );
  }

  let signedBytes;
  if (verification === null) {
    signedBytes = trailerManifest ?? sectionManifest;
  } else if (verification?.signatureScope === "bundle") {
    signedBytes = trailerManifest;
  } else if (
    verification?.signatureScope === "module" &&
    verification?.statementDomain === DOMAIN_MODULE_PUBLICATION_V1
  ) {
    signedBytes = sectionManifest;
  } else {
    throw new Error(
      "Isomorphic flow artifact is signed with a bare-digest module-scope signature, which covers neither its MBL manifest nor its sds.manifest section; sign the flow with signatureScope \"bundle\".",
    );
  }
  if (!signedBytes) {
    throw new Error(
      `Isomorphic flow artifact embeds no signed ${SDS_MANIFEST_SECTION_NAME} PLG manifest for its signature scope.`,
    );
  }
  return decodeCanonicalPlg(
    signedBytes,
    verification === null ? "Unverified flow manifest" : "Signed flow manifest",
  );
}

function flowManifestNodes(manifest) {
  const nodes = new Map();
  for (const node of manifest?.flowNodes ?? []) {
    const nodeId = normalizeNodeId(node?.nodeId);
    if (nodes.has(nodeId)) {
      throw new Error(`Flow PLG declares duplicate node "${nodeId}".`);
    }
    nodes.set(nodeId, {
      nodeId,
      pluginId: normalizePluginId(node?.pluginId),
      config:
        node?.config === undefined || node?.config === null
          ? new Uint8Array(0)
          : exactArtifactBytes(node.config).slice(),
    });
  }
  return nodes;
}

function canonicalConfigInput(manifest, methodId, nodeId) {
  const method = (manifest?.methods ?? []).find(
    (candidate) => candidate?.methodId === methodId,
  );
  const port = (method?.inputPorts ?? []).find(
    (candidate) => candidate?.portId === "config",
  );
  if (!port) {
    throw new Error(
      `Isomorphic node "${nodeId}" has signed CONFIG bytes, but child method "${methodId}" declares no generic config input port.`,
    );
  }
  const canonicalType = (port.acceptedTypeSets ?? [])
    .flatMap((typeSet) => typeSet?.allowedTypes ?? [])
    .find((typeRef) => {
      const wireFormat = String(typeRef?.wireFormat ?? "flatbuffer")
        .trim()
        .toLowerCase()
        .replace(/_/g, "-");
      return wireFormat === "flatbuffer";
    });
  if (!canonicalType) {
    throw new Error(
      `Isomorphic node "${nodeId}" config input has no canonical FlatBuffer representation.`,
    );
  }
  return {
    portId: port.portId,
    typeRef: { ...canonicalType, wireFormat: "flatbuffer" },
  };
}

function childEmbeddedManifest(harness, nodeId) {
  const manifestBytes = harness.readManifest();
  if (manifestBytes) {
    return decodeCanonicalPlg(
      manifestBytes,
      `Isomorphic node "${nodeId}" child manifest`,
    );
  }
  throw new Error(
    `Isomorphic node "${nodeId}" has signed CONFIG bytes, but its child artifact exposes no PLG manifest.`,
  );
}

function configRequestFrame(configInput, config) {
  return {
    portId: configInput.portId,
    typeRef: configInput.typeRef,
    wireFormat: "flatbuffer",
    payload: config.slice(),
    ownership: "host-owned",
    mutability: "immutable",
  };
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
 * Instantiate one compiled flow runtime plus one exact hash-bound signed child
 * instance per isomorphic graph node. Artifact verification remains keyed by
 * plugin dependency while instance state, signed opaque CONFIG, and dispatch
 * remain keyed by nodeId. The adapter converts generic PIV/TAB frame envelopes
 * without inspecting application schemas.
 */
export async function createIsomorphicFlowRuntimeHost(options = {}) {
  if (options.wasmModule !== undefined && options.wasmModule !== null) {
    throw new TypeError(
      "Isomorphic flow hosting rejects a precompiled WebAssembly.Module because it cannot prove that module matches the signed parent PLG artifact bytes.",
    );
  }
  const parentArtifactBytes = exactArtifactBytes(
    options.wasmSource ?? options.wasmBytes,
  );
  // FAIL CLOSED (SEC-008): a trust policy is required, it always requires a
  // signature, and the result must say verified. The only way to run an
  // unverified flow is the explicit verifySignature: false (local debugging).
  const parentSignaturePolicy = resolveTrustedModuleSignaturePolicy(options);
  const parentVerification = parentSignaturePolicy
    ? await verifyTrustedModuleArtifact(parentArtifactBytes, parentSignaturePolicy)
    : null;
  const manifestNodes = flowManifestNodes(
    embeddedFlowManifest(parentArtifactBytes, parentVerification),
  );
  const parent = await createFlowRuntimeHost({
    wasmSource: parentArtifactBytes,
    // UNCONDITIONAL, with no opt-out. This host mounts every isomorphic child
    // through the BROWSER module harness, whose gate cannot be turned off — so
    // an escape hatch here would only ever produce an ungated parent with
    // gated children, and a half-gate is not a gate. There is no legitimate
    // non-browser use of this host precisely because of that mount; callers
    // that want the runtime-agnostic host call createFlowRuntimeHost, which
    // does take a stated leg.
    runtimeTarget: "browser",
    args: options.args,
    env: options.env,
    logOutput: options.logOutput,
    extraImports: options.extraImports,
    legacyHostImportCompat: options.legacyHostImportCompat,
    engineLink: options.engineLink,
  });
  const declared = new Map();
  for (let index = 0; index < parent.dependencyCount; index += 1) {
    const descriptor = parent.getDependencyDescriptor(index);
    if (declared.has(descriptor.pluginId)) {
      throw new Error(`Flow declares duplicate dependency "${descriptor.pluginId}".`);
    }
    declared.set(descriptor.pluginId, descriptor);
  }

  const childArtifacts = new Map();
  for (const child of options.children ?? []) {
    const pluginId = normalizePluginId(child?.pluginId);
    if (childArtifacts.has(pluginId)) {
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
    childArtifacts.set(pluginId, {
      child,
      pluginId,
      sha256,
      descriptor,
      artifactBytes,
    });
  }

  const childRecords = new Map();
  const handlers = {};
  const reservedHandlerKeys = new Set();
  try {
    for (let index = 0; index < parent.nodeCount; index += 1) {
      const node = parent.getNodeDispatchDescriptor(index);
      if (node.dispatchModel !== "isomorphic") continue;
      const nodeId = normalizeNodeId(node.nodeId);
      const artifact = childArtifacts.get(node.pluginId);
      if (!artifact) {
        throw new Error(
          `Flow is missing exact isomorphic child artifact "${node.pluginId}" for node "${node.nodeId}".`,
        );
      }
      if (childRecords.has(nodeId)) {
        throw new Error(`Flow declares duplicate isomorphic node "${nodeId}".`);
      }
      const signedNode = manifestNodes.get(nodeId);
      if (!signedNode || signedNode.pluginId !== node.pluginId) {
        throw new Error(
          `Runtime node "${nodeId}" does not match the signed parent PLG node declaration.`,
        );
      }

      const { child, artifactBytes, descriptor, pluginId, sha256 } = artifact;
      const harness = await createBrowserModuleHarness({
        wasmSource: artifactBytes,
        manifest: child.manifest,
        surface: child.surface ?? "direct",
        verifySignature: child.verifySignature,
        // A child gets only what its embedder grants: an explicit host, or
        // hostOptions whose capabilities list BrowserHost enforces. With
        // neither, BrowserHost is default-deny (SEC-009).
        host: child.host,
        hostOptions: child.hostOptions,
        hostcallDispatch: child.hostcallDispatch,
        imports: child.imports,
      });
      const config = signedNode.config.slice();
      let configInput = null;
      try {
        configInput =
          config.length > 0
            ? canonicalConfigInput(
                childEmbeddedManifest(harness, nodeId),
                node.methodId,
                nodeId,
              )
            : null;
      } catch (error) {
        harness.destroy();
        throw error;
      }
      const record = {
        nodeId,
        pluginId,
        sha256,
        descriptor,
        config: config.slice(),
        configInputPortId: configInput?.portId ?? null,
        harness,
      };
      childRecords.set(nodeId, record);
      handlers[nodeId] = async ({ methodId, frames }) => {
        if (
          configInput &&
          frames.some((frame) => frame?.portId === configInput.portId)
        ) {
          throw new Error(
            `Isomorphic node "${nodeId}" invocation cannot override its signed CONFIG input.`,
          );
        }
        const inputs = frames.map(childRequestFrame);
        if (configInput) {
          inputs.unshift(configRequestFrame(configInput, config));
        }
        const response = await harness.invoke({ methodId, inputs });
        return {
          statusCode: response.statusCode,
          yielded: response.yielded,
          backlogRemaining: response.backlogRemaining,
          outputs: response.outputs.map(flowOutputFrame),
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
        };
      };
      reservedHandlerKeys.add(`${pluginId}:${node.methodId}`);
      if (descriptor.dependencyId) {
        reservedHandlerKeys.add(descriptor.dependencyId);
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
      for (const key of reservedHandlerKeys) {
        if (Object.prototype.hasOwnProperty.call(customHandlers, key)) {
          throw new Error(
            `Custom handler "${key}" cannot override node-scoped isomorphic dispatch.`,
          );
        }
      }
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
