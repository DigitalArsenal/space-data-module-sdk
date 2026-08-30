/* ===========================================================================
 * orbpro_event_runner.h — THE event runner. Hand-written, and deliberately so.
 *
 * orbpro_events_abi.h is GENERATED from schemas/orbpro/Events.fbs because it is
 * LAYOUT. This file is ALGORITHM, and there is exactly one copy of it: the
 * bracketing scan, the root refinement, the occurrence counting and the
 * interval bookkeeping that every locator shares.
 *
 * That is the whole point of the family. A locator supplies ONE function —
 * the vector of scalar event functions g_i(t) — and gets the rest. Eclipse,
 * station contact, sensor intrusion, apsides, node crossings and a
 * propagate-to-condition stop differ only in g. Adding the fifth locator does
 * not touch this file, and a locator that needed it to change would be
 * evidence the ABI is wrong, not that this file is incomplete.
 *
 * Contract  : docs/events-abi.md
 * Wire      : schemas/orbpro/Events.fbs -> include/orbpro/orbpro_events_abi.h
 * Ruling    : Janus AMEND 2026-08-30 (gmat-06-parameter-catalog-and-event-locators)
 *
 * ---------------------------------------------------------------------------
 * DETERMINISM IS STRUCTURAL, NOT ASPIRATIONAL
 * ---------------------------------------------------------------------------
 * Nothing here reads a clock, allocates, threads, or calls libm beyond fabs.
 * Every operation is IEEE-754 +, -, *, / and comparison, which WebAssembly
 * specifies exactly and which has no fused-multiply-add form in the MVP. Two
 * runs of the same locator on the same inputs therefore produce byte-identical
 * hits in the browser, in native WasmEdge and in Docker WasmEdge — not because
 * the lanes were tested into agreement, but because there is nothing in the
 * arithmetic for them to disagree about. Any divergence is a P1 SDK defect.
 *
 * The one thing this file CANNOT make deterministic is the state source. That
 * is why the epochs it asks for are exact functions of the interval and the
 * scan step, and why the consumer decides nothing.
 *
 * ---------------------------------------------------------------------------
 * TIME
 * ---------------------------------------------------------------------------
 * Internally the runner works in SECONDS FROM THE INTERVAL START, as a double.
 * A Julian date in one float64 resolves to 4.02e-5 s at a 2026 epoch; seconds
 * from a start epoch resolve to 1.5e-11 s over a week. Epochs cross the ABI as
 * (jd_day, seconds) pairs and are NEVER collapsed to a single JD inside this
 * file. `epoch_seconds` is allowed to exceed 86400 and is not normalized: the
 * fine coordinate stays fine, and two epochs from one scan stay directly
 * comparable.
 * ===========================================================================
 */

#ifndef ORBPRO_EVENT_RUNNER_H
#define ORBPRO_EVENT_RUNNER_H

#include <stdint.h>
#include <stddef.h>

#include "orbpro/orbpro_events_abi.h"
#include "orbpro/orbpro_propagator_abi.h"

