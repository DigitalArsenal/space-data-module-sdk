import { canonicalBytes } from "../auth/canonicalize.js";
import { decodePluginManifest, encodePluginManifest } from "../manifest/index.js";
import { toUint8Array } from "../runtime/bufferLike.js";
import { sha256Bytes } from "../utils/crypto.js";
import { bytesToHex } from "../utils/encoding.js";
import { createDeploymentPlanBundleEntry } from "../deployment/index.js";
import {
  DEFAULT_MANIFEST_EXPORT_SYMBOL,
  DEFAULT_MANIFEST_SIZE_SYMBOL,
  SDS_CUSTOM_SECTION_PREFIX,
  SDS_DEPLOYMENT_ENTRY_ID,
  SDS_DEPLOYMENT_SECTION_NAME,
  SDS_MBL_CONTAINER_NAME,
} from "./constants.js";
import {
  decodeModuleBundle,
  decodeModuleBundleEntryPayload,
  encodeModuleBundle,
  findModuleBundleEntry,
  moduleBundleEncodingToName,
  moduleBundleRoleToName,
} from "./codec.js";
import {
  appendPublicationRecordCollection,
  encodePublicationRecordCollection,
  extractPublicationRecordCollection,
} from "../transport/records.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];
const WASM_VERSION_1 = [0x01, 0x00, 0x00, 0x00];

function assertSafeNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
}

function normalizeBytes(value, label) {
  const bytes = toUint8Array(value);
  if (bytes) {
    return bytes;
  }
  throw new TypeError(`${label} must be a Uint8Array, ArrayBufferView, or ArrayBuffer.`);
}

function concatBytes(chunks) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function encodeUnsignedLeb128(value) {
  assertSafeNonNegativeInteger(value, "ULEB128 value");
  let remaining = value;
  const out = [];
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) {
      byte |= 0x80;
    }
    out.push(byte);
  } while (remaining > 0);
  return Uint8Array.from(out);
}

export function decodeUnsignedLeb128(bytes, offset = 0) {
  const view = normalizeBytes(bytes, "bytes");
  let result = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < view.length) {
    const byte = view[cursor++];
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      return { value: result, nextOffset: cursor };
    }
    shift += 7;
    if (shift > 49) {
      throw new Error("ULEB128 value exceeds supported integer range.");
    }
  }
  throw new Error("Unexpected end of data while decoding ULEB128.");
}

export function parseWasmModuleSections(bytes) {
  const protectedArtifact = extractPublicationRecordCollection(bytes);
  const wasmBytes = normalizeBytes(
    protectedArtifact?.payloadBytes ?? bytes,
    "wasm bytes",
  );
  if (wasmBytes.length < 8) {
    throw new Error("WASM module is truncated.");
  }
  for (let index = 0; index < 4; index += 1) {
    if (wasmBytes[index] !== WASM_MAGIC[index]) {
      throw new Error("WASM magic header mismatch.");
    }
    if (wasmBytes[index + 4] !== WASM_VERSION_1[index]) {
      throw new Error("Unsupported WASM version header.");
    }
  }
  const sections = [];
  let offset = 8;
  while (offset < wasmBytes.length) {
    const start = offset;
    const id = wasmBytes[offset++];
    const sizeInfo = decodeUnsignedLeb128(wasmBytes, offset);
    const payloadStart = sizeInfo.nextOffset;
    const payloadEnd = payloadStart + sizeInfo.value;
    if (payloadEnd > wasmBytes.length) {
      throw new Error("WASM section extends past end of file.");
    }
    const section = {
      id,
      start,
      end: payloadEnd,
      payloadStart,
      payloadEnd,
      size: sizeInfo.value,
      rawBytes: wasmBytes.subarray(start, payloadEnd),
    };
    if (id === 0) {
      const nameInfo = decodeUnsignedLeb128(wasmBytes, payloadStart);
      const nameStart = nameInfo.nextOffset;
      const nameEnd = nameStart + nameInfo.value;
      if (nameEnd > payloadEnd) {
        throw new Error("WASM custom section name extends past payload.");
      }
      Object.assign(section, {
        name: textDecoder.decode(wasmBytes.subarray(nameStart, nameEnd)),
        nameStart,
        nameEnd,
        dataStart: nameEnd,
        dataEnd: payloadEnd,
        dataBytes: wasmBytes.subarray(nameEnd, payloadEnd),
      });
    }
    sections.push(section);
    offset = payloadEnd;
  }
  if (offset !== wasmBytes.length) {
    throw new Error("WASM parser ended on a non-terminal offset.");
  }
  return {
    bytes: wasmBytes,
    headerBytes: wasmBytes.subarray(0, 8),
    sections,
  };
}

