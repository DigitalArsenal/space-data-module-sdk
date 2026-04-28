import * as flatbuffers from "flatbuffers/mjs/flatbuffers.js";

import {
  CapabilityKind,
  DrainPolicy,
  HostCapabilityT,
  PluginFamily,
  PluginManifest,
  PluginManifestT,
} from "../generated/orbpro/manifest.js";
import { normalizeInvokeSurfaceName } from "../invoke/codec.js";
import { toUint8Array } from "../runtime/bufferLike.js";
import { toEmbeddedPluginManifest } from "./normalize.js";
import { decodePlgManifest, isPlgManifestBuffer } from "./plgCodec.js";

function toByteBuffer(data) {
  if (data instanceof flatbuffers.ByteBuffer) {
    return data;
  }
  const bytes = toUint8Array(data);
  if (bytes) {
    return new flatbuffers.ByteBuffer(bytes);
  }
  throw new TypeError(
    "Expected ByteBuffer, Uint8Array, ArrayBufferView, or ArrayBuffer.",
  );
}

function normalizeEnumName(name, { separator = "_", lowercase = true } = {}) {
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }
  const normalized = name.trim();
  if (!normalized) {
    return null;
  }
  const joined = normalized.replace(/_/g, separator);
  return lowercase ? joined.toLowerCase() : joined;
}

function normalizePluginFamilyName(value) {
  if (typeof value === "number" && typeof PluginFamily[value] === "string") {
    return normalizeEnumName(PluginFamily[value], { separator: "_" });
  }
  return normalizeEnumName(value, { separator: "_" });
}

function normalizeDrainPolicyName(value) {
  if (typeof value === "number" && typeof DrainPolicy[value] === "string") {
    return normalizeEnumName(DrainPolicy[value], { separator: "-" });
  }
  return normalizeEnumName(value, { separator: "-" });
}

function normalizeCapabilityName(value) {
  if (
    typeof value === "number" &&
    typeof CapabilityKind[value] === "string"
  ) {
    return normalizeEnumName(CapabilityKind[value], { separator: "_" });
  }
  return normalizeEnumName(value, { separator: "_" });
}

function normalizeDecodedCapabilities(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return normalizeCapabilityName(entry);
      }
      if (!(entry instanceof HostCapabilityT) && (!entry || typeof entry !== "object")) {
        return null;
      }
      const capability = normalizeCapabilityName(entry.capability);
      if (!capability) {
        return null;
      }
      const scope =
        typeof entry.scope === "string" && entry.scope.trim().length > 0
          ? entry.scope.trim()
          : null;
      const description =
        typeof entry.description === "string" &&
        entry.description.trim().length > 0
          ? entry.description.trim()
          : null;
      const required = entry.required !== false;
      if (!scope && !description && required) {
        return capability;
      }
      return {
        capability,
        ...(scope ? { scope } : {}),
        ...(required === false ? { required: false } : {}),
        ...(description ? { description } : {}),
      };
    })
    .filter(Boolean);
}

function normalizeDecodedMethod(method = {}) {
  return {
    ...method,
    drainPolicy: normalizeDrainPolicyName(method.drainPolicy),
  };
}

function typeRefFromSchemaName(schemaName) {
  return typeof schemaName === "string" && schemaName.length > 0
    ? { schemaName }
    : null;
}

function portFromSchemaName(schemaName, index, direction) {
  const typeRef = typeRefFromSchemaName(schemaName);
  if (!typeRef) {
    return null;
  }
  return {
    portId: `${direction}-${index + 1}`,
    acceptedTypeSets: [
      {
        setId: schemaName,
        allowedTypes: [typeRef],
      },
    ],
    minStreams: 0,
    maxStreams: 1,
    required: false,
  };
}

function methodFromPlgEntry(entry = {}) {
  const methodId = entry.name;
  if (typeof methodId !== "string" || methodId.length === 0) {
    return null;
  }
  const inputPorts = Array.isArray(entry.inputSchemas)
    ? entry.inputSchemas
        .map((schemaName, index) => portFromSchemaName(schemaName, index, "input"))
        .filter(Boolean)
    : [];
  const outputPort = portFromSchemaName(entry.outputSchema, 0, "output");
  return {
    methodId,
    displayName: methodId,
    description: entry.description,
    inputPorts,
    outputPorts: outputPort ? [outputPort] : [],
    maxBatch: 1,
    drainPolicy: "single-shot",
  };
}

function normalizeDecodedPlgManifest(manifest = {}) {
  const methods = Array.isArray(manifest.entryFunctions)
    ? manifest.entryFunctions.map((entry) => methodFromPlgEntry(entry)).filter(Boolean)
    : [];
  return {
    ...manifest,
    methods,
    capabilities: Array.isArray(manifest.capabilities)
      ? manifest.capabilities
      : [],
    invokeSurfaces: Array.isArray(manifest.invokeSurfaces)
      ? manifest.invokeSurfaces
          .map((value) => normalizeInvokeSurfaceName(value))
          .filter(Boolean)
      : [],
    runtimeTargets: Array.isArray(manifest.runtimeTargets)
      ? manifest.runtimeTargets
      : [],
  };
}

export function decodePluginManifest(data) {
  const bytes = toUint8Array(data);
  if (bytes && isPlgManifestBuffer(bytes)) {
    return normalizeDecodedPlgManifest(decodePlgManifest(bytes));
  }
  const bb = toByteBuffer(data);
  if (!PluginManifest.bufferHasIdentifier(bb)) {
    throw new Error("Plugin manifest buffer identifier mismatch.");
  }
  const unpacked = PluginManifest.getRootAsPluginManifest(bb).unpack();
  return {
    ...unpacked,
    pluginFamily: normalizePluginFamilyName(unpacked.pluginFamily),
    capabilities: normalizeDecodedCapabilities(unpacked.capabilities),
    methods: Array.isArray(unpacked.methods)
      ? unpacked.methods.map((method) => normalizeDecodedMethod(method))
      : [],
    invokeSurfaces: Array.isArray(unpacked.invokeSurfaces)
      ? unpacked.invokeSurfaces
          .map((value) => normalizeInvokeSurfaceName(value))
          .filter(Boolean)
      : [],
  };
}

export function encodePluginManifest(manifest) {
  const value =
    manifest instanceof PluginManifestT
      ? manifest
      : toEmbeddedPluginManifest(manifest).manifest;
  const builder = new flatbuffers.Builder(1024);
  PluginManifest.finishPluginManifestBuffer(builder, value.pack(builder));
  return builder.asUint8Array();
}
