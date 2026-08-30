/* ===========================================================================
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source of truth : schemas/orbpro/Events.fbs
 * Generator       : scripts/generate-events-abi.mjs
 * Drift gate      : scripts/check-events-abi.mjs  (runs in `npm test`)
 * Contract        : docs/events-abi.md
 *
 * Edit the .fbs and regenerate. A hand edit here is erased by the next run and
 * failed by the gate in between — which is the point: this file existing in
 * five hand-maintained copies is the drift that
 * graph/findings/official-harness-shapes.md §3 forbids.
 * ===========================================================================
 */

#ifndef ORBPRO_EVENTS_ABI_H
#define ORBPRO_EVENTS_ABI_H

#include <stdint.h>
#include <stddef.h> /* offsetof */
#include "orbpro/orbpro_propagator_abi.h"

/* The ABI locks below must compile in both C and C++ — a locator's event
 * function is usually C++ while the runner
 * (include/orbpro/orbpro_event_runner.h) and its examples are C. */
#if defined(__cplusplus)
#define ORBPRO_ABI_STATIC_ASSERT(cond, msg) static_assert(cond, msg)
#else
#define ORBPRO_ABI_STATIC_ASSERT(cond, msg) _Static_assert(cond, msg)
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================= */
/* RootMethod */
/* ========================================================================= */

/**
 * The refinement algorithm the runner uses on a bracketed root. All three are
 * bracketing methods: a root that is bracketed stays bracketed, so a locator
 * can never report a root outside the interval that produced it.
 */
typedef enum {
    ORBPRO_ROOT_BRENT = 0,    /**< Brent's method (inverse quadratic interpolation with bisection fallback). The default: superlinear on smooth g, and it cannot diverge. */
    ORBPRO_ROOT_BISECTION = 1,    /**< Plain bisection. Slower, and chosen only when g is known to be noisy or piecewise — it is the one method whose iteration count is a function of the bracket width alone, which makes it the reproducibility fallback. */
    ORBPRO_ROOT_ILLINOIS = 2,    /**< Illinois (modified regula falsi). Retained because it is the method the legacy JavaScript eclipse scan used, so a like-for-like comparison against the pre-module answer is possible without changing the method. */
} OrbProRootMethod;

/* ========================================================================= */
/* CrossingDirection */
/* ========================================================================= */

/**
 * Which way g crosses zero. SIGNED on purpose: a crossing qualifies when
 * `direction * (g_after - g_before) > 0`, so the filter is arithmetic rather
 * than a branch table, and ANY = 0 falls out of the same expression.
 */
typedef enum {
    ORBPRO_CROSSING_FALLING = -1,    /**< g decreasing through zero — an interval OPENS for the usual "g > 0 means outside" convention (eclipse entry, AOS, FOV entry). */
    ORBPRO_CROSSING_ANY = 0,    /**< Either direction. */
    ORBPRO_CROSSING_RISING = 1,    /**< g increasing through zero — an interval CLOSES (eclipse exit, LOS). */
} OrbProCrossingDirection;

/* ========================================================================= */
/* RootStatus */
/* ========================================================================= */

/**
 * How a refinement ended. NEVER folded into the returned root: a root that
 * stopped on the iteration cap and a root that converged are different
 * answers, and a consumer that cannot tell them apart will publish the first
 * as if it were the second.
 */
typedef enum {
    ORBPRO_ROOT_STATUS_CONVERGED = 0,    /**< |g| <= value_tolerance, or the bracket narrowed below epoch_tolerance. */
    ORBPRO_ROOT_STATUS_MAX_ITERATIONS = 1,    /**< The iteration cap was reached with the bracket still wider than the tolerance. The returned epoch is the best bracket midpoint. */
    ORBPRO_ROOT_STATUS_FLAT_BRACKET = 2,    /**< g did not change sign across a bracket that the scan said it did — the state source returned inconsistent values for the same epoch, or g is not a function of epoch alone. */
    ORBPRO_ROOT_STATUS_DISCONTINUOUS = 3,    /**< g jumped across zero without passing through it within the epoch tolerance: a discontinuity, not a root. Reported, never refined away. */
    ORBPRO_ROOT_STATUS_TRUNCATED = 4,    /**< The scan hit `EventInterval.max_events` or `max_evaluations` and stopped early. Everything reported is real; the list is not complete. */
    ORBPRO_ROOT_STATUS_EPOCH_RESOLUTION_LIMITED = 5,    /**< The bracket narrowed to the state source's declared epoch resolution before it reached `epoch_tolerance_seconds`. The root is correct to that resolution and NO FINER, and this is how the ABI says so instead of reporting the tolerance it was asked for. */
} OrbProRootStatus;

