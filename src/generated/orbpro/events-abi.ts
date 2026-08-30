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

import { ReferenceFrame } from "./propagator-abi.js";

export { ReferenceFrame };

/**
 * The refinement algorithm the runner uses on a bracketed root. All three are
 * bracketing methods: a root that is bracketed stays bracketed, so a locator
 * can never report a root outside the interval that produced it.
 */
export enum RootMethod {
  BRENT = 0,
  BISECTION = 1,
  ILLINOIS = 2,
}

/**
 * Which way g crosses zero. SIGNED on purpose: a crossing qualifies when
 * `direction * (g_after - g_before) > 0`, so the filter is arithmetic rather
 * than a branch table, and ANY = 0 falls out of the same expression.
 */
export enum CrossingDirection {
  FALLING = -1,
  ANY = 0,
  RISING = 1,
}

/**
 * How a refinement ended. NEVER folded into the returned root: a root that
 * stopped on the iteration cap and a root that converged are different
 * answers, and a consumer that cannot tell them apart will publish the first
 * as if it were the second.
 */
export enum RootStatus {
  CONVERGED = 0,
  MAX_ITERATIONS = 1,
  FLAT_BRACKET = 2,
  DISCONTINUOUS = 3,
  TRUNCATED = 4,
  EPOCH_RESOLUTION_LIMITED = 5,
}

/**
 * The sign of a scalar at an interval endpoint. Its only job is to make an
 * interval that is ALREADY OPEN at the scan start representable: a
 * crossing-only report loses that interval entirely, which is the classic
 * event-scan defect (the pass you were already inside when the scan began).
 */
export enum Sign {
  NEGATIVE = -1,
  ZERO = 0,
  POSITIVE = 1,
}

/**
 * EventHit.flags and EventInterval.flags are BITFIELDS carrying any
 * OR-combination of these, so both are declared `uint` on their structs
 * rather than typed to this enum. The C enumerators are generated from here
 * anyway — they are the contract.
 */
export enum EventFlags {
  NONE = 0,
  INTERVAL_OPEN_AT_START = 1,
  INTERVAL_OPEN_AT_END = 2,
  TANGENTIAL = 4,
  ON_SCAN_BOUNDARY = 8,
  BACKWARD = 16,
  STOP_CONDITION = 32,
}

/**
 * Named negative return codes for every export in this family. A locator that
 * answers -1 for everything is unconformable: the consumer cannot place the
 * failure on the degradation ladder, so it cannot decide between retrying,
 * widening the interval, and refusing. Codes -1..-6 are deliberately the SAME
 * numbers and the same meanings as the propagator family's
 * (docs/propagator-abi.md §Error codes); the events-specific codes start at
 * -20 so no consumer can confuse the two tables by value.
 */
export enum EventError {
  INTERNAL = -25,
  SUPPLY_COUNT_MISMATCH = -24,
  PROTOCOL_ORDER = -23,
  BUFFER_TOO_SMALL = -22,
  UNKNOWN_COMPONENT = -21,
  NOT_STARTED = -20,
  UNPHYSICAL = -6,
  NOT_CONVERGED = -5,
  BAD_INPUT = -4,
  NULL_OUTPUT = -3,
  BAD_OBJECT_INDEX = -2,
  NOT_CONFIGURED = -1,
  OK = 0,
}

/**
 * Whether a component's g is safe to refine, and with which method. A locator
 * that lies here produces roots that look converged and are not, which is why
 * it is declared per component rather than assumed for the family.
 */
export enum ComponentContinuity {
  SMOOTH = 0,
  PIECEWISE = 1,
  DISCRETE = 2,
}

/** One field's placement inside an ABI struct. */
export interface AbiField {
  readonly offset: number;
  readonly size: number;
  /** Element count for array fields, 1 for scalars. */
  readonly length: number;
  /** DataView accessor suffix, e.g. "Float64" for getFloat64. */
  readonly view: string;
}

