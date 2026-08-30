/*
 * event-runner-harness.c — the both-harness proof for the event-locator ABI.
 *
 * ONE source file, compiled twice: natively by clang, and to
 * wasm32-wasip1-threads. Both runs print the SAME bytes or the guardrail test
 * fails. The doubles are printed as raw IEEE-754 bit patterns, never through
 * a float format specifier, so the comparison is of the arithmetic and not of
 * two printf implementations.
 *
 * The event functions here are ANALYTIC and their roots are known in closed
 * form, so the test measures the refinement against mathematics rather than
 * against a stored number of unknown provenance:
 *
 *   g0(t) = z(t)  = R sin(i) sin(2 pi t / T)     roots at t = k T / 2
 *   g1(t) = x(t)  = R cos(2 pi t / T)            roots at t = T/4 + k T / 2
 *
 * The "propagator" is in the HARNESS, not in the locator — that is the point
 * of the pull protocol. The locator never learns where the states came from.
 *
 * Driven by: test/events-abi.test.js
 */

#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "orbpro/orbpro_event_runner.h"

#define HARNESS_R 7000000.0            /* metres */
#define HARNESS_INC_SIN 0.7833269096274834  /* sin(51.6 deg) */
#define HARNESS_INC_COS 0.6216099683704188  /* cos(51.6 deg) */
#define HARNESS_PERIOD 5828.516599999999     /* seconds */
#define HARNESS_TWO_PI 6.283185307179586

#define HARNESS_START_JD_DAY 2460522.0
#define HARNESS_START_SECONDS 43200.0

/* The scanned arc is offset by an eighth of a period so that NO analytic root
 * sits exactly on an interval endpoint. That is not tuning: an event exactly
 * at the scan START has no preceding sample to bracket it and is therefore not
 * a crossing, while one exactly at the scan END is. The asymmetry is real, it
 * is documented in docs/events-abi.md, and `EventScanSummary.initial_sign` is
 * how a consumer learns about it — but it makes a forward/backward comparison
 * measure the endpoint rule instead of the refinement, which is not what this
 * harness is for. */
#define HARNESS_ARC0 (HARNESS_PERIOD * 0.125)

static uint32_t harness_prop_calls = 0;

/* sin/cos by argument reduction + a fixed 13-term Taylor pair. The harness
 * refuses to link libm so that the native and wasm builds cannot differ by
 * one library's rounding of a transcendental — the arithmetic under test is
 * the RUNNER's, and a libm difference would masquerade as a runner
 * divergence. */
static double harness_sin(double x) {
    /* reduce to [-pi, pi] */
    const double two_pi = HARNESS_TWO_PI;
    double k = x / two_pi;
    double n = (double)(int64_t)(k >= 0.0 ? k + 0.5 : k - 0.5);
    x -= n * two_pi;
    double x2 = x * x;
    double term = x;
    double sum = x;
    for (int i = 1; i <= 12; ++i) {
        term *= -x2 / (double)((2 * i) * (2 * i + 1));
        sum += term;
    }
    return sum;
}

static double harness_cos(double x) {
    const double two_pi = HARNESS_TWO_PI;
    double k = x / two_pi;
    double n = (double)(int64_t)(k >= 0.0 ? k + 0.5 : k - 0.5);
    x -= n * two_pi;
    double x2 = x * x;
    double term = 1.0;
    double sum = 1.0;
    for (int i = 1; i <= 12; ++i) {
        term *= -x2 / (double)((2 * i - 1) * (2 * i));
        sum += term;
    }
    return sum;
}

/* The consumer's propagator port. Analytic circular orbit; `t` is seconds
 * from the interval start, which is what makes the roots exact. */
