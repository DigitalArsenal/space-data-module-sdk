// SDK-side SDS conversion. FlatSQL itself receives and emits only FlatBuffers.
import { Builder, ByteBuffer } from "flatbuffers";
import { QRP } from "spacedatastandards.org/lib/js/QRP/QRP.js";
import { QRPValue } from "spacedatastandards.org/lib/js/QRP/QRPValue.js";
import { qrpValueKind as K } from "spacedatastandards.org/lib/js/QRP/qrpValueKind.js";
import { qrpRepresentation } from "spacedatastandards.org/lib/js/QRP/qrpRepresentation.js";
import { qrpKind } from "spacedatastandards.org/lib/js/QRP/qrpKind.js";

export function encodeFlatSqlQuery(sql, parameters = []) {
  if (typeof sql !== "string" || !sql.trim()) throw new TypeError("SQL must be a nonempty string");
  const b = new Builder(512), text = b.createString(sql);
  const values = parameters.map(value => {
    let kind = K.Null, data = 0;
    if (typeof value === "string") { kind = K.Text; data = b.createString(value); }
    else if (value instanceof Uint8Array) { kind = K.Bytes; data = QRPValue.createBytesValueVector(b, value); }
    else if (typeof value === "boolean") kind = K.Bool;
    else if (typeof value === "bigint" || (typeof value === "number" && Number.isSafeInteger(value))) {
      kind = K.Int; value = BigInt(value);
      if (value < -(1n << 63n) || value >= (1n << 63n)) throw new RangeError("SQL integer exceeds int64");
    } else if (typeof value === "number" && Number.isFinite(value)) kind = K.Float;
    else if (value !== null) throw new TypeError("SQL values are null, boolean, finite number, bigint, string or Uint8Array");
    QRPValue.startQRPValue(b); QRPValue.addKind(b, kind);
    if (kind === K.Text) QRPValue.addTextValue(b, data);
    if (kind === K.Bytes) QRPValue.addBytesValue(b, data);
    if (kind === K.Bool) QRPValue.addBoolValue(b, value);
    if (kind === K.Int) QRPValue.addIntValue(b, value);
    if (kind === K.Float) QRPValue.addFloatValue(b, value);
    return QRPValue.endQRPValue(b);
  });
  const params = QRP.createParametersVector(b, values);
  QRP.startQRP(b); QRP.addSql(b, text); QRP.addParameters(b, params);
  QRP.addRepresentation(b, qrpRepresentation.FlatBuffer);
  QRP.finishSizePrefixedQRPBuffer(b, QRP.endQRP(b));
  return b.asUint8Array().slice();
}

export function decodeFlatSqlResult(stream) {
  if (!(stream instanceof Uint8Array)) throw new TypeError("QRP result must be Uint8Array");
  let columns = [], ended = false;
  const rows = [];
  for (let at = 0; at < stream.length;) {
    if (ended || stream.length - at < 4) throw new Error("Invalid QRP stream boundary");
    const size = new DataView(stream.buffer, stream.byteOffset + at, 4).getUint32(0, true);
    if (size < 8 || size > stream.length - at - 4) throw new Error("Truncated QRP frame");
    const frame = stream.subarray(at, at + size + 4);
    if (String.fromCharCode(...frame.subarray(8, 12)) !== "$QRP") throw new Error("Expected SDS QRP");
    const page = QRP.getSizePrefixedRootAsQRP(new ByteBuffer(frame));
    if (![qrpKind.Page, qrpKind.Error].includes(page.KIND()) || page.REPRESENTATION() !== qrpRepresentation.FlatBuffer) throw new Error("Unexpected QRP response kind");
    if (page.ERROR_CODE() || page.KIND() === qrpKind.Error) throw new Error(`FlatSQL ${page.ERROR_CODE()}: ${page.MESSAGE()}`);
    if (page.columnsLength() > size / 4 || page.rowsLength() > size / 4) throw new Error("Invalid QRP vector length");
    if (page.columnsLength()) {
      const next = Array.from({ length: page.columnsLength() }, (_, i) => page.COLUMNS(i).NAME());
      if (columns.length && (columns.length !== next.length || columns.some((name, i) => name !== next[i]))) throw new Error("QRP columns changed");
      columns = next;
    }
    for (let i = 0; i < page.rowsLength(); ++i) {
      const row = page.ROWS(i);
      if (row.cellsLength() !== columns.length) throw new Error("QRP row width mismatch");
      rows.push(Array.from({ length: columns.length }, (_, j) => {
        const c = row.CELLS(j);
        switch (c.KIND()) {
          case K.Null: return null;
          case K.Bool: return c.BOOL_VALUE();
          case K.Int: { const value = c.INT_VALUE(); return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value; }
          case K.Float: return c.FLOAT_VALUE();
          case K.Text: return c.TEXT_VALUE();
          case K.Bytes: return c.bytesValueArray()?.slice() ?? new Uint8Array();
          default: throw new Error("Unknown QRP cell kind");
        }
      }));
    }
    ended = !page.PARTIAL(); at += size + 4;
  }
  if (!ended) throw new Error("QRP result has no terminal page");
  return { columns, rows, rowCount: rows.length };
}
