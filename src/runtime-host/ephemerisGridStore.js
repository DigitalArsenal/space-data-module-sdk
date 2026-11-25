import * as flatbuffers from "flatbuffers";
import { SCR } from "spacedatastandards.org/lib/js/SCR/SCR.js";
import { SCRGrid } from "spacedatastandards.org/lib/js/SCR/SCRGrid.js";
import { BufferMutability } from "../generated/orbpro/stream/buffer-mutability.js";
import { BufferOwnership } from "../generated/orbpro/stream/buffer-ownership.js";
import { createRuntimeRegionStore } from "./runtimeRegionStore.js";

export const SCR_GRID_STATE_FLOATS = 8;
export const SCR_GRID_STATE_BYTES = 32;
export const SCR_RADIUS_BAND_FLOATS = 2;
export const SCR_RADIUS_BAND_BYTES = 8;
export const SCR_ROLE = Object.freeze({
  SECONDARY: 0,
  PRIMARY: 1,
  SKIP: 2,
});
export const SCR_ROLE_MASK_ALL = 0x7;
export const SCR_GRID_LAYOUT_ID = "SCR.GRID.ALIGNED";

export const DEFAULT_PROPAGATOR_ID = "propagator/sdn-ap";
export const SUPPORTED_PROPAGATOR_IDS = Object.freeze([
  "propagator/sdn-ap",
  "propagator/sgp4-xp",
  "propagator/sgp4",
]);
export const DECLARED_ORBIT_THEORIES = Object.freeze([
  "SGP4",
  "SGP4XP",
  "AP",
]);

const DEFAULT_THEORY_SUPPORT = Object.freeze({
  "propagator/sdn-ap": Object.freeze(["AP", "SGP4XP", "SGP4"]),
  "propagator/sgp4-xp": Object.freeze(["SGP4XP", "SGP4"]),
  "propagator/sgp4": Object.freeze(["SGP4"]),
});

const PREFERRED_PROPAGATOR_BY_THEORY = Object.freeze({
  AP: "propagator/sdn-ap",
  SGP4XP: "propagator/sgp4-xp",
  SGP4: "propagator/sgp4",
});

const PROPAGATOR_ALIASES = Object.freeze({
  "sdn-ap": "propagator/sdn-ap",
  sdn_ap: "propagator/sdn-ap",
  sdnap: "propagator/sdn-ap",
  "propagator/sdn-ap": "propagator/sdn-ap",
  "com.digitalarsenal.propagator.sdn-ap": "propagator/sdn-ap",
  "sgp4-xp": "propagator/sgp4-xp",
  sgp4_xp: "propagator/sgp4-xp",
  sgp4xp: "propagator/sgp4-xp",
  "propagator/sgp4-xp": "propagator/sgp4-xp",
  "com.digitalarsenal.propagator.sgp4-xp": "propagator/sgp4-xp",
  sgp4: "propagator/sgp4",
  "propagator/sgp4": "propagator/sgp4",
  "com.orbpro.sgp4": "propagator/sgp4",
});

const MUTATING_TYPED_ARRAY_METHODS = new Set([
  "set",
  "fill",
  "copyWithin",
  "reverse",
  "sort",
]);

const HOST_IS_LITTLE_ENDIAN =
  new Uint16Array(new Uint8Array([1, 0]).buffer)[0] === 1;

export class TheoryMismatchError extends Error {
  constructor(
    message,
    { recordId = null, declaredTheory = null, propagatorId = null } = {},
  ) {
    super(message);
    this.name = "TheoryMismatchError";
    this.code = "ERR_DECLARED_THEORY_MISMATCH";
    this.recordId = recordId;
    this.declaredTheory = declaredTheory;
    this.propagatorId = propagatorId;
  }
}

export class StaleGridLeaseError extends Error {
  constructor(
    message,
    {
      regionId = null,
      moduleId = null,
      attachedGeneration = null,
      currentGeneration = null,
    } = {},
  ) {
    super(message);
    this.name = "StaleGridLeaseError";
    this.code = "ERR_STALE_GRID_LEASE";
    this.regionId = regionId;
    this.moduleId = moduleId;
    this.attachedGeneration = attachedGeneration;
    this.currentGeneration = currentGeneration;
  }
}

function normalizeNonEmptyString(value, label) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeFiniteNumber(value, label) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return num;
}

function normalizePositiveNumber(value, label) {
  const num = normalizeFiniteNumber(value, label);
  if (num <= 0) {
    throw new RangeError(`${label} must be greater than 0.`);
  }
  return num;
}

function normalizeNonNegativeInteger(value, label) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }
  return num;
}

function normalizePositiveInteger(value, label) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return num;
}

function normalizeRoleMask(roleMask = SCR_ROLE_MASK_ALL) {
  if (roleMask === null || roleMask === undefined) {
    return SCR_ROLE_MASK_ALL;
  }
  const num = Number(roleMask);
  if (!Number.isInteger(num) || num < 0 || num > 0xffffffff) {
    throw new TypeError("roleMask must be an unsigned 32-bit integer.");
  }
  return num >>> 0;
}

function normalizeRolesArray(roles, objectCount) {
  if (roles === null || roles === undefined) {
    return null;
  }
  const arr =
    roles instanceof Uint8Array
      ? new Uint8Array(roles)
      : Uint8Array.from(roles, (value) => Number(value));
  if (arr.length !== objectCount) {
    throw new RangeError(
      `roles length (${arr.length}) must match objectCount (${objectCount}).`,
    );
  }
  for (let i = 0; i < arr.length; i += 1) {
    if (
      arr[i] !== SCR_ROLE.SECONDARY &&
      arr[i] !== SCR_ROLE.PRIMARY &&
      arr[i] !== SCR_ROLE.SKIP
    ) {
      throw new RangeError(
        `Invalid SCR role ${arr[i]} at index ${i}; expected 0 (SECONDARY), 1 (PRIMARY), or 2 (SKIP).`,
      );
    }
  }
  return arr;
}

export function resolvePropagatorId(id = DEFAULT_PROPAGATOR_ID) {
  if (id === null || id === undefined || String(id).trim() === "") {
    return DEFAULT_PROPAGATOR_ID;
  }
  const raw = String(id).trim();
  const alias = PROPAGATOR_ALIASES[raw.toLowerCase()];
  return alias ?? raw;
}