static void harness_propagate(double t, OrbProStateVector* out) {
    double theta = HARNESS_TWO_PI * t / HARNESS_PERIOD;
    double ct = harness_cos(theta);
    double st = harness_sin(theta);
    harness_prop_calls += 1u;
    orbpro_state_init(out);
    out->epoch = HARNESS_START_JD_DAY + (HARNESS_START_SECONDS + t) / 86400.0;
    out->position[0] = HARNESS_R * ct;
    out->position[1] = HARNESS_R * st * HARNESS_INC_COS;
    out->position[2] = HARNESS_R * st * HARNESS_INC_SIN;
    out->velocity[0] = -HARNESS_R * HARNESS_TWO_PI / HARNESS_PERIOD * st;
    out->velocity[1] = HARNESS_R * HARNESS_TWO_PI / HARNESS_PERIOD * ct * HARNESS_INC_COS;
    out->velocity[2] = HARNESS_R * HARNESS_TWO_PI / HARNESS_PERIOD * ct * HARNESS_INC_SIN;
    orbpro_state_set_reference_frame(out, ORBPRO_FRAME_J2000);
    out->flags = (uint32_t)ORBPRO_STATE_VALID;
}

/* The locator's ONE obligation. Two components, both analytic. */
static int32_t harness_eval(double epoch_jd_day, double epoch_seconds,
                            const OrbProStateVector* states, uint32_t object_count,
                            double* g_out, uint32_t component_count, void* user) {
    (void)epoch_jd_day;
    (void)epoch_seconds;
    (void)user;
    if (object_count < 1u || component_count < 2u) return ORBPRO_EVENT_E_BAD_INPUT;
    g_out[0] = states[0].position[2];
    g_out[1] = states[0].position[0];
    return 0;
}

static void print_u64(const char* label, uint64_t v) {
    printf("%s %016llx\n", label, (unsigned long long)v);
}

static void print_double(const char* label, double v) {
    uint64_t bits;
    memcpy(&bits, &v, sizeof(bits));
    print_u64(label, bits);
}

