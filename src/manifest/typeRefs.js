function cloneSchemaHash(value) {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (Array.isArray(value)) {
    return [...value];
  }
  return value ?? undefined;
}

export function clonePayloadTypeRef(value = null) {
  if (!value || typeof value !== "object") {
    return { acceptsAnyFlatbuffer: true };
  }
  return {
    schemaName: value.schemaName ?? value.schema_name ?? undefined,
    fileIdentifier: value.fileIdentifier ?? value.file_identifier ?? undefined,
    schemaHash: cloneSchemaHash(value.schemaHash ?? value.schema_hash),
    acceptsAnyFlatbuffer: Boolean(
      value.acceptsAnyFlatbuffer ?? value.accepts_any_flatbuffer ?? false,
    ),
    wireFormat: value.wireFormat ?? value.wire_format ?? undefined,
    rootTypeName: value.rootTypeName ?? value.root_type_name ?? undefined,
    fixedStringLength:
      value.fixedStringLength ?? value.fixed_string_length ?? undefined,
    byteLength: value.byteLength ?? value.byte_length ?? undefined,
    requiredAlignment:
      value.requiredAlignment ?? value.required_alignment ?? undefined,
  };
}

export function normalizePayloadWireFormatName(value) {
  if (value === undefined || value === null || value === "") {
    return null;
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
  if (!Array.isArray(expected) && !(expected instanceof Uint8Array)) {
    return true;
  }
  const expectedArray = Array.from(expected);
  if (expectedArray.length === 0) {
    return true;
  }
  const actualArray =
    Array.isArray(actual) || actual instanceof Uint8Array
      ? Array.from(actual)
      : null;
  if (!actualArray || actualArray.length !== expectedArray.length) {
    return false;
  }
  for (let index = 0; index < expectedArray.length; index += 1) {
    if (expectedArray[index] !== actualArray[index]) {
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
  if (!schemaHashMatches(expected.schemaHash, actual.schemaHash)) {
    return false;
  }
  if (expectedWireFormat === "aligned-binary") {
    if (!optionalScalarMatches(expected.rootTypeName, actual.rootTypeName)) {
      return false;
    }
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