export function normalizeDeclaredTheory(value, recordLabel = "record") {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new TypeError(
      `Catalog record ${recordLabel} must declare its orbit theory (declaredTheory: SGP4 | SGP4XP | AP).`,
    );
  }
  const token = String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");
  if (token === "SGP4") return "SGP4";
  if (token === "SGP4XP") return "SGP4XP";
  if (token === "AP" || token === "SDNAP") return "AP";
  throw new TypeError(
    `Unsupported declaredTheory "${String(value)}" on catalog record ${recordLabel}.`,
  );
}

function extractRecordId(record, index) {
  if (record && typeof record === "object") {
    return (
      record.id ??
      record.ID ??
      record.OBJECT_ID ??
      record.objectId ??
      record.NORAD_CAT_ID ??
      record.noradCatId ??
      `record[${index}]`
    );
  }
  return `record[${index}]`;
}

function extractDeclaredTheory(record, index) {
  const recordId = extractRecordId(record, index);
  const raw =
    record?.declaredTheory ??
    record?.MEAN_ELEMENT_THEORY ??
    record?.meanElementTheory ??
    record?.theory ??
    record?.THEORY;
  return {
    recordId: String(recordId),
    declaredTheory: normalizeDeclaredTheory(raw, String(recordId)),
  };
}

function createReadOnlyTypedArrayView(target, label) {
  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === "string" && MUTATING_TYPED_ARRAY_METHODS.has(prop)) {
        return () => {
          throw new TypeError(`Cannot mutate read-only ${label}.`);
        };
      }
      if (prop === "subarray") {
        return (...args) =>
          createReadOnlyTypedArrayView(obj.subarray(...args), label);
      }
      const value = Reflect.get(obj, prop, obj);
      return typeof value === "function" ? value.bind(obj) : value;
    },
    set() {
      throw new TypeError(`Cannot write to read-only ${label}.`);
    },
    defineProperty() {
      throw new TypeError(`Cannot define property on read-only ${label}.`);
    },
    deleteProperty() {
      throw new TypeError(`Cannot delete property on read-only ${label}.`);
    },
  });
}

function adapterSupportsTheory(adapter, theory, fallbackId) {
  if (adapter && typeof adapter.supportsTheory === "function") {
    return Boolean(adapter.supportsTheory(theory));
  }
  if (adapter?.supportedTheories) {
    return adapter.supportedTheories.has(theory);
  }
  const defaults = DEFAULT_THEORY_SUPPORT[fallbackId];
  return defaults ? defaults.includes(theory) : false;
}

export function createPropagatorRegistry(initialAdapters = {}) {
  const adapters = new Map();

  function registerPropagator(id, adapter) {
    const canonicalId = resolvePropagatorId(id);
    if (!adapter || typeof adapter !== "object") {
      throw new TypeError(
        `Propagator adapter for "${canonicalId}" must be an object.`,
      );
    }
    const rawTheories =
      adapter.supportedTheories ??
      (adapter.strict === true && canonicalId === DEFAULT_PROPAGATOR_ID
        ? ["AP"]
        : DEFAULT_THEORY_SUPPORT[canonicalId]);
    const supportedTheories = rawTheories
      ? new Set(
          Array.from(rawTheories, (theory) =>
            normalizeDeclaredTheory(theory, canonicalId),
          ),
        )
      : null;

    const normalizedAdapter = {
      ...adapter,
      propagatorId: canonicalId,
      supportedTheories,
      supportsTheory(theory) {
        const normalizedTheory = normalizeDeclaredTheory(theory, canonicalId);
        if (typeof adapter.supportsTheory === "function") {
          return Boolean(adapter.supportsTheory(normalizedTheory));
        }
        return supportedTheories ? supportedTheories.has(normalizedTheory) : false;
      },
    };
    adapters.set(canonicalId, normalizedAdapter);
    return normalizedAdapter;
  }

  function getPropagator(id = DEFAULT_PROPAGATOR_ID) {
    return adapters.get(resolvePropagatorId(id)) ?? null;
  }

  function hasPropagator(id = DEFAULT_PROPAGATOR_ID) {
    return adapters.has(resolvePropagatorId(id));
  }

  function listPropagators() {
    return Array.from(adapters.keys()).sort();
  }

  function unregisterPropagator(id) {
    return adapters.delete(resolvePropagatorId(id));
  }

  if (initialAdapters instanceof Map) {
    for (const [id, adapter] of initialAdapters.entries()) {
      registerPropagator(id, adapter);
    }
  } else if (initialAdapters && typeof initialAdapters === "object") {
    for (const [id, adapter] of Object.entries(initialAdapters)) {
      registerPropagator(id, adapter);
    }
  }

  return {
    defaultPropagatorId: DEFAULT_PROPAGATOR_ID,
    supportedPropagatorIds: SUPPORTED_PROPAGATOR_IDS,
    registerPropagator,
    getPropagator,
    hasPropagator,
    listPropagators,
    unregisterPropagator,
  };
}