/* One complete scan, driven exactly the way a consumer drives it. */
static int run_scan(const char* tag, double scan_step, double start_offset,
                    double span_seconds, double epoch_tolerance, uint8_t method,
                    double state_epoch_resolution) {
    static OrbProEventRunner runner;
    static OrbProStateVector states[ORBPRO_EVENT_SCAN_BATCH * ORBPRO_EVENT_MAX_OBJECTS];
    static double epochs[2 * ORBPRO_EVENT_SCAN_BATCH];
    static OrbProEventHit hits[ORBPRO_EVENT_MAX_HITS];
    static OrbProEventScanSummary summaries[ORBPRO_EVENT_MAX_COMPONENTS];

    OrbProEventInterval interval;
    OrbProRootPolicy policy;
    OrbProEventStateRequest request;
    int32_t rc;

    harness_prop_calls = 0u;
    orbpro_event_runner_init(&runner, harness_eval, NULL);
    rc = orbpro_event_runner_configure(&runner, 2u, 1u,
                                       (uint8_t)ORBPRO_FRAME_J2000,
                                       state_epoch_resolution);
    if (rc < 0) { printf("%s configure %d\n", tag, (int)rc); return 1; }

    orbpro_event_interval_init(&interval);
    interval.start_jd_day = HARNESS_START_JD_DAY;
    interval.start_seconds = HARNESS_START_SECONDS + start_offset;
    interval.stop_jd_day = HARNESS_START_JD_DAY;
    interval.stop_seconds = HARNESS_START_SECONDS + start_offset + span_seconds;
    interval.max_events = 0u;
    interval.max_evaluations = 0u;
    interval.occurrence = 0u;
    interval.component = ORBPRO_EVENT_ALL_COMPONENTS;
    interval.flags = 0u;
    orbpro_event_interval_set_direction(&interval, ORBPRO_CROSSING_ANY);

    orbpro_root_policy_init(&policy);
    policy.scan_step_seconds = scan_step;
    policy.epoch_tolerance_seconds = epoch_tolerance;
    policy.value_tolerance = 0.0;
    policy.max_iterations = 100u;
    orbpro_root_policy_set_method(&policy, (OrbProRootMethod)method);

    rc = orbpro_event_runner_begin(&runner, &interval, &policy);
    if (rc < 0) { printf("%s begin %d\n", tag, (int)rc); return 1; }

    for (;;) {
        int32_t n = orbpro_event_runner_next(&runner, &request, epochs,
                                             ORBPRO_EVENT_SCAN_BATCH);
        if (n < 0) { printf("%s next %d\n", tag, (int)n); return 1; }
        if (n == 0) break;
        for (int32_t e = 0; e < n; ++e) {
            double t = (epochs[2 * e] - HARNESS_START_JD_DAY) * 86400.0 +
                       (epochs[2 * e + 1] - HARNESS_START_SECONDS);
            for (uint32_t o = 0; o < request.object_count; ++o) {
                harness_propagate(t, &states[(size_t)e * request.object_count + o]);
            }
        }
        rc = orbpro_event_runner_supply(&runner, states,
                                        (uint32_t)n * request.object_count);
        if (rc < 0) { printf("%s supply %d\n", tag, (int)rc); return 1; }
    }

    {
        int32_t hit_count = orbpro_event_runner_hits(&runner, hits, ORBPRO_EVENT_MAX_HITS);
        int32_t summary_count =
            orbpro_event_runner_summaries(&runner, summaries, ORBPRO_EVENT_MAX_COMPONENTS);
        if (hit_count < 0 || summary_count < 0) {
            printf("%s results %d %d\n", tag, (int)hit_count, (int)summary_count);
            return 1;
        }
        printf("%s hits %d\n", tag, (int)hit_count);
        printf("%s evals %u\n", tag, orbpro_event_runner_evaluation_count(&runner));
        printf("%s propcalls %u\n", tag, harness_prop_calls);
        print_double(" tol", orbpro_event_runner_effective_tolerance(&runner));
        for (int32_t i = 0; i < hit_count; ++i) {
            printf("%s hit %d comp %u dir %d status %u iter %u flags %u\n", tag, (int)i,
                   hits[i].component, (int)hits[i].direction, (unsigned)hits[i].status,
                   hits[i].iterations, hits[i].flags);
            print_double("  day", hits[i].epoch_jd_day);
            print_double("  sec", hits[i].epoch_seconds);
            print_double("  val", hits[i].value);
            /* The residual against the CLOSED FORM: t_root - k*T/2 (component
             * 0) or t_root - (T/4 + k*T/2) (component 1). Printed as bits so
             * the two lanes are compared exactly. */
            {
                double t = hits[i].epoch_seconds - HARNESS_START_SECONDS;
                double quarter = HARNESS_PERIOD * 0.25;
                double half = HARNESS_PERIOD * 0.5;
                double phase = hits[i].component == 0u ? t : t - quarter;
                double k = phase / half;
                double nearest = (double)(int64_t)(k >= 0.0 ? k + 0.5 : k - 0.5);
                print_double("  err", phase - nearest * half);
            }
        }
        for (int32_t i = 0; i < summary_count; ++i) {
            printf("%s sum %d comp %u cross %u evals %u isign %d fsign %d\n", tag, (int)i,
                   summaries[i].component, summaries[i].crossing_count,
                   summaries[i].evaluation_count, (int)summaries[i].initial_sign,
                   (int)summaries[i].final_sign);
            print_double("  ini", summaries[i].initial_value);
            print_double("  fin", summaries[i].final_value);
        }
    }
    return 0;
}

