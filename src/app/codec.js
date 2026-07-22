import * as flatbuffers from "flatbuffers";
import {
  APP,
  APPT,
  APPDataflowT,
  APPDataRefT,
  APPModuleRefT,
  APPSourceRefT,
  APPUIPageT,
  appContentEncoding,
  appDataDirection,
  appFlowDirection,
  appFlowTransport,
  appRuntimeTarget,
  appSourceKind,
} from "spacedatastandards.org/lib/js/APP/main.js";
import { toUint8Array } from "../runtime/bufferLike.js";

export const APP_FILE_IDENTIFIER = "$APP";

const HEX_SHA256 = /^[a-f0-9]{64}$/;
const RFC3339_FIXED_MILLISECONDS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const contentEncodingToFB = Object.freeze({
  utf8: appContentEncoding.UTF8,
  base64: appContentEncoding.BASE64,
  base64_gzip: appContentEncoding.BASE64_GZIP,
  base64_brotli: appContentEncoding.BASE64_BROTLI,
});
const contentEncodingFromFB = invertEnumMap(contentEncodingToFB);

const dataDirectionToFB = Object.freeze({
  produces: appDataDirection.PRODUCES,
  consumes: appDataDirection.CONSUMES,
  both: appDataDirection.BOTH,
});
const dataDirectionFromFB = invertEnumMap(dataDirectionToFB);

const sourceKindToFB = Object.freeze({
  module: appSourceKind.MODULE,
  "external-api": appSourceKind.EXTERNAL_API,
  dataset: appSourceKind.DATASET,
});
const sourceKindFromFB = invertEnumMap(sourceKindToFB);

const runtimeTargetToFB = Object.freeze({
  node: appRuntimeTarget.NODE,
  page: appRuntimeTarget.PAGE,
  both: appRuntimeTarget.BOTH,
});
const runtimeTargetFromFB = invertEnumMap(runtimeTargetToFB);

const flowDirectionToFB = Object.freeze({
  to_page: appFlowDirection.TO_PAGE,
  from_page: appFlowDirection.FROM_PAGE,
  bidirectional: appFlowDirection.BIDIRECTIONAL,
});
const flowDirectionFromFB = invertEnumMap(flowDirectionToFB);

const flowTransportToFB = Object.freeze({
  ipfs_cid: appFlowTransport.IPFS_CID,
  pubsub_topic: appFlowTransport.PUBSUB_TOPIC,
  gateway_route: appFlowTransport.GATEWAY_ROUTE,
});
const flowTransportFromFB = invertEnumMap(flowTransportToFB);

function invertEnumMap(value) {
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([name, code]) => [code, name])),
  );
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value, label) {
  if (!isObject(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function optionalString(value, label) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new TypeError(`${label} must be a string when present.`);
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
}

function requireEnum(value, values, label, fallback) {
  const normalized = value === undefined || value === null || value === ""
    ? fallback
    : String(value);
  if (!Object.hasOwn(values, normalized)) {
    throw new TypeError(
      `${label} must be one of ${Object.keys(values).join(", ")}.`,
    );
  }
  return normalized;
}

function requireUnsignedInteger(value, label) {
  const normalized = value ?? 0;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 0
  ) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return normalized;
}

function requireUniqueID(value, seen, label, noun) {
  requireString(value, `${label}.id`);
  if (seen.has(value)) {
    throw new Error(`APP manifest contains duplicate ${noun} id ${JSON.stringify(value)}.`);
  }
  seen.add(value);
}

function validateTimestamp(value, label) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || !RFC3339_FIXED_MILLISECONDS.test(value)) {
    throw new TypeError(
      `${label} must be an RFC 3339 UTC timestamp with fixed milliseconds.`,
    );
  }
}

function validateSha256(value, label) {
  if (typeof value !== "string" || !HEX_SHA256.test(value)) {
    throw new TypeError(`${label} must be 64 lowercase hexadecimal characters.`);
  }
}

function validateReferences(manifest, moduleIDs) {
  for (const [index, data] of manifest.data.entries()) {
    if (data.moduleId && !moduleIDs.has(data.moduleId)) {
      throw new Error(
        `APP manifest data[${index}].moduleId references unknown module ${JSON.stringify(data.moduleId)}.`,
      );
    }
  }
  for (const [index, source] of manifest.sources.entries()) {
    if (source.kind === "module" && !moduleIDs.has(source.ref)) {
      throw new Error(
        `APP manifest sources[${index}].ref references unknown module ${JSON.stringify(source.ref)}.`,
      );
    }
  }
  for (const [index, page] of manifest.pages.entries()) {
    if (page.moduleId && !moduleIDs.has(page.moduleId)) {
      throw new Error(
        `APP manifest pages[${index}].moduleId references unknown module ${JSON.stringify(page.moduleId)}.`,
      );
    }
  }
  for (const [index, flow] of manifest.dataflow.entries()) {
    if (flow.moduleId && !moduleIDs.has(flow.moduleId)) {
      throw new Error(
        `APP manifest dataflow[${index}].moduleId references unknown module ${JSON.stringify(flow.moduleId)}.`,
      );
    }
  }
}

