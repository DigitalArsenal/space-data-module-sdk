import { clonePayloadTypeRef } from "../manifest/typeRefs.js";

function assertNonEmptyString(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}

function normalizePositiveInteger(value, fallback) {
  const normalized = Number(value ?? fallback);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    return fallback;
  }
  return normalized;
}

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
    "Module FlatBuffer stream pump expects Uint8Array, ArrayBuffer, or ArrayBufferView chunks.",
  );
}

function concatUint8Arrays(chunks) {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.byteLength;
  }
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
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

function resolveInvoke(options) {
  if (typeof options.invoke === "function") {
    return options.invoke;
  }
  if (options.harness && typeof options.harness.invoke === "function") {
    return options.harness.invoke.bind(options.harness);
  }
  throw new TypeError(
    "createModuleFlatBufferStreamPump requires an invoke(request) function or harness with invoke().",
  );
}

function defaultTypeResolver(_payload, context) {
  return {
    schemaName: null,
    fileIdentifier: context.rawFileIdentifier,
    acceptsAnyFlatbuffer: true,
  };
}

function resolveFrameTemplate(frameTemplate, payload, context) {
  if (typeof frameTemplate === "function") {
    const resolved = frameTemplate(payload, context);
    return resolved && typeof resolved === "object" ? resolved : {};
  }
  if (frameTemplate && typeof frameTemplate === "object") {
    return frameTemplate;
  }
  return {};
}

export function createModuleFlatBufferStreamPump(options = {}) {
  const invoke = resolveInvoke(options);
  const methodId = assertNonEmptyString(options.methodId, "methodId");
  const portId = assertNonEmptyString(options.portId, "portId");
  const maxFramesPerInvoke = normalizePositiveInteger(options.maxFramesPerInvoke, 1);
  const streamId = normalizePositiveInteger(options.streamId, 1);
  const typeResolver =
    typeof options.typeResolver === "function"
      ? options.typeResolver
      : defaultTypeResolver;
  const onResponse =
    typeof options.onResponse === "function" ? options.onResponse : null;

  const stats = {
    bytesReceived: 0,
    chunksReceived: 0,
    framesDecoded: 0,
    framesInvoked: 0,
    invokes: 0,
    parseErrors: 0,
  };

  let pendingBytes = new Uint8Array(0);
  let pendingFrames = [];
  let nextSequence = normalizePositiveInteger(options.sequenceStart, 1);
  let lastResponse = null;

  async function flushPendingFrames(isFinalBatch) {
    if (pendingFrames.length === 0) {
      return lastResponse;
    }

    const frames = pendingFrames.map((decodedFrame, index) => {
      const context = {
        rawFileIdentifier: decodedFrame.rawFileIdentifier,
        schemaFileId: decodedFrame.schemaFileId,
        methodId,
        portId,
        streamId: decodedFrame.streamId,
        sequence: decodedFrame.sequence,
        stats,
      };
      const resolvedTypeRef = clonePayloadTypeRef(
        typeResolver(decodedFrame.payload, context) ?? defaultTypeResolver(decodedFrame.payload, context),
      );
      if (!resolvedTypeRef.fileIdentifier && decodedFrame.rawFileIdentifier) {
        resolvedTypeRef.fileIdentifier = decodedFrame.rawFileIdentifier;
      }
      if (resolvedTypeRef.acceptsAnyFlatbuffer !== true) {
        resolvedTypeRef.acceptsAnyFlatbuffer = false;
      }
      return {
        ...resolveFrameTemplate(options.frameTemplate, decodedFrame.payload, context),
        portId,
        typeRef: resolvedTypeRef,
        payload: decodedFrame.payload,
        streamId: decodedFrame.streamId,
        sequence: decodedFrame.sequence,
        endOfStream:
          isFinalBatch === true && index === pendingFrames.length - 1,
      };
    });

    pendingFrames = [];
    const response = await invoke({
      methodId,
      inputs: frames,
    });
    stats.invokes += 1;
    stats.framesInvoked += frames.length;
    lastResponse = response;
    if (onResponse) {
      await onResponse(response, {
        methodId,
        portId,
        frames,
        isFinalBatch: isFinalBatch === true,
        stats,
      });
    }
    return response;
  }

  async function pushBytes(data) {
    const bytes = toUint8Array(data);
    stats.bytesReceived += bytes.byteLength;
    stats.chunksReceived += 1;

    const combined =
      pendingBytes.byteLength > 0 ? concatUint8Arrays([pendingBytes, bytes]) : bytes;

    let offset = 0;
    let decodedCount = 0;

    while (offset + 4 <= combined.byteLength) {
      const frameSize = readFrameSize(combined, offset);
      if (frameSize <= 0) {
        stats.parseErrors += 1;
        throw new Error("Invalid FlatBuffer stream frame size.");
      }
      if (offset + 4 + frameSize > combined.byteLength) {
        break;
      }

      const payload = combined.subarray(offset + 4, offset + 4 + frameSize).slice();
      const rawFileIdentifier = readFileIdentifier(payload);
      const schemaFileId = normalizeSchemaFileId(rawFileIdentifier);
      if (!schemaFileId) {
        stats.parseErrors += 1;
        throw new Error(
          "FlatBuffer stream frame is missing a readable file identifier.",
        );
      }

      pendingFrames.push({
        payload,
        rawFileIdentifier,
        schemaFileId,
        streamId,
        sequence: nextSequence,
      });
      nextSequence += 1;
      stats.framesDecoded += 1;
      decodedCount += 1;
      offset += 4 + frameSize;

      if (pendingFrames.length >= maxFramesPerInvoke) {
        await flushPendingFrames(false);
      }
    }

    pendingBytes =
      offset < combined.byteLength ? combined.slice(offset) : new Uint8Array(0);

    return decodedCount;
  }

  async function finish() {
    if (pendingBytes.byteLength > 0) {
      throw new Error("FlatBuffer stream ended with a partial frame.");
    }
    return flushPendingFrames(true);
  }

  return {
    stats,
    get lastResponse() {
      return lastResponse;
    },
    pushBytes,
    finish,
  };
}