/* ========================================================================= */
/* Sign */
/* ========================================================================= */

/**
 * The sign of a scalar at an interval endpoint. Its only job is to make an
 * interval that is ALREADY OPEN at the scan start representable: a
 * crossing-only report loses that interval entirely, which is the classic
 * event-scan defect (the pass you were already inside when the scan began).
 */
typedef enum {
    ORBPRO_SIGN_NEGATIVE = -1,
    ORBPRO_SIGN_ZERO = 0,
    ORBPRO_SIGN_POSITIVE = 1,
} OrbProSign;

/* ========================================================================= */
/* EventFlags */
/* ========================================================================= */

/**
 * EventHit.flags and EventInterval.flags are BITFIELDS carrying any
 * OR-combination of these, so both are declared `uint` on their structs
 * rather than typed to this enum. The C enumerators are generated from here
 * anyway — they are the contract.
 */
typedef enum {
    ORBPRO_EVENT_NONE = 0,
    ORBPRO_EVENT_INTERVAL_OPEN_AT_START = 1,    /**< The component's interval was already open at the interval start, so this hit is a CLOSING crossing whose opening epoch is before the scan. */
    ORBPRO_EVENT_INTERVAL_OPEN_AT_END = 2,    /**< The component's interval is still open at the interval end. */
    ORBPRO_EVENT_TANGENTIAL = 4,    /**< g touched zero and returned on the same side — a grazing event. Reported as a hit with this flag rather than silently dropped, because a grazing eclipse and no eclipse are different answers. */
    ORBPRO_EVENT_ON_SCAN_BOUNDARY = 8,    /**< The root sits within one epoch tolerance of an interval endpoint, so the bracket is one-sided and the consumer should widen the interval to confirm it. */
    ORBPRO_EVENT_BACKWARD = 16,    /**< The scan ran backward in time (`stop` earlier than `start`). Hits are still reported in SCAN order, which is decreasing epoch. */
    ORBPRO_EVENT_STOP_CONDITION = 32,    /**< This hit satisfied a component declared `isStopCondition` — it is the propagate-to-condition answer, not merely an observed crossing. */
} OrbProEventFlags;

/* ========================================================================= */
/* EventError */
/* ========================================================================= */

/**
 * Named negative return codes for every export in this family. A locator that
 * answers -1 for everything is unconformable: the consumer cannot place the
 * failure on the degradation ladder, so it cannot decide between retrying,
 * widening the interval, and refusing. Codes -1..-6 are deliberately the SAME
 * numbers and the same meanings as the propagator family's
 * (docs/propagator-abi.md §Error codes); the events-specific codes start at
 * -20 so no consumer can confuse the two tables by value.
 */
typedef enum {
    ORBPRO_EVENT_E_INTERNAL = -25,    /**< The runner asked for a phase that does not exist. Internal; never returned by a conformant locator. */
    ORBPRO_EVENT_E_SUPPLY_COUNT_MISMATCH = -24,    /**< `plugin_event_supply` was called with a count that is not `epoch_count * object_count` from the last `plugin_event_next`. */
    ORBPRO_EVENT_E_PROTOCOL_ORDER = -23,    /**< `plugin_event_supply` was called when no request was outstanding, or `plugin_event_next` twice without an intervening supply. */
    ORBPRO_EVENT_E_BUFFER_TOO_SMALL = -22,    /**< A caller buffer was too small for the answer. The required element count is available from the matching `*_count` export; nothing is truncated silently. */
    ORBPRO_EVENT_E_UNKNOWN_COMPONENT = -21,    /**< The configuration named a component, parameter or object this locator does not implement. The name is reported through the description, never coerced to a neighbour. */
    ORBPRO_EVENT_E_NOT_STARTED = -20,    /**< `plugin_event_begin` has not been called, or the previous scan finished. */
    ORBPRO_EVENT_E_UNPHYSICAL = -6,    /**< A state, epoch or parameter is outside the domain where this locator's geometry is defined (a station below the surface, e < 0, a cone half-angle outside (0, pi)). */
    ORBPRO_EVENT_E_NOT_CONVERGED = -5,    /**< A refinement ended without converging AND the caller asked for strict convergence. Ordinarily non-convergence is reported per hit in `EventHit.status`, not as a call failure. */
    ORBPRO_EVENT_E_BAD_INPUT = -4,    /**< A pointer, count or policy value is malformed (NaN tolerance, zero scan step, `max_iterations` of 0). */
    ORBPRO_EVENT_E_NULL_OUTPUT = -3,    /**< A required output pointer was null. */
    ORBPRO_EVENT_E_BAD_OBJECT_INDEX = -2,    /**< An object index is outside `[0, object_count)`. */
    ORBPRO_EVENT_E_NOT_CONFIGURED = -1,    /**< `plugin_event_configure` has not been called, or it failed. */
    ORBPRO_EVENT_E_OK = 0,
} OrbProEventError;

