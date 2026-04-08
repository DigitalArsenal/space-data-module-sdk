import { DirectAccessor, FlatSQLDatabase } from "flatsql";

const RUNTIME_ROW_TABLE = "RuntimeHostRow";
const RUNTIME_ROW_SCHEMA = `
table RuntimeHostRow {
  schemaFileId: string;
  rowId: ulong;
}
`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function clonePayload(payload) {
  if (payload === null || payload === undefined) {
    return payload ?? null;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(payload);
  }
  return clonePayloadFallback(payload, new WeakMap());
}

function clonePayloadFallback(payload, seen) {
  if (payload instanceof Date) {
    return new Date(payload.getTime());
  }
  if (payload instanceof RegExp) {
    return new RegExp(payload.source, payload.flags);
  }
  if (payload instanceof Map) {
    if (seen.has(payload)) {
      return seen.get(payload);
    }
    const cloned = new Map();
    seen.set(payload, cloned);
    for (const [key, value] of payload.entries()) {
      cloned.set(clonePayloadFallback(key, seen), clonePayloadFallback(value, seen));
    }
    return cloned;
  }
  if (payload instanceof Set) {
    if (seen.has(payload)) {
      return seen.get(payload);
    }
    const cloned = new Set();
    seen.set(payload, cloned);
    for (const value of payload.values()) {
      cloned.add(clonePayloadFallback(value, seen));
    }
    return cloned;
  }
  if (ArrayBuffer.isView(payload)) {
    if (payload instanceof DataView) {
      return new DataView(
        payload.buffer.slice(
          payload.byteOffset,
          payload.byteOffset + payload.byteLength,
        ),
      );
    }
    const clonedBuffer = payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength,
    );
    return new payload.constructor(clonedBuffer, 0, payload.length);
  }
  if (payload instanceof ArrayBuffer) {
    return payload.slice(0);
  }
  if (Array.isArray(payload)) {
    if (seen.has(payload)) {
      return seen.get(payload);
    }
    const cloned = [];
    seen.set(payload, cloned);
    for (const value of payload) {
      cloned.push(clonePayloadFallback(value, seen));
    }
    return cloned;
  }
  if (typeof payload === "object") {
    if (seen.has(payload)) {
      return seen.get(payload);
    }
    const prototype = Object.getPrototypeOf(payload);
    const cloned = Object.create(prototype ?? Object.prototype);
    seen.set(payload, cloned);
    for (const key of Reflect.ownKeys(payload)) {
      const descriptor = Object.getOwnPropertyDescriptor(payload, key);
      if (!descriptor) {
        continue;
      }
      if ("value" in descriptor) {
        descriptor.value = clonePayloadFallback(descriptor.value, seen);
      }
      Object.defineProperty(cloned, key, descriptor);
    }
    return cloned;
  }
  return payload;
}

function normalizeSchemaFileId(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("schemaFileId must be a non-empty string");
  }
  return value.trim();
}

function normalizeRowHandle(handle) {
  if (!handle || typeof handle !== "object") {
    throw new TypeError("row handle is required");
  }
  const schemaFileId = normalizeSchemaFileId(handle.schemaFileId);
  const rowId = Number(handle.rowId);
  if (!Number.isInteger(rowId) || rowId <= 0) {
    throw new TypeError("rowId must be a positive integer");
  }
  return { schemaFileId, rowId };
}

function escapeSqlStringLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function encodeRuntimeRowMetadata({ schemaFileId, rowId }) {
  const schemaBytes = encoder.encode(normalizeSchemaFileId(schemaFileId));
  const encoded = new Uint8Array(4 + schemaBytes.byteLength + 8);
  const view = new DataView(encoded.buffer);
  view.setUint32(0, schemaBytes.byteLength, true);
  encoded.set(schemaBytes, 4);
  view.setBigUint64(4 + schemaBytes.byteLength, BigInt(rowId), true);
  return encoded;
}

