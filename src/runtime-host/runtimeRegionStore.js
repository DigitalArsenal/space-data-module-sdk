function cloneBytes(bytes) {
  return new Uint8Array(bytes);
}

function normalizePositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return normalized;
}

function normalizeStrictlyPositiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return normalized;
}

function normalizeRequiredString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeOptionalFunction(value, label) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function`);
  }
  return value;
}

function toRecordBytes(value, recordByteLength) {
  const bytes = new Uint8Array(recordByteLength);
  if (value === null || value === undefined) {
    return bytes;
  }
  if (ArrayBuffer.isView(value)) {
    const view = value;
    if (view.byteLength > recordByteLength) {
      throw new RangeError("record bytes exceed recordByteLength");
    }
    bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return bytes;
  }
  if (value instanceof ArrayBuffer) {
    if (value.byteLength > recordByteLength) {
      throw new RangeError("record bytes exceed recordByteLength");
    }
    bytes.set(new Uint8Array(value));
    return bytes;
  }
  throw new TypeError("runtime region records must be byte-oriented");
}

export function createRuntimeRegionStore() {
  let nextRegionId = 1;
  const regions = new Map();

  function getRegionRecordCount(region) {
    if (typeof region.getRecordCount === "function") {
      return normalizePositiveInteger(
        region.getRecordCount(region.regionId),
        "recordCount",
      );
    }
    return region.records.length;
  }

  function describeRegion(regionId) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const region = regions.get(normalizedRegionId);
    if (!region) {
      return null;
    }
    return {
      regionId: region.regionId,
      layoutId: region.layoutId,
      recordByteLength: region.recordByteLength,
      alignment: region.alignment,
      recordCount: getRegionRecordCount(region),
    };
  }

  function allocateRegion({
    layoutId,
    recordByteLength,
    alignment = 1,
    initialRecords = [],
  }) {
    const region = {
      regionId: nextRegionId++,
      kind: "owned",
      layoutId: normalizeRequiredString(layoutId, "layoutId"),
      recordByteLength: normalizeStrictlyPositiveInteger(
        recordByteLength,
        "recordByteLength",
      ),
      alignment: normalizeStrictlyPositiveInteger(alignment, "alignment"),
      records: [],
    };
    region.records = Array.from(initialRecords, (record) =>
      toRecordBytes(record, region.recordByteLength),
    );
    regions.set(region.regionId, region);
    return describeRegion(region.regionId);
  }

  function registerExternalRegion({
    layoutId,
    recordByteLength,
    alignment = 1,
    recordCount = 0,
    getRecordCount,
    resolveRecordView,
  }) {
    const region = {
      regionId: nextRegionId++,
      kind: "external",
      layoutId: normalizeRequiredString(layoutId, "layoutId"),
      recordByteLength: normalizeStrictlyPositiveInteger(
        recordByteLength,
        "recordByteLength",
      ),
      alignment: normalizeStrictlyPositiveInteger(alignment, "alignment"),
      records: [],
      getRecordCount: normalizeOptionalFunction(getRecordCount, "getRecordCount"),
      resolveRecordView: normalizeOptionalFunction(
        resolveRecordView,
        "resolveRecordView",
      ),
    };
    if (region.getRecordCount === undefined) {
      region.records.length = normalizePositiveInteger(recordCount, "recordCount");
    }
    regions.set(region.regionId, region);
    return describeRegion(region.regionId);
  }

  function setRegionRecordCount(regionId, recordCount) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const region = regions.get(normalizedRegionId);
    if (!region) {
      return null;
    }
    if (typeof region.getRecordCount === "function") {
      throw new Error("Cannot set recordCount for externally counted regions");
    }
    const normalizedRecordCount = normalizePositiveInteger(
      recordCount,
      "recordCount",
    );
    if (normalizedRecordCount < region.records.length) {
      region.records.length = normalizedRecordCount;
    } else {
      while (region.records.length < normalizedRecordCount) {
        region.records.push(new Uint8Array(region.recordByteLength));
      }
    }
    return describeRegion(normalizedRegionId);
  }

  function resolveRecord({ regionId, recordIndex }) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const normalizedRecordIndex = normalizePositiveInteger(
      recordIndex,
      "recordIndex",
    );
    const region = regions.get(normalizedRegionId);
    if (!region) {
      return null;
    }
    if (normalizedRecordIndex >= getRegionRecordCount(region)) {
      return null;
    }
    if (region.kind === "external") {
      return null;
    }
    return {
      regionId: region.regionId,
      recordIndex: normalizedRecordIndex,
      layoutId: region.layoutId,
      recordByteLength: region.recordByteLength,
      alignment: region.alignment,
      byteLength: region.recordByteLength,
      bytes: cloneBytes(region.records[normalizedRecordIndex]),
    };
  }

  function resolveRecordView({ regionId, recordIndex }) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const normalizedRecordIndex = normalizePositiveInteger(
      recordIndex,
      "recordIndex",
    );
    const region = regions.get(normalizedRegionId);
    if (!region) {
      return null;
    }
    if (normalizedRecordIndex >= getRegionRecordCount(region)) {
      return null;
    }
    if (region.kind !== "external") {
      return resolveRecord({
        regionId: normalizedRegionId,
        recordIndex: normalizedRecordIndex,
      });
    }
    if (typeof region.resolveRecordView !== "function") {
      return null;
    }
    const view = region.resolveRecordView({
      regionId: normalizedRegionId,
      recordIndex: normalizedRecordIndex,
      layoutId: region.layoutId,
      recordByteLength: region.recordByteLength,
      alignment: region.alignment,
    });
    if (view === null || view === undefined) {
      return null;
    }
    return {
      regionId: normalizedRegionId,
      recordIndex: normalizedRecordIndex,
      layoutId: region.layoutId,
      recordByteLength: region.recordByteLength,
      alignment: region.alignment,
      ...view,
    };
  }

  return {
    allocateRegion,
    describeRegion,
    registerExternalRegion,
    resolveRecord,
    resolveRecordView,
    setRegionRecordCount,
  };
}
