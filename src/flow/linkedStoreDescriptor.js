import { canonicalBytes } from "../auth/canonicalize.js";
import {
  getWasmCustomSections,
  parseWasmModuleSections,
} from "../bundle/wasm.js";
import { sha256Bytes } from "../utils/crypto.js";
import { bytesToHex, toUint8Array } from "../utils/encoding.js";

export const FLATSQL_LINKED_STORE_SECTION_NAME =
  "sdn.flatsql.descriptor.v1";

const MAX_IDENTIFIER_LENGTH = 63;
const MAX_SCHEMA_BYTES = 128 << 10;
const MAX_FILE_IDENTIFIER_MAPPINGS = 256;
const MAX_RECORD_VIEWS = 256;
const MAX_RECORD_VIEW_FILTERS = 32;
const MAX_DESCRIPTOR_BYTES = 256 << 10;
const SAFE_SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const SAFE_ROUTE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const ASCII_FILE_IDENTIFIER = /^[\x21-\x7e]{4}$/;
const ROOT_FIELDS = new Set([
  "version",
  "engine",
  "database",
  "schema",
  "fileIdentifiers",
  "recordViews",
]);
const MAPPING_FIELDS = new Set(["id", "table"]);
const RECORD_VIEW_FIELDS = new Set([
  "id",
  "fileIdentifier",
  "table",
  "recordColumn",
  "filters",
  "latestOrderBy",
]);
const RECORD_VIEW_FILTER_FIELDS = new Set(["parameter", "column", "type"]);
const FLATSQL_PERSISTENCE_IMPORTS = new Set([
  "ingest_record",
]);

const strictTextDecoder = new TextDecoder("utf-8", { fatal: true });

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertKnownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new TypeError(`${label} contains unknown field "${field}".`);
    }
  }
}

function assertSafeIdentifier(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !SAFE_SQL_IDENTIFIER.test(value)
  ) {
    throw new TypeError(
      `${label} must be a safe SQL identifier of 1..${MAX_IDENTIFIER_LENGTH} ASCII characters.`,
    );
  }
  return value;
}