function decodeRuntimeRowMetadata(data) {
  const bytes =
    data instanceof Uint8Array
      ? data
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.byteLength < 12) {
    throw new Error("Invalid runtime row metadata buffer.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const schemaLength = view.getUint32(0, true);
  const schemaStart = 4;
  const schemaEnd = schemaStart + schemaLength;
  const rowIdOffset = schemaEnd;
  if (schemaEnd + 8 > bytes.byteLength) {
    throw new Error("Invalid runtime row metadata layout.");
  }
  return {
    schemaFileId: decoder.decode(bytes.subarray(schemaStart, schemaEnd)),
    rowId: Number(view.getBigUint64(rowIdOffset, true)),
  };
}

function buildRowKey(schemaFileId, rowId) {
  return `${normalizeSchemaFileId(schemaFileId)}:${Number(rowId)}`;
}

function createRuntimeRowAccessor() {
  const accessor = new DirectAccessor();
  accessor.registerAccessor(RUNTIME_ROW_TABLE, (data, path) => {
    const row = decodeRuntimeRowMetadata(data);
    let current = row;
    for (const segment of Array.isArray(path) ? path : []) {
      if (current === null || current === undefined) {
        return null;
      }
      current = current[segment];
    }
    return current ?? null;
  });
  accessor.registerBuilder(RUNTIME_ROW_TABLE, (fields) =>
    encodeRuntimeRowMetadata({
      schemaFileId: fields.schemaFileId,
      rowId: Number(fields.rowId),
    }),
  );
  return accessor;
}

function cloneQueryResult(result) {
  return {
    columns: Array.from(result?.columns ?? []),
    rows: (result?.rows ?? []).map((row) =>
      Array.isArray(row) ? row.map((value) => clonePayload(value)) : row,
    ),
    rowCount: Number(result?.rowCount ?? 0),
  };
}

function rowViewFromQueryRow(row, payloadStore) {
  const schemaFileId = String(row[0]);
  const rowId = Number(row[1]);
  return {
    handle: {
      schemaFileId,
      rowId,
    },
    payload: clonePayload(payloadStore.get(buildRowKey(schemaFileId, rowId))),
  };
}

export function createFlatSqlRuntimeStore(options = {}) {
  const accessor = options.accessor ?? createRuntimeRowAccessor();
  const payloadStore = options.payloadStore ?? new Map();
  const database =
    options.database ??
    FlatSQLDatabase.fromSchema(
      RUNTIME_ROW_SCHEMA,
      accessor,
      options.databaseName ?? "runtime-host",
    );
  const nextRowIdBySchema = new Map();
  const existingRows = database.query(
    `SELECT schemaFileId, rowId FROM ${RUNTIME_ROW_TABLE} ORDER BY schemaFileId, rowId`,
  );
  for (const row of existingRows.rows ?? []) {
    const schemaFileId = normalizeSchemaFileId(row[0]);
    const rowId = Number(row[1]);
    if (Number.isInteger(rowId) && rowId > 0) {
      nextRowIdBySchema.set(
        schemaFileId,
        Math.max(nextRowIdBySchema.get(schemaFileId) ?? 0, rowId),
      );
    }
  }

  function appendRow({ schemaFileId, payload = null }) {
    const normalizedSchemaFileId = normalizeSchemaFileId(schemaFileId);
    const nextRowId = (nextRowIdBySchema.get(normalizedSchemaFileId) ?? 0) + 1;
    nextRowIdBySchema.set(normalizedSchemaFileId, nextRowId);
    database.insert(RUNTIME_ROW_TABLE, {
      schemaFileId: normalizedSchemaFileId,
      rowId: nextRowId,
    });
    payloadStore.set(
      buildRowKey(normalizedSchemaFileId, nextRowId),
      clonePayload(payload),
    );
    return {
      schemaFileId: normalizedSchemaFileId,
      rowId: nextRowId,
    };
  }

  function resolveRow(handle) {
    const normalizedHandle = normalizeRowHandle(handle);
    return (
      listRows(normalizedHandle.schemaFileId).find(
        (row) => row.handle.rowId === normalizedHandle.rowId,
      ) ?? null
    );
  }

  function listRows(schemaFileId = null) {
    const normalizedSchemaFileId =
      schemaFileId === null || schemaFileId === undefined
        ? null
        : normalizeSchemaFileId(schemaFileId);
    const result =
      normalizedSchemaFileId === null
        ? database.query(
            `SELECT schemaFileId, rowId FROM ${RUNTIME_ROW_TABLE} ORDER BY schemaFileId, rowId`,
          )
        : database.query(
            `SELECT schemaFileId, rowId FROM ${RUNTIME_ROW_TABLE} WHERE schemaFileId = '${escapeSqlStringLiteral(normalizedSchemaFileId)}' ORDER BY rowId`,
          );
    return (result.rows ?? []).map((row) => rowViewFromQueryRow(row, payloadStore));
  }

  function query(sql) {
    if (typeof sql !== "string" || sql.trim().length === 0) {
      throw new TypeError("sql must be a non-empty string");
    }
    return cloneQueryResult(database.query(sql));
  }

  return {
    appendRow,
    listRows,
    query,
    resolveRow,
  };
}