export function listWasmCustomSections(bytes) {
  return parseWasmModuleSections(bytes).sections
    .filter((section) => section.id === 0)
    .map((section) => ({
      name: section.name,
      dataBytes: new Uint8Array(section.dataBytes),
      start: section.start,
      end: section.end,
    }));
}

export function getWasmCustomSections(bytes, name) {
  return listWasmCustomSections(bytes)
    .filter((section) => section.name === name)
    .map((section) => section.dataBytes);
}

export function encodeWasmCustomSection(name, payload) {
  const normalizedName = String(name ?? "").trim();
  if (!normalizedName) {
    throw new Error("Custom section name is required.");
  }
  const payloadBytes = normalizeBytes(payload, "custom section payload");
  const nameBytes = textEncoder.encode(normalizedName);
  const nameLengthBytes = encodeUnsignedLeb128(nameBytes.length);
  const sectionSize =
    nameLengthBytes.length + nameBytes.length + payloadBytes.length;
  const sectionSizeBytes = encodeUnsignedLeb128(sectionSize);
  return concatBytes([
    Uint8Array.of(0),
    sectionSizeBytes,
    nameLengthBytes,
    nameBytes,
    payloadBytes,
  ]);
}

export function stripWasmCustomSections(bytes, predicate = () => false) {
  const parsed = parseWasmModuleSections(bytes);
  const chunks = [parsed.headerBytes];
  for (const section of parsed.sections) {
    if (section.id === 0 && predicate(section)) {
      continue;
    }
    chunks.push(parsed.bytes.subarray(section.start, section.end));
  }
  return concatBytes(chunks);
}

export function appendWasmCustomSection(bytes, name, payload) {
  return concatBytes([
    normalizeBytes(bytes, "wasm bytes"),
    encodeWasmCustomSection(name, payload),
  ]);
}

function normalizeJsonPayload(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const bytes = toUint8Array(value);
  if (bytes) {
    return new Uint8Array(bytes);
  }
  if (typeof value === "string") {
    return textEncoder.encode(value);
  }
  return new Uint8Array(canonicalBytes(value));
}

function normalizeManifestEntry(manifest, manifestBytes) {
  if (!manifest && !manifestBytes) {
    return null;
  }
  const payload = manifestBytes ?? encodePluginManifest(manifest);
  return {
    entryId: "manifest",
    role: "manifest",
    sectionName: "sds.manifest",
    payloadEncoding: "flatbuffer",
    typeRef: {
      schemaName: "PluginManifest.fbs",
      fileIdentifier: "PMAN",
    },
    payload,
    description: "Canonical plugin manifest.",
  };
}

function normalizeStandardEntries(options = {}) {
  const entries = [];
  if (options.authorization !== undefined) {
    entries.push({
      entryId: "authorization",
      role: "authorization",
      sectionName: "sds.authorization",
      payloadEncoding: "json-utf8",
      mediaType: "application/json",
      payload: normalizeJsonPayload(options.authorization),
      description: "Deployment authorization envelope.",
    });
  }
  if (options.signature !== undefined) {
    entries.push({
      entryId: "signature",
      role: "signature",
      sectionName: "sds.signature",
      payloadEncoding: "json-utf8",
      mediaType: "application/json",
      payload: normalizeJsonPayload(options.signature),
      description: "Detached signature payload.",
    });
  }
  if (options.transportEnvelope !== undefined) {
    entries.push({
      entryId: "transport",
      role: "transport",
      sectionName: "sds.transport",
      payloadEncoding: "json-utf8",
      mediaType: "application/json",
      payload: normalizeJsonPayload(options.transportEnvelope),
      description: "Transport envelope metadata.",
    });
  }
  if (options.deploymentPlan !== undefined) {
    entries.push(createDeploymentPlanBundleEntry(options.deploymentPlan));
  }
  return entries.filter((entry) => entry.payload !== null);
}