const APP_ARRAY_FIELDS = Object.freeze([
  "modules",
  "data",
  "sources",
  "pages",
  "dataflow",
]);

function withArrayDefaults(manifest) {
  return Object.fromEntries([
    ...Object.entries(manifest),
    ...APP_ARRAY_FIELDS.map((field) => [field, manifest[field] ?? []]),
  ]);
}

/**
 * Validate the canonical camelCase representation of an SDS `$APP` record.
 * The validator is intentionally stricter than the FlatBuffer schema at the
 * publication boundary: every module must already be content-addressed and
 * every inline page must carry its decoded-content digest.
 */
export function validateAppManifest(manifest) {
  requireObject(manifest, "APP manifest");
  const normalized = withArrayDefaults(manifest);
  requireString(manifest.id, "APP manifest id");
  requireString(manifest.name, "APP manifest name");
  requireString(manifest.version, "APP manifest version");
  optionalString(manifest.description, "APP manifest description");
  validateTimestamp(manifest.createdAt, "APP manifest createdAt");
  validateTimestamp(manifest.updatedAt, "APP manifest updatedAt");

  for (const field of APP_ARRAY_FIELDS) {
    requireArray(normalized[field], `APP manifest ${field}`);
  }
  if (normalized.modules.length === 0) {
    throw new Error("APP manifest must reference at least one module.");
  }

  const moduleIDs = new Set();
  for (const [index, module] of normalized.modules.entries()) {
    const label = `APP manifest modules[${index}]`;
    requireObject(module, label);
    requireUniqueID(module.id, moduleIDs, label, "module");
    requireString(module.pluginId, `${label}.pluginId`);
    validateSha256(module.contentHash, `${label}.contentHash`);
    optionalString(module.version, `${label}.version`);
    optionalString(module.role, `${label}.role`);
    optionalString(module.description, `${label}.description`);
    requireUnsignedInteger(module.maxWallClockMs, `${label}.maxWallClockMs`);
    requireUnsignedInteger(module.maxCostUnits, `${label}.maxCostUnits`);
    const maxMemoryPages = requireUnsignedInteger(
      module.maxMemoryPages,
      `${label}.maxMemoryPages`,
    );
    if (maxMemoryPages > 0xffffffff) {
      throw new TypeError(`${label}.maxMemoryPages must fit in uint32.`);
    }
    requireEnum(
      module.runtimeTarget,
      runtimeTargetToFB,
      `${label}.runtimeTarget`,
      "node",
    );
  }

  const dataIDs = new Set();
  for (const [index, data] of normalized.data.entries()) {
    const label = `APP manifest data[${index}]`;
    requireObject(data, label);
    requireUniqueID(data.id, dataIDs, label, "data");
    requireString(data.sdsType, `${label}.sdsType`);
    requireEnum(data.direction, dataDirectionToFB, `${label}.direction`, "produces");
    optionalString(data.moduleId, `${label}.moduleId`);
    optionalString(data.description, `${label}.description`);
  }

  const sourceIDs = new Set();
  for (const [index, source] of normalized.sources.entries()) {
    const label = `APP manifest sources[${index}]`;
    requireObject(source, label);
    requireUniqueID(source.id, sourceIDs, label, "source");
    requireEnum(source.kind, sourceKindToFB, `${label}.kind`, "module");
    requireString(source.ref, `${label}.ref`);
    optionalString(source.description, `${label}.description`);
  }

  const pageIDs = new Set();
  let entryPages = 0;
  for (const [index, page] of normalized.pages.entries()) {
    const label = `APP manifest pages[${index}]`;
    requireObject(page, label);
    requireUniqueID(page.id, pageIDs, label, "page");
    for (const field of ["title", "description", "icon", "color", "textColor"]) {
      optionalString(page[field], `${label}.${field}`);
    }
    const inline = typeof page.content === "string" && page.content.length > 0;
    const moduleServed =
      typeof page.moduleId === "string" && page.moduleId.length > 0 &&
      typeof page.url === "string" && page.url.length > 0;
    if (inline === moduleServed) {
      throw new Error(
        `${label} must use exactly one delivery lane: inline content or moduleId+url.`,
      );
    }
    if (inline) {
      requireEnum(page.encoding, contentEncodingToFB, `${label}.encoding`, "utf8");
      requireString(page.mediaType, `${label}.mediaType`);
      validateSha256(page.contentSha256, `${label}.contentSha256`);
      if (page.moduleId || page.url) {
        throw new Error(
          `${label} must use exactly one delivery lane: inline content or moduleId+url.`,
        );
      }
    } else {
      optionalString(page.content, `${label}.content`);
      optionalString(page.contentSha256, `${label}.contentSha256`);
    }
    if (page.entry === true) entryPages += 1;
    else if (page.entry !== undefined && page.entry !== false) {
      throw new TypeError(`${label}.entry must be boolean when present.`);
    }
  }
  if (normalized.pages.length > 0 && entryPages !== 1) {
    throw new Error(
      `APP manifest must have exactly one entry page (found ${entryPages}).`,
    );
  }

  const flowNames = new Set();
  for (const [index, flow] of normalized.dataflow.entries()) {
    const label = `APP manifest dataflow[${index}]`;
    requireObject(flow, label);
    requireUniqueID(flow.name, flowNames, label, "dataflow");
    requireEnum(flow.direction, flowDirectionToFB, `${label}.direction`, "to_page");
    requireString(flow.sdsSchema, `${label}.sdsSchema`);
    requireEnum(flow.transport, flowTransportToFB, `${label}.transport`, "ipfs_cid");
    optionalString(flow.locator, `${label}.locator`);
    optionalString(flow.moduleId, `${label}.moduleId`);
    optionalString(flow.methodId, `${label}.methodId`);
    optionalString(flow.portId, `${label}.portId`);
    requireEnum(
      flow.contentEncoding,
      contentEncodingToFB,
      `${label}.contentEncoding`,
      "utf8",
    );
    optionalString(flow.description, `${label}.description`);
    const moduleBindingFields = [flow.moduleId, flow.methodId, flow.portId].filter(
      (value) => typeof value === "string" && value.length > 0,
    ).length;
    if (moduleBindingFields !== 0 && moduleBindingFields !== 3) {
      throw new Error(
        `${label} must declare moduleId, methodId, and portId together.`,
      );
    }
  }

  validateReferences(normalized, moduleIDs);
  return manifest;
}