export function routeCatalogRecordsByTheory(
  records = [],
  {
    propagatorId = DEFAULT_PROPAGATOR_ID,
    registry = null,
    allowMixedRouting = undefined,
  } = {},
) {
  if (!Array.isArray(records)) {
    throw new TypeError("Catalog records must be an array.");
  }
  const canonicalPropagatorId = resolvePropagatorId(propagatorId);
  const mixedEnabled =
    allowMixedRouting === undefined
      ? canonicalPropagatorId === DEFAULT_PROPAGATOR_ID
      : Boolean(allowMixedRouting);
  const selectedAdapter = registry?.getPropagator(canonicalPropagatorId) ?? null;

  return records.map((record, index) => {
    const { recordId, declaredTheory } = extractDeclaredTheory(record, index);
    const explicitRecordPropagator = record?.propagatorId
      ? resolvePropagatorId(record.propagatorId)
      : null;

    if (explicitRecordPropagator) {
      const recordAdapter =
        registry?.getPropagator(explicitRecordPropagator) ?? null;
      if (
        !adapterSupportsTheory(
          recordAdapter,
          declaredTheory,
          explicitRecordPropagator,
        )
      ) {
        throw new TheoryMismatchError(
          `Catalog record "${recordId}" declares theory "${declaredTheory}", which is incompatible with assigned propagator "${explicitRecordPropagator}".`,
          {
            recordId,
            declaredTheory,
            propagatorId: explicitRecordPropagator,
          },
        );
      }
      if (!mixedEnabled && explicitRecordPropagator !== canonicalPropagatorId) {
        throw new TheoryMismatchError(
          `Catalog record "${recordId}" requests propagator "${explicitRecordPropagator}" (theory "${declaredTheory}"), which cannot run under strict propagator "${canonicalPropagatorId}".`,
          {
            recordId,
            declaredTheory,
            propagatorId: canonicalPropagatorId,
          },
        );
      }
      return {
        index,
        recordId,
        declaredTheory,
        propagatorId: explicitRecordPropagator,
        record,
      };
    }

    if (
      adapterSupportsTheory(
        selectedAdapter,
        declaredTheory,
        canonicalPropagatorId,
      )
    ) {
      return {
        index,
        recordId,
        declaredTheory,
        propagatorId: canonicalPropagatorId,
        record,
      };
    }

    if (!mixedEnabled) {
      throw new TheoryMismatchError(
        `Catalog record "${recordId}" declares theory "${declaredTheory}", which is rejected by propagator "${canonicalPropagatorId}" (every record must fly on the theory it declares).`,
        {
          recordId,
          declaredTheory,
          propagatorId: canonicalPropagatorId,
        },
      );
    }

    const preferredId = PREFERRED_PROPAGATOR_BY_THEORY[declaredTheory];
    const preferredAdapter = preferredId
      ? registry?.getPropagator(preferredId)
      : null;
    if (
      preferredId &&
      preferredAdapter &&
      adapterSupportsTheory(preferredAdapter, declaredTheory, preferredId)
    ) {
      return {
        index,
        recordId,
        declaredTheory,
        propagatorId: preferredId,
        record,
      };
    }

    if (registry) {
      for (const candidateId of registry.listPropagators()) {
        const candidate = registry.getPropagator(candidateId);
        if (adapterSupportsTheory(candidate, declaredTheory, candidateId)) {
          return {
            index,
            recordId,
            declaredTheory,
            propagatorId: candidateId,
            record,
          };
        }
      }
    }

    throw new TheoryMismatchError(
      `Catalog record "${recordId}" declares theory "${declaredTheory}", which has no compatible propagator registered (requested "${canonicalPropagatorId}").`,
      {
        recordId,
        declaredTheory,
        propagatorId: canonicalPropagatorId,
      },
    );
  });
}

export function gridCacheKey({
  propagatorId = DEFAULT_PROPAGATOR_ID,
  catalogRevision,
  windowStart,
  windowEnd,
  stepS,
  frame = "TEME",
}) {
  const canonicalPropagatorId = resolvePropagatorId(propagatorId);
  const revision = normalizeNonEmptyString(catalogRevision, "catalogRevision");
  const start = normalizeFiniteNumber(windowStart, "windowStart");
  const end = normalizeFiniteNumber(windowEnd, "windowEnd");
  const step = normalizePositiveNumber(stepS, "stepS");
  const normalizedFrame = normalizeNonEmptyString(frame, "frame").toUpperCase();
  return `${canonicalPropagatorId}|${revision}|${start}|${end}|${step}|${normalizedFrame}`;
}

export function encodeScrGridFlatBuffer({
  firstStep = 0,
  stepCount,
  objectCount,
  frame = "TEME",
  stepS = 0,
  statesView,
  bandsView,
}) {
  const normalizedFirstStep = normalizeNonNegativeInteger(firstStep, "firstStep");
  const normalizedStepCount = normalizePositiveInteger(stepCount, "stepCount");
  const normalizedObjectCount = normalizeNonNegativeInteger(
    objectCount,
    "objectCount",
  );
  const expectedStateFloats =
    normalizedStepCount * normalizedObjectCount * SCR_GRID_STATE_FLOATS;
  const expectedBandFloats = normalizedObjectCount * SCR_RADIUS_BAND_FLOATS;
  if (!(statesView instanceof Float32Array) || statesView.length !== expectedStateFloats) {
    throw new RangeError(
      `statesView must be a Float32Array of length ${expectedStateFloats}.`,
    );
  }
  if (!(bandsView instanceof Float32Array) || bandsView.length !== expectedBandFloats) {
    throw new RangeError(
      `bandsView must be a Float32Array of length ${expectedBandFloats}.`,
    );
  }

  const builder = new flatbuffers.Builder(
    256 + statesView.byteLength + bandsView.byteLength,
  );
  const frameOffset = frame ? builder.createString(String(frame)) : 0;

  let statesOffset = 0;
  const stateCount = normalizedStepCount * normalizedObjectCount;
  if (HOST_IS_LITTLE_ENDIAN) {
    const raw = new Uint8Array(
      statesView.buffer,
      statesView.byteOffset,
      statesView.byteLength,
    );
    SCRGrid.startStatesVector(builder, stateCount);
    if (raw.byteLength > 0) {
      builder.prep(4, raw.byteLength);
      builder.space -= raw.byteLength;
      builder.bb.bytes().set(raw, builder.space);
    }
    statesOffset = builder.endVector();
  } else {
    SCRGrid.startStatesVector(builder, stateCount);
    for (let i = stateCount - 1; i >= 0; i -= 1) {
      const base = i * SCR_GRID_STATE_FLOATS;
      builder.prep(4, SCR_GRID_STATE_BYTES);
      builder.writeFloat32(statesView[base + 7]);
      builder.writeFloat32(statesView[base + 6]);
      builder.writeFloat32(statesView[base + 5]);
      builder.writeFloat32(statesView[base + 4]);
      builder.writeFloat32(statesView[base + 3]);
      builder.writeFloat32(statesView[base + 2]);
      builder.writeFloat32(statesView[base + 1]);
      builder.writeFloat32(statesView[base]);
    }
    statesOffset = builder.endVector();
  }

  let bandsOffset = 0;
  if (HOST_IS_LITTLE_ENDIAN) {
    const raw = new Uint8Array(
      bandsView.buffer,
      bandsView.byteOffset,
      bandsView.byteLength,
    );
    SCRGrid.startBandsVector(builder, normalizedObjectCount);
    if (raw.byteLength > 0) {
      builder.prep(4, raw.byteLength);
      builder.space -= raw.byteLength;
      builder.bb.bytes().set(raw, builder.space);
    }
    bandsOffset = builder.endVector();
  } else {
    SCRGrid.startBandsVector(builder, normalizedObjectCount);
    for (let i = normalizedObjectCount - 1; i >= 0; i -= 1) {
      const base = i * SCR_RADIUS_BAND_FLOATS;
      builder.prep(4, SCR_RADIUS_BAND_BYTES);
      builder.writeFloat32(bandsView[base + 1]);
      builder.writeFloat32(bandsView[base]);
    }
    bandsOffset = builder.endVector();
  }

  const gridOffset = SCRGrid.createSCRGrid(
    builder,
    normalizedFirstStep,
    normalizedStepCount,
    normalizedObjectCount,
    frameOffset,
    Number(stepS),
    statesOffset,
    bandsOffset,
  );
  SCR.startSCR(builder);
  SCR.addGrid(builder, gridOffset);
  const scrOffset = SCR.endSCR(builder);
  SCR.finishSCRBuffer(builder, scrOffset);
  return builder.asUint8Array().slice();
}

