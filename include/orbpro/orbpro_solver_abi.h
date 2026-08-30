/* ===========================================================================
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source of truth : schemas/orbpro/Solver.fbs
 * Contract        : pull/supply maneuver-family solver ABI
 *
 * A solver has no propagator import. plugin_solver_next yields a candidate;
 * the host evaluates it through the selected propagator/objective ports and
 * returns the answer through plugin_solver_supply.
 * ===========================================================================
 */

#ifndef ORBPRO_SOLVER_ABI_H
#define ORBPRO_SOLVER_ABI_H

#include <stddef.h>
#include <stdint.h>

#if defined(__cplusplus)
#define ORBPRO_SOLVER_STATIC_ASSERT(cond, msg) static_assert(cond, msg)
#else
#define ORBPRO_SOLVER_STATIC_ASSERT(cond, msg) _Static_assert(cond, msg)
#endif

#ifdef __cplusplus
extern "C" {
#endif

#define ORBPRO_SOLVER_MAX_DIMENSION 16u
#define ORBPRO_SOLVER_MAX_JACOBIAN_VALUES 256u

typedef enum {
  ORBPRO_SOLVER_NEWTON_RAPHSON = 0,
  ORBPRO_SOLVER_BROYDEN = 1,
  ORBPRO_SOLVER_MODIFIED_BROYDEN = 2,
  ORBPRO_SOLVER_SQP = 3,
} OrbProSolverAlgorithm;

typedef enum {
  ORBPRO_SOLVER_DIFFERENCE_FORWARD = 0,
  ORBPRO_SOLVER_DIFFERENCE_CENTRAL = 1,
  ORBPRO_SOLVER_DIFFERENCE_ANALYTIC_STM = 2,
} OrbProSolverDifferenceMode;

typedef enum {
  ORBPRO_SOLVER_STATUS_IDLE = 0,
  ORBPRO_SOLVER_STATUS_NEEDS_EVALUATION = 1,
  ORBPRO_SOLVER_STATUS_CONVERGED = 2,
  ORBPRO_SOLVER_STATUS_INVALID_PROBLEM = 3,
  ORBPRO_SOLVER_STATUS_EVALUATION_FAILED = 4,
  ORBPRO_SOLVER_STATUS_SINGULAR_JACOBIAN = 5,
  ORBPRO_SOLVER_STATUS_BUDGET_EXCEEDED = 6,
  ORBPRO_SOLVER_STATUS_STALLED = 7,
  ORBPRO_SOLVER_STATUS_INFEASIBLE = 8,
} OrbProSolverStatus;

typedef enum {
  ORBPRO_SOLVER_EVALUATE_VALUES = 0,
  ORBPRO_SOLVER_EVALUATE_VALUES_AND_JACOBIAN = 1,
} OrbProSolverEvaluationKind;

typedef struct {
  uint8_t algorithm;
  uint8_t difference_mode;
  uint16_t _reserved0;
  uint32_t maximum_iterations;
  uint32_t maximum_evaluations;
  uint32_t variable_count;
  uint32_t goal_count;
  uint32_t equality_constraint_count;
  uint32_t inequality_constraint_count;
  double residual_tolerance;
  double step_tolerance;
  double constraint_tolerance;
  double kkt_tolerance;
} OrbProSolverSettings;

ORBPRO_SOLVER_STATIC_ASSERT(sizeof(OrbProSolverSettings) == 64,
                            "OrbProSolverSettings must be 64 bytes");

typedef struct {
  uint64_t request_id;
  uint8_t kind;
  uint8_t _reserved0[3];
  uint32_t variable_count;
  double variables[ORBPRO_SOLVER_MAX_DIMENSION];
} OrbProSolverEvaluationRequest;

ORBPRO_SOLVER_STATIC_ASSERT(sizeof(OrbProSolverEvaluationRequest) == 144,
                            "OrbProSolverEvaluationRequest must be 144 bytes");

typedef struct {
  uint64_t request_id;
  uint8_t valid;
  uint8_t _reserved0[3];
  uint32_t goal_count;
  uint32_t constraint_count;
  uint32_t jacobian_rows;
  uint32_t jacobian_columns;
  double goals[ORBPRO_SOLVER_MAX_DIMENSION];
  double objective;
  double constraints[ORBPRO_SOLVER_MAX_DIMENSION];
  double jacobian[ORBPRO_SOLVER_MAX_JACOBIAN_VALUES];
} OrbProSolverEvaluation;

ORBPRO_SOLVER_STATIC_ASSERT(sizeof(OrbProSolverEvaluation) == 2344,
                            "OrbProSolverEvaluation must be 2344 bytes");

typedef struct {
  uint32_t iteration;
  uint32_t evaluation_count;
  uint32_t variable_count;
  uint32_t goal_count;
  double variables[ORBPRO_SOLVER_MAX_DIMENSION];
  double values[ORBPRO_SOLVER_MAX_DIMENSION];
  double residual_norm;
  double step_norm;
  double jacobian_condition;
  double maximum_constraint_violation;
  double kkt_residual;
  uint8_t accepted;
  uint8_t _reserved0[7];
} OrbProSolverIteration;

ORBPRO_SOLVER_STATIC_ASSERT(sizeof(OrbProSolverIteration) == 320,
                            "OrbProSolverIteration must be 320 bytes");

typedef struct {
  uint8_t status;
  uint8_t _reserved0[3];
  uint32_t iteration_count;
  uint32_t evaluation_count;
  uint32_t variable_count;
  uint32_t value_count;
  double variables[ORBPRO_SOLVER_MAX_DIMENSION];
  double values[ORBPRO_SOLVER_MAX_DIMENSION];
  double objective;
  double residual_norm;
  double maximum_constraint_violation;
  double kkt_residual;
} OrbProSolverResult;

ORBPRO_SOLVER_STATIC_ASSERT(sizeof(OrbProSolverResult) == 312,
                            "OrbProSolverResult must be 312 bytes");

static inline void orbpro_solver_zero(void* value, size_t size) {
  size_t index;
  for (index = 0; index < size; ++index) ((uint8_t*)value)[index] = 0;
}

int32_t plugin_solver_configure(const OrbProSolverSettings* settings,
                                const double* initial_variables,
                                const double* lower_bounds,
                                const double* upper_bounds,
                                const double* desired_values,
                                const double* perturbations);
int32_t plugin_solver_begin(void);
int32_t plugin_solver_next(OrbProSolverEvaluationRequest* request);
int32_t plugin_solver_supply(const OrbProSolverEvaluation* evaluation);
int32_t plugin_solver_result(OrbProSolverResult* result);
int32_t plugin_solver_iteration(uint32_t index, OrbProSolverIteration* result);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* ORBPRO_SOLVER_ABI_H */
