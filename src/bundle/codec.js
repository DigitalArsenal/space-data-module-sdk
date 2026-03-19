import * as flatbuffers from "flatbuffers";

import {
  CanonicalizationRuleT,
  ModuleBundle,
  ModuleBundleEntryRole,
  ModuleBundleEntryT,
  ModuleBundleT,
  ModulePayloadEncoding,
} from "../generated/orbpro/module.js";
import { FlatBufferTypeRefT } from "../generated/orbpro/stream/flat-buffer-type-ref.js";
import { canonicalBytes } from "../auth/canonicalize.js";
import { toUint8Array as toBufferLikeUint8Array } from "../runtime/bufferLike.js";
import {
  DEFAULT_HASH_ALGORITHM,
  DEFAULT_MANIFEST_EXPORT_SYMBOL,
  DEFAULT_MANIFEST_SIZE_SYMBOL,
  DEFAULT_MODULE_FORMAT,
  SDS_BUNDLE_SECTION_NAME,
  SDS_CUSTOM_SECTION_PREFIX,
} from "./constants.js";

const textEncoder = new TextEncoder();

const ROLE_NAME_TO_ENUM = new Map([
  ["manifest", ModuleBundleEntryRole.MANIFEST],
  ["authorization", ModuleBundleEntryRole.AUTHORIZATION],
  ["signature", ModuleBundleEntryRole.SIGNATURE],
  ["transport", ModuleBundleEntryRole.TRANSPORT],
  ["attestation", ModuleBundleEntryRole.ATTESTATION],
  ["auxiliary", ModuleBundleEntryRole.AUXILIARY],
]);

const ROLE_ENUM_TO_NAME = new Map(
  Array.from(ROLE_NAME_TO_ENUM, ([name, value]) => [value, name]),
);

const ENCODING_NAME_TO_ENUM = new Map([
  ["raw-bytes", ModulePayloadEncoding.RAW_BYTES],
  ["flatbuffer", ModulePayloadEncoding.FLATBUFFER],
  ["json-utf8", ModulePayloadEncoding.JSON_UTF8],
  ["cbor", ModulePayloadEncoding.CBOR],
]);

const ENCODING_ENUM_TO_NAME = new Map(
  Array.from(ENCODING_NAME_TO_ENUM, ([name, value]) => [value, name]),
);

function toByteBuffer(data) {
  if (data instanceof flatbuffers.ByteBuffer) {
    return data;
  }
  const bytes = toBufferLikeUint8Array(data);
  if (bytes) {
    return new flatbuffers.ByteBuffer(bytes);
  }
  throw new TypeError(
    "Expected ByteBuffer, Uint8Array, ArrayBufferView, or ArrayBuffer.",
  );
}

function normalizeString(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value);
}

function normalizePayloadWireFormat(value) {
  if (value === 1) {
    return "aligned-binary";
  }
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return normalized === "aligned-binary" ? "aligned-binary" : "flatbuffer";
}

function normalizeUnsignedInteger(value, fallback = 0) {
  const normalized = Number(value ?? fallback);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(normalized));
}

function normalizeByteArray(value, { encoding = null } = {}) {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((byte) => Number(byte) & 0xff);
  }
  const bytes = toBufferLikeUint8Array(value);
  if (bytes) {
    return Array.from(bytes);
  }
  if (typeof value === "string") {
    return Array.from(textEncoder.encode(value));
  }
  if (encoding === ModulePayloadEncoding.JSON_UTF8) {
    return Array.from(canonicalBytes(value));
  }
  throw new TypeError(
    "Expected payload bytes, ArrayBufferView, ArrayBuffer, string, or JSON value.",
  );
}

function normalizeRole(value) {
  if (typeof value === "number") {
    return value;
  }
  const normalized = String(value ?? "auxiliary")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return ROLE_NAME_TO_ENUM.get(normalized) ?? ModuleBundleEntryRole.AUXILIARY;
}

function normalizePayloadEncoding(value) {
  if (typeof value === "number") {
    return value;
  }
  const normalized = String(value ?? "raw-bytes")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return (
    ENCODING_NAME_TO_ENUM.get(normalized) ?? ModulePayloadEncoding.RAW_BYTES
  );
}

