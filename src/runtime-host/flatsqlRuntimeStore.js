import { FlatSQL } from "flatsql";
import { encodeFlatSqlQuery, decodeFlatSqlResult } from "./flatsqlQueryProtocol.js";

const quote = name => `"${name.replaceAll('"', '""')}"`;
const fileId = value => {
  if (typeof value !== "string" || new TextEncoder().encode(value).length !== 4) {
    throw new TypeError("schemaFileId must be the four-byte FlatBuffer file identifier");
  }
  return value;
};

/** Durable binary records. Schema compilation and result rendering belong to
 * the caller; the engine owns row IDs, deduplication, indexes and persistence. */
export function createFlatSqlRuntimeStore(options = {}) {
  const schemas = new Map();
  let opening, closed = false;
  const database = () => {
    if (closed) throw new Error("Runtime row store is closed");
    return opening ??= (async () => {
      const db = options.database ?? await FlatSQL.open(options.engine);
      try {
        for (const spec of options.schemas ?? []) {
          const id = fileId(spec.fileIdentifier);
          await db.registerSchema(spec); schemas.set(id, spec);
        }
        return db;
      } catch (error) { await db.close(); throw error; }
    })();
  };
  async function registerSchema(schema) {
    const id = fileId(schema.fileIdentifier);
    await (await database()).registerSchema(schema);
    schemas.set(id, schema);
  }
  async function schemaFor(id) {
    id = fileId(id);
    await database();
    if (!schemas.has(id)) {
      const spec = (options.schemas ?? []).find(s => s.fileIdentifier === id)
        ?? await options.resolveSchema?.(id);
      if (!spec || spec.fileIdentifier !== id) throw new Error(`No binary schema registered for ${id}`);
      await registerSchema(spec);
    }
    return schemas.get(id);
  }
  async function query(sql, params = [], limits = {}) {
    return decodeFlatSqlResult(await (await database()).execute(encodeFlatSqlQuery(sql, params), limits));
  }
  async function appendRow({ schemaFileId, payload }) {
    const schema = await schemaFor(schemaFileId);
    if (!(payload instanceof Uint8Array) || payload.length < 8) throw new TypeError("payload must be a FlatBuffer Uint8Array");
    if (String.fromCharCode(...payload.subarray(4, 8)) !== schema.fileIdentifier) throw new Error("Record file identifier does not match its schema");
    const frame = new Uint8Array(payload.length + 4);
    new DataView(frame.buffer).setUint32(0, payload.length, true);
    frame.set(payload, 4);
    const receipt = decodeFlatSqlResult(await (await database()).ingest(schema.name, frame));
    const row = receipt.rows[0];
    if (receipt.rows.length !== 1 || Number(row[1]) === 0) throw new Error(`FlatSQL rejected record: ${row?.[3] ?? "missing receipt"}`);
    const rowId = Number(row[2]);
    if (!Number.isSafeInteger(rowId) || rowId < 1) throw new RangeError("Row ID exceeds the host identity range");
    return { schemaFileId: schema.fileIdentifier, rowId };
  }
  async function listRows(schemaFileId) {
    const ids = schemaFileId == null ? [...new Set([...schemas.keys(), ...(options.schemas ?? []).map(s => s.fileIdentifier)])].sort() : [fileId(schemaFileId)];
    const out = [];
    for (const id of ids) {
      const schema = await schemaFor(id);
      const result = await query(`SELECT _rowid,_data FROM ${quote(schema.name)} ORDER BY _rowid`);
      for (const [rowId, payload] of result.rows) {
        const value = Number(rowId);
        if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Row ID exceeds the host identity range");
        out.push({ handle: { schemaFileId: id, rowId: value }, payload });
      }
    }
    return out;
  }
  async function resolveRow(handle) {
    if (!Number.isSafeInteger(handle?.rowId) || handle.rowId < 1) throw new TypeError("rowId must be a positive safe integer");
    const schema = await schemaFor(handle.schemaFileId);
    const result = await query(`SELECT _data FROM ${quote(schema.name)} WHERE _rowid=?1`, [handle.rowId]);
    return result.rows.length ? { handle: { schemaFileId: schema.fileIdentifier, rowId: handle.rowId }, payload: result.rows[0][0] } : null;
  }
  async function close() {
    if (closed) return;
    closed = true;
    if (opening) await (await opening).close();
  }
  return { registerSchema, appendRow, listRows, query, resolveRow, close };
}
