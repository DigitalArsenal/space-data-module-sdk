// ===========================================================================
// GENERATED FILE — DO NOT EDIT.
//
// Source of truth : schemas/orbpro/Events.fbs
// Generator       : scripts/generate-events-abi.mjs
// Drift gate      : scripts/check-events-abi.mjs  (runs in `npm test`)
// Contract        : docs/events-abi.md
//
// These constants exist so that no JavaScript consumer ever hard-codes a byte
// offset again. Read a state vector with ORBPRO_STATE_VECTOR.offsets.position,
// never with the literal 8.
// ===========================================================================

export { ReferenceFrame } from "./propagator-abi.js";

export const RootMethod = Object.freeze({
  BRENT: 0,
  BISECTION: 1,
  ILLINOIS: 2,
});

export const CrossingDirection = Object.freeze({
  FALLING: -1,
  ANY: 0,
  RISING: 1,
});

export const RootStatus = Object.freeze({
  CONVERGED: 0,
  MAX_ITERATIONS: 1,
  FLAT_BRACKET: 2,
  DISCONTINUOUS: 3,
  TRUNCATED: 4,
  EPOCH_RESOLUTION_LIMITED: 5,
});

export const Sign = Object.freeze({
  NEGATIVE: -1,
  ZERO: 0,
  POSITIVE: 1,
});

export const EventFlags = Object.freeze({
  NONE: 0,
  INTERVAL_OPEN_AT_START: 1,
  INTERVAL_OPEN_AT_END: 2,
  TANGENTIAL: 4,
  ON_SCAN_BOUNDARY: 8,
  BACKWARD: 16,
  STOP_CONDITION: 32,
});

export const EventError = Object.freeze({
  INTERNAL: -25,
  SUPPLY_COUNT_MISMATCH: -24,
  PROTOCOL_ORDER: -23,
  BUFFER_TOO_SMALL: -22,
  UNKNOWN_COMPONENT: -21,
  NOT_STARTED: -20,
  UNPHYSICAL: -6,
  NOT_CONVERGED: -5,
  BAD_INPUT: -4,
  NULL_OUTPUT: -3,
  BAD_OBJECT_INDEX: -2,
  NOT_CONFIGURED: -1,
  OK: 0,
});

export const ComponentContinuity = Object.freeze({
  SMOOTH: 0,
  PIECEWISE: 1,
  DISCRETE: 2,
});

export const ORBPRO_ROOT_POLICY = Object.freeze({
  name: "RootPolicy",
  cName: "OrbProRootPolicy",
  size: 32,
  alignment: 8,
  offsets: Object.freeze({
    scan_step_seconds: 0,
    epoch_tolerance_seconds: 8,
    value_tolerance: 16,
    max_iterations: 24,
    method: 28,
  }),
  fields: Object.freeze({
    scan_step_seconds: Object.freeze({ offset: 0, size: 8, length: 1, view: "Float64" }),
    epoch_tolerance_seconds: Object.freeze({ offset: 8, size: 8, length: 1, view: "Float64" }),
    value_tolerance: Object.freeze({ offset: 16, size: 8, length: 1, view: "Float64" }),
    max_iterations: Object.freeze({ offset: 24, size: 4, length: 1, view: "Uint32" }),
    method: Object.freeze({ offset: 28, size: 1, length: 1, view: "Uint8" }),
  }),
});

export const ORBPRO_EVENT_INTERVAL = Object.freeze({
  name: "EventInterval",
  cName: "OrbProEventInterval",
  size: 56,
  alignment: 8,
  offsets: Object.freeze({
    start_jd_day: 0,
    start_seconds: 8,
    stop_jd_day: 16,
    stop_seconds: 24,
    max_events: 32,
    max_evaluations: 36,
    occurrence: 40,
    component: 44,
    flags: 48,
    direction: 52,
  }),
  fields: Object.freeze({
    start_jd_day: Object.freeze({ offset: 0, size: 8, length: 1, view: "Float64" }),
    start_seconds: Object.freeze({ offset: 8, size: 8, length: 1, view: "Float64" }),
    stop_jd_day: Object.freeze({ offset: 16, size: 8, length: 1, view: "Float64" }),
    stop_seconds: Object.freeze({ offset: 24, size: 8, length: 1, view: "Float64" }),
    max_events: Object.freeze({ offset: 32, size: 4, length: 1, view: "Uint32" }),
    max_evaluations: Object.freeze({ offset: 36, size: 4, length: 1, view: "Uint32" }),
    occurrence: Object.freeze({ offset: 40, size: 4, length: 1, view: "Uint32" }),
    component: Object.freeze({ offset: 44, size: 4, length: 1, view: "Uint32" }),
    flags: Object.freeze({ offset: 48, size: 4, length: 1, view: "Uint32" }),
    direction: Object.freeze({ offset: 52, size: 1, length: 1, view: "Int8" }),
  }),
});