function nullable(value) {
  return value === undefined || value === "" ? null : value;
}

function toBigInt(value) {
  return BigInt(value ?? 0);
}

function toAppObject(manifest) {
  return new APPT(
    manifest.id,
    manifest.name,
    manifest.version,
    nullable(manifest.description),
    manifest.modules.map(
      (module) =>
        new APPModuleRefT(
          module.id,
          module.pluginId,
          module.contentHash,
          nullable(module.version),
          nullable(module.role),
          nullable(module.description),
          toBigInt(module.maxWallClockMs),
          toBigInt(module.maxCostUnits),
          module.maxMemoryPages ?? 0,
          runtimeTargetToFB[module.runtimeTarget ?? "node"],
        ),
    ),
    manifest.data.map(
      (data) =>
        new APPDataRefT(
          data.id,
          data.sdsType,
          dataDirectionToFB[data.direction ?? "produces"],
          nullable(data.moduleId),
          nullable(data.description),
        ),
    ),
    manifest.sources.map(
      (source) =>
        new APPSourceRefT(
          source.id,
          sourceKindToFB[source.kind ?? "module"],
          source.ref,
          nullable(source.description),
        ),
    ),
    manifest.pages.map(
      (page) =>
        new APPUIPageT(
          page.id,
          nullable(page.title),
          nullable(page.description),
          nullable(page.icon),
          nullable(page.color),
          nullable(page.textColor),
          nullable(page.content),
          contentEncodingToFB[page.encoding ?? "utf8"],
          nullable(page.mediaType),
          nullable(page.contentSha256),
          page.entry === true,
          nullable(page.moduleId),
          nullable(page.url),
        ),
    ),
    nullable(manifest.createdAt),
    nullable(manifest.updatedAt),
    manifest.dataflow.map(
      (flow) =>
        new APPDataflowT(
          flow.name,
          flowDirectionToFB[flow.direction ?? "to_page"],
          flow.sdsSchema,
          flowTransportToFB[flow.transport ?? "ipfs_cid"],
          nullable(flow.locator),
          nullable(flow.moduleId),
          nullable(flow.methodId),
          nullable(flow.portId),
          contentEncodingToFB[flow.contentEncoding ?? "utf8"],
          nullable(flow.description),
        ),
    ),
  );
}

/** Encode a validated manifest as canonical size-prefixed SDS `$APP` bytes. */
export function encodeAppManifest(manifest) {
  validateAppManifest(manifest);
  const normalized = withArrayDefaults(manifest);
  const builder = new flatbuffers.Builder(1024);
  const root = toAppObject(normalized).pack(builder);
  APP.finishSizePrefixedAPPBuffer(builder, root);
  return new Uint8Array(builder.asUint8Array());
}

