/**
 * Binary hostcall wire format.
 *
 * Replaces the JSON+base64 hostcall round-trip: binary payloads cross the
 * host<->module boundary as raw length-prefixed segments, with a small JSON
 * "meta" document carrying only control metadata. Byte values inside the
 * meta document are represented as `{ "$bin": <segmentIndex> }` references.
 *
 * Envelope layout (little-endian):
 *   u32 metaLength
 *   u8[metaLength]   meta JSON (UTF-8)
 *   u32 segmentCount
 *   repeat segmentCount times:
 *     u32 segmentLength
 *     u8[segmentLength] segment bytes
 *
 * The same envelope is used for hostcall requests (meta = params) and
 * responses (meta = { ok, result } | { ok, error }).
 */

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export const HOSTCALL_BINARY_REF_KEY = "$bin";

function isByteValue(value) {
  return (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

function toBytes(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

/**
 * Walk a structured value, detaching binary leaves into `segments` and
 * replacing them with `{ "$bin": index }` references. Dates become ISO
 * strings and bigints become decimal strings (JSON-safe control metadata).
 */
export function detachBinaryValues(value, segments) {
  if (value === undefined || value === null) {
    return value ?? null;
  }
  if (isByteValue(value)) {
    const index = segments.length;
    segments.push(toBytes(value));
    return { [HOSTCALL_BINARY_REF_KEY]: index };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => detachBinaryValues(entry, segments));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, detachBinaryValues(entry, segments)]),
    );
  }
  return value;
}

/**
 * Inverse of detachBinaryValues: re-attach segment bytes wherever the meta
 * document references them.
 */
export function attachBinaryValues(value, segments) {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => attachBinaryValues(entry, segments));
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === HOSTCALL_BINARY_REF_KEY) {
      const index = value[HOSTCALL_BINARY_REF_KEY];
      if (!Number.isInteger(index) || index < 0 || index >= segments.length) {
        throw new RangeError(
          `Hostcall envelope references missing binary segment ${index}.`,
        );
      }
      return segments[index];
    }
    return Object.fromEntries(
      keys.map((key) => [key, attachBinaryValues(value[key], segments)]),
    );
  }
  return value;
}

export function encodeHostcallEnvelope(meta, segments = []) {
  const metaBytes = textEncoder.encode(JSON.stringify(meta ?? null));
  let total = 4 + metaBytes.length + 4;
  for (const segment of segments) {
    total += 4 + segment.length;
  }

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  view.setUint32(offset, metaBytes.length, true);
  offset += 4;
  bytes.set(metaBytes, offset);
  offset += metaBytes.length;
  view.setUint32(offset, segments.length, true);
  offset += 4;
  for (const segment of segments) {
    view.setUint32(offset, segment.length, true);
    offset += 4;
    bytes.set(segment, offset);
    offset += segment.length;
  }
  return bytes;
}

export function decodeHostcallEnvelope(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Hostcall envelope must be a Uint8Array.");
  }
  if (bytes.length < 8) {
    throw new RangeError("Hostcall envelope is truncated.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const metaLength = view.getUint32(offset, true);
  offset += 4;
  if (offset + metaLength + 4 > bytes.length) {
    throw new RangeError("Hostcall envelope meta exceeds envelope bounds.");
  }
  const meta = JSON.parse(
    textDecoder.decode(bytes.subarray(offset, offset + metaLength)),
  );
  offset += metaLength;
  const segmentCount = view.getUint32(offset, true);
  offset += 4;
  const segments = [];
  for (let index = 0; index < segmentCount; index += 1) {
    if (offset + 4 > bytes.length) {
      throw new RangeError("Hostcall envelope segment table is truncated.");
    }
    const segmentLength = view.getUint32(offset, true);
    offset += 4;
    if (offset + segmentLength > bytes.length) {
      throw new RangeError("Hostcall envelope segment exceeds envelope bounds.");
    }
    segments.push(bytes.subarray(offset, offset + segmentLength));
    offset += segmentLength;
  }
  return { meta, segments };
}

/**
 * Encode a structured value (params or result) into an envelope, detaching
 * binary leaves into segments.
 */
export function encodeHostcallValueEnvelope(value) {
  const segments = [];
  const meta = detachBinaryValues(value, segments);
  return encodeHostcallEnvelope(meta, segments);
}

/**
 * Decode an envelope back into a structured value with bytes re-attached.
 */
export function decodeHostcallValueEnvelope(bytes) {
  const { meta, segments } = decodeHostcallEnvelope(bytes);
  return attachBinaryValues(meta, segments);
}
