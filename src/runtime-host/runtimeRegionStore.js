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
  if (value instanceof ArrayBuffer || isSharedBuffer(value)) {
    if (value.byteLength > recordByteLength) {
      throw new RangeError("record bytes exceed recordByteLength");
    }
    bytes.set(new Uint8Array(value));
    return bytes;
  }
  throw new TypeError("runtime region records must be byte-oriented");
}

function toExactUint8Array(value, label) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer || isSharedBuffer(value)) {
    return new Uint8Array(value);
  }
  throw new TypeError(`${label} must be byte-oriented`);
}

export function isSharedBuffer(buffer) {
  return (
    typeof SharedArrayBuffer === "function" &&
    buffer instanceof SharedArrayBuffer
  );
}

export function createArenaBuffer(byteLength, { shared = true } = {}) {
  const normalizedLength = normalizePositiveInteger(byteLength, "byteLength");
  if (shared && typeof SharedArrayBuffer === "function") {
    return new SharedArrayBuffer(normalizedLength);
  }
  return new ArrayBuffer(normalizedLength);
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
    if (region.kind === "contiguous") {
      return region.recordCount;
    }
    return region.records.length;
  }

  function describeRegion(regionId) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const region = regions.get(normalizedRegionId);
    if (!region) {
      return null;
    }
    if (region.kind === "contiguous") {
      return {
        regionId: region.regionId,
        layoutId: region.layoutId,
        recordByteLength: region.recordByteLength,
        alignment: region.alignment,
        recordCount: region.recordCount,
        kind: "contiguous",
        shared: region.shared,
        generation: region.generation,
        byteLength: region.bytes.byteLength,
        activeConsumers: region.consumers.size,
        invalidated: region.invalidated,
        metadata: region.metadata,
      };
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
      generation: 1,
      consumers: new Map(),
      nextLeaseId: 1,
      invalidated: false,
    };
    region.records = Array.from(initialRecords, (record) =>
      toRecordBytes(record, region.recordByteLength),
    );
    regions.set(region.regionId, region);
    return describeRegion(region.regionId);
  }

  function allocateContiguousRegion({
    layoutId,
    recordByteLength,
    alignment = 8,
    recordCount = 0,
    shared = true,
    initialBytes = null,
    metadata = null,
  }) {
    const normalizedLayoutId = normalizeRequiredString(layoutId, "layoutId");
    const normalizedRecordByteLength = normalizeStrictlyPositiveInteger(
      recordByteLength,
      "recordByteLength",
    );
    const normalizedAlignment = normalizeStrictlyPositiveInteger(
      alignment,
      "alignment",
    );
    const normalizedRecordCount = normalizePositiveInteger(
      recordCount,
      "recordCount",
    );
    const byteLength = normalizedRecordCount * normalizedRecordByteLength;
    const buffer = createArenaBuffer(byteLength, { shared: Boolean(shared) });
    const bytes = new Uint8Array(buffer, 0, byteLength);
    if (initialBytes !== null && initialBytes !== undefined) {
      const source = toExactUint8Array(initialBytes, "initialBytes");
      if (source.byteLength > byteLength) {
        throw new RangeError(
          `initialBytes length (${source.byteLength}) exceeds allocated region byteLength (${byteLength}).`,
        );
      }
      bytes.set(source, 0);
    }

    const region = {
      regionId: nextRegionId++,
      kind: "contiguous",
      layoutId: normalizedLayoutId,
      recordByteLength: normalizedRecordByteLength,
      alignment: normalizedAlignment,
      recordCount: normalizedRecordCount,
      buffer,
      bytes,
      shared: isSharedBuffer(buffer),
      generation: 1,
      consumers: new Map(),
      nextLeaseId: 1,
      invalidated: false,
      metadata: metadata ?? null,
    };
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
      generation: 1,
      consumers: new Map(),
      nextLeaseId: 1,
      invalidated: false,
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
    if (region.kind === "contiguous") {
      return resizeContiguousRegion(normalizedRegionId, recordCount);
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

  function getRegionArena(regionId) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const region = regions.get(normalizedRegionId);
    if (!region || region.invalidated) {
      return null;
    }
    if (region.kind !== "contiguous") {
      throw new TypeError(
        `Region ${normalizedRegionId} (${region.kind}) does not have a contiguous arena.`,
      );
    }
    return {
      regionId: region.regionId,
      buffer: region.buffer,
      byteOffset: region.bytes.byteOffset,
      byteLength: region.bytes.byteLength,
      bytes: region.bytes,
      shared: region.shared,
      alignment: region.alignment,
      generation: region.generation,
      recordCount: region.recordCount,
      recordByteLength: region.recordByteLength,
    };
  }

  function updateContiguousRecord({
    regionId,
    recordIndex,
    bytes,
    bumpGeneration = false,
  }) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const normalizedRecordIndex = normalizePositiveInteger(
      recordIndex,
      "recordIndex",
    );
    const region = regions.get(normalizedRegionId);
    if (!region) {
      throw new Error(`Unknown region ${normalizedRegionId}.`);
    }
    if (region.invalidated) {
      throw new Error(`Region ${normalizedRegionId} has been invalidated.`);
    }
    if (region.kind !== "contiguous") {
      throw new TypeError(
        `Region ${normalizedRegionId} is not a contiguous arena region.`,
      );
    }
    if (normalizedRecordIndex >= region.recordCount) {
      throw new RangeError(
        `recordIndex ${normalizedRecordIndex} out of bounds for region ${normalizedRegionId} (recordCount=${region.recordCount}).`,
      );
    }
    const source = toRecordBytes(bytes, region.recordByteLength);
    region.bytes.set(
      source,
      normalizedRecordIndex * region.recordByteLength,
    );
    if (bumpGeneration) {
      region.generation += 1;
    }
    return {
      regionId: region.regionId,
      recordIndex: normalizedRecordIndex,
      generation: region.generation,
      byteLength: region.recordByteLength,
    };
  }

  function resizeContiguousRegion(regionId, newRecordCount, { shared } = {}) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const normalizedRecordCount = normalizePositiveInteger(
      newRecordCount,
      "recordCount",
    );
    const region = regions.get(normalizedRegionId);
    if (!region) {
      return null;
    }
    if (region.invalidated) {
      throw new Error(`Region ${normalizedRegionId} has been invalidated.`);
    }
    if (region.kind !== "contiguous") {
      throw new TypeError(
        `Region ${normalizedRegionId} is not a contiguous arena region.`,
      );
    }
    const useShared = shared === undefined ? region.shared : Boolean(shared);
    const nextByteLength = normalizedRecordCount * region.recordByteLength;
    const nextBuffer = createArenaBuffer(nextByteLength, { shared: useShared });
    const nextBytes = new Uint8Array(nextBuffer, 0, nextByteLength);
    const copyBytes = Math.min(region.bytes.byteLength, nextByteLength);
    if (copyBytes > 0) {
      nextBytes.set(region.bytes.subarray(0, copyBytes), 0);
    }
    region.buffer = nextBuffer;
    region.bytes = nextBytes;
    region.shared = isSharedBuffer(nextBuffer);
    region.recordCount = normalizedRecordCount;
    region.generation += 1;
    return describeRegion(normalizedRegionId);
  }

  function bumpRegionGeneration(regionId) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const region = regions.get(normalizedRegionId);
    if (!region) {
      return null;
    }
    region.generation += 1;
    return region.generation;
  }

  function invalidateRegion(regionId) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const region = regions.get(normalizedRegionId);
    if (!region) {
      return false;
    }
    region.invalidated = true;
    region.generation += 1;
    region.consumers.clear();
    return true;
  }

  function attachRegionConsumer(
    regionId,
    { consumerId, mode = "read-only", roleMask = null } = {},
  ) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const normalizedConsumerId = normalizeRequiredString(
      consumerId,
      "consumerId",
    );
    if (mode !== "read-only") {
      throw new Error(
        `Shared region consumer "${normalizedConsumerId}" must attach with mode "read-only" (got "${String(mode)}").`,
      );
    }
    const region = regions.get(normalizedRegionId);
    if (!region) {
      throw new Error(`Cannot attach consumer to unknown region ${normalizedRegionId}.`);
    }
    if (region.invalidated) {
      throw new Error(`Cannot attach consumer to invalidated region ${normalizedRegionId}.`);
    }
    const leaseId = region.nextLeaseId++;
    const attachedGeneration = region.generation;
    const entry = {
      leaseId,
      regionId: normalizedRegionId,
      consumerId: normalizedConsumerId,
      mode: "read-only",
      roleMask,
      generation: attachedGeneration,
      attachedAt: Date.now(),
    };
    region.consumers.set(leaseId, entry);

    function isCurrent() {
      return (
        !region.invalidated &&
        region.generation === attachedGeneration &&
        region.consumers.has(leaseId)
      );
    }

    function assertCurrent() {
      if (!region.consumers.has(leaseId)) {
        throw new Error(
          `Region consumer lease ${leaseId} (${normalizedConsumerId}) on region ${normalizedRegionId} is detached or invalidated.`,
        );
      }
      if (region.invalidated) {
        throw new Error(
          `Region ${normalizedRegionId} has been invalidated; lease ${leaseId} (${normalizedConsumerId}) is stale.`,
        );
      }
      if (region.generation !== attachedGeneration) {
        throw new Error(
          `Region ${normalizedRegionId} generation mismatch for lease ${leaseId} (${normalizedConsumerId}): attached at generation ${attachedGeneration}, current generation is ${region.generation}.`,
        );
      }
      return true;
    }

    function detach() {
      return region.consumers.delete(leaseId);
    }

    return Object.freeze({
      leaseId,
      regionId: normalizedRegionId,
      consumerId: normalizedConsumerId,
      mode: "read-only",
      roleMask,
      generation: attachedGeneration,
      isCurrent,
      assertCurrent,
      detach,
    });
  }

  function detachRegionConsumer(regionId, leaseId) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const normalizedLeaseId = normalizeStrictlyPositiveInteger(
      leaseId,
      "leaseId",
    );
    const region = regions.get(normalizedRegionId);
    if (!region) {
      return false;
    }
    return region.consumers.delete(normalizedLeaseId);
  }

  function listRegionConsumers(regionId) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const region = regions.get(normalizedRegionId);
    if (!region || region.invalidated) {
      return [];
    }
    return Array.from(region.consumers.values(), (entry) =>
      Object.freeze({ ...entry }),
    );
  }

  function resolveRecord({ regionId, recordIndex }) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const normalizedRecordIndex = normalizePositiveInteger(
      recordIndex,
      "recordIndex",
    );
    const region = regions.get(normalizedRegionId);
    if (!region || region.invalidated) {
      return null;
    }
    if (normalizedRecordIndex >= getRegionRecordCount(region)) {
      return null;
    }
    if (region.kind === "external") {
      return null;
    }
    if (region.kind === "contiguous") {
      const offset = normalizedRecordIndex * region.recordByteLength;
      return {
        regionId: region.regionId,
        recordIndex: normalizedRecordIndex,
        layoutId: region.layoutId,
        recordByteLength: region.recordByteLength,
        alignment: region.alignment,
        byteLength: region.recordByteLength,
        bytes: cloneBytes(
          region.bytes.subarray(offset, offset + region.recordByteLength),
        ),
      };
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
    if (!region || region.invalidated) {
      return null;
    }
    if (normalizedRecordIndex >= getRegionRecordCount(region)) {
      return null;
    }
    if (region.kind === "contiguous") {
      const offset = normalizedRecordIndex * region.recordByteLength;
      return {
        regionId: region.regionId,
        recordIndex: normalizedRecordIndex,
        layoutId: region.layoutId,
        recordByteLength: region.recordByteLength,
        alignment: region.alignment,
        byteLength: region.recordByteLength,
        byteOffset: region.bytes.byteOffset + offset,
        buffer: region.buffer,
        shared: region.shared,
        generation: region.generation,
        bytes: region.bytes.subarray(offset, offset + region.recordByteLength),
      };
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
    allocateContiguousRegion,
    describeRegion,
    registerExternalRegion,
    resolveRecord,
    resolveRecordView,
    setRegionRecordCount,
    getRegionArena,
    updateContiguousRecord,
    resizeContiguousRegion,
    bumpRegionGeneration,
    invalidateRegion,
    attachRegionConsumer,
    detachRegionConsumer,
    listRegionConsumers,
  };
}