/* ========================================================================= */
/* ComponentContinuity */
/* ========================================================================= */

/**
 * Whether a component's g is safe to refine, and with which method. A locator
 * that lies here produces roots that look converged and are not, which is why
 * it is declared per component rather than assumed for the family.
 */
typedef enum {
    ORBPRO_CONTINUITY_SMOOTH = 0,    /**< g is C1 in epoch. Brent is valid. */
    ORBPRO_CONTINUITY_PIECEWISE = 1,    /**< g is continuous but its derivative jumps (a piecewise mask, a multi-body minimum). Bracketing methods are valid; interpolation is not guaranteed to help, and the runner falls back to bisection. */
    ORBPRO_CONTINUITY_DISCRETE = 2,    /**< g steps between levels and has no root in the analytic sense (a discrete count, an enumerated state). The runner reports the STEP epoch to within the scan step and marks it DISCONTINUOUS; it never refines it. */
} OrbProComponentContinuity;

/* ========================================================================= */
/* OrbProRootPolicy — 32 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 * The root-refinement policy — the SAME parameters for every locator, which
 * is what makes two locators' epochs comparable. 32 bytes, 8-byte aligned.
 *
 * A zeroed policy is NOT a default: `orbpro_root_policy_init` zeroes it and
 * `plugin_event_begin` refuses a zero `scan_step_seconds` with `BAD_INPUT`.
 * A silent default step is how a scan misses every event shorter than it.
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0     8  scan_step_seconds
 *        8     8  epoch_tolerance_seconds
 *       16     8  value_tolerance
 *       24     4  max_iterations
 *       28     1  method
 *       29     3  (alignment padding — MUST be written as zero)
 */
typedef struct {
    double scan_step_seconds; /**< Coarse bracketing step, SECONDS, always positive. The runner applies the interval's direction. This is the ONLY thing that decides which events are found; the refinement decides only how precisely. */
    double epoch_tolerance_seconds; /**< Convergence bar on the bracket width, SECONDS. Clamped up to the state source's declared epoch resolution — see `EPOCH_RESOLUTION_LIMITED`. */
    double value_tolerance; /**< Convergence bar on |g|, in the component's own declared unit. 0 disables the value test and converges on the bracket alone. */
    uint32_t max_iterations; /**< Hard cap on refinement iterations for ONE root. Reaching it is reported as `MAX_ITERATIONS`, never as a converged root. */
    uint8_t method; /**< Refinement algorithm. */
    uint8_t _reserved[3]; /**< Alignment padding at offset 29. MUST be 0. */
} OrbProRootPolicy;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProRootPolicy) == 32,
    "OrbProRootPolicy must be 32 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProRootPolicy, scan_step_seconds) == 0,
    "OrbProRootPolicy.scan_step_seconds must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProRootPolicy, epoch_tolerance_seconds) == 8,
    "OrbProRootPolicy.epoch_tolerance_seconds must be at offset 8");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProRootPolicy, value_tolerance) == 16,
    "OrbProRootPolicy.value_tolerance must be at offset 16");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProRootPolicy, max_iterations) == 24,
    "OrbProRootPolicy.max_iterations must be at offset 24");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProRootPolicy, method) == 28,
    "OrbProRootPolicy.method must be at offset 28");