function normalizeAdditionalEntries(entries = []) {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((entry, index) => ({
    entryId: entry.entryId ?? `entry-${index + 1}`,
    ...entry,
  }));
}

async function withSha256(entry) {
  const payloadBytes =
    toUint8Array(entry.payload) ??
    ((entry.payloadEncoding === "json-utf8" ||
      moduleBundleEncodingToName(entry.payloadEncoding) === "json-utf8")
      ? canonicalBytes(entry.payload)
      : normalizeBytes(entry.payload, `entry "${entry.entryId}" payload`));
  return {
    ...entry,
    payload: payloadBytes,
    sha256: await sha256Bytes(payloadBytes),
  };
}

function buildParsedEntries(bundle) {
  return (Array.isArray(bundle?.entries) ? bundle.entries : []).map((entry) => {
    const payloadBytes = new Uint8Array(entry.payload ?? []);
    const parsedEntry = {
      ...entry,
      roleName: moduleBundleRoleToName(entry.role),
      payloadEncodingName: moduleBundleEncodingToName(entry.payloadEncoding),
      payloadBytes,
      sha256Bytes: new Uint8Array(entry.sha256 ?? []),
    };
    try {
      parsedEntry.decodedPayload = decodeModuleBundleEntryPayload(entry);
    } catch {
      parsedEntry.decodedPayload = payloadBytes;
    }
    if (
      parsedEntry.roleName === "manifest" &&
      parsedEntry.payloadEncodingName === "flatbuffer"
    ) {
      try {
        parsedEntry.decodedManifest = decodePluginManifest(payloadBytes);
      } catch {
        parsedEntry.decodedManifest = null;
      }
    }
    if (
      parsedEntry.entryId === SDS_DEPLOYMENT_ENTRY_ID ||
      parsedEntry.sectionName === SDS_DEPLOYMENT_SECTION_NAME
    ) {
      parsedEntry.decodedDeploymentPlan =
        parsedEntry.payloadEncodingName === "json-utf8" &&
        parsedEntry.decodedPayload &&
        typeof parsedEntry.decodedPayload === "object"
          ? parsedEntry.decodedPayload
          : null;
    }
    return parsedEntry;
  });
}

export async function computeCanonicalModuleHash(
  bytes,
  options = {},
) {
  const protectedArtifact = extractPublicationRecordCollection(bytes);
  const candidateBytes = protectedArtifact?.payloadBytes ?? bytes;
  const prefix = String(
    options.customSectionPrefix ?? SDS_CUSTOM_SECTION_PREFIX,
  );
  const canonicalWasmBytes = stripWasmCustomSections(candidateBytes, (section) =>
    section.name.startsWith(prefix),
  );
  const hashBytes = await sha256Bytes(canonicalWasmBytes);
  return {
    canonicalWasmBytes,
    hashBytes,
    hashHex: bytesToHex(hashBytes),
  };
}

