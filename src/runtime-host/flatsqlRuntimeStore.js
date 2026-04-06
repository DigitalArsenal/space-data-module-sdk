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

export function createFlatSqlRuntimeStore() {
  const nextRowIdBySchema = new Map();
  const rows = [];
  const rowsByKey = new Map();

  function appendRow({ schemaFileId, payload = null }) {
    const normalizedSchemaFileId = normalizeSchemaFileId(schemaFileId);
    const nextRowId = (nextRowIdBySchema.get(normalizedSchemaFileId) ?? 0) + 1;
    nextRowIdBySchema.set(normalizedSchemaFileId, nextRowId);
    const handle = {
      schemaFileId: normalizedSchemaFileId,
      rowId: nextRowId,
    };
    const entry = {
      handle,
      payload: clonePayload(payload),
    };
    rows.push(entry);
    rowsByKey.set(`${handle.schemaFileId}:${handle.rowId}`, entry);
    return { ...handle };
  }

  function resolveRow(handle) {
    const normalizedHandle = normalizeRowHandle(handle);
    const entry = rowsByKey.get(
      `${normalizedHandle.schemaFileId}:${normalizedHandle.rowId}`,
    );
    if (!entry) {
      return null;
    }
    return {
      handle: { ...entry.handle },
      payload: clonePayload(entry.payload),
    };
  }

  function listRows(schemaFileId = null) {
    const normalizedSchemaFileId =
      schemaFileId === null || schemaFileId === undefined
        ? null
        : normalizeSchemaFileId(schemaFileId);
    return rows
      .filter(
        (entry) =>
          normalizedSchemaFileId === null ||
          entry.handle.schemaFileId === normalizedSchemaFileId,
      )
      .map((entry) => ({
        handle: { ...entry.handle },
        payload: clonePayload(entry.payload),
      }));
  }

  return {
    appendRow,
    listRows,
    resolveRow,
  };
}