/**
 * Zero an entire OrbProRootPolicy, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_root_policy_init(OrbProRootPolicy* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/**
 * Set OrbProRootPolicy.method AND clear the 3 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_root_policy_set_method(OrbProRootPolicy* value, OrbProRootMethod v) {
    value->method = (uint8_t)v;
    ((unsigned char*)value)[29] = 0;
    ((unsigned char*)value)[30] = 0;
    ((unsigned char*)value)[31] = 0;
}

/* ========================================================================= */
/* OrbProEventInterval — 56 bytes, 8-byte aligned */
/* ========================================================================= */

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
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0     8  start_jd_day
 *        8     8  start_seconds
 *       16     8  stop_jd_day
 *       24     8  stop_seconds
 *       32     4  max_events
 *       36     4  max_evaluations
 *       40     4  occurrence
 *       44     4  component
 *       48     4  flags
 *       52     1  direction
 *       53     3  (alignment padding — MUST be written as zero)
 */
typedef struct {
    double start_jd_day; /**< Scan start: exactly-representable Julian day. */
    double start_seconds; /**< Scan start: seconds from `start_jd_day`. */
    double stop_jd_day; /**< Scan end: exactly-representable Julian day. May be EARLIER than the start — that is backward propagation. */
    double stop_seconds; /**< Scan end: seconds from `stop_jd_day`. */
    uint32_t max_events; /**< Stop after this many qualifying hits. 0 = unbounded (bounded only by the caller's hit buffer and by `max_evaluations`). */
    uint32_t max_evaluations; /**< Hard cap on g evaluations for the whole scan, so a pathological configuration terminates with `TRUNCATED` instead of running forever. 0 = unbounded. */
    uint32_t occurrence; /**< Report only the Nth qualifying crossing, 1-based. 0 = report all. This is GMAT's "which occurrence" on a stopping condition, and it counts crossings that pass the direction filter, not raw sign changes. */
    uint32_t component; /**< Restrict the scan to one component index. 0xFFFFFFFF = every component. */
    uint32_t flags; /**< EventFlags bitfield. Input flags are advisory; the runner ORs its own findings into each hit's flags. */
    int8_t direction; /**< Crossing-direction filter applied to every component. */
    uint8_t _reserved[3]; /**< Alignment padding at offset 53. MUST be 0. */
} OrbProEventInterval;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProEventInterval) == 56,
    "OrbProEventInterval must be 56 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventInterval, start_jd_day) == 0,
    "OrbProEventInterval.start_jd_day must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventInterval, start_seconds) == 8,
    "OrbProEventInterval.start_seconds must be at offset 8");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventInterval, stop_jd_day) == 16,
    "OrbProEventInterval.stop_jd_day must be at offset 16");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventInterval, stop_seconds) == 24,
    "OrbProEventInterval.stop_seconds must be at offset 24");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventInterval, max_events) == 32,
    "OrbProEventInterval.max_events must be at offset 32");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventInterval, max_evaluations) == 36,
    "OrbProEventInterval.max_evaluations must be at offset 36");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventInterval, occurrence) == 40,
    "OrbProEventInterval.occurrence must be at offset 40");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventInterval, component) == 44,
    "OrbProEventInterval.component must be at offset 44");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventInterval, flags) == 48,
    "OrbProEventInterval.flags must be at offset 48");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventInterval, direction) == 52,
    "OrbProEventInterval.direction must be at offset 52");

/**
 * Zero an entire OrbProEventInterval, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_event_interval_init(OrbProEventInterval* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/**
 * Set OrbProEventInterval.direction AND clear the 3 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_event_interval_set_direction(OrbProEventInterval* value, OrbProCrossingDirection v) {
    value->direction = (int8_t)v;
    ((unsigned char*)value)[53] = 0;
    ((unsigned char*)value)[54] = 0;
    ((unsigned char*)value)[55] = 0;
}

/* ========================================================================= */
/* OrbProEventHit — 48 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 * One refined crossing. 48 bytes, 8-byte aligned.
 *
 * A HIT IS A CROSSING, NOT AN INTERVAL. Apsides and node crossings are
 * instants; eclipse and contact are intervals. Emitting crossings and pairing
 * them by direction is total over both, whereas an interval-shaped hit puts a
 * sentinel in half the family. Pairing is deterministic and is specified in
 * docs/events-abi.md §Interval pairing; `EventScanSummary` carries the
 * endpoint signs that make the pairing total.
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0     8  epoch_jd_day
 *        8     8  epoch_seconds
 *       16     8  value
 *       24     4  component
 *       28     4  iterations
 *       32     4  evaluations
 *       36     4  flags
 *       40     1  direction
 *       41     1  status
 *       42     6  (alignment padding — MUST be written as zero)
 */