export async function createSingleFileBundle(options = {}) {
  const protectedArtifact = extractPublicationRecordCollection(options.wasmBytes);
  const wasmBytes = normalizeBytes(
    protectedArtifact?.payloadBytes ?? options.wasmBytes,
    "wasmBytes",
  );
  const manifestBytes =
    options.manifestBytes !== undefined
      ? normalizeBytes(options.manifestBytes, "manifestBytes")
      : options.manifest
        ? encodePluginManifest(options.manifest)
        : null;
  const manifestEntry = normalizeManifestEntry(options.manifest, manifestBytes);
  const rawEntries = [
    ...(manifestEntry ? [manifestEntry] : []),
    ...normalizeStandardEntries(options),
    ...normalizeAdditionalEntries(options.entries),
  ];
  const entries = [];
  for (const entry of rawEntries) {
    entries.push(await withSha256(entry));
  }
  const canonicalization = {
    version: 1,
    strippedCustomSectionPrefix:
      options.customSectionPrefix ?? SDS_CUSTOM_SECTION_PREFIX,
    bundleSectionName: options.bundleSectionName ?? SDS_MBL_CONTAINER_NAME,
    hashAlgorithm: "sha256",
  };
  const canonical = await computeCanonicalModuleHash(wasmBytes, {
    customSectionPrefix: canonicalization.strippedCustomSectionPrefix,
  });
  const manifestHash = manifestBytes ? await sha256Bytes(manifestBytes) : [];
  const bundle = {
    bundleVersion: Number(options.bundleVersion ?? 1),
    moduleFormat: options.moduleFormat ?? "space-data-module",
    canonicalization,
    canonicalModuleHash: canonical.hashBytes,
    manifestHash,
    manifestExportSymbol:
      options.manifestExportSymbol ?? DEFAULT_MANIFEST_EXPORT_SYMBOL,
    manifestSizeSymbol:
      options.manifestSizeSymbol ?? DEFAULT_MANIFEST_SIZE_SYMBOL,
    entries,
  };
  const bundleBytes = encodeModuleBundle(bundle);
  const baseWasmBytes = stripWasmCustomSections(wasmBytes, (section) =>
    section.name.startsWith(canonicalization.strippedCustomSectionPrefix),
  );
  const outputWasmBytes = appendPublicationRecordCollection(
    baseWasmBytes,
    encodePublicationRecordCollection({
      version: protectedArtifact?.version,
      mbl: bundle,
      enc: protectedArtifact?.enc,
      pnm: protectedArtifact?.pnm,
    }),
  );
  return {
    bundle,
    bundleBytes,
    canonicalWasmBytes: canonical.canonicalWasmBytes,
    canonicalModuleHash: canonical.hashBytes,
    canonicalModuleHashHex: canonical.hashHex,
    manifestHash,
    manifestHashHex: bytesToHex(manifestHash),
    wasmBytes: outputWasmBytes,
  };
}

export async function parseSingleFileBundle(bytes, options = {}) {
  const protectedArtifact = extractPublicationRecordCollection(bytes);
  if (!protectedArtifact?.mbl) {
    throw new Error("Missing required REC trailer containing an MBL record.");
  }
  const wasmBytes = normalizeBytes(
    protectedArtifact.payloadBytes,
    "wasm bytes",
  );
  const customSections = listWasmCustomSections(wasmBytes);
  const bundle = protectedArtifact.mbl;
  const bundleBytes = protectedArtifact.mblBytes ?? encodeModuleBundle(bundle);
  const prefix =
    bundle.canonicalization?.strippedCustomSectionPrefix ??
    SDS_CUSTOM_SECTION_PREFIX;
  const canonical = await computeCanonicalModuleHash(wasmBytes, {
    customSectionPrefix: prefix,
  });
  const parsedEntries = buildParsedEntries(bundle);
  const manifestEntry = findModuleBundleEntry(bundle, "manifest");
  let manifest = null;
  if (manifestEntry) {
    try {
      manifest = decodePluginManifest(new Uint8Array(manifestEntry.payload ?? []));
    } catch {
      manifest = null;
    }
  }
  const deploymentEntry =
    parsedEntries.find(
      (entry) =>
        entry.entryId === SDS_DEPLOYMENT_ENTRY_ID ||
        entry.sectionName === SDS_DEPLOYMENT_SECTION_NAME,
    ) ?? null;
  return {
    wasmBytes,
    protectedArtifactBytes: protectedArtifact.protectedBytes,
    publicationRecords: protectedArtifact,
    bundleBytes,
    bundle,
    entries: parsedEntries,
    manifest,
    deploymentPlan: deploymentEntry?.decodedDeploymentPlan ?? null,
    customSections,
    canonicalWasmBytes: canonical.canonicalWasmBytes,
    canonicalModuleHash: canonical.hashBytes,
    canonicalModuleHashHex: canonical.hashHex,
  };
}
