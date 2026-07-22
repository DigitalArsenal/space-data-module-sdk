function cloneSchemaHash(value) {
  if (value instanceof Uint8Array) {
    return value.byteLength > 0 ? new Uint8Array(value) : undefined;
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? [...value] : undefined;
  }
  return value ?? undefined;
}

function normalizeNullableString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAlignedMetadataScalar(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric === 0 ? undefined : numeric;
  }
  return value;
}

function inspectPayloadSchemaHash(value) {
  if (value === undefined || value === null) {
    return { valid: true, present: false, bytes: [] };
  }
  if (typeof value === "string") {
    const hex = value.startsWith("0x") ? value.slice(2) : value;
    if (hex.length === 0) {
      return { valid: true, present: false, bytes: [] };
    }
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
      return { valid: false, present: true, bytes: [] };
    }
    const bytes = [];
    for (let index = 0; index < hex.length; index += 2) {
      bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
    }
    return { valid: true, present: true, bytes };
  }
  if (!Array.isArray(value) && !(value instanceof Uint8Array)) {
    return { valid: false, present: true, bytes: [] };
  }
  const bytes = Array.from(value);
  if (bytes.length === 0) {
    return { valid: true, present: false, bytes: [] };
  }
  if (
    bytes.some(
      (entry) =>
        !Number.isInteger(entry) || entry < 0 || entry > 0xff,
    )
  ) {
    return { valid: false, present: true, bytes: [] };
  }
  return { valid: true, present: true, bytes };
}

export function normalizePayloadSchemaHash(value) {
  const inspected = inspectPayloadSchemaHash(value);
  return inspected.valid && inspected.present ? inspected.bytes : undefined;
}

export function isPayloadSchemaHashValid(value) {
  return inspectPayloadSchemaHash(value).valid;
}

export function clonePayloadTypeRef(value = null) {
  if (!value || typeof value !== "object") {
    return { acceptsAnyFlatbuffer: true, fileIdentifier: null };
  }
  return {
    schemaName: normalizeNullableString(
      value.schemaName ?? value.schema_name ?? value.SCHEMA_NAME,
    ),
    fileIdentifier: normalizeNullableString(
      value.fileIdentifier ?? value.file_identifier ?? value.FILE_IDENTIFIER,
    ),
    schemaVersion: normalizeNullableString(
      value.schemaVersion ?? value.schema_version ?? value.SCHEMA_VERSION,
    ),
    schemaHash: cloneSchemaHash(
      value.schemaHash ?? value.schema_hash ?? value.SCHEMA_HASH,
    ),
    acceptsAnyFlatbuffer: Boolean(
      value.acceptsAnyFlatbuffer ??
        value.accepts_any_flatbuffer ??
        value.ACCEPTS_ANY_FLATBUFFER ??
        false,
    ),
    wireFormat: normalizePayloadWireFormatName(
      value.wireFormat ?? value.wire_format ?? value.WIRE_FORMAT,
    ),
    rootTypeName: normalizeNullableString(
      value.rootTypeName ??
        value.root_type_name ??
        value.rootType ??
        value.ROOT_TYPE,
    ),
    fixedStringLength: normalizeAlignedMetadataScalar(
      value.fixedStringLength ??
        value.fixed_string_length ??
        value.FIXED_STRING_LENGTH,
    ),
    byteLength: normalizeAlignedMetadataScalar(
      value.byteLength ?? value.byte_length ?? value.BYTE_LENGTH,
    ),
    requiredAlignment: normalizeAlignedMetadataScalar(
      value.requiredAlignment ??
        value.required_alignment ??
        value.REQUIRED_ALIGNMENT,
    ),
  };
}

function schemaHashesEqual(left, right) {
  const inspectedLeft = inspectPayloadSchemaHash(left);
  const inspectedRight = inspectPayloadSchemaHash(right);
  if (!inspectedLeft.valid || !inspectedRight.valid) {
    return false;
  }
  if (!inspectedLeft.present || !inspectedRight.present) {
    return inspectedLeft.present === inspectedRight.present;
  }
  if (inspectedLeft.bytes.length !== inspectedRight.bytes.length) {
    return false;
  }
  return inspectedLeft.bytes.every(
    (entry, index) => entry === inspectedRight.bytes[index],
  );
}

/**
 * Return true only when two concrete payload type refs carry one complete,
 * identical SDS logical identity. Schema version and hash are optional, but
 * when either peer declares one, both peers must declare the same value.
 */