export function validateFlatsqlLinkedStoreDescriptor(value) {
  assertPlainObject(value, "flow.linkedStore");
  assertKnownFields(value, ROOT_FIELDS, "flow.linkedStore");

  if (value.version !== 1) {
    throw new TypeError("flow.linkedStore.version must be exactly 1.");
  }
  if (value.engine !== "flatsql") {
    throw new TypeError('flow.linkedStore.engine must be exactly "flatsql".');
  }

  const database = assertSafeIdentifier(
    value.database,
    "flow.linkedStore.database",
  );
  if (typeof value.schema !== "string" || value.schema.trim().length === 0) {
    throw new TypeError("flow.linkedStore.schema must be a non-empty string.");
  }
  const schemaBytes = new TextEncoder().encode(value.schema);
  if (schemaBytes.length > MAX_SCHEMA_BYTES) {
    throw new RangeError(
      `flow.linkedStore.schema exceeds the ${MAX_SCHEMA_BYTES}-byte limit.`,
    );
  }
  if (value.schema.includes("\0")) {
    throw new TypeError("flow.linkedStore.schema must not contain NUL bytes.");
  }

  if (
    !Array.isArray(value.fileIdentifiers) ||
    value.fileIdentifiers.length === 0 ||
    value.fileIdentifiers.length > MAX_FILE_IDENTIFIER_MAPPINGS
  ) {
    throw new TypeError(
      `flow.linkedStore.fileIdentifiers must contain 1..${MAX_FILE_IDENTIFIER_MAPPINGS} mappings.`,
    );
  }

  const ids = new Set();
  const tables = new Set();
  const fileIdentifiers = value.fileIdentifiers.map((mapping, index) => {
    const label = `flow.linkedStore.fileIdentifiers[${index}]`;
    assertPlainObject(mapping, label);
    assertKnownFields(mapping, MAPPING_FIELDS, label);
    if (
      typeof mapping.id !== "string" ||
      !ASCII_FILE_IDENTIFIER.test(mapping.id) ||
      new TextEncoder().encode(mapping.id).length !== 4
    ) {
      throw new TypeError(`${label}.id must be a printable 4-byte ASCII ID.`);
    }
    if (ids.has(mapping.id)) {
      throw new TypeError(
        `flow.linkedStore.fileIdentifiers contains duplicate id "${mapping.id}".`,
      );
    }
    const table = assertSafeIdentifier(mapping.table, `${label}.table`);
    if (tables.has(table)) {
      throw new TypeError(
        `flow.linkedStore.fileIdentifiers contains duplicate table "${table}".`,
      );
    }
    ids.add(mapping.id);
    tables.add(table);
    return { id: mapping.id, table };
  });

  let recordViews;
  if (value.recordViews !== undefined) {
    if (
      !Array.isArray(value.recordViews) ||
      value.recordViews.length === 0 ||
      value.recordViews.length > MAX_RECORD_VIEWS
    ) {
      throw new TypeError(
        `flow.linkedStore.recordViews must contain 1..${MAX_RECORD_VIEWS} views when provided.`,
      );
    }
    const mappingByID = new Map(
      fileIdentifiers.map((mapping) => [mapping.id, mapping]),
    );
    const viewIDs = new Set();
    recordViews = value.recordViews.map((view, index) => {
      const label = `flow.linkedStore.recordViews[${index}]`;
      assertPlainObject(view, label);
      assertKnownFields(view, RECORD_VIEW_FIELDS, label);
      if (
        typeof view.id !== "string" ||
        !SAFE_ROUTE_IDENTIFIER.test(view.id)
      ) {
        throw new TypeError(
          `${label}.id must be a path-safe identifier of 1..${MAX_IDENTIFIER_LENGTH} ASCII characters.`,
        );
      }
      if (viewIDs.has(view.id)) {
        throw new TypeError(
          `flow.linkedStore.recordViews contains duplicate id "${view.id}".`,
        );
      }
      viewIDs.add(view.id);

      const mapping = mappingByID.get(view.fileIdentifier);
      if (!mapping) {
        throw new TypeError(
          `${label}.fileIdentifier must reference a declared fileIdentifiers id.`,
        );
      }
      if (view.table !== mapping.table) {
        throw new TypeError(
          `${label}.table must match the declared fileIdentifier table mapping.`,
        );
      }
      const recordColumn = assertSafeIdentifier(
        view.recordColumn,
        `${label}.recordColumn`,
      );
      const latestOrderBy = assertSafeIdentifier(
        view.latestOrderBy,
        `${label}.latestOrderBy`,
      );
      if (
        !Array.isArray(view.filters) ||
        view.filters.length > MAX_RECORD_VIEW_FILTERS
      ) {
        throw new TypeError(
          `${label}.filters must be an array with at most ${MAX_RECORD_VIEW_FILTERS} entries.`,
        );
      }
      const parameters = new Set();
      const filters = view.filters.map((filter, filterIndex) => {
        const filterLabel = `${label}.filters[${filterIndex}]`;
        assertPlainObject(filter, filterLabel);
        assertKnownFields(filter, RECORD_VIEW_FILTER_FIELDS, filterLabel);
        const parameter = assertSafeIdentifier(
          filter.parameter,
          `${filterLabel}.parameter`,
        );
        if (parameters.has(parameter)) {
          throw new TypeError(
            `${label}.filters contains duplicate parameter "${parameter}".`,
          );
        }
        parameters.add(parameter);
        const column = assertSafeIdentifier(
          filter.column,
          `${filterLabel}.column`,
        );
        if (filter.type !== "text") {
          throw new TypeError(`${filterLabel}.type must be exactly "text".`);
        }
        return { column, parameter, type: "text" };
      });
      return {
        fileIdentifier: mapping.id,
        filters,
        id: view.id,
        latestOrderBy,
        recordColumn,
        table: mapping.table,
      };
    });
  }

  const descriptor = {
    database,
    engine: "flatsql",
    fileIdentifiers,
    ...(recordViews === undefined ? {} : { recordViews }),
    schema: value.schema,
    version: 1,
  };
  const encoded = canonicalBytes(descriptor);
  if (encoded.length > MAX_DESCRIPTOR_BYTES) {
    throw new RangeError(
      `flow.linkedStore descriptor exceeds the ${MAX_DESCRIPTOR_BYTES}-byte limit.`,
    );
  }
  return descriptor;
}

export function encodeFlatsqlLinkedStoreDescriptor(value) {
  return new Uint8Array(
    canonicalBytes(validateFlatsqlLinkedStoreDescriptor(value)),
  );
}