function normalizeTypeRef(value) {
  if (!value) {
    return null;
  }
  if (value instanceof FlatBufferTypeRefT) {
    return value;
  }
  return new FlatBufferTypeRefT(
    normalizeString(value.schemaName),
    normalizeString(value.fileIdentifier),
    normalizeByteArray(value.schemaHash),
    Boolean(value.acceptsAnyFlatbuffer),
    normalizePayloadWireFormat(value.wireFormat),
    normalizeString(value.rootTypeName),
    normalizeUnsignedInteger(value.fixedStringLength),
    normalizeUnsignedInteger(value.byteLength),
    normalizeUnsignedInteger(value.requiredAlignment),
  );
}

function normalizeCanonicalization(value = {}) {
  if (value instanceof CanonicalizationRuleT) {
    return value;
  }
  return new CanonicalizationRuleT(
    Number(value.version ?? 1),
    normalizeString(
      value.strippedCustomSectionPrefix,
      SDS_CUSTOM_SECTION_PREFIX,
    ),
    normalizeString(value.bundleSectionName, SDS_BUNDLE_SECTION_NAME),
    normalizeString(value.hashAlgorithm, DEFAULT_HASH_ALGORITHM),
  );
}

function normalizeEntry(value = {}) {
  if (value instanceof ModuleBundleEntryT) {
    return value;
  }
  const payloadEncoding = normalizePayloadEncoding(value.payloadEncoding);
  return new ModuleBundleEntryT(
    normalizeString(value.entryId),
    normalizeRole(value.role),
    normalizeString(value.sectionName),
    normalizeTypeRef(value.typeRef),
    payloadEncoding,
    normalizeString(value.mediaType),
    Number(value.flags ?? 0),
    normalizeByteArray(value.sha256),
    normalizeByteArray(value.payload, { encoding: payloadEncoding }),
    normalizeString(value.description),
  );
}

export function decodeModuleBundle(data) {
  const bb = toByteBuffer(data);
  if (!ModuleBundle.bufferHasIdentifier(bb)) {
    throw new Error("Module bundle buffer identifier mismatch.");
  }
  return ModuleBundle.getRootAsModuleBundle(bb).unpack();
}

export function encodeModuleBundle(bundle) {
  const value =
    bundle instanceof ModuleBundleT
      ? bundle
      : new ModuleBundleT(
          Number(bundle?.bundleVersion ?? 1),
          normalizeString(bundle?.moduleFormat, DEFAULT_MODULE_FORMAT),
          normalizeCanonicalization(bundle?.canonicalization),
          normalizeByteArray(bundle?.canonicalModuleHash),
          normalizeByteArray(bundle?.manifestHash),
          normalizeString(
            bundle?.manifestExportSymbol,
            DEFAULT_MANIFEST_EXPORT_SYMBOL,
          ),
          normalizeString(
            bundle?.manifestSizeSymbol,
            DEFAULT_MANIFEST_SIZE_SYMBOL,
          ),
          Array.isArray(bundle?.entries)
            ? bundle.entries.map(normalizeEntry)
            : [],
        );
  const builder = new flatbuffers.Builder(1024);
  ModuleBundle.finishModuleBundleBuffer(builder, value.pack(builder));
  return builder.asUint8Array();
}

export function moduleBundleRoleToName(value) {
  return ROLE_ENUM_TO_NAME.get(value) ?? "auxiliary";
}

export function moduleBundleEncodingToName(value) {
  return ENCODING_ENUM_TO_NAME.get(value) ?? "raw-bytes";
}

export function decodeModuleBundleEntryPayload(entry) {
  const payloadEncoding = normalizePayloadEncoding(entry?.payloadEncoding);
  const payloadBytes = new Uint8Array(
    normalizeByteArray(entry?.payload, { encoding: payloadEncoding }),
  );
  if (payloadEncoding === ModulePayloadEncoding.JSON_UTF8) {
    return JSON.parse(new TextDecoder().decode(payloadBytes));
  }
  return payloadBytes;
}

export function findModuleBundleEntry(bundle, match) {
  const entries = Array.isArray(bundle?.entries) ? bundle.entries : [];
  if (typeof match === "number") {
    return entries.find((entry) => entry.role === match) ?? null;
  }
  const normalized = String(match ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return (
    entries.find((entry) => entry.entryId === match) ??
    entries.find(
      (entry) => moduleBundleRoleToName(normalizeRole(entry.role)) === normalized,
    ) ??
    null
  );
}

export {
  CanonicalizationRuleT,
  FlatBufferTypeRefT,
  ModuleBundle,
  ModuleBundleEntryRole,
  ModuleBundleEntryT,
  ModuleBundleT,
  ModulePayloadEncoding,
};
