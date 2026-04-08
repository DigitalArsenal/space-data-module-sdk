import { createFlatSqlRuntimeStore } from "./flatsqlRuntimeStore.js";

function toUint8Array(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new TypeError(
    "FlatBuffer stream ingestor expects Uint8Array, ArrayBuffer, or ArrayBufferView chunks.",
  );
}

function concatUint8Arrays(chunks) {
  let totalLength = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    totalLength += chunks[index].byteLength;
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    combined.set(chunks[index], offset);
    offset += chunks[index].byteLength;
  }
  return combined;
}

function readFrameSize(bytes, offset) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    ((bytes[offset + 3] << 24) >>> 0)
  );
}

function readFileIdentifier(payload) {
  if (!(payload instanceof Uint8Array) || payload.byteLength < 8) {
    return null;
  }
  return String.fromCharCode(payload[4], payload[5], payload[6], payload[7]);
}

function normalizeSchemaFileId(fileIdentifier) {
  if (typeof fileIdentifier !== "string") {
    return null;
  }
  const normalized = fileIdentifier.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveRouteHandler(frameRouter, rawFileIdentifier, schemaFileId) {
  if (typeof frameRouter === "function") {
    return frameRouter;
  }
  if (!frameRouter || typeof frameRouter !== "object") {
    return null;
  }
  if (typeof frameRouter[schemaFileId] === "function") {
    return frameRouter[schemaFileId];
  }
  if (typeof frameRouter[rawFileIdentifier] === "function") {
    return frameRouter[rawFileIdentifier];
  }
  return null;
}

export function createFlatBufferStreamIngestor(options = {}) {
  const rows = options.rows ?? createFlatSqlRuntimeStore();
  const frameRouter = options.frameRouter ?? null;
  const appendFrame =
    typeof options.appendFrame === "function" ? options.appendFrame : null;

  const stats = {
    bytesReceived: 0,
    chunksReceived: 0,
    framesDecoded: 0,
    framesAppended: 0,
    framesRouted: 0,
    parseErrors: 0,
  };

  let pending = new Uint8Array(0);

  function appendDecodedFrame(payload, context) {
    if (appendFrame) {
      appendFrame(payload, context);
      return;
    }
    rows.appendRow({
      schemaFileId: context.schemaFileId,
      payload,
    });
  }

  function pushBytes(data) {
    const bytes = toUint8Array(data);
    stats.bytesReceived += bytes.byteLength;
    stats.chunksReceived += 1;

    const combined =
      pending.byteLength > 0 ? concatUint8Arrays([pending, bytes]) : bytes;

    let offset = 0;
    let appendedCount = 0;

    while (offset + 4 <= combined.byteLength) {
      const frameSize = readFrameSize(combined, offset);
      if (frameSize <= 0) {
        stats.parseErrors += 1;
        throw new Error("Invalid FlatBuffer stream frame size.");
      }
      if (offset + 4 + frameSize > combined.byteLength) {
        break;
      }

      const payload = combined.subarray(offset + 4, offset + 4 + frameSize);
      const rawFileIdentifier = readFileIdentifier(payload);
      const schemaFileId = normalizeSchemaFileId(rawFileIdentifier);
      if (!schemaFileId) {
        stats.parseErrors += 1;
        throw new Error(
          "FlatBuffer stream frame is missing a readable file identifier.",
        );
      }

      const context = {
        rawFileIdentifier,
        schemaFileId,
        rows,
        stats,
      };
      const routeHandler = resolveRouteHandler(
        frameRouter,
        rawFileIdentifier,
        schemaFileId,
      );

      stats.framesDecoded += 1;
      if (routeHandler) {
        const routeResult = routeHandler(payload, context);
        if (routeResult !== false) {
          stats.framesRouted += 1;
          offset += 4 + frameSize;
          continue;
        }
      }

      appendDecodedFrame(payload, context);
      stats.framesAppended += 1;
      appendedCount += 1;
      offset += 4 + frameSize;
    }

    pending =
      offset < combined.byteLength
        ? combined.slice(offset)
        : new Uint8Array(0);

    return appendedCount;
  }

  function finish() {
    if (pending.byteLength > 0) {
      throw new Error("FlatBuffer stream ended with a partial frame.");
    }
    return 0;
  }

  return {
    rows,
    stats,
    pushBytes,
    finish,
  };
}