export function parseFlatsqlLinkedStoreDescriptor(bytes) {
  const actual = toUint8Array(bytes);
  if (actual.byteLength > MAX_DESCRIPTOR_BYTES) {
    throw new RangeError(
      `FlatSQL linked-store descriptor exceeds the ${MAX_DESCRIPTOR_BYTES}-byte limit.`,
    );
  }
  let text;
  try {
    text = strictTextDecoder.decode(actual);
  } catch (error) {
    throw new TypeError("FlatSQL linked-store descriptor is not valid UTF-8.", {
      cause: error,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new TypeError("FlatSQL linked-store descriptor is not valid JSON.", {
      cause: error,
    });
  }
  const descriptor = validateFlatsqlLinkedStoreDescriptor(parsed);
  const canonical = encodeFlatsqlLinkedStoreDescriptor(descriptor);
  if (
    actual.length !== canonical.length ||
    actual.some((byte, index) => byte !== canonical[index])
  ) {
    throw new TypeError(
      "FlatSQL linked-store descriptor JSON must use canonical UTF-8 encoding.",
    );
  }
  return descriptor;
}

export async function hashFlatsqlLinkedStoreDescriptor(value) {
  return bytesToHex(
    await sha256Bytes(encodeFlatsqlLinkedStoreDescriptor(value)),
  );
}

export async function readFlatsqlLinkedStoreDescriptor(
  wasmBytes,
  { expectedSha256 } = {},
) {
  const sections = getWasmCustomSections(
    wasmBytes,
    FLATSQL_LINKED_STORE_SECTION_NAME,
  );
  if (sections.length === 0) {
    if (expectedSha256 !== undefined) {
      throw new Error(
        `WASM is missing the integrity-bound ${FLATSQL_LINKED_STORE_SECTION_NAME} custom section.`,
      );
    }
    return null;
  }
  if (sections.length !== 1) {
    throw new Error(
      `WASM must contain exactly one ${FLATSQL_LINKED_STORE_SECTION_NAME} custom section.`,
    );
  }
  const descriptor = parseFlatsqlLinkedStoreDescriptor(sections[0]);
  if (expectedSha256 !== undefined) {
    const expected = String(expectedSha256).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      throw new TypeError("Expected linked-store descriptor SHA-256 must be 64 hex characters.");
    }
    const actual = await hashFlatsqlLinkedStoreDescriptor(descriptor);
    if (actual !== expected) {
      throw new Error(
        `FlatSQL linked-store descriptor hash mismatch: expected ${expected}, got ${actual}.`,
      );
    }
  }
  return descriptor;
}

export function listFlatsqlPersistenceImports(wasmBytes) {
  const module = new WebAssembly.Module(
    parseWasmModuleSections(wasmBytes).bytes,
  );
  return WebAssembly.Module.imports(module)
    .filter(
      (entry) =>
        entry.module === "flatsql" &&
        entry.kind === "function" &&
        FLATSQL_PERSISTENCE_IMPORTS.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

export function assertFlatsqlLinkedStoreDescriptorForWasm(
  wasmBytes,
  descriptor,
) {
  const imports = listFlatsqlPersistenceImports(wasmBytes);
  const sections = getWasmCustomSections(
    wasmBytes,
    FLATSQL_LINKED_STORE_SECTION_NAME,
  );
  if (sections.length > 1) {
    throw new Error(
      `WASM must contain at most one ${FLATSQL_LINKED_STORE_SECTION_NAME} custom section.`,
    );
  }
  const embedded =
    sections.length === 1
      ? parseFlatsqlLinkedStoreDescriptor(sections[0])
      : null;
  if (imports.length > 0 && !embedded) {
    throw new Error(
      `WASM imports FlatSQL persistence trampolines (${imports.join(", ")}); flow.linkedStore requires the ${FLATSQL_LINKED_STORE_SECTION_NAME} custom section.`,
    );
  }
  if (descriptor !== undefined && descriptor !== null) {
    const expected = encodeFlatsqlLinkedStoreDescriptor(descriptor);
    if (
      embedded &&
      (sections[0].length !== expected.length ||
        sections[0].some((byte, index) => byte !== expected[index]))
    ) {
      throw new Error(
        "Embedded FlatSQL linked-store descriptor does not match flow.linkedStore.",
      );
    }
  }
}
