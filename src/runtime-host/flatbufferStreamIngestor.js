import { createFlatSqlRuntimeStore } from "./flatsqlRuntimeStore.js";

function bytesOf(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError("FlatBuffer stream chunks must be binary buffers");
}

/** Ordered, backpressured ingestion. Await pushBytes before supplying the next
 * chunk. A failed route/write makes the stream terminal rather than dropping a
 * record and advancing its frame counter. */
export function createFlatBufferStreamIngestor(options = {}) {
  const rows = options.rows ?? createFlatSqlRuntimeStore(options.store);
  const maxFrameBytes = options.maxFrameBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 8) throw new RangeError("Invalid frame byte limit");
  const stats = { bytesReceived: 0, chunksReceived: 0, framesDecoded: 0, framesAppended: 0, framesRouted: 0, parseErrors: 0 };
  let pending = new Uint8Array(), tail = Promise.resolve(), failed, finished = false;
  async function ingest(bytes) {
    if (failed) throw failed;
    stats.bytesReceived += bytes.length; stats.chunksReceived++;
    const combined = new Uint8Array(pending.length + bytes.length);
    combined.set(pending); combined.set(bytes, pending.length);
    let at = 0, appended = 0;
    while (at + 4 <= combined.length) {
      const size = new DataView(combined.buffer, at, 4).getUint32(0, true);
      if (size < 8 || size > maxFrameBytes) { stats.parseErrors++; throw new Error("Invalid FlatBuffer stream frame size"); }
      if (size > combined.length - at - 4) break;
      const payload = combined.subarray(at + 4, at + 4 + size);
      const schemaFileId = String.fromCharCode(...payload.subarray(4, 8));
      if (!/^[\x20-\x7e]{4}$/.test(schemaFileId)) { stats.parseErrors++; throw new Error("Missing FlatBuffer file identifier"); }
      const context = { rawFileIdentifier: schemaFileId, schemaFileId, rows, stats };
      const route = typeof options.frameRouter === "function" ? options.frameRouter : options.frameRouter?.[schemaFileId];
      stats.framesDecoded++;
      if (route && await route(payload, context) !== false) stats.framesRouted++;
      else {
        if (options.appendFrame) await options.appendFrame(payload, context);
        else await rows.appendRow({ schemaFileId, payload });
        stats.framesAppended++; appended++;
      }
      at += size + 4;
    }
    pending = combined.slice(at);
    return appended;
  }
  function pushBytes(data) {
    if (finished) return Promise.reject(new Error("FlatBuffer stream is finished"));
    const bytes = bytesOf(data).slice();
    const result = tail.then(() => ingest(bytes));
    tail = result.catch(error => { failed = error; });
    return result;
  }
  async function finish() {
    finished = true;
    await tail;
    if (failed) throw failed;
    if (pending.length) throw new Error("FlatBuffer stream ended with a partial frame");
    return 0;
  }
  return { rows, stats, pushBytes, finish };
}
