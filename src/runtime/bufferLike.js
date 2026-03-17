function getObjectTag(value) {
  return Object.prototype.toString.call(value);
}

export function isArrayBufferLike(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const tag = getObjectTag(value);
  return tag === "[object ArrayBuffer]" || tag === "[object SharedArrayBuffer]";
}

export function hasByteAddressableBuffer(value) {
  return isArrayBufferLike(value?.buffer);
}

export function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (isArrayBufferLike(value)) {
    return new Uint8Array(value);
  }
  return null;
}
