import {
  BackpressurePolicy,
  FlowProgramT,
  NodeKind,
  TriggerKind,
} from "../generated/orbpro/flow.js";
import {
  DrainPolicy,
  PluginFamily,
  PluginManifestT,
} from "../generated/orbpro/manifest.js";
import { PayloadWireFormat } from "../generated/orbpro/stream.js";
import { decodeFlowProgram, decodePluginManifestPman } from "./flowCodec.js";
import { normalizePayloadSchemaHash } from "../manifest/typeRefs.js";

function enumSymbol(enumType, value, fallback = null) {
  if (typeof value === "number" && enumType[value]) {
    return enumType[value];
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return fallback;
}

function toKebabEnum(enumType, value, fallback) {
  const symbol = enumSymbol(enumType, value, null);
  if (!symbol) {
    return fallback;
  }
  return symbol.toLowerCase().replace(/_/g, "-");
}

function toPlainTypeRef(typeRef) {
  const rawSchemaHash = typeRef?.schemaHash ?? typeRef?.SCHEMA_HASH;
  const schemaHash = normalizePayloadSchemaHash(rawSchemaHash) ?? [];
  return {
    schemaName: typeRef?.schemaName ?? typeRef?.SCHEMA_NAME ?? null,
    fileIdentifier:
      typeRef?.fileIdentifier ?? typeRef?.FILE_IDENTIFIER ?? null,
    schemaVersion:
      typeRef?.schemaVersion ?? typeRef?.SCHEMA_VERSION ?? null,
    schemaHash,
    acceptsAnyFlatbuffer: typeRef?.acceptsAnyFlatbuffer === true,
    wireFormat:
      typeRef?.wireFormat === PayloadWireFormat.AlignedBinary
        ? "aligned-binary"
        : typeRef?.wireFormat === "aligned-binary"
          ? "aligned-binary"
          : "flatbuffer",
    rootTypeName:
      typeRef?.rootTypeName ?? typeRef?.rootType ?? typeRef?.ROOT_TYPE ?? null,
    fixedStringLength: Number(typeRef?.fixedStringLength ?? 0),
    byteLength: Number(typeRef?.byteLength ?? 0),
    requiredAlignment: Number(typeRef?.requiredAlignment ?? 0),
  };
}

function toPlainAcceptedTypeSet(typeSet) {
  return {
    setId: typeSet?.setId ?? null,
    allowedTypes: Array.isArray(typeSet?.allowedTypes)
      ? typeSet.allowedTypes.map(toPlainTypeRef)
      : [],
    description: typeSet?.description ?? null,
  };
}

function toPlainPort(port) {
  return {
    portId: port?.portId ?? "",
    displayName: port?.displayName ?? null,
    acceptedTypeSets: Array.isArray(port?.acceptedTypeSets)
      ? port.acceptedTypeSets.map(toPlainAcceptedTypeSet)
      : [],
    minStreams: Number(port?.minStreams ?? 1),
    maxStreams: Number(port?.maxStreams ?? 1),
    required: port?.required !== false,
    description: port?.description ?? null,
  };
}

function toPlainMethod(method) {
  return {
    methodId: method?.methodId ?? "",
    displayName: method?.displayName ?? null,
    inputPorts: Array.isArray(method?.inputPorts)
      ? method.inputPorts.map(toPlainPort)
      : [],
    outputPorts: Array.isArray(method?.outputPorts)
      ? method.outputPorts.map(toPlainPort)
      : [],
    maxBatch: Number(method?.maxBatch ?? 1),
    drainPolicy: toKebabEnum(
      DrainPolicy,
      method?.drainPolicy,
      "drain-until-yield",
    ),
    description: method?.description ?? null,
  };
}

function toPlainBuildArtifact(artifact) {
  return {
    artifactId: artifact?.artifactId ?? null,
    kind: artifact?.kind ?? null,
    path: artifact?.path ?? null,
    target: artifact?.target ?? null,
    entrySymbol: artifact?.entrySymbol ?? null,
  };
}

function toPlainCapability(capability) {
  return capability
    ? {
        capability: capability.capability ?? null,
        scope: capability.scope ?? null,
        required: capability.required !== false,
        description: capability.description ?? null,
      }
    : null;
}

function toPlainTimer(timer) {
  return timer
    ? {
        timerId: timer.timerId ?? null,
        methodId: timer.methodId ?? null,
        inputPortId: timer.inputPortId ?? null,
        defaultIntervalMs: timer.defaultIntervalMs ?? 0,
        description: timer.description ?? null,
      }
    : null;
}

function toPlainProtocol(protocol) {
  return protocol
    ? {
        protocolId: protocol.protocolId ?? null,
        methodId: protocol.methodId ?? null,
        inputPortId: protocol.inputPortId ?? null,
        outputPortId: protocol.outputPortId ?? null,
        description: protocol.description ?? null,
      }
    : null;
}

function asManifest(manifest) {
  if (manifest instanceof PluginManifestT) {
    return manifest;
  }
  if (
    manifest instanceof Uint8Array ||
    manifest instanceof ArrayBuffer ||
    ArrayBuffer.isView(manifest)
  ) {
    return decodePluginManifestPman(manifest);
  }
  return Object.assign(new PluginManifestT(), manifest);
}

function asProgram(program) {
  if (program instanceof FlowProgramT) {
    return program;
  }
  if (
    program instanceof Uint8Array ||
    program instanceof ArrayBuffer ||
    ArrayBuffer.isView(program)
  ) {
    return decodeFlowProgram(program);
  }
  return Object.assign(new FlowProgramT(), program);
}

export function normalizeManifestForSdnFlow(manifest) {
  const normalized = asManifest(manifest);
  return {
    pluginId: normalized.pluginId ?? "",
    name: normalized.name ?? null,
    version: normalized.version ?? null,
    pluginFamily: enumSymbol(
      PluginFamily,
      normalized.pluginFamily,
      String(normalized.pluginFamily ?? ""),
    ),
    methods: Array.isArray(normalized.methods)
      ? normalized.methods.map(toPlainMethod)
      : [],
    capabilities: Array.isArray(normalized.capabilities)
      ? normalized.capabilities.map(toPlainCapability).filter(Boolean)
      : [],
    timers: Array.isArray(normalized.timers)
      ? normalized.timers.map(toPlainTimer).filter(Boolean)
      : [],
    protocols: Array.isArray(normalized.protocols)
      ? normalized.protocols.map(toPlainProtocol).filter(Boolean)
      : [],
    schemasUsed: Array.isArray(normalized.schemasUsed)
      ? normalized.schemasUsed.map(toPlainTypeRef)
      : [],
    buildArtifacts: Array.isArray(normalized.buildArtifacts)
      ? normalized.buildArtifacts.map(toPlainBuildArtifact)
      : [],
    abiVersion: Number(normalized.abiVersion ?? 1),
  };
}

export function normalizeProgramForSdnFlow(program) {
  const normalized = asProgram(program);
  return {
    programId: normalized.programId ?? "",
    name: normalized.name ?? null,
    version: normalized.version ?? null,
    nodes: Array.isArray(normalized.nodes)
      ? normalized.nodes.map((node) => ({
          nodeId: node?.nodeId ?? "",
          pluginId: node?.pluginId ?? "",
          methodId: node?.methodId ?? "",
          kind: toKebabEnum(NodeKind, node?.kind, "transform"),
          drainPolicy: toKebabEnum(
            DrainPolicy,
            node?.drainPolicy,
            "drain-until-yield",
          ),
          timeSliceMicros: Number(node?.timeSliceMicros ?? 0),
        }))
      : [],
    edges: Array.isArray(normalized.edges)
      ? normalized.edges.map((edge) => ({
          edgeId: edge?.edgeId ?? "",
          fromNodeId: edge?.fromNodeId ?? "",
          fromPortId: edge?.fromPortId ?? "",
          toNodeId: edge?.toNodeId ?? "",
          toPortId: edge?.toPortId ?? "",
          acceptedTypes: Array.isArray(edge?.acceptedTypes)
            ? edge.acceptedTypes.map(toPlainTypeRef)
            : [],
          backpressurePolicy: toKebabEnum(
            BackpressurePolicy,
            edge?.backpressurePolicy,
            "queue",
          ),
          queueDepth: Number(edge?.queueDepth ?? 1),
        }))
      : [],
    triggers: Array.isArray(normalized.triggers)
      ? normalized.triggers.map((trigger) => ({
          triggerId: trigger?.triggerId ?? "",
          kind: toKebabEnum(TriggerKind, trigger?.kind, "manual"),
          source: trigger?.source ?? null,
          protocolId: trigger?.protocolId ?? null,
          defaultIntervalMs: trigger?.defaultIntervalMs ?? 0,
          acceptedTypes: Array.isArray(trigger?.acceptedTypes)
            ? trigger.acceptedTypes.map(toPlainTypeRef)
            : [],
          description: trigger?.description ?? null,
        }))
      : [],
    triggerBindings: Array.isArray(normalized.triggerBindings)
      ? normalized.triggerBindings.map((binding) => ({
          triggerId: binding?.triggerId ?? "",
          targetNodeId: binding?.targetNodeId ?? "",
          targetPortId: binding?.targetPortId ?? "",
          backpressurePolicy: toKebabEnum(
            BackpressurePolicy,
            binding?.backpressurePolicy,
            "queue",
          ),
          queueDepth: Number(binding?.queueDepth ?? 1),
        }))
      : [],
    requiredPlugins: Array.isArray(normalized.requiredPlugins)
      ? [...normalized.requiredPlugins]
      : [],
    description: normalized.description ?? null,
  };
}