typedef struct {
    double epoch_jd_day; /**< Refined root: exactly-representable Julian day. */
    double epoch_seconds; /**< Refined root: seconds from `epoch_jd_day`. */
    double value; /**< g at the reported root, in the component's declared unit. This is the RESIDUAL and it is evidence: a "converged" root with a residual far outside `value_tolerance` is a defect the consumer can see. */
    uint32_t component; /**< Which component crossed. */
    uint32_t iterations; /**< Refinement iterations actually taken. */
    uint32_t evaluations; /**< g evaluations spent on this root, scan samples included. */
    uint32_t flags; /**< EventFlags bitfield. */
    int8_t direction; /**< The direction g crossed in. */
    uint8_t status; /**< How the refinement ended. */
    uint8_t _reserved[6]; /**< Alignment padding at offset 42. MUST be 0. */
} OrbProEventHit;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProEventHit) == 48,
    "OrbProEventHit must be 48 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventHit, epoch_jd_day) == 0,
    "OrbProEventHit.epoch_jd_day must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventHit, epoch_seconds) == 8,
    "OrbProEventHit.epoch_seconds must be at offset 8");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventHit, value) == 16,
    "OrbProEventHit.value must be at offset 16");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventHit, component) == 24,
    "OrbProEventHit.component must be at offset 24");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventHit, iterations) == 28,
    "OrbProEventHit.iterations must be at offset 28");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventHit, evaluations) == 32,
    "OrbProEventHit.evaluations must be at offset 32");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventHit, flags) == 36,
    "OrbProEventHit.flags must be at offset 36");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventHit, direction) == 40,
    "OrbProEventHit.direction must be at offset 40");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventHit, status) == 41,
    "OrbProEventHit.status must be at offset 41");

/**
 * Zero an entire OrbProEventHit, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_event_hit_init(OrbProEventHit* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/**
 * Set OrbProEventHit.direction AND clear the 0 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_event_hit_set_direction(OrbProEventHit* value, OrbProCrossingDirection v) {
    value->direction = (int8_t)v;
}

/**
 * Set OrbProEventHit.status AND clear the 6 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_event_hit_set_status(OrbProEventHit* value, OrbProRootStatus v) {
    value->status = (uint8_t)v;
    ((unsigned char*)value)[42] = 0;
    ((unsigned char*)value)[43] = 0;
    ((unsigned char*)value)[44] = 0;
    ((unsigned char*)value)[45] = 0;
    ((unsigned char*)value)[46] = 0;
    ((unsigned char*)value)[47] = 0;
}

/* ========================================================================= */
/* OrbProEventScanSummary — 32 bytes, 8-byte aligned */
/* ========================================================================= */

/**
 * What one component did across the whole interval. 32 bytes, 8-byte aligned.
 *
 * This is what makes a crossing list interpretable. Without the endpoint
 * signs, "no hits" is ambiguous between "never in eclipse" and "in eclipse the
 * entire time", and those are opposite answers.
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0     8  initial_value
 *        8     8  final_value
 *       16     4  component
 *       20     4  crossing_count
 *       24     4  evaluation_count
 *       28     1  initial_sign
 *       29     1  final_sign
 *       30     2  (alignment padding — MUST be written as zero)
 */
typedef struct {
    double initial_value; /**< g at the interval start, in the component's declared unit. */
    double final_value; /**< g at the interval end. */
    uint32_t component; /**< Which component this summarizes. */
    uint32_t crossing_count; /**< Qualifying crossings found for this component. */
    uint32_t evaluation_count; /**< g evaluations spent on this component. */
    int8_t initial_sign; /**< Sign of g at the interval start. */
    int8_t final_sign; /**< Sign of g at the interval end. */
    uint8_t _reserved[2]; /**< Alignment padding at offset 30. MUST be 0. */
} OrbProEventScanSummary;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProEventScanSummary) == 32,
    "OrbProEventScanSummary must be 32 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventScanSummary, initial_value) == 0,
    "OrbProEventScanSummary.initial_value must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventScanSummary, final_value) == 8,
    "OrbProEventScanSummary.final_value must be at offset 8");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventScanSummary, component) == 16,
    "OrbProEventScanSummary.component must be at offset 16");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventScanSummary, crossing_count) == 20,
    "OrbProEventScanSummary.crossing_count must be at offset 20");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventScanSummary, evaluation_count) == 24,
    "OrbProEventScanSummary.evaluation_count must be at offset 24");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventScanSummary, initial_sign) == 28,
    "OrbProEventScanSummary.initial_sign must be at offset 28");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventScanSummary, final_sign) == 29,
    "OrbProEventScanSummary.final_sign must be at offset 29");