/** One ABI struct's byte layout. */
export interface AbiStruct {
  readonly name: string;
  readonly cName: string;
  readonly size: number;
  readonly alignment: number;
  readonly offsets: Readonly<Record<string, number>>;
  readonly fields: Readonly<Record<string, AbiField>>;
}

/**
 * The root-refinement policy — the SAME parameters for every locator, which
 * is what makes two locators' epochs comparable. 32 bytes, 8-byte aligned.
 *
 * A zeroed policy is NOT a default: `orbpro_root_policy_init` zeroes it and
 * `plugin_event_begin` refuses a zero `scan_step_seconds` with `BAD_INPUT`.
 * A silent default step is how a scan misses every event shorter than it.
 */
export const ORBPRO_ROOT_POLICY: AbiStruct = {
  name: "RootPolicy",
  cName: "OrbProRootPolicy",
  size: 32,
  alignment: 8,
  offsets: {
    scan_step_seconds: 0,
    epoch_tolerance_seconds: 8,
    value_tolerance: 16,
    max_iterations: 24,
    method: 28,
  },
  fields: {
    scan_step_seconds: { offset: 0, size: 8, length: 1, view: "Float64" },
    epoch_tolerance_seconds: { offset: 8, size: 8, length: 1, view: "Float64" },
    value_tolerance: { offset: 16, size: 8, length: 1, view: "Float64" },
    max_iterations: { offset: 24, size: 4, length: 1, view: "Uint32" },
    method: { offset: 28, size: 1, length: 1, view: "Uint8" },
  },
} as const;

/**
 * The interval to scan, and the filter applied to what is found. 56 bytes,
 * 8-byte aligned.
 *
 * EPOCHS ARE SPLIT PAIRS: `*_jd_day` is an exactly-representable Julian day
 * (an integer, or an integer + 0.5) and `*_seconds` is the offset from it in
 * seconds. Do not collapse them into one double before comparing — that is
 * the forty-microsecond quantization this pair exists to avoid.
 *
 * BACKWARD PROPAGATION IS NOT A MODE. It is `stop` earlier than `start`. The
 * runner steps negatively, the consumer's propagator is asked for earlier
 * epochs, and every hit carries `BACKWARD`. There is no second code path to
 * keep in agreement with the first.
 */
export const ORBPRO_EVENT_INTERVAL: AbiStruct = {
  name: "EventInterval",
  cName: "OrbProEventInterval",
  size: 56,
  alignment: 8,
  offsets: {
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
  },
  fields: {
    start_jd_day: { offset: 0, size: 8, length: 1, view: "Float64" },
    start_seconds: { offset: 8, size: 8, length: 1, view: "Float64" },
    stop_jd_day: { offset: 16, size: 8, length: 1, view: "Float64" },
    stop_seconds: { offset: 24, size: 8, length: 1, view: "Float64" },
    max_events: { offset: 32, size: 4, length: 1, view: "Uint32" },
    max_evaluations: { offset: 36, size: 4, length: 1, view: "Uint32" },
    occurrence: { offset: 40, size: 4, length: 1, view: "Uint32" },
    component: { offset: 44, size: 4, length: 1, view: "Uint32" },
    flags: { offset: 48, size: 4, length: 1, view: "Uint32" },
    direction: { offset: 52, size: 1, length: 1, view: "Int8" },
  },
} as const;

/**
 * One refined crossing. 48 bytes, 8-byte aligned.
 *
 * A HIT IS A CROSSING, NOT AN INTERVAL. Apsides and node crossings are
 * instants; eclipse and contact are intervals. Emitting crossings and pairing
 * them by direction is total over both, whereas an interval-shaped hit puts a
 * sentinel in half the family. Pairing is deterministic and is specified in
 * docs/events-abi.md §Interval pairing; `EventScanSummary` carries the
 * endpoint signs that make the pairing total.
 */
