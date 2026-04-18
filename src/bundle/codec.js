import * as flatbuffers from "flatbuffers/mjs/flatbuffers.js";

import {
  CanonicalizationRuleT,
  MBL,
  MBLT,
  ModuleBundleEntryRole,
  ModuleBundleEntryT,
  ModulePayloadEncoding,
} from "spacedatastandards.org/lib/js/MBL/main.js";
import { canonicalBytes } from "../auth/canonicalize.js";
import { toUint8Array as toBufferLikeUint8Array } from "../runtime/bufferLike.js";
import {
  DEFAULT_HASH_ALGORITHM,
  DEFAULT_MANIFEST_EXPORT_SYMBOL,
  DEFAULT_MANIFEST_SIZE_SYMBOL,
  DEFAULT_MODULE_FORMAT,
  SDS_CUSTOM_SECTION_PREFIX,
  SDS_MBL_CONTAINER_NAME,
} from "./constants.js";

const textDecoder = new TextDecoder();
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

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
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

function stringifyTypeRef(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  const bytes = toBufferLikeUint8Array(value);
  if (bytes) {
    return textDecoder.decode(bytes);
  }
  return textDecoder.decode(canonicalBytes(value));
}

function parseTypeRef(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      ...value,
      wireFormat: normalizePayloadWireFormat(value.wireFormat),
      fixedStringLength: normalizeUnsignedInteger(value.fixedStringLength),
      byteLength: normalizeUnsignedInteger(value.byteLength),
      requiredAlignment: normalizeUnsignedInteger(value.requiredAlignment),
    };
  }
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = JSON.parse(normalized);
    if (parsed && typeof parsed === "object") {
      return {
        ...parsed,
        wireFormat: normalizePayloadWireFormat(parsed.wireFormat),
        fixedStringLength: normalizeUnsignedInteger(parsed.fixedStringLength),
        byteLength: normalizeUnsignedInteger(parsed.byteLength),
        requiredAlignment: normalizeUnsignedInteger(parsed.requiredAlignment),
      };
    }
  } catch {}
  return normalized;
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
    normalizeString(value.bundleSectionName, SDS_MBL_CONTAINER_NAME),
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
    stringifyTypeRef(value.typeRef),
    payloadEncoding,
    normalizeString(value.mediaType),
    Number(value.flags ?? 0),
    normalizeByteArray(value.sha256),
    normalizeByteArray(value.payload, { encoding: payloadEncoding }),
    normalizeString(value.description),
  );
}

function normalizeDecodedEntry(entry = {}) {
  return {
    entryId: firstDefined(entry.entryId, entry.entry_id) ?? null,
    role: entry.role ?? ModuleBundleEntryRole.AUXILIARY,
    sectionName: firstDefined(entry.sectionName, entry.section_name) ?? null,
    typeRef: parseTypeRef(firstDefined(entry.typeRef, entry.type_ref)),
    payloadEncoding:
      firstDefined(entry.payloadEncoding, entry.payload_encoding) ??
      ModulePayloadEncoding.RAW_BYTES,
    mediaType: firstDefined(entry.mediaType, entry.media_type) ?? null,
    flags: Number(entry.flags ?? 0),
    sha256: normalizeByteArray(entry.sha256),
    payload: normalizeByteArray(firstDefined(entry.payload, entry.PAYLOAD)),
    description: entry.description ?? null,
  };
}

function normalizeDecodedCanonicalization(canonicalization = null) {
  if (!canonicalization || typeof canonicalization !== "object") {
    return null;
  }
  return {
    version: Number(canonicalization.version ?? 1),
    strippedCustomSectionPrefix: normalizeString(
      firstDefined(
        canonicalization.strippedCustomSectionPrefix,
        canonicalization.stripped_custom_section_prefix,
      ),
      SDS_CUSTOM_SECTION_PREFIX,
    ),
    bundleSectionName: normalizeString(
      firstDefined(
        canonicalization.bundleSectionName,
        canonicalization.bundle_section_name,
      ),
      SDS_MBL_CONTAINER_NAME,
    ),
    hashAlgorithm: normalizeString(
      firstDefined(
        canonicalization.hashAlgorithm,
        canonicalization.hash_algorithm,
      ),
      DEFAULT_HASH_ALGORITHM,
    ),
  };
}

function normalizeDecodedBundle(bundle = {}) {
  return {
    bundleVersion: Number(
      firstDefined(bundle.bundleVersion, bundle.bundle_version) ?? 1,
    ),
    moduleFormat: normalizeString(
      firstDefined(bundle.moduleFormat, bundle.module_format),
      DEFAULT_MODULE_FORMAT,
    ),
    canonicalization: normalizeDecodedCanonicalization(bundle.canonicalization),
    canonicalModuleHash: normalizeByteArray(
      firstDefined(bundle.canonicalModuleHash, bundle.canonical_module_hash),
    ),
    manifestHash: normalizeByteArray(
      firstDefined(bundle.manifestHash, bundle.manifest_hash),
    ),
    manifestExportSymbol: normalizeString(
      firstDefined(bundle.manifestExportSymbol, bundle.manifest_export_symbol),
      DEFAULT_MANIFEST_EXPORT_SYMBOL,
    ),
    manifestSizeSymbol: normalizeString(
      firstDefined(bundle.manifestSizeSymbol, bundle.manifest_size_symbol),
      DEFAULT_MANIFEST_SIZE_SYMBOL,
    ),
    entries: Array.isArray(bundle.entries)
      ? bundle.entries.map(normalizeDecodedEntry)
      : [],
  };
}

export function moduleBundleTableFromObject(bundle = {}) {
  return bundle instanceof MBLT
    ? bundle
    : new MBLT(
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
}

export function decodeModuleBundle(data) {
  const bb = toByteBuffer(data);
  if (!MBL.bufferHasIdentifier(bb)) {
    throw new Error("Module bundle buffer identifier mismatch.");
  }
  return normalizeDecodedBundle(MBL.getRootAsMBL(bb).unpack());
}

export function decodeModuleBundleTable(table) {
  return normalizeDecodedBundle(table?.unpack?.() ?? {});
}

export function encodeModuleBundle(bundle) {
  const value = moduleBundleTableFromObject(bundle);
  const builder = new flatbuffers.Builder(1024);
  MBL.finishMBLBuffer(builder, value.pack(builder));
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
  MBL,
  MBLT,
  ModuleBundleEntryRole,
  ModuleBundleEntryT,
  ModulePayloadEncoding,
};