export function decodeScrGridFlatBuffer(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const bb = new flatbuffers.ByteBuffer(u8);
  if (!SCR.bufferHasIdentifier(bb)) {
    throw new Error("Expected a $SCR FlatBuffer payload.");
  }
  const scr = SCR.getRootAsSCR(bb);
  const grid = scr.GRID();
  if (!grid) {
    throw new Error("Expected a $SCR GRID table.");
  }
  const firstStep = grid.FIRST_STEP();
  const stepCount = grid.STEP_COUNT();
  const objectCount = grid.OBJECTS();
  const frame = grid.FRAME() ?? "TEME";
  const stepS = grid.STEP_S();
  const statesLen = grid.statesLength();
  const bandsLen = grid.bandsLength();
  const statesView = new Float32Array(statesLen * SCR_GRID_STATE_FLOATS);
  for (let i = 0; i < statesLen; i += 1) {
    const row = grid.STATES(i);
    const base = i * SCR_GRID_STATE_FLOATS;
    statesView[base] = row.X_KM();
    statesView[base + 1] = row.Y_KM();
    statesView[base + 2] = row.Z_KM();
    statesView[base + 3] = row.DEVIATION_KM();
    statesView[base + 4] = row.VX_KM_S();
    statesView[base + 5] = row.VY_KM_S();
    statesView[base + 6] = row.VZ_KM_S();
    statesView[base + 7] = row.RESERVED();
  }
  const bandsView = new Float32Array(bandsLen * SCR_RADIUS_BAND_FLOATS);
  for (let i = 0; i < bandsLen; i += 1) {
    const band = grid.BANDS(i);
    const base = i * SCR_RADIUS_BAND_FLOATS;
    bandsView[base] = band.LOW_KM();
    bandsView[base + 1] = band.HIGH_KM();
  }
  return {
    firstStep,
    stepCount,
    objectCount,
    frame,
    stepS,
    statesView,
    bandsView,
  };
}

function markExcludedObjectRows(statesView, bandsView, stepCount, objectCount, index) {
  for (let step = 0; step < stepCount; step += 1) {
    const offset = (step * objectCount + index) * SCR_GRID_STATE_FLOATS;
    for (let k = 0; k < SCR_GRID_STATE_FLOATS; k += 1) {
      statesView[offset + k] = Number.NaN;
    }
  }
  const bandOffset = index * SCR_RADIUS_BAND_FLOATS;
  bandsView[bandOffset] = Number.NaN;
  bandsView[bandOffset + 1] = Number.NaN;
}