export const ORBPRO_EVENT_HIT: AbiStruct = {
  name: "EventHit",
  cName: "OrbProEventHit",
  size: 48,
  alignment: 8,
  offsets: {
    epoch_jd_day: 0,
    epoch_seconds: 8,
    value: 16,
    component: 24,
    iterations: 28,
    evaluations: 32,
    flags: 36,
    direction: 40,
    status: 41,
  },
  fields: {
    epoch_jd_day: { offset: 0, size: 8, length: 1, view: "Float64" },
    epoch_seconds: { offset: 8, size: 8, length: 1, view: "Float64" },
    value: { offset: 16, size: 8, length: 1, view: "Float64" },
    component: { offset: 24, size: 4, length: 1, view: "Uint32" },
    iterations: { offset: 28, size: 4, length: 1, view: "Uint32" },
    evaluations: { offset: 32, size: 4, length: 1, view: "Uint32" },
    flags: { offset: 36, size: 4, length: 1, view: "Uint32" },
    direction: { offset: 40, size: 1, length: 1, view: "Int8" },
    status: { offset: 41, size: 1, length: 1, view: "Uint8" },
  },
} as const;

/**
 * What one component did across the whole interval. 32 bytes, 8-byte aligned.
 *
 * This is what makes a crossing list interpretable. Without the endpoint
 * signs, "no hits" is ambiguous between "never in eclipse" and "in eclipse the
 * entire time", and those are opposite answers.
 */
export const ORBPRO_EVENT_SCAN_SUMMARY: AbiStruct = {
  name: "EventScanSummary",
  cName: "OrbProEventScanSummary",
  size: 32,
  alignment: 8,
  offsets: {
    initial_value: 0,
    final_value: 8,
    component: 16,
    crossing_count: 20,
    evaluation_count: 24,
    initial_sign: 28,
    final_sign: 29,
  },
  fields: {
    initial_value: { offset: 0, size: 8, length: 1, view: "Float64" },
    final_value: { offset: 8, size: 8, length: 1, view: "Float64" },
    component: { offset: 16, size: 4, length: 1, view: "Uint32" },
    crossing_count: { offset: 20, size: 4, length: 1, view: "Uint32" },
    evaluation_count: { offset: 24, size: 4, length: 1, view: "Uint32" },
    initial_sign: { offset: 28, size: 1, length: 1, view: "Int8" },
    final_sign: { offset: 29, size: 1, length: 1, view: "Int8" },
  },
} as const;

/**
 * What the locator wants evaluated next — the guest-to-consumer half of the
 * pull protocol. 16 bytes, 4-byte aligned.
 *
 * The consumer reads this, propagates the requested epochs through whatever
 * module is wired to the propagator port, and returns the states through
 * `plugin_event_supply`. The consumer chooses NOTHING: not the epochs, not
 * the order, not when the scan ends.
 */
export const ORBPRO_EVENT_STATE_REQUEST: AbiStruct = {
  name: "EventStateRequest",
  cName: "OrbProEventStateRequest",
  size: 16,
  alignment: 4,
  offsets: {
    epoch_count: 0,
    object_count: 4,
    reference_frame: 8,
    flags: 12,
  },
  fields: {
    epoch_count: { offset: 0, size: 4, length: 1, view: "Uint32" },
    object_count: { offset: 4, size: 4, length: 1, view: "Uint32" },
    reference_frame: { offset: 8, size: 1, length: 1, view: "Uint8" },
    flags: { offset: 12, size: 4, length: 1, view: "Uint32" },
  },
} as const;

/** Every ABI struct, keyed by its IDL name. */
export const ORBPRO_EVENTS_ABI: Readonly<Record<string, AbiStruct>> = {
  RootPolicy: ORBPRO_ROOT_POLICY,
  EventInterval: ORBPRO_EVENT_INTERVAL,
  EventHit: ORBPRO_EVENT_HIT,
  EventScanSummary: ORBPRO_EVENT_SCAN_SUMMARY,
  EventStateRequest: ORBPRO_EVENT_STATE_REQUEST,
} as const;