/**
 * Zero an entire OrbProEventScanSummary, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_event_scan_summary_init(OrbProEventScanSummary* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/**
 * Set OrbProEventScanSummary.initial_sign AND clear the 0 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_event_scan_summary_set_initial_sign(OrbProEventScanSummary* value, OrbProSign v) {
    value->initial_sign = (int8_t)v;
}

/**
 * Set OrbProEventScanSummary.final_sign AND clear the 2 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_event_scan_summary_set_final_sign(OrbProEventScanSummary* value, OrbProSign v) {
    value->final_sign = (int8_t)v;
    ((unsigned char*)value)[30] = 0;
    ((unsigned char*)value)[31] = 0;
}

/* ========================================================================= */
/* OrbProEventStateRequest — 16 bytes, 4-byte aligned */
/* ========================================================================= */

/**
 * What the locator wants evaluated next — the guest-to-consumer half of the
 * pull protocol. 16 bytes, 4-byte aligned.
 *
 * The consumer reads this, propagates the requested epochs through whatever
 * module is wired to the propagator port, and returns the states through
 * `plugin_event_supply`. The consumer chooses NOTHING: not the epochs, not
 * the order, not when the scan ends.
 *
 * Binary layout (derived from the IDL, not hand-written):
 *
 *   Offset  Size  Field
 *   ------  ----  -----------------------------------------
 *        0     4  epoch_count
 *        4     4  object_count
 *        8     1  reference_frame
 *        9     3  (alignment padding — MUST be written as zero)
 *       12     4  flags
 */
typedef struct {
    uint32_t epoch_count; /**< How many epochs were written to the caller's epoch buffer. The buffer holds `2 * epoch_count` doubles: (jd_day, seconds) pairs, in scan order. */
    uint32_t object_count; /**< How many objects each epoch must be evaluated for. Every configured object is evaluated at EVERY requested epoch — that is what makes a multi-spacecraft (Formation) stop synchronized by construction rather than by the consumer remembering to keep the epochs aligned. */
    uint8_t reference_frame; /**< The frame the returned states must be expressed in. An `OrbProReferenceFrame` value; the consumer converts through the frames port if its propagator emits another frame, and a consumer that cannot must fail loudly rather than supply a differently-framed state. */
    uint8_t _reserved[3]; /**< Alignment padding at offset 9. MUST be 0. */
    uint32_t flags; /**< EventFlags bitfield describing the phase this request belongs to (a coarse scan batch versus a single refinement abscissa). */
} OrbProEventStateRequest;

ORBPRO_ABI_STATIC_ASSERT(sizeof(OrbProEventStateRequest) == 16,
    "OrbProEventStateRequest must be 16 bytes");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventStateRequest, epoch_count) == 0,
    "OrbProEventStateRequest.epoch_count must be at offset 0");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventStateRequest, object_count) == 4,
    "OrbProEventStateRequest.object_count must be at offset 4");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventStateRequest, reference_frame) == 8,
    "OrbProEventStateRequest.reference_frame must be at offset 8");
ORBPRO_ABI_STATIC_ASSERT(offsetof(OrbProEventStateRequest, flags) == 12,
    "OrbProEventStateRequest.flags must be at offset 12");

/**
 * Zero an entire OrbProEventStateRequest, INCLUDING its alignment padding.
 * Start every write here — see the note above about scratch buffers.
 */
static inline void orbpro_event_state_request_init(OrbProEventStateRequest* value) {
    for (size_t i = 0; i < sizeof(*value); ++i) {
        ((unsigned char*)value)[i] = 0;
    }
}

/**
 * Set OrbProEventStateRequest.reference_frame AND clear the 3 padding byte(s)
 * that follow it. USE THIS instead of assigning the field directly.
 */
static inline void orbpro_event_state_request_set_reference_frame(OrbProEventStateRequest* value, uint8_t v) {
    value->reference_frame = (uint8_t)v;
    ((unsigned char*)value)[9] = 0;
    ((unsigned char*)value)[10] = 0;
    ((unsigned char*)value)[11] = 0;
}

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* ORBPRO_EVENTS_ABI_H */