int main(void) {
    /* Sizes and offsets, so a layout drift shows up in the SAME artifact the
     * numbers come from rather than only in the generated header's asserts. */
    printf("sizeof RootPolicy %u\n", (unsigned)sizeof(OrbProRootPolicy));
    printf("sizeof EventInterval %u\n", (unsigned)sizeof(OrbProEventInterval));
    printf("sizeof EventHit %u\n", (unsigned)sizeof(OrbProEventHit));
    printf("sizeof EventScanSummary %u\n", (unsigned)sizeof(OrbProEventScanSummary));
    printf("sizeof EventStateRequest %u\n", (unsigned)sizeof(OrbProEventStateRequest));
    printf("sizeof StateVector %u\n", (unsigned)sizeof(OrbProStateVector));

    /* Step-independence: three scan steps over two orbits. Same roots, in the
     * same order. */
    if (run_scan("A", 60.0, HARNESS_ARC0, 2.0 * HARNESS_PERIOD, 1.0e-9, ORBPRO_ROOT_BRENT, 0.0)) return 1;
    if (run_scan("B", 137.0, HARNESS_ARC0, 2.0 * HARNESS_PERIOD, 1.0e-9, ORBPRO_ROOT_BRENT, 0.0)) return 1;
    if (run_scan("C", 300.0, HARNESS_ARC0, 2.0 * HARNESS_PERIOD, 1.0e-9, ORBPRO_ROOT_BRENT, 0.0)) return 1;

    /* Backward: the SAME ARC, walked the other way. Not a mode — a negative
     * span from the far end. The identical roots must come back. */
    if (run_scan("D", 60.0, HARNESS_ARC0 + 2.0 * HARNESS_PERIOD, -2.0 * HARNESS_PERIOD, 1.0e-9,
                 ORBPRO_ROOT_BRENT, 0.0)) return 1;

    /* Method agreement: three bracketing methods, one answer. */
    if (run_scan("E", 60.0, HARNESS_ARC0, 2.0 * HARNESS_PERIOD, 1.0e-9, ORBPRO_ROOT_BISECTION, 0.0)) return 1;
    if (run_scan("F", 60.0, HARNESS_ARC0, 2.0 * HARNESS_PERIOD, 1.0e-9, ORBPRO_ROOT_ILLINOIS, 0.0)) return 1;

    /* The epoch-resolution clamp: a source that resolves 4.02e-5 s cannot
     * deliver 1e-9 s, and the runner says so instead of pretending. */
    if (run_scan("G", 60.0, HARNESS_ARC0, HARNESS_PERIOD, 1.0e-9, ORBPRO_ROOT_BRENT, 4.0233e-5)) return 1;

    /* Refusals are typed, and each has its own code. */
    {
        static OrbProEventRunner r;
        OrbProEventInterval interval;
        OrbProRootPolicy policy;
        OrbProEventStateRequest request;
        double epochs[2];
        orbpro_event_runner_init(&r, harness_eval, NULL);
        printf("refuse not-started %d\n",
               (int)orbpro_event_runner_next(&r, &request, epochs, 1u));
        orbpro_event_interval_init(&interval);
        orbpro_root_policy_init(&policy);
        printf("refuse not-configured %d\n",
               (int)orbpro_event_runner_begin(&r, &interval, &policy));
        (void)orbpro_event_runner_configure(&r, 2u, 1u, (uint8_t)ORBPRO_FRAME_J2000, 0.0);
        printf("refuse zero-step %d\n",
               (int)orbpro_event_runner_begin(&r, &interval, &policy));
        policy.scan_step_seconds = 60.0;
        policy.epoch_tolerance_seconds = 1.0e-9;
        policy.max_iterations = 50u;
        interval.start_jd_day = HARNESS_START_JD_DAY;
        interval.start_seconds = HARNESS_START_SECONDS;
        interval.stop_jd_day = HARNESS_START_JD_DAY;
        interval.stop_seconds = HARNESS_START_SECONDS;
        printf("refuse zero-span %d\n",
               (int)orbpro_event_runner_begin(&r, &interval, &policy));
        interval.stop_seconds = HARNESS_START_SECONDS + 600.0;
        interval.component = 9u;
        printf("refuse unknown-component %d\n",
               (int)orbpro_event_runner_begin(&r, &interval, &policy));
        interval.component = ORBPRO_EVENT_ALL_COMPONENTS;
        (void)orbpro_event_runner_begin(&r, &interval, &policy);
        {
            static OrbProStateVector one;
            harness_propagate(0.0, &one);
            printf("refuse supply-order %d\n",
                   (int)orbpro_event_runner_supply(&r, &one, 1u));
            (void)orbpro_event_runner_next(&r, &request, epochs, 1u);
            printf("refuse supply-count %d\n",
                   (int)orbpro_event_runner_supply(&r, &one, 7u));
        }
    }

    return 0;
}