export function createSharedEphemerisGridManager({
  regions = createRuntimeRegionStore(),
  propagators = createPropagatorRegistry(),
} = {}) {
  const entriesByRegionId = new Map();
  const cacheByKey = new Map();

  function buildDescriptor(entry, { roleMask } = {}) {
    return Object.freeze({
      regionId: entry.regionId,
      roleMask:
        roleMask === undefined ? entry.roleMask : normalizeRoleMask(roleMask),
      propagatorId: entry.propagatorId,
      catalogRevision: entry.catalogRevision,
      windowStart: entry.windowStart,
      windowEnd: entry.windowEnd,
      stepS: entry.stepS,
      frame: entry.frame,
      firstStep: entry.firstStep,
      stepCount: entry.stepCount,
      objectCount: entry.objectCount,
      generation: entry.generation,
    });
  }

  function runPropagation({
    canonicalPropagatorId,
    routedRecords,
    records,
    populateFn,
    statesView,
    bandsView,
    firstStep,
    stepCount,
    objectCount,
    windowStart,
    windowEnd,
    stepS,
    frame,
  }) {
    if (typeof populateFn === "function") {
      return populateFn({
        records,
        routedRecords,
        statesView,
        bandsView,
        firstStep,
        stepCount,
        objectCount,
        windowStart,
        windowEnd,
        stepS,
        frame,
        propagatorId: canonicalPropagatorId,
      });
    }

    const excluded = [];
    const byPropagator = new Map();
    for (const routed of routedRecords) {
      let group = byPropagator.get(routed.propagatorId);
      if (!group) {
        group = [];
        byPropagator.set(routed.propagatorId, group);
      }
      group.push(routed);
    }

    if (routedRecords.length === 0) {
      const primaryAdapter = propagators.getPropagator(canonicalPropagatorId);
      if (!primaryAdapter) {
        throw new Error(
          `Propagator "${canonicalPropagatorId}" is not registered on this runtime host.`,
        );
      }
      if (typeof primaryAdapter.propagateGrid === "function") {
        return primaryAdapter.propagateGrid({
          records,
          routedRecords,
          statesView,
          bandsView,
          firstStep,
          stepCount,
          objectCount,
          windowStart,
          windowEnd,
          stepS,
          frame,
          propagatorId: canonicalPropagatorId,
        });
      }
      return { excludedIndices: [] };
    }

    for (const [targetId, group] of byPropagator.entries()) {
      const adapter = propagators.getPropagator(targetId);
      if (!adapter) {
        throw new Error(
          `Propagator "${targetId}" is not registered on this runtime host.`,
        );
      }
      if (
        byPropagator.size === 1 &&
        typeof adapter.propagateGrid === "function" &&
        group.length === objectCount
      ) {
        const res = adapter.propagateGrid({
          records,
          routedRecords: group,
          statesView,
          bandsView,
          firstStep,
          stepCount,
          objectCount,
          windowStart,
          windowEnd,
          stepS,
          frame,
          propagatorId: targetId,
        });
        if (Array.isArray(res?.excludedIndices)) {
          excluded.push(...res.excludedIndices);
        }
        continue;
      }

      if (typeof adapter.propagateRecord === "function") {
        for (const routed of group) {
          const res = adapter.propagateRecord({
            record: routed.record,
            objectIndex: routed.index,
            declaredTheory: routed.declaredTheory,
            propagatorId: targetId,
            statesView,
            bandsView,
            firstStep,
            stepCount,
            objectCount,
            windowStart,
            windowEnd,
            stepS,
            frame,
          });
          if (res?.excluded === true) {
            excluded.push(routed.index);
          }
        }
        continue;
      }

      if (typeof adapter.propagateGrid === "function") {
        const res = adapter.propagateGrid({
          records: group.map((item) => item.record),
          routedRecords: group,
          statesView,
          bandsView,
          firstStep,
          stepCount,
          objectCount,
          windowStart,
          windowEnd,
          stepS,
          frame,
          propagatorId: targetId,
        });
        if (Array.isArray(res?.excludedIndices)) {
          excluded.push(...res.excludedIndices);
        }
        continue;
      }

      throw new Error(
        `Propagator "${targetId}" must implement propagateGrid() or propagateRecord().`,
      );
    }

    return { excludedIndices: excluded };
  }

  function populateGrid(spec = {}) {
    const canonicalPropagatorId = resolvePropagatorId(
      spec.propagatorId ?? DEFAULT_PROPAGATOR_ID,
    );
    const catalogRevision = normalizeNonEmptyString(
      spec.catalogRevision,
      "catalogRevision",
    );
    const windowStart = normalizeFiniteNumber(spec.windowStart, "windowStart");
    const windowEnd = normalizeFiniteNumber(spec.windowEnd, "windowEnd");
    if (windowEnd <= windowStart) {
      throw new RangeError(
        `windowEnd (${windowEnd}) must be greater than windowStart (${windowStart}).`,
      );
    }
    const stepS = normalizePositiveNumber(spec.stepS, "stepS");
    const frame = normalizeNonEmptyString(spec.frame ?? "TEME", "frame");
    const firstStep = normalizeNonNegativeInteger(
      spec.firstStep ?? 0,
      "firstStep",
    );
    const computedSteps = Math.max(
      1,
      Math.ceil((windowEnd - windowStart) / stepS) + 1,
    );
    const stepCount =
      spec.stepCount === undefined
        ? computedSteps
        : normalizePositiveInteger(spec.stepCount, "stepCount");

    const records = Array.isArray(spec.records) ? spec.records : [];
    const objectCount =
      spec.objectCount === undefined
        ? records.length
        : normalizeNonNegativeInteger(spec.objectCount, "objectCount");
    if (records.length > 0 && records.length !== objectCount) {
      throw new RangeError(
        `records.length (${records.length}) must match objectCount (${objectCount}).`,
      );
    }
    const roleMask = normalizeRoleMask(spec.roleMask);
    const roles = normalizeRolesArray(spec.roles, objectCount);
    const shared = spec.shared === undefined ? true : Boolean(spec.shared);

    const key = gridCacheKey({
      propagatorId: canonicalPropagatorId,
      catalogRevision,
      windowStart,
      windowEnd,
      stepS,
      frame,
    });

    const cached = cacheByKey.get(key);
    if (cached && !cached.invalidated) {
      if (
        cached.firstStep !== firstStep ||
        cached.stepCount !== stepCount ||
        cached.objectCount !== objectCount
      ) {
        throw new Error(
          `Cached ephemeris grid shape mismatch for ${key}: cached (${cached.firstStep}, ${cached.stepCount}, ${cached.objectCount}) vs requested (${firstStep}, ${stepCount}, ${objectCount}).`,
        );
      }
      return {
        descriptor: buildDescriptor(cached, { roleMask }),
        regionId: cached.regionId,
        cacheHit: true,
        propagationCount: cached.propagationCount,
        propagatedObjectCount: cached.propagatedObjectCount,
        excludedIndices: Array.from(cached.excludedIndices),
      };
    }

    const allowMixedRouting =
      spec.allowMixedRouting === undefined
        ? spec.propagatorId === undefined ||
          canonicalPropagatorId === DEFAULT_PROPAGATOR_ID
        : Boolean(spec.allowMixedRouting);
    const routedRecords = routeCatalogRecordsByTheory(records, {
      propagatorId: canonicalPropagatorId,
      registry: propagators,
      allowMixedRouting,
    });

    const statesFloatCount =
      stepCount * objectCount * SCR_GRID_STATE_FLOATS;
    const statesByteLength = stepCount * objectCount * SCR_GRID_STATE_BYTES;
    const bandsFloatCount = objectCount * SCR_RADIUS_BAND_FLOATS;
    const bandsByteLength = objectCount * SCR_RADIUS_BAND_BYTES;
    const totalBytes = statesByteLength + bandsByteLength;

    const regionDesc = regions.allocateContiguousRegion({
      layoutId: SCR_GRID_LAYOUT_ID,
      recordByteLength: SCR_RADIUS_BAND_BYTES,
      alignment: 8,
      recordCount: totalBytes / SCR_RADIUS_BAND_BYTES,
      shared,
      metadata: {
        propagatorId: canonicalPropagatorId,
        catalogRevision,
        windowStart,
        windowEnd,
        stepS,
        frame,
        firstStep,
        stepCount,
        objectCount,
      },
    });
    const arena = regions.getRegionArena(regionDesc.regionId);
    const statesView = new Float32Array(
      arena.buffer,
      arena.byteOffset,
      statesFloatCount,
    );
    const bandsView = new Float32Array(
      arena.buffer,
      arena.byteOffset + statesByteLength,
      bandsFloatCount,
    );

    const outcome = runPropagation({
      canonicalPropagatorId,
      routedRecords,
      records,
      populateFn: spec.populateFn,
      statesView,
      bandsView,
      firstStep,
      stepCount,
      objectCount,
      windowStart,
      windowEnd,
      stepS,
      frame,
    });

    const excludedSet = new Set(
      Array.isArray(outcome?.excludedIndices)
        ? outcome.excludedIndices.map((idx) =>
            normalizeNonNegativeInteger(idx, "excludedIndex"),
          )
        : [],
    );
    for (const idx of excludedSet) {
      if (idx >= objectCount) {
        throw new RangeError(
          `excludedIndex ${idx} out of bounds for objectCount ${objectCount}.`,
        );
      }
      markExcludedObjectRows(statesView, bandsView, stepCount, objectCount, idx);
    }

    const entry = {
      regionId: regionDesc.regionId,
      cacheKey: key,
      roleMask,
      roles,
      propagatorId: canonicalPropagatorId,
      catalogRevision,
      windowStart,
      windowEnd,
      stepS,
      frame,
      firstStep,
      stepCount,
      objectCount,
      generation: regionDesc.generation,
      shared: regionDesc.shared,
      statesByteLength,
      bandsByteLength,
      statesFloatCount,
      bandsFloatCount,
      propagationCount: 1,
      propagatedObjectCount: objectCount,
      spliceCount: 0,
      excludedIndices: excludedSet,
      invalidated: false,
    };
    entriesByRegionId.set(entry.regionId, entry);
    cacheByKey.set(key, entry);

    return {
      descriptor: buildDescriptor(entry),
      regionId: entry.regionId,
      cacheHit: false,
      propagationCount: entry.propagationCount,
      propagatedObjectCount: entry.propagatedObjectCount,
      excludedIndices: Array.from(excludedSet),
    };
  }

  function getGrid(regionId) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const entry = entriesByRegionId.get(normalizedRegionId);
    if (!entry) {
      return null;
    }
    const regionDesc = regions.describeRegion(normalizedRegionId);
    return {
      descriptor: buildDescriptor(entry),
      regionId: entry.regionId,
      shared: entry.shared,
      generation: entry.generation,
      byteLength: entry.statesByteLength + entry.bandsByteLength,
      statesByteLength: entry.statesByteLength,
      bandsByteLength: entry.bandsByteLength,
      propagationCount: entry.propagationCount,
      propagatedObjectCount: entry.propagatedObjectCount,
      spliceCount: entry.spliceCount,
      activeConsumers: regionDesc?.activeConsumers ?? 0,
      invalidated: entry.invalidated,
      excludedIndices: Array.from(entry.excludedIndices),
    };
  }

  function attachGridModule(
    regionId,
    {
      moduleId,
      roleMask = undefined,
      roles = null,
      mode = "read-only",
    } = {},
  ) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const normalizedModuleId = normalizeNonEmptyString(moduleId, "moduleId");
    if (mode !== "read-only") {
      throw new Error(
        `Shared ephemeris grid attach for module "${normalizedModuleId}" must use mode "read-only" (got "${String(mode)}").`,
      );
    }
    const entry = entriesByRegionId.get(normalizedRegionId);
    if (!entry) {
      throw new Error(`Unknown ephemeris grid region ${normalizedRegionId}.`);
    }
    if (entry.invalidated) {
      throw new StaleGridLeaseError(
        `Ephemeris grid region ${normalizedRegionId} has been invalidated.`,
        {
          regionId: normalizedRegionId,
          moduleId: normalizedModuleId,
          currentGeneration: entry.generation,
        },
      );
    }

    const effectiveRoleMask =
      roleMask === undefined ? entry.roleMask : normalizeRoleMask(roleMask);
    const effectiveRoles =
      roles === null || roles === undefined
        ? entry.roles
        : normalizeRolesArray(roles, entry.objectCount);

    const regionLease = regions.attachRegionConsumer(normalizedRegionId, {
      consumerId: normalizedModuleId,
      mode: "read-only",
      roleMask: effectiveRoleMask,
    });
    const attachedGeneration = entry.generation;
    const descriptor = buildDescriptor(entry, { roleMask: effectiveRoleMask });
    let detached = false;

    function assertCurrent() {
      if (detached) {
        throw new StaleGridLeaseError(
          `Ephemeris grid lease for module "${normalizedModuleId}" on region ${normalizedRegionId} is detached.`,
          {
            regionId: normalizedRegionId,
            moduleId: normalizedModuleId,
            attachedGeneration,
            currentGeneration: entry.generation,
          },
        );
      }
      if (entry.invalidated) {
        throw new StaleGridLeaseError(
          `Ephemeris grid region ${normalizedRegionId} was invalidated; lease for module "${normalizedModuleId}" is stale.`,
          {
            regionId: normalizedRegionId,
            moduleId: normalizedModuleId,
            attachedGeneration,
            currentGeneration: entry.generation,
          },
        );
      }
      if (entry.generation !== attachedGeneration) {
        throw new StaleGridLeaseError(
          `Ephemeris grid lease for module "${normalizedModuleId}" on region ${normalizedRegionId} is stale: attached at generation ${attachedGeneration}, current generation is ${entry.generation}.`,
          {
            regionId: normalizedRegionId,
            moduleId: normalizedModuleId,
            attachedGeneration,
            currentGeneration: entry.generation,
          },
        );
      }
      regionLease.assertCurrent();
      return true;
    }

    function isCurrent() {
      return (
        !detached &&
        !entry.invalidated &&
        entry.generation === attachedGeneration &&
        regionLease.isCurrent()
      );
    }

    function getRawArena() {
      assertCurrent();
      const arena = regions.getRegionArena(normalizedRegionId);
      if (!arena) {
        throw new StaleGridLeaseError(
          `Arena for ephemeris grid region ${normalizedRegionId} is unavailable.`,
          {
            regionId: normalizedRegionId,
            moduleId: normalizedModuleId,
            attachedGeneration,
            currentGeneration: entry.generation,
          },
        );
      }
      return arena;
    }

    function getStatesView() {
      const arena = getRawArena();
      const rawStates = new Float32Array(
        arena.buffer,
        arena.byteOffset,
        entry.statesFloatCount,
      );
      return createReadOnlyTypedArrayView(
        rawStates,
        `SCR states view (region ${normalizedRegionId}, module ${normalizedModuleId})`,
      );
    }

    function getBandsView() {
      const arena = getRawArena();
      const rawBands = new Float32Array(
        arena.buffer,
        arena.byteOffset + entry.statesByteLength,
        entry.bandsFloatCount,
      );
      return createReadOnlyTypedArrayView(
        rawBands,
        `SCR bands view (region ${normalizedRegionId}, module ${normalizedModuleId})`,
      );
    }

    function getRolesView() {
      assertCurrent();
      const source =
        effectiveRoles ??
        new Uint8Array(entry.objectCount).fill(SCR_ROLE.PRIMARY);
      return createReadOnlyTypedArrayView(
        new Uint8Array(source),
        `SCR roles view (region ${normalizedRegionId}, module ${normalizedModuleId})`,
      );
    }

    function encodeAlignedExternalFrame({
      portId = "grid",
      typeRef = undefined,
    } = {}) {
      const arena = getRawArena();
      return Object.freeze({
        portId: normalizeNonEmptyString(portId, "portId"),
        offset: 0,
        size: arena.byteLength,
        alignment: arena.alignment,
        ownership: BufferOwnership.SHARED,
        mutability: BufferMutability.IMMUTABLE,
        arenaGeneration: attachedGeneration,
        generation: attachedGeneration,
        shared: arena.shared,
        regionId: normalizedRegionId,
        typeRef: typeRef ?? {
          schemaName: "SCR.fbs",
          fileIdentifier: "$SCR",
          rootTypeName: "SCR",
          wireFormat: "aligned-binary",
          byteLength: arena.byteLength,
          requiredAlignment: arena.alignment,
        },
      });
    }

    function encodeScrGridFrame() {
      const arena = getRawArena();
      const rawStates = new Float32Array(
        arena.buffer,
        arena.byteOffset,
        entry.statesFloatCount,
      );
      const rawBands = new Float32Array(
        arena.buffer,
        arena.byteOffset + entry.statesByteLength,
        entry.bandsFloatCount,
      );
      return encodeScrGridFlatBuffer({
        firstStep: entry.firstStep,
        stepCount: entry.stepCount,
        objectCount: entry.objectCount,
        frame: entry.frame,
        stepS: entry.stepS,
        statesView: rawStates,
        bandsView: rawBands,
      });
    }

    function detach() {
      if (detached) {
        return false;
      }
      detached = true;
      return regionLease.detach();
    }

    return Object.freeze({
      leaseId: regionLease.leaseId,
      regionId: normalizedRegionId,
      moduleId: normalizedModuleId,
      mode: "read-only",
      shared: entry.shared,
      generation: attachedGeneration,
      descriptor,
      get arenaBytes() {
        const arena = getRawArena();
        return createReadOnlyTypedArrayView(
          arena.bytes,
          `SCR arenaBytes (region ${normalizedRegionId}, module ${normalizedModuleId})`,
        );
      },
      getStatesView,
      getBandsView,
      getRolesView,
      encodeAlignedExternalFrame,
      encodeScrGridFrame,
      isCurrent,
      assertCurrent,
      detach,
    });
  }

  function spliceGridObjects({
    regionId,
    newCatalogRevision,
    updatedIndices = [],
    records = [],
    populateFn = null,
    excludedIndices = [],
    allowMixedRouting = undefined,
  }) {
    const normalizedRegionId = normalizePositiveInteger(regionId, "regionId");
    const entry = entriesByRegionId.get(normalizedRegionId);
    if (!entry) {
      throw new Error(`Unknown ephemeris grid region ${normalizedRegionId}.`);
    }
    if (entry.invalidated) {
      throw new Error(
        `Cannot splice invalidated ephemeris grid region ${normalizedRegionId}.`,
      );
    }
    const nextRevision = normalizeNonEmptyString(
      newCatalogRevision,
      "newCatalogRevision",
    );
    if (!Array.isArray(updatedIndices)) {
      throw new TypeError("updatedIndices must be an array.");
    }
    const indices = updatedIndices.map((idx) => {
      const n = normalizeNonNegativeInteger(idx, "updatedIndex");
      if (n >= entry.objectCount) {
        throw new RangeError(
          `updatedIndex ${n} out of bounds for objectCount ${entry.objectCount}.`,
        );
      }
      return n;
    });

    if (records.length > 0 && records.length !== indices.length) {
      throw new RangeError(
        `spliceGridObjects records.length (${records.length}) must match updatedIndices.length (${indices.length}).`,
      );
    }

    const mixedEnabled =
      allowMixedRouting === undefined
        ? entry.propagatorId === DEFAULT_PROPAGATOR_ID
        : Boolean(allowMixedRouting);
    const routedUpdates = routeCatalogRecordsByTheory(records, {
      propagatorId: entry.propagatorId,
      registry: propagators,
      allowMixedRouting: mixedEnabled,
    }).map((item, pos) => ({
      ...item,
      index: indices[pos],
    }));

    const arena = regions.getRegionArena(normalizedRegionId);
    const statesView = new Float32Array(
      arena.buffer,
      arena.byteOffset,
      entry.statesFloatCount,
    );
    const bandsView = new Float32Array(
      arena.buffer,
      arena.byteOffset + entry.statesByteLength,
      entry.bandsFloatCount,
    );

    if (typeof populateFn === "function") {
      populateFn({
        updatedIndices: indices,
        records,
        routedRecords: routedUpdates,
        statesView,
        bandsView,
        firstStep: entry.firstStep,
        stepCount: entry.stepCount,
        objectCount: entry.objectCount,
        windowStart: entry.windowStart,
        windowEnd: entry.windowEnd,
        stepS: entry.stepS,
        frame: entry.frame,
        propagatorId: entry.propagatorId,
      });
    } else if (indices.length > 0) {
      for (const routed of routedUpdates) {
        const adapter = propagators.getPropagator(routed.propagatorId);
        if (!adapter) {
          throw new Error(
            `Propagator "${routed.propagatorId}" is not registered on this runtime host.`,
          );
        }
        if (typeof adapter.propagateRecord === "function") {
          const res = adapter.propagateRecord({
            record: routed.record,
            objectIndex: routed.index,
            declaredTheory: routed.declaredTheory,
            propagatorId: routed.propagatorId,
            statesView,
            bandsView,
            firstStep: entry.firstStep,
            stepCount: entry.stepCount,
            objectCount: entry.objectCount,
            windowStart: entry.windowStart,
            windowEnd: entry.windowEnd,
            stepS: entry.stepS,
            frame: entry.frame,
          });
          if (res?.excluded === true) {
            entry.excludedIndices.add(routed.index);
          } else {
            entry.excludedIndices.delete(routed.index);
          }
        } else if (typeof adapter.propagateGrid === "function") {
          adapter.propagateGrid({
            records: [routed.record],
            routedRecords: [routed],
            updatedIndices: [routed.index],
            statesView,
            bandsView,
            firstStep: entry.firstStep,
            stepCount: entry.stepCount,
            objectCount: entry.objectCount,
            windowStart: entry.windowStart,
            windowEnd: entry.windowEnd,
            stepS: entry.stepS,
            frame: entry.frame,
            propagatorId: routed.propagatorId,
          });
        } else {
          throw new Error(
            `Propagator "${routed.propagatorId}" must implement propagateRecord() or propagateGrid().`,
          );
        }
      }
    }

    for (const idx of excludedIndices) {
      const n = normalizeNonNegativeInteger(idx, "excludedIndex");
      if (n >= entry.objectCount) {
        throw new RangeError(`excludedIndex ${n} out of bounds.`);
      }
      entry.excludedIndices.add(n);
      markExcludedObjectRows(
        statesView,
        bandsView,
        entry.stepCount,
        entry.objectCount,
        n,
      );
    }
    for (const idx of entry.excludedIndices) {
      markExcludedObjectRows(
        statesView,
        bandsView,
        entry.stepCount,
        entry.objectCount,
        idx,
      );
    }

    cacheByKey.delete(entry.cacheKey);
    entry.catalogRevision = nextRevision;
    entry.cacheKey = gridCacheKey({
      propagatorId: entry.propagatorId,
      catalogRevision: nextRevision,
      windowStart: entry.windowStart,
      windowEnd: entry.windowEnd,
      stepS: entry.stepS,
      frame: entry.frame,
    });
    cacheByKey.set(entry.cacheKey, entry);

    const nextGeneration = regions.bumpRegionGeneration(normalizedRegionId);
    entry.generation = nextGeneration ?? entry.generation + 1;
    entry.spliceCount += 1;
    entry.propagatedObjectCount += indices.length;

    return {
      descriptor: buildDescriptor(entry),
      regionId: entry.regionId,
      generation: entry.generation,
      updatedIndices: indices,
      propagatedObjectCount: indices.length,
    };
  }

  function invalidateGrid(filter = {}) {
    const normalizedFilter =
      typeof filter === "number" ? { regionId: filter } : filter ?? {};
    const hasRegionId = normalizedFilter.regionId !== undefined;
    const hasPropagatorId = normalizedFilter.propagatorId !== undefined;
    const hasRevision = normalizedFilter.catalogRevision !== undefined;
    const hasWindowStart = normalizedFilter.windowStart !== undefined;
    const hasWindowEnd = normalizedFilter.windowEnd !== undefined;
    const hasStepS = normalizedFilter.stepS !== undefined;
    const hasFrame = normalizedFilter.frame !== undefined;
    const matchAll = normalizedFilter.all === true;

    if (
      !matchAll &&
      !hasRegionId &&
      !hasPropagatorId &&
      !hasRevision &&
      !hasWindowStart &&
      !hasWindowEnd &&
      !hasStepS &&
      !hasFrame
    ) {
      throw new TypeError(
        "invalidateGrid requires at least one filter criterion or { all: true }.",
      );
    }

    const targetPropagatorId = hasPropagatorId
      ? resolvePropagatorId(normalizedFilter.propagatorId)
      : null;
    const targetRevision = hasRevision
      ? normalizeNonEmptyString(
          normalizedFilter.catalogRevision,
          "catalogRevision",
        )
      : null;
    const targetFrame = hasFrame
      ? normalizeNonEmptyString(normalizedFilter.frame, "frame").toUpperCase()
      : null;

    const invalidatedRegionIds = [];
    for (const entry of entriesByRegionId.values()) {
      if (entry.invalidated) continue;
      if (!matchAll) {
        if (hasRegionId && entry.regionId !== Number(normalizedFilter.regionId)) {
          continue;
        }
        if (hasPropagatorId && entry.propagatorId !== targetPropagatorId) {
          continue;
        }
        if (hasRevision && entry.catalogRevision !== targetRevision) {
          continue;
        }
        if (hasWindowStart && entry.windowStart !== Number(normalizedFilter.windowStart)) {
          continue;
        }
        if (hasWindowEnd && entry.windowEnd !== Number(normalizedFilter.windowEnd)) {
          continue;
        }
        if (hasStepS && entry.stepS !== Number(normalizedFilter.stepS)) {
          continue;
        }
        if (hasFrame && entry.frame.toUpperCase() !== targetFrame) {
          continue;
        }
      }
      entry.invalidated = true;
      entry.generation += 1;
      cacheByKey.delete(entry.cacheKey);
      regions.invalidateRegion(entry.regionId);
      invalidatedRegionIds.push(entry.regionId);
    }

    return {
      invalidatedRegionIds,
      count: invalidatedRegionIds.length,
    };
  }

  return {
    populateGrid,
    getGrid,
    attachGridModule,
    spliceGridObjects,
    invalidateGrid,
  };
}