function fromBigInt(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

function assignOptional(target, key, value) {
  if (value !== null && value !== undefined && value !== "") {
    target[key] = value;
  }
}

function decodeModule(module) {
  const out = {
    id: module.ID,
    pluginId: module.PLUGIN_ID,
    contentHash: module.CONTENT_HASH,
  };
  assignOptional(out, "version", module.VERSION);
  assignOptional(out, "role", module.ROLE);
  assignOptional(out, "description", module.DESCRIPTION);
  const maxWallClockMs = fromBigInt(module.MAX_WALL_CLOCK_MS);
  const maxCostUnits = fromBigInt(module.MAX_COST_UNITS);
  if (maxWallClockMs !== 0) out.maxWallClockMs = maxWallClockMs;
  if (maxCostUnits !== 0) out.maxCostUnits = maxCostUnits;
  if (module.MAX_MEMORY_PAGES !== 0) out.maxMemoryPages = module.MAX_MEMORY_PAGES;
  out.runtimeTarget = runtimeTargetFromFB[module.RUNTIME_TARGET];
  return out;
}

function decodeData(data) {
  const out = {
    id: data.ID,
    sdsType: data.SDS_TYPE,
    direction: dataDirectionFromFB[data.DIRECTION],
  };
  assignOptional(out, "moduleId", data.MODULE_ID);
  assignOptional(out, "description", data.DESCRIPTION);
  return out;
}

function decodeSource(source) {
  const out = {
    id: source.ID,
    kind: sourceKindFromFB[source.KIND],
    ref: source.REF,
  };
  assignOptional(out, "description", source.DESCRIPTION);
  return out;
}

function decodePage(page) {
  const out = { id: page.ID };
  assignOptional(out, "title", page.TITLE);
  assignOptional(out, "description", page.DESCRIPTION);
  assignOptional(out, "icon", page.ICON);
  assignOptional(out, "color", page.COLOR);
  assignOptional(out, "textColor", page.TEXT_COLOR);
  assignOptional(out, "content", page.CONTENT);
  out.encoding = contentEncodingFromFB[page.ENCODING];
  assignOptional(out, "mediaType", page.MEDIA_TYPE);
  assignOptional(out, "contentSha256", page.CONTENT_SHA256);
  out.entry = page.ENTRY;
  assignOptional(out, "moduleId", page.MODULE_ID);
  assignOptional(out, "url", page.URL);
  return out;
}

function decodeDataflow(flow) {
  const out = {
    name: flow.NAME,
    direction: flowDirectionFromFB[flow.DIRECTION],
    sdsSchema: flow.SDS_SCHEMA,
    transport: flowTransportFromFB[flow.TRANSPORT],
  };
  assignOptional(out, "locator", flow.LOCATOR);
  assignOptional(out, "moduleId", flow.MODULE_ID);
  assignOptional(out, "methodId", flow.METHOD_ID);
  assignOptional(out, "portId", flow.PORT_ID);
  out.contentEncoding = contentEncodingFromFB[flow.CONTENT_ENCODING];
  assignOptional(out, "description", flow.DESCRIPTION);
  return out;
}

/** Decode and revalidate canonical size-prefixed SDS `$APP` bytes. */
export function decodeAppManifest(data) {
  const bytes = toUint8Array(data);
  if (!bytes || bytes.length < 12) {
    throw new TypeError("decodeAppManifest expects non-truncated FlatBuffer bytes.");
  }
  const identifier = new TextDecoder().decode(bytes.subarray(8, 12));
  if (identifier !== APP_FILE_IDENTIFIER) {
    throw new Error(
      `APP manifest buffer identifier mismatch (expected ${APP_FILE_IDENTIFIER}).`,
    );
  }
  const root = APP.getSizePrefixedRootAsAPP(
    new flatbuffers.ByteBuffer(new Uint8Array(bytes)),
  ).unpack();
  const manifest = {
    id: root.ID,
    name: root.NAME ?? "",
    version: root.VERSION ?? "",
    modules: root.MODULES.map(decodeModule),
    data: root.DATA.map(decodeData),
    sources: root.SOURCES.map(decodeSource),
    pages: root.UI.map(decodePage),
    dataflow: root.DATAFLOW.map(decodeDataflow),
  };
  assignOptional(manifest, "description", root.DESCRIPTION);
  assignOptional(manifest, "createdAt", root.CREATED_AT);
  assignOptional(manifest, "updatedAt", root.UPDATED_AT);
  validateAppManifest(manifest);
  return manifest;
}