#ifdef __cplusplus
extern "C" {
#endif

/* --------------------------------------------------------------------------
 * Fixed capacities. A locator may raise any of these by defining it BEFORE
 * including this header. They are compile-time because this runner never
 * allocates: a wasm guest that mallocs during a scan has a failure mode the
 * three runtimes do not share, and a fixed arena has none.
 * -------------------------------------------------------------------------- */

#ifndef ORBPRO_EVENT_MAX_COMPONENTS
#define ORBPRO_EVENT_MAX_COMPONENTS 32u
#endif

#ifndef ORBPRO_EVENT_MAX_OBJECTS
#define ORBPRO_EVENT_MAX_OBJECTS 16u
#endif

#ifndef ORBPRO_EVENT_MAX_HITS
#define ORBPRO_EVENT_MAX_HITS 512u
#endif

/** Coarse-scan epochs requested per round trip. Batching the SCAN is what lets
 *  a consumer drive it through `plugin_propagate_batch`; the REFINEMENT is
 *  inherently one abscissa at a time and always asks for exactly one. */
#ifndef ORBPRO_EVENT_SCAN_BATCH
#define ORBPRO_EVENT_SCAN_BATCH 64u
#endif

/** Brackets discovered in one scan batch, awaiting refinement. */
#ifndef ORBPRO_EVENT_MAX_PENDING
#define ORBPRO_EVENT_MAX_PENDING 64u
#endif

/** 2^-52. Written out rather than pulled from <float.h> so the header has no
 *  dependency a wasi-libc-less build could miss. */
#define ORBPRO_EVENT_DBL_EPSILON 2.220446049250313e-16

/** `EventInterval.component` value meaning "every component". */
#define ORBPRO_EVENT_ALL_COMPONENTS 0xFFFFFFFFu

/* --------------------------------------------------------------------------
 * The locator's one obligation.
 * -------------------------------------------------------------------------- */

/**
 * Evaluate EVERY configured component at one epoch, for the states of every
 * configured object at that epoch.
 *
 * Vector-valued on purpose: one state fetch feeds every component, so a
 * ten-component locator costs one propagation per epoch and not ten. It is
 * also what makes eclipse-with-three-occulting-bodies and
 * contact-with-eight-stations ordinary rather than special.
 *
 * MUST be a pure function of its arguments. A g that depends on call order,
 * on a cached previous epoch, or on anything outside these parameters breaks
 * bracketing: Brent evaluates epochs out of chronological order by design.
 *
 * Returns 0, or a negative `OrbProEventError`.
 */
typedef int32_t (*orbpro_event_eval_fn)(double epoch_jd_day,
                                        double epoch_seconds,
                                        const OrbProStateVector* states,
                                        uint32_t object_count,
                                        double* g_out,
                                        uint32_t component_count,
                                        void* user);

/* --------------------------------------------------------------------------
 * Internal state. Public only so it can live in a locator's static storage.
 * -------------------------------------------------------------------------- */

typedef enum {
    ORBPRO_EVENT_PHASE_IDLE = 0,
    ORBPRO_EVENT_PHASE_SCAN_WAIT = 1,
    ORBPRO_EVENT_PHASE_REFINE_WAIT = 2,
    ORBPRO_EVENT_PHASE_DONE = 3
} OrbProEventPhase;

/** One bracketed root, mid-refinement. */
typedef struct {
    double a, b, c;      /* abscissae, SECONDS from the interval start */
    double fa, fb, fc;   /* g at a, b, c */
    double d, e;         /* Brent step bookkeeping */
    double tol;          /* effective epoch tolerance, SECONDS */
    double vtol;         /* value tolerance, component units */
    uint32_t component;
    uint32_t iterations;
    uint32_t max_iterations;
    uint32_t evaluations;
    uint32_t flags;
    int32_t direction;   /* the crossing direction that qualified it */
    uint8_t method;
    uint8_t status;
    uint8_t awaiting;    /* 1 when fb for the current b is outstanding */
} OrbProEventBracket;

typedef struct {
    /* ---- wiring ---- */
    orbpro_event_eval_fn eval;
    void* user;

    /* ---- configuration ---- */
    uint32_t component_count;
    uint32_t object_count;
    uint8_t reference_frame;
    double state_epoch_resolution_seconds;
    int32_t comp_direction[ORBPRO_EVENT_MAX_COMPONENTS];
    uint32_t comp_occurrence[ORBPRO_EVENT_MAX_COMPONENTS];
    uint8_t comp_continuity[ORBPRO_EVENT_MAX_COMPONENTS];
    uint8_t comp_is_stop[ORBPRO_EVENT_MAX_COMPONENTS];

    /* ---- the scan ---- */
    OrbProEventInterval interval;
    OrbProRootPolicy policy;
    double effective_tolerance;   /* SECONDS, clamped to the source resolution */
    int clamped;                  /* 1 when the clamp actually bound */
    double span_seconds;          /* signed: negative means backward */
    double step_seconds;          /* signed */
    double total_steps;           /* how many whole steps fit in the span */
    uint32_t next_sample;         /* index of the next scan sample to request */
    uint32_t sample_count;        /* total scan samples, inclusive of both ends */
    int have_previous;            /* 1 once sample 0 has been evaluated */
    double prev_t;
    double prev_g[ORBPRO_EVENT_MAX_COMPONENTS];
    int8_t prev_sign[ORBPRO_EVENT_MAX_COMPONENTS];
    double first_g[ORBPRO_EVENT_MAX_COMPONENTS];
    int8_t first_sign[ORBPRO_EVENT_MAX_COMPONENTS];
    double last_g[ORBPRO_EVENT_MAX_COMPONENTS];
    int8_t last_sign[ORBPRO_EVENT_MAX_COMPONENTS];
    uint32_t crossings[ORBPRO_EVENT_MAX_COMPONENTS];
    uint32_t qualifying[ORBPRO_EVENT_MAX_COMPONENTS];
    uint32_t comp_evals[ORBPRO_EVENT_MAX_COMPONENTS];

    /* ---- round-trip bookkeeping ---- */
    OrbProEventPhase phase;
    uint32_t outstanding_epochs;  /* what the last `next` asked for */
    double outstanding_t[ORBPRO_EVENT_SCAN_BATCH];

    /* ---- brackets awaiting refinement, in scan order ---- */
    OrbProEventBracket pending[ORBPRO_EVENT_MAX_PENDING];
    uint32_t pending_head;
    uint32_t pending_tail;

    /* ---- results ---- */
    OrbProEventHit hits[ORBPRO_EVENT_MAX_HITS];
    uint32_t hit_count;
    uint32_t evaluation_count;
    uint32_t truncated;

    /* ---- scratch ---- */
    double g_scratch[ORBPRO_EVENT_MAX_COMPONENTS];
} OrbProEventRunner;

/* --------------------------------------------------------------------------
 * Small helpers. Static so a locator that includes this header in one
 * translation unit emits no duplicate symbols.
 * -------------------------------------------------------------------------- */

static inline double orbpro_event_fabs(double v) { return v < 0.0 ? -v : v; }

static inline int8_t orbpro_event_sign(double v) {
    if (v > 0.0) return (int8_t)1;
    if (v < 0.0) return (int8_t)-1;
    return (int8_t)0;
}

static inline double orbpro_event_signed_tol(double magnitude, double reference) {
    return reference >= 0.0 ? magnitude : -magnitude;
}

static inline void orbpro_event_zero(void* p, size_t n) {
    unsigned char* b = (unsigned char*)p;
    for (size_t i = 0; i < n; ++i) b[i] = 0;
}

/* --------------------------------------------------------------------------
 * Lifecycle.
 * -------------------------------------------------------------------------- */

/** Wire a locator's g to the runner. Call once, before configure. */
static inline void orbpro_event_runner_init(OrbProEventRunner* r,
                                            orbpro_event_eval_fn eval,
                                            void* user) {
    orbpro_event_zero(r, sizeof(*r));
    r->eval = eval;
    r->user = user;
    r->phase = ORBPRO_EVENT_PHASE_IDLE;
}

/**
 * Declare the shape of the scan: how many components, how many objects, which
 * frame the states must arrive in, and — critically — the state source's own
 * epoch resolution in seconds. See `EventLocatorConfig.stateEpochResolutionSeconds`;
 * 0 means "not declared", and the runner then trusts the tolerance it is given.
 */
static inline int32_t orbpro_event_runner_configure(OrbProEventRunner* r,
                                                    uint32_t component_count,
                                                    uint32_t object_count,
                                                    uint8_t reference_frame,
                                                    double state_epoch_resolution_seconds) {
    if (r->eval == NULL) return ORBPRO_EVENT_E_NOT_CONFIGURED;
    if (component_count == 0u || component_count > ORBPRO_EVENT_MAX_COMPONENTS)
        return ORBPRO_EVENT_E_BAD_INPUT;
    if (object_count == 0u || object_count > ORBPRO_EVENT_MAX_OBJECTS)
        return ORBPRO_EVENT_E_BAD_OBJECT_INDEX;
    if (state_epoch_resolution_seconds < 0.0 ||
        state_epoch_resolution_seconds != state_epoch_resolution_seconds)
        return ORBPRO_EVENT_E_BAD_INPUT;

    r->component_count = component_count;
    r->object_count = object_count;
    r->reference_frame = reference_frame;
    r->state_epoch_resolution_seconds = state_epoch_resolution_seconds;
    for (uint32_t i = 0; i < component_count; ++i) {
        r->comp_direction[i] = (int32_t)ORBPRO_CROSSING_ANY;
        r->comp_occurrence[i] = 0u;
        r->comp_continuity[i] = (uint8_t)ORBPRO_CONTINUITY_SMOOTH;
        r->comp_is_stop[i] = 0u;
    }
    r->phase = ORBPRO_EVENT_PHASE_IDLE;
    return 0;
}

/** Per-component filters, from the locator's parsed `EventLocatorConfig`. */
static inline int32_t orbpro_event_runner_set_component(OrbProEventRunner* r,
                                                        uint32_t component,
                                                        OrbProCrossingDirection direction,
                                                        uint32_t occurrence,
                                                        OrbProComponentContinuity continuity,
                                                        int is_stop_condition) {
    if (component >= r->component_count) return ORBPRO_EVENT_E_UNKNOWN_COMPONENT;
    r->comp_direction[component] = (int32_t)direction;
    r->comp_occurrence[component] = occurrence;
    r->comp_continuity[component] = (uint8_t)continuity;
    r->comp_is_stop[component] = is_stop_condition ? 1u : 0u;
    return 0;
}

/* --------------------------------------------------------------------------
 * The scan.
 * -------------------------------------------------------------------------- */

/**
 * Begin a scan. A zero `scan_step_seconds` is refused: a silent default step
 * is how a scan misses every event shorter than it, and the miss looks exactly
 * like "there was no event".
 */
static inline int32_t orbpro_event_runner_begin(OrbProEventRunner* r,
                                                const OrbProEventInterval* interval,
                                                const OrbProRootPolicy* policy) {
    if (interval == NULL || policy == NULL) return ORBPRO_EVENT_E_NULL_OUTPUT;
    if (r->component_count == 0u) return ORBPRO_EVENT_E_NOT_CONFIGURED;
    if (!(policy->scan_step_seconds > 0.0)) return ORBPRO_EVENT_E_BAD_INPUT;
    if (!(policy->epoch_tolerance_seconds > 0.0)) return ORBPRO_EVENT_E_BAD_INPUT;
    if (policy->max_iterations == 0u) return ORBPRO_EVENT_E_BAD_INPUT;
    if (policy->value_tolerance < 0.0 || policy->value_tolerance != policy->value_tolerance)
        return ORBPRO_EVENT_E_BAD_INPUT;
    if (interval->component != ORBPRO_EVENT_ALL_COMPONENTS &&
        interval->component >= r->component_count)
        return ORBPRO_EVENT_E_UNKNOWN_COMPONENT;

    r->interval = *interval;
    r->policy = *policy;
    r->hit_count = 0u;
    r->evaluation_count = 0u;
    r->truncated = 0u;
    r->pending_head = 0u;
    r->pending_tail = 0u;
    r->have_previous = 0;
    r->next_sample = 0u;
    r->outstanding_epochs = 0u;

    for (uint32_t i = 0; i < r->component_count; ++i) {
        r->crossings[i] = 0u;
        r->qualifying[i] = 0u;
        r->comp_evals[i] = 0u;
        r->prev_g[i] = 0.0;
        r->prev_sign[i] = 0;
        r->first_g[i] = 0.0;
        r->first_sign[i] = 0;
        r->last_g[i] = 0.0;
        r->last_sign[i] = 0;
    }

    /* Seconds from the interval start. The day difference is exact for
     * integral Julian days, so the span carries no JD quantization. */
    r->span_seconds = (interval->stop_jd_day - interval->start_jd_day) * 86400.0 +
                      (interval->stop_seconds - interval->start_seconds);
    if (r->span_seconds == 0.0) return ORBPRO_EVENT_E_BAD_INPUT;

    r->step_seconds = r->span_seconds < 0.0 ? -policy->scan_step_seconds
                                            : policy->scan_step_seconds;

    /* Sample count includes BOTH endpoints, and the last sample is clamped to
     * the interval end EXACTLY rather than overshooting it: a scan that runs
     * past its own interval reports events outside the window it was asked
     * about, which is worse than missing them. */
    {
        double whole = orbpro_event_fabs(r->span_seconds) / policy->scan_step_seconds;
        double floored = (double)(uint32_t)whole;
        uint32_t steps = (uint32_t)floored;
        if (whole - floored > 0.0) steps += 1u;
        if (steps == 0u) steps = 1u;
        r->total_steps = (double)steps;
        r->sample_count = steps + 1u;
    }

    r->effective_tolerance = policy->epoch_tolerance_seconds;
    r->clamped = 0;
    if (r->state_epoch_resolution_seconds > r->effective_tolerance) {
        r->effective_tolerance = r->state_epoch_resolution_seconds;
        r->clamped = 1;
    }

    r->phase = ORBPRO_EVENT_PHASE_SCAN_WAIT;
    return 0;
}

/** Sample k's offset in seconds from the interval start, endpoint-exact. */
static inline double orbpro_event_sample_time(const OrbProEventRunner* r, uint32_t k) {
    if (k >= r->sample_count - 1u) return r->span_seconds;
    return r->step_seconds * (double)k;
}

static inline void orbpro_event_emit_epoch(const OrbProEventRunner* r, double t, double* out) {
    out[0] = r->interval.start_jd_day;
    out[1] = r->interval.start_seconds + t;
}

static inline uint32_t orbpro_event_pending_count(const OrbProEventRunner* r) {
    return r->pending_tail - r->pending_head;
}

/* ---- the refinement state machine ------------------------------------------
 * Brent's method, suspended at every function evaluation. `advance` runs from
 * the top of the classical loop and returns 1 having written the next abscissa
 * into `br->b`, or 0 having finished with the root in `br->b`.
 * -------------------------------------------------------------------------- */

static inline int orbpro_event_bracket_advance(OrbProEventBracket* br) {
    for (;;) {
        if (br->method == (uint8_t)ORBPRO_ROOT_BISECTION ||
            br->method == (uint8_t)ORBPRO_ROOT_ILLINOIS) {
            /* a/c are the live bracket, b is the last probe. */
            if (br->iterations > 0u) {
                if ((br->fb > 0.0) == (br->fa > 0.0)) {
                    br->a = br->b;
                    br->fa = br->fb;
                    if (br->method == (uint8_t)ORBPRO_ROOT_ILLINOIS) br->fc *= 0.5;
                } else {
                    br->c = br->b;
                    br->fc = br->fb;
                    if (br->method == (uint8_t)ORBPRO_ROOT_ILLINOIS) br->fa *= 0.5;
                }
            }
            if (br->fb == 0.0 ||
                (br->vtol > 0.0 && br->iterations > 0u && orbpro_event_fabs(br->fb) <= br->vtol) ||
                orbpro_event_fabs(br->c - br->a) <= br->tol) {
                br->status = (uint8_t)ORBPRO_ROOT_STATUS_CONVERGED;
                if (br->iterations > 0u) return 0;
                br->b = 0.5 * (br->a + br->c);
                return 0;
            }
            if (br->iterations >= br->max_iterations) {
                br->status = (uint8_t)ORBPRO_ROOT_STATUS_MAX_ITERATIONS;
                br->b = 0.5 * (br->a + br->c);
                return 0;
            }
            br->iterations += 1u;
            if (br->method == (uint8_t)ORBPRO_ROOT_BISECTION ||
                br->fc == br->fa) {
                br->b = 0.5 * (br->a + br->c);
            } else {
                br->b = (br->a * br->fc - br->c * br->fa) / (br->fc - br->fa);
                /* Never leave the bracket, whatever the interpolation says. */
                double lo = br->a < br->c ? br->a : br->c;
                double hi = br->a < br->c ? br->c : br->a;
                if (!(br->b > lo && br->b < hi)) br->b = 0.5 * (br->a + br->c);
            }
            return 1;
        }

        /* Brent. */
        if ((br->fb > 0.0 && br->fc > 0.0) || (br->fb < 0.0 && br->fc < 0.0)) {
            br->c = br->a;
            br->fc = br->fa;
            br->e = br->b - br->a;
            br->d = br->e;
        }
        if (orbpro_event_fabs(br->fc) < orbpro_event_fabs(br->fb)) {
            br->a = br->b;
            br->b = br->c;
            br->c = br->a;
            br->fa = br->fb;
            br->fb = br->fc;
            br->fc = br->fa;
        }
        {
            double tol1 = 2.0 * ORBPRO_EVENT_DBL_EPSILON * orbpro_event_fabs(br->b) +
                          0.5 * br->tol;
            double xm = 0.5 * (br->c - br->b);
            if (orbpro_event_fabs(xm) <= tol1 || br->fb == 0.0 ||
                (br->vtol > 0.0 && orbpro_event_fabs(br->fb) <= br->vtol)) {
                br->status = (uint8_t)ORBPRO_ROOT_STATUS_CONVERGED;
                return 0;
            }
            if (br->iterations >= br->max_iterations) {
                br->status = (uint8_t)ORBPRO_ROOT_STATUS_MAX_ITERATIONS;
                return 0;
            }
            br->iterations += 1u;

            if (orbpro_event_fabs(br->e) >= tol1 &&
                orbpro_event_fabs(br->fa) > orbpro_event_fabs(br->fb)) {
                double s = br->fb / br->fa;
                double p, q, rr;
                if (br->a == br->c) {
                    p = 2.0 * xm * s;
                    q = 1.0 - s;
                } else {
                    q = br->fa / br->fc;
                    rr = br->fb / br->fc;
                    p = s * (2.0 * xm * q * (q - rr) - (br->b - br->a) * (rr - 1.0));
                    q = (q - 1.0) * (rr - 1.0) * (s - 1.0);
                }
                if (p > 0.0) q = -q;
                p = orbpro_event_fabs(p);
                {
                    double min1 = 3.0 * xm * q - orbpro_event_fabs(tol1 * q);
                    double min2 = orbpro_event_fabs(br->e * q);
                    double lim = min1 < min2 ? min1 : min2;
                    if (2.0 * p < lim) {
                        br->e = br->d;
                        br->d = p / q;
                    } else {
                        br->d = xm;
                        br->e = br->d;
                    }
                }
            } else {
                br->d = xm;
                br->e = br->d;
            }
            br->a = br->b;
            br->fa = br->fb;
            if (orbpro_event_fabs(br->d) > tol1) br->b += br->d;
            else br->b += orbpro_event_signed_tol(tol1, xm);
            return 1;
        }
    }
}

static inline void orbpro_event_bracket_begin(OrbProEventBracket* br,
                                              const OrbProEventRunner* r,
                                              uint32_t component,
                                              double t_lo, double g_lo,
                                              double t_hi, double g_hi,
                                              int32_t direction) {
    orbpro_event_zero(br, sizeof(*br));
    br->component = component;
    br->direction = direction;
    br->tol = r->effective_tolerance;
    br->vtol = r->policy.value_tolerance;
    br->max_iterations = r->policy.max_iterations;
    br->method = (uint8_t)r->policy.method;
    if (r->comp_continuity[component] == (uint8_t)ORBPRO_CONTINUITY_PIECEWISE &&
        br->method == (uint8_t)ORBPRO_ROOT_BRENT) {
        /* Declared non-smooth: interpolation is not admissible, so the runner
         * falls back to the method whose iteration count depends on the
         * bracket width alone. This is the locator's declaration doing work,
         * not a heuristic sniffing the numbers. */
        br->method = (uint8_t)ORBPRO_ROOT_BISECTION;
    }
    br->a = t_lo;
    br->fa = g_lo;
    br->b = t_hi;
    br->fb = g_hi;
    br->c = t_hi;
    br->fc = g_hi;
    br->status = (uint8_t)ORBPRO_ROOT_STATUS_CONVERGED;
    br->iterations = 0u;
    br->evaluations = 0u;
    br->awaiting = 0u;
}

static inline void orbpro_event_record_hit(OrbProEventRunner* r,
                                           uint32_t component,
                                           double t,
                                           double value,
                                           int32_t direction,
                                           uint8_t status,
                                           uint32_t iterations,
                                           uint32_t evaluations,
                                           uint32_t extra_flags) {
    r->crossings[component] += 1u;
    r->qualifying[component] += 1u;
    if (r->comp_occurrence[component] != 0u &&
        r->qualifying[component] != r->comp_occurrence[component]) {
        return;
    }
    if (r->interval.occurrence != 0u &&
        r->qualifying[component] != r->interval.occurrence) {
        return;
    }
    if (r->hit_count >= ORBPRO_EVENT_MAX_HITS) {
        r->truncated = 1u;
        return;
    }
    {
        /* INSERT IN SCAN ORDER, never in discovery order.
         *
         * Roots are only known after refinement, and refinement completes in
         * bracket-queue order — which is chronological PER COMPONENT but
         * interleaved ACROSS components. Reporting discovery order therefore
         * made the hit list a function of the scan step: with a 60 s step two
         * components' events fell in separate samples and came out in epoch
         * order, and with a 137 s step they fell in the same sample and came
         * out in component order. Measured: the same eight events, two of them
         * transposed by half an orbit. The step-independence invariant is
         * about the LIST, not only about each epoch, so the list is ordered
         * here.
         *
         * Scan order is increasing epoch forward and DECREASING epoch
         * backward — the order a consumer walks the arc in. */
        double key = r->interval.start_seconds + t;
        uint32_t index = r->hit_count;
        while (index > 0u) {
            double prior = r->hits[index - 1u].epoch_seconds;
            int later = r->span_seconds < 0.0 ? (prior < key) : (prior > key);
            if (!later) break;
            r->hits[index] = r->hits[index - 1u];
            index -= 1u;
        }
        OrbProEventHit* hit = &r->hits[index];
        orbpro_event_hit_init(hit);
        hit->epoch_jd_day = r->interval.start_jd_day;
        hit->epoch_seconds = r->interval.start_seconds + t;
        hit->value = value;
        hit->component = component;
        hit->iterations = iterations;
        hit->evaluations = evaluations;
        hit->flags = extra_flags;
        if (r->span_seconds < 0.0) hit->flags |= (uint32_t)ORBPRO_EVENT_BACKWARD;
        if (r->comp_is_stop[component]) hit->flags |= (uint32_t)ORBPRO_EVENT_STOP_CONDITION;
        if (r->first_sign[component] != 0 &&
            r->crossings[component] == 1u &&
            r->first_sign[component] == orbpro_event_sign(value)) {
            hit->flags |= (uint32_t)ORBPRO_EVENT_TANGENTIAL;
        }
        orbpro_event_hit_set_direction(hit, (OrbProCrossingDirection)direction);
        {
            uint8_t reported = status;
            if (reported == (uint8_t)ORBPRO_ROOT_STATUS_CONVERGED && r->clamped) {
                reported = (uint8_t)ORBPRO_ROOT_STATUS_EPOCH_RESOLUTION_LIMITED;
            }
            orbpro_event_hit_set_status(hit, (OrbProRootStatus)reported);
        }
        r->hit_count += 1u;
    }
    if (r->interval.max_events != 0u) {
        /* `max_events` means the first N IN SCAN ORDER. An event discovered
         * later but lying earlier displaces the last one, which is then
         * dropped and the result marked truncated — the alternative is a cap
         * that returns a different set depending on the scan step. */
        if (r->hit_count > r->interval.max_events) {
            r->hit_count = r->interval.max_events;
            r->truncated = 1u;
        }
        if (r->hit_count >= r->interval.max_events) {
            r->phase = ORBPRO_EVENT_PHASE_DONE;
        }
    }
}

/**
 * Ask for the next batch of epochs.
 *
 * Returns the number of epochs written (each as a (jd_day, seconds) PAIR, so
 * `2 * n` doubles), 0 when the scan is finished, or a negative
 * `OrbProEventError`.
 */
static inline int32_t orbpro_event_runner_next(OrbProEventRunner* r,
                                               OrbProEventStateRequest* request,
                                               double* epochs,
                                               uint32_t epoch_capacity) {
    if (request == NULL || epochs == NULL) return ORBPRO_EVENT_E_NULL_OUTPUT;
    if (r->phase == ORBPRO_EVENT_PHASE_IDLE) return ORBPRO_EVENT_E_NOT_STARTED;
    if (r->outstanding_epochs != 0u) return ORBPRO_EVENT_E_PROTOCOL_ORDER;

    orbpro_event_state_request_init(request);
    request->object_count = r->object_count;
    orbpro_event_state_request_set_reference_frame(
        request, (OrbProReferenceFrame)r->reference_frame);

    if (r->interval.max_evaluations != 0u &&
        r->evaluation_count >= r->interval.max_evaluations) {
        r->truncated = 1u;
        r->phase = ORBPRO_EVENT_PHASE_DONE;
    }

    if (r->phase == ORBPRO_EVENT_PHASE_DONE) {
        /* Brackets still queued when the scan stopped ARE dropped events, and
         * `max_events` is the usual reason. Saying so is the difference
         * between "these are the events" and "these are the first N events";
         * a consumer that cannot tell them apart will publish the second as
         * the first. Unscanned samples are the same story. */
        if (orbpro_event_pending_count(r) > 0u || r->next_sample < r->sample_count) {
            r->truncated = 1u;
        }
        request->epoch_count = 0u;
        return 0;
    }

    /* Refinement first: brackets found in the last scan batch are refined in
     * scan order BEFORE the scan advances, so occurrence counting is
     * chronological and a `max_events` stop lands on the right event. */
    if (orbpro_event_pending_count(r) > 0u) {
        OrbProEventBracket* br = &r->pending[r->pending_head % ORBPRO_EVENT_MAX_PENDING];
        if (epoch_capacity < 1u) return ORBPRO_EVENT_E_BUFFER_TOO_SMALL;
        r->phase = ORBPRO_EVENT_PHASE_REFINE_WAIT;
        r->outstanding_epochs = 1u;
        r->outstanding_t[0] = br->b;
        br->awaiting = 1u;
        request->epoch_count = 1u;
        request->flags = (uint32_t)ORBPRO_EVENT_NONE;
        orbpro_event_emit_epoch(r, br->b, &epochs[0]);
        return 1;
    }

    if (r->next_sample >= r->sample_count) {
        r->phase = ORBPRO_EVENT_PHASE_DONE;
        request->epoch_count = 0u;
        return 0;
    }

    {
        uint32_t remaining = r->sample_count - r->next_sample;
        uint32_t want = remaining < ORBPRO_EVENT_SCAN_BATCH ? remaining : ORBPRO_EVENT_SCAN_BATCH;
        if (want > epoch_capacity) want = epoch_capacity;
        if (want == 0u) return ORBPRO_EVENT_E_BUFFER_TOO_SMALL;
        for (uint32_t i = 0; i < want; ++i) {
            double t = orbpro_event_sample_time(r, r->next_sample + i);
            r->outstanding_t[i] = t;
            orbpro_event_emit_epoch(r, t, &epochs[2u * i]);
        }
        r->outstanding_epochs = want;
        r->phase = ORBPRO_EVENT_PHASE_SCAN_WAIT;
        request->epoch_count = want;
        request->flags = (uint32_t)ORBPRO_EVENT_NONE;
        return (int32_t)want;
    }
}

/**
 * Feed back the states for the epochs the last `next` asked for.
 *
 * `count` MUST be `epoch_count * object_count`, ordered EPOCH-MAJOR: state
 * `[e * object_count + o]` is object `o` at epoch `e`. A mismatch is
 * `SUPPLY_COUNT_MISMATCH`, never a partial evaluation — a locator that
 * silently accepted a short supply would report events computed from another
 * object's trajectory.
 */
static inline int32_t orbpro_event_runner_supply(OrbProEventRunner* r,
                                                 const OrbProStateVector* states,
                                                 uint32_t count) {
    if (states == NULL) return ORBPRO_EVENT_E_NULL_OUTPUT;
    if (r->outstanding_epochs == 0u) return ORBPRO_EVENT_E_PROTOCOL_ORDER;
    if (count != r->outstanding_epochs * r->object_count)
        return ORBPRO_EVENT_E_SUPPLY_COUNT_MISMATCH;

    uint32_t supplied = r->outstanding_epochs;
    r->outstanding_epochs = 0u;

    if (r->phase == ORBPRO_EVENT_PHASE_REFINE_WAIT) {
        OrbProEventBracket* br = &r->pending[r->pending_head % ORBPRO_EVENT_MAX_PENDING];
        int32_t rc = r->eval(r->interval.start_jd_day,
                             r->interval.start_seconds + r->outstanding_t[0],
                             states, r->object_count,
                             r->g_scratch, r->component_count, r->user);
        if (rc < 0) return rc;
        r->evaluation_count += 1u;
        r->comp_evals[br->component] += 1u;
        br->evaluations += 1u;
        br->fb = r->g_scratch[br->component];
        br->awaiting = 0u;
        if (orbpro_event_bracket_advance(br) == 0) {
            orbpro_event_record_hit(r, br->component, br->b, br->fb, br->direction,
                                    br->status, br->iterations, br->evaluations,
                                    br->flags);
            r->pending_head += 1u;
            if (r->pending_head == r->pending_tail) {
                r->pending_head = 0u;
                r->pending_tail = 0u;
            }
        }
        if (r->phase != ORBPRO_EVENT_PHASE_DONE) r->phase = ORBPRO_EVENT_PHASE_SCAN_WAIT;
        return 0;
    }

    for (uint32_t i = 0; i < supplied; ++i) {
        double t = r->outstanding_t[i];
        int32_t rc = r->eval(r->interval.start_jd_day,
                             r->interval.start_seconds + t,
                             &states[(size_t)i * r->object_count], r->object_count,
                             r->g_scratch, r->component_count, r->user);
        if (rc < 0) return rc;
        r->evaluation_count += 1u;

        for (uint32_t comp = 0; comp < r->component_count; ++comp) {
            if (r->interval.component != ORBPRO_EVENT_ALL_COMPONENTS &&
                r->interval.component != comp)
                continue;
            double g = r->g_scratch[comp];
            int8_t s = orbpro_event_sign(g);
            r->comp_evals[comp] += 1u;

            if (!r->have_previous) {
                r->first_g[comp] = g;
                r->first_sign[comp] = s;
            }
            r->last_g[comp] = g;
            r->last_sign[comp] = s;

            if (r->have_previous) {
                int8_t sp = r->prev_sign[comp];
                double gp = r->prev_g[comp];
                int crosses = (sp != 0 && s != 0 && sp != s) || (s == 0 && sp != 0);
                if (crosses) {
                    int32_t dir = (g > gp) ? 1 : -1;
                    int32_t want = r->comp_direction[comp];
                    int32_t iwant = (int32_t)r->interval.direction;
                    int qualifies = (want == 0 || want == dir) && (iwant == 0 || iwant == dir);
                    if (qualifies) {
                        if (r->comp_continuity[comp] == (uint8_t)ORBPRO_CONTINUITY_DISCRETE) {
                            /* A step, not a root. Report where the step was
                             * SEEN, to within the scan step, and say so. */
                            orbpro_event_record_hit(r, comp, t, g, dir,
                                                    (uint8_t)ORBPRO_ROOT_STATUS_DISCONTINUOUS,
                                                    0u, 1u, 0u);
                        } else if (s == 0) {
                            orbpro_event_record_hit(r, comp, t, g, dir,
                                                    (uint8_t)ORBPRO_ROOT_STATUS_CONVERGED,
                                                    0u, 1u, 0u);
                        } else if (orbpro_event_pending_count(r) >= ORBPRO_EVENT_MAX_PENDING) {
                            r->truncated = 1u;
                        } else {
                            OrbProEventBracket* br =
                                &r->pending[r->pending_tail % ORBPRO_EVENT_MAX_PENDING];
                            orbpro_event_bracket_begin(br, r, comp, r->prev_t, gp, t, g, dir);
                            /* Prime the state machine: the first advance
                             * consumes the bracket endpoints and produces the
                             * first abscissa to evaluate. */
                            if (orbpro_event_bracket_advance(br) == 0) {
                                orbpro_event_record_hit(r, comp, br->b, br->fb, dir,
                                                        br->status, br->iterations,
                                                        br->evaluations, br->flags);
                            } else {
                                r->pending_tail += 1u;
                            }
                        }
                    } else {
                        r->crossings[comp] += 1u;
                    }
                }
            }
            r->prev_g[comp] = g;
            r->prev_sign[comp] = s;
        }
        r->prev_t = t;
        r->have_previous = 1;
        if (r->phase == ORBPRO_EVENT_PHASE_DONE) break;
    }

    r->next_sample += supplied;
    if (r->phase != ORBPRO_EVENT_PHASE_DONE) {
        r->phase = (r->next_sample >= r->sample_count && orbpro_event_pending_count(r) == 0u)
                       ? ORBPRO_EVENT_PHASE_DONE
                       : ORBPRO_EVENT_PHASE_SCAN_WAIT;
    }
    return 0;
}

/* --------------------------------------------------------------------------
 * Results.
 * -------------------------------------------------------------------------- */

static inline int32_t orbpro_event_runner_hit_count(const OrbProEventRunner* r) {
    return (int32_t)r->hit_count;
}

static inline int32_t orbpro_event_runner_hits(const OrbProEventRunner* r,
                                               OrbProEventHit* out,
                                               uint32_t capacity) {
    if (out == NULL) return ORBPRO_EVENT_E_NULL_OUTPUT;
    if (capacity < r->hit_count) return ORBPRO_EVENT_E_BUFFER_TOO_SMALL;
    for (uint32_t i = 0; i < r->hit_count; ++i) out[i] = r->hits[i];
    return (int32_t)r->hit_count;
}

/**
 * One summary per component: the endpoint values and SIGNS, without which
 * "no hits" is ambiguous between "never in the interval" and "inside it the
 * whole time".
 */
static inline int32_t orbpro_event_runner_summaries(const OrbProEventRunner* r,
                                                    OrbProEventScanSummary* out,
                                                    uint32_t capacity) {
    if (out == NULL) return ORBPRO_EVENT_E_NULL_OUTPUT;
    if (capacity < r->component_count) return ORBPRO_EVENT_E_BUFFER_TOO_SMALL;
    for (uint32_t i = 0; i < r->component_count; ++i) {
        OrbProEventScanSummary* s = &out[i];
        orbpro_event_scan_summary_init(s);
        s->initial_value = r->first_g[i];
        s->final_value = r->last_g[i];
        s->component = i;
        s->crossing_count = r->crossings[i];
        s->evaluation_count = r->comp_evals[i];
        orbpro_event_scan_summary_set_initial_sign(s, (OrbProSign)r->first_sign[i]);
        orbpro_event_scan_summary_set_final_sign(s, (OrbProSign)r->last_sign[i]);
    }
    return (int32_t)r->component_count;
}

/** Did the scan stop early? `TRUNCATED` is a real answer, not an error. */
static inline int orbpro_event_runner_truncated(const OrbProEventRunner* r) {
    return r->truncated != 0u;
}

/** The tolerance actually used, after the state-source resolution clamp. */
static inline double orbpro_event_runner_effective_tolerance(const OrbProEventRunner* r) {
    return r->effective_tolerance;
}

static inline uint32_t orbpro_event_runner_evaluation_count(const OrbProEventRunner* r) {
    return r->evaluation_count;
}

static inline void orbpro_event_runner_reset(OrbProEventRunner* r) {
    orbpro_event_eval_fn eval = r->eval;
    void* user = r->user;
    orbpro_event_runner_init(r, eval, user);
}

/* --------------------------------------------------------------------------
 * The export set, for free.
 *
 * A locator writes plugin_event_describe, plugin_event_configure and
 * plugin_event_eval. Everything else is THIS macro. That is the structural
 * form of "adding a new locator requires no change to the runner": there is
 * no runner to change, only a g to write.
 * -------------------------------------------------------------------------- */

#if defined(__cplusplus)
#define ORBPRO_EVENT_EXPORT(name) extern "C" __attribute__((export_name(name)))
#else
#define ORBPRO_EVENT_EXPORT(name) __attribute__((export_name(name)))
#endif

#define ORBPRO_EVENT_RUNNER_EXPORTS(RUNNER)                                              \
    ORBPRO_EVENT_EXPORT("plugin_event_begin")                                            \
    int32_t plugin_event_begin(const OrbProEventInterval* interval,                      \
                               const OrbProRootPolicy* policy) {                         \
        return orbpro_event_runner_begin(&(RUNNER), interval, policy);                   \
    }                                                                                    \
    ORBPRO_EVENT_EXPORT("plugin_event_next")                                             \
    int32_t plugin_event_next(OrbProEventStateRequest* request, double* epochs,           \
                              uint32_t epoch_capacity) {                                 \
        return orbpro_event_runner_next(&(RUNNER), request, epochs, epoch_capacity);     \
    }                                                                                    \
    ORBPRO_EVENT_EXPORT("plugin_event_supply")                                           \
    int32_t plugin_event_supply(const OrbProStateVector* states, uint32_t count) {        \
        return orbpro_event_runner_supply(&(RUNNER), states, count);                     \
    }                                                                                    \
    ORBPRO_EVENT_EXPORT("plugin_event_hit_count")                                        \
    int32_t plugin_event_hit_count(void) {                                               \
        return orbpro_event_runner_hit_count(&(RUNNER));                                 \
    }                                                                                    \
    ORBPRO_EVENT_EXPORT("plugin_event_hits")                                             \
    int32_t plugin_event_hits(OrbProEventHit* out, uint32_t capacity) {                   \
        return orbpro_event_runner_hits(&(RUNNER), out, capacity);                       \
    }                                                                                    \
    ORBPRO_EVENT_EXPORT("plugin_event_summaries")                                        \
    int32_t plugin_event_summaries(OrbProEventScanSummary* out, uint32_t capacity) {      \
        return orbpro_event_runner_summaries(&(RUNNER), out, capacity);                  \
    }                                                                                    \
    ORBPRO_EVENT_EXPORT("plugin_event_destroy")                                          \
    void plugin_event_destroy(void) { orbpro_event_runner_reset(&(RUNNER)); }

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* ORBPRO_EVENT_RUNNER_H */
