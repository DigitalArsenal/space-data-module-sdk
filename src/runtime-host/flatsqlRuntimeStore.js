import { DirectAccessor, FlatSQLDatabase } from "flatsql";

const RUNTIME_ROW_TABLE = "RuntimeHostRow";
const RUNTIME_ROW_SCHEMA = `
table RuntimeHostRow {
  schemaFileId: string;
  rowId: ulong;
  payloadJson: string;
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
  if (ArrayBuffer.isView(payload)) {
    return payload.slice(0);
  }
  if (payload instanceof ArrayBuffer) {
    return payload.slice(0);
  }
  if (typeof payload === "object") {
    return JSON.parse(JSON.stringify(payload));
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

function serializePayload(payload) {
  if (payload === null || payload === undefined) {
    return {
      kind: "json",
      value: null,
    };
  }
  if (ArrayBuffer.isView(payload)) {
    return {
      kind: "bytes",
      bytes: Array.from(
        new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
      ),
    };
  }
  if (payload instanceof ArrayBuffer) {
    return {
      kind: "bytes",
      bytes: Array.from(new Uint8Array(payload)),
    };
  }
  return {
    kind: "json",
    value: clonePayload(payload),
  };
}

function deserializePayload(payloadJson) {
  const payload = JSON.parse(String(payloadJson ?? "null"));
  if (payload?.kind === "bytes") {
    return Uint8Array.from(payload.bytes ?? []);
  }
  if (payload?.kind === "json") {
    return clonePayload(payload.value);
  }
  return clonePayload(payload);
}

function createRuntimeRowAccessor() {
  const accessor = new DirectAccessor();
  accessor.registerAccessor(RUNTIME_ROW_TABLE, (data, path) => {
    const row = JSON.parse(decoder.decode(data));
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
    encoder.encode(
      JSON.stringify({
        schemaFileId: normalizeSchemaFileId(fields.schemaFileId),
        rowId: Number(fields.rowId),
        payloadJson: String(fields.payloadJson ?? "null"),
      }),
    ),
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

function rowViewFromQueryRow(row) {
  return {
    handle: {
      schemaFileId: String(row[0]),
      rowId: Number(row[1]),
    },
    payload: deserializePayload(row[2]),
  };
}

export function createFlatSqlRuntimeStore(options = {}) {
  const accessor = options.accessor ?? createRuntimeRowAccessor();
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
      payloadJson: JSON.stringify(serializePayload(payload)),
    });
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
            `SELECT schemaFileId, rowId, payloadJson FROM ${RUNTIME_ROW_TABLE} ORDER BY schemaFileId, rowId`,
          )
        : database.query(
            `SELECT schemaFileId, rowId, payloadJson FROM ${RUNTIME_ROW_TABLE} WHERE schemaFileId = '${escapeSqlStringLiteral(normalizedSchemaFileId)}' ORDER BY rowId`,
          );
    return (result.rows ?? []).map(rowViewFromQueryRow);
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