export function payloadSchemaIdentitiesEqual(leftTypeRef = {}, rightTypeRef = {}) {
  const left = clonePayloadTypeRef(leftTypeRef);
  const right = clonePayloadTypeRef(rightTypeRef);
  const requiredIdentityFields = [
    "schemaName",
    "fileIdentifier",
    "rootTypeName",
  ];
  for (const field of requiredIdentityFields) {
    if (!left[field] || !right[field] || left[field] !== right[field]) {
      return false;
    }
  }
  if (
    (left.schemaVersion || right.schemaVersion) &&
    left.schemaVersion !== right.schemaVersion
  ) {
    return false;
  }
  return schemaHashesEqual(left.schemaHash, right.schemaHash);
}

export function alignedPayloadLayoutsCompatible(leftTypeRef = {}, rightTypeRef = {}) {
  const left = clonePayloadTypeRef(leftTypeRef);
  const right = clonePayloadTypeRef(rightTypeRef);
  if (
    getPayloadTypeWireFormat(left) !== "aligned-binary" ||
    getPayloadTypeWireFormat(right) !== "aligned-binary" ||
    !payloadSchemaIdentitiesEqual(left, right)
  ) {
    return false;
  }
  return (
    left.fixedStringLength === right.fixedStringLength &&
    left.byteLength === right.byteLength &&
    left.requiredAlignment === right.requiredAlignment
  );
}

export function normalizePayloadWireFormatName(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (value === 1 || value === "1") {
    return "aligned-binary";
  }
  if (value === 0 || value === "0") {
    return "flatbuffer";
  }
  const normalized = String(value).trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "aligned-binary") {
    return "aligned-binary";
  }
  if (normalized === "flatbuffer") {
    return "flatbuffer";
  }
  return null;
}

export function getPayloadTypeWireFormat(typeRef = {}) {
  return normalizePayloadWireFormatName(typeRef.wireFormat) ?? "flatbuffer";
}

function schemaHashMatches(expected, actual) {
  const inspectedExpected = inspectPayloadSchemaHash(expected);
  if (!inspectedExpected.valid) {
    return false;
  }
  if (!inspectedExpected.present) {
    return true;
  }
  const inspectedActual = inspectPayloadSchemaHash(actual);
  if (
    !inspectedActual.valid ||
    !inspectedActual.present ||
    inspectedActual.bytes.length !== inspectedExpected.bytes.length
  ) {
    return false;
  }
  for (let index = 0; index < inspectedExpected.bytes.length; index += 1) {
    if (inspectedExpected.bytes[index] !== inspectedActual.bytes[index]) {
      return false;
    }
  }
  return true;
}

function optionalScalarMatches(expected, actual) {
  return expected === undefined || expected === null || expected === actual;
}

export function payloadTypeRefsMatch(expectedTypeRef = {}, actualTypeRef = {}) {
  const expected = clonePayloadTypeRef(expectedTypeRef);
  const actual = clonePayloadTypeRef(actualTypeRef);
  const expectedWireFormat = getPayloadTypeWireFormat(expected);
  const actualWireFormat = getPayloadTypeWireFormat(actual);

  if (expected.acceptsAnyFlatbuffer === true) {
    return actualWireFormat === "flatbuffer";
  }
  if (expectedWireFormat !== actualWireFormat) {
    return false;
  }
  if (expected.schemaName && expected.schemaName !== actual.schemaName) {
    return false;
  }
  if (
    expected.fileIdentifier &&
    expected.fileIdentifier !== actual.fileIdentifier
  ) {
    return false;
  }
  if (
    expected.schemaVersion &&
    expected.schemaVersion !== actual.schemaVersion
  ) {
    return false;
  }
  if (!schemaHashMatches(expected.schemaHash, actual.schemaHash)) {
    return false;
  }
  if (!optionalScalarMatches(expected.rootTypeName, actual.rootTypeName)) {
    return false;
  }
  if (expectedWireFormat === "aligned-binary") {
    if (!optionalScalarMatches(expected.fixedStringLength, actual.fixedStringLength)) {
      return false;
    }
    if (!optionalScalarMatches(expected.byteLength, actual.byteLength)) {
      return false;
    }
    if (
      !optionalScalarMatches(expected.requiredAlignment, actual.requiredAlignment)
    ) {
      return false;
    }
  }
  return true;
}

export function selectPreferredPayloadTypeRef(port = {}, options = {}) {
  const preferredWireFormat = normalizePayloadWireFormatName(
    options.preferredWireFormat,
  );
  let fallback = null;
  for (const typeSet of Array.isArray(port.acceptedTypeSets) ? port.acceptedTypeSets : []) {
    const allowedTypes = Array.isArray(typeSet.allowedTypes)
      ? typeSet.allowedTypes
      : [];
    for (const allowedType of allowedTypes) {
      const candidate = clonePayloadTypeRef(allowedType);
      if (fallback === null) {
        fallback = candidate;
      }
      if (
        preferredWireFormat !== null &&
        getPayloadTypeWireFormat(candidate) === preferredWireFormat
      ) {
        return candidate;
      }
    }
  }
  return fallback ?? clonePayloadTypeRef(null);
}