export const ORBPRO_EVENT_HIT = Object.freeze({
  name: "EventHit",
  cName: "OrbProEventHit",
  size: 48,
  alignment: 8,
  offsets: Object.freeze({
    epoch_jd_day: 0,
    epoch_seconds: 8,
    value: 16,
    component: 24,
    iterations: 28,
    evaluations: 32,
    flags: 36,
    direction: 40,
    status: 41,
  }),
  fields: Object.freeze({
    epoch_jd_day: Object.freeze({ offset: 0, size: 8, length: 1, view: "Float64" }),
    epoch_seconds: Object.freeze({ offset: 8, size: 8, length: 1, view: "Float64" }),
    value: Object.freeze({ offset: 16, size: 8, length: 1, view: "Float64" }),
    component: Object.freeze({ offset: 24, size: 4, length: 1, view: "Uint32" }),
    iterations: Object.freeze({ offset: 28, size: 4, length: 1, view: "Uint32" }),
    evaluations: Object.freeze({ offset: 32, size: 4, length: 1, view: "Uint32" }),
    flags: Object.freeze({ offset: 36, size: 4, length: 1, view: "Uint32" }),
    direction: Object.freeze({ offset: 40, size: 1, length: 1, view: "Int8" }),
    status: Object.freeze({ offset: 41, size: 1, length: 1, view: "Uint8" }),
  }),
});

export const ORBPRO_EVENT_SCAN_SUMMARY = Object.freeze({
  name: "EventScanSummary",
  cName: "OrbProEventScanSummary",
  size: 32,
  alignment: 8,
  offsets: Object.freeze({
    initial_value: 0,
    final_value: 8,
    component: 16,
    crossing_count: 20,
    evaluation_count: 24,
    initial_sign: 28,
    final_sign: 29,
  }),
  fields: Object.freeze({
    initial_value: Object.freeze({ offset: 0, size: 8, length: 1, view: "Float64" }),
    final_value: Object.freeze({ offset: 8, size: 8, length: 1, view: "Float64" }),
    component: Object.freeze({ offset: 16, size: 4, length: 1, view: "Uint32" }),
    crossing_count: Object.freeze({ offset: 20, size: 4, length: 1, view: "Uint32" }),
    evaluation_count: Object.freeze({ offset: 24, size: 4, length: 1, view: "Uint32" }),
    initial_sign: Object.freeze({ offset: 28, size: 1, length: 1, view: "Int8" }),
    final_sign: Object.freeze({ offset: 29, size: 1, length: 1, view: "Int8" }),
  }),
});

export const ORBPRO_EVENT_STATE_REQUEST = Object.freeze({
  name: "EventStateRequest",
  cName: "OrbProEventStateRequest",
  size: 16,
  alignment: 4,
  offsets: Object.freeze({
    epoch_count: 0,
    object_count: 4,
    reference_frame: 8,
    flags: 12,
  }),
  fields: Object.freeze({
    epoch_count: Object.freeze({ offset: 0, size: 4, length: 1, view: "Uint32" }),
    object_count: Object.freeze({ offset: 4, size: 4, length: 1, view: "Uint32" }),
    reference_frame: Object.freeze({ offset: 8, size: 1, length: 1, view: "Uint8" }),
    flags: Object.freeze({ offset: 12, size: 4, length: 1, view: "Uint32" }),
  }),
});

export const ORBPRO_EVENTS_ABI = Object.freeze({
  RootPolicy: ORBPRO_ROOT_POLICY,
  EventInterval: ORBPRO_EVENT_INTERVAL,
  EventHit: ORBPRO_EVENT_HIT,
  EventScanSummary: ORBPRO_EVENT_SCAN_SUMMARY,
  EventStateRequest: ORBPRO_EVENT_STATE_REQUEST,
});
