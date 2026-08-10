// ===========================================================================
// GENERATED FILE — DO NOT EDIT.
//
// Source of truth : schemas/orbpro/Propagator.fbs
// Generator       : scripts/generate-propagator-abi.mjs
// Drift gate      : scripts/check-propagator-abi.mjs  (runs in `npm test`)
// Contract        : docs/propagator-abi.md
//
// These constants exist so that no JavaScript consumer ever hard-codes a byte
// offset again. Read a state vector with ORBPRO_STATE_VECTOR.offsets.position,
// never with the literal 8.
// ===========================================================================

export const ReferenceFrame = Object.freeze({
  TEME: 0,
  J2000: 1,
  ICRF: 2,
  ECEF: 3,
  MCI: 4,
  MCMF: 5,
});

export const StateFlags = Object.freeze({
  NONE: 0,
  VALID: 1,
  IN_ECLIPSE: 2,
  DECAYED: 4,
  MANEUVERING: 8,
  EXTRAPOLATED: 16,
  HAS_COVARIANCE: 32,
});

export const ORBPRO_STATE_VECTOR = Object.freeze({
  name: "StateVector",
  cName: "OrbProStateVector",
  size: 64,
  alignment: 8,
  offsets: Object.freeze({
    epoch: 0,
    position: 8,
    velocity: 32,
    reference_frame: 56,
    flags: 60,
  }),
  fields: Object.freeze({
    epoch: Object.freeze({ offset: 0, size: 8, length: 1, view: "Float64" }),
    position: Object.freeze({ offset: 8, size: 24, length: 3, view: "Float64" }),
    velocity: Object.freeze({ offset: 32, size: 24, length: 3, view: "Float64" }),
    reference_frame: Object.freeze({ offset: 56, size: 1, length: 1, view: "Uint8" }),
    flags: Object.freeze({ offset: 60, size: 4, length: 1, view: "Uint32" }),
  }),
});

export const ORBPRO_ORBITAL_ELEMENTS = Object.freeze({
  name: "OrbitalElements",
  cName: "OrbProOrbitalElements",
  size: 64,
  alignment: 8,
  offsets: Object.freeze({
    semi_major_axis: 0,
    eccentricity: 8,
    inclination: 16,
    raan: 24,
    arg_periapsis: 32,
    true_anomaly: 40,
    epoch: 48,
    reserved: 56,
  }),
  fields: Object.freeze({
    semi_major_axis: Object.freeze({ offset: 0, size: 8, length: 1, view: "Float64" }),
    eccentricity: Object.freeze({ offset: 8, size: 8, length: 1, view: "Float64" }),
    inclination: Object.freeze({ offset: 16, size: 8, length: 1, view: "Float64" }),
    raan: Object.freeze({ offset: 24, size: 8, length: 1, view: "Float64" }),
    arg_periapsis: Object.freeze({ offset: 32, size: 8, length: 1, view: "Float64" }),
    true_anomaly: Object.freeze({ offset: 40, size: 8, length: 1, view: "Float64" }),
    epoch: Object.freeze({ offset: 48, size: 8, length: 1, view: "Float64" }),
    reserved: Object.freeze({ offset: 56, size: 8, length: 1, view: "Float64" }),
  }),
});

export const ORBPRO_OMM_RECORD = Object.freeze({
  name: "OMMRecord",
  cName: "OrbProOMMRecord",
  size: 88,
  alignment: 8,
  offsets: Object.freeze({
    epoch_jd: 0,
    mean_motion: 8,
    eccentricity: 16,
    inclination: 24,
    ra_of_asc_node: 32,
    arg_of_pericenter: 40,
    mean_anomaly: 48,
    bstar: 56,
    mean_motion_dot: 64,
    mean_motion_ddot: 72,
    norad_cat_id: 80,
  }),
  fields: Object.freeze({
    epoch_jd: Object.freeze({ offset: 0, size: 8, length: 1, view: "Float64" }),
    mean_motion: Object.freeze({ offset: 8, size: 8, length: 1, view: "Float64" }),
    eccentricity: Object.freeze({ offset: 16, size: 8, length: 1, view: "Float64" }),
    inclination: Object.freeze({ offset: 24, size: 8, length: 1, view: "Float64" }),
    ra_of_asc_node: Object.freeze({ offset: 32, size: 8, length: 1, view: "Float64" }),
    arg_of_pericenter: Object.freeze({ offset: 40, size: 8, length: 1, view: "Float64" }),
    mean_anomaly: Object.freeze({ offset: 48, size: 8, length: 1, view: "Float64" }),
    bstar: Object.freeze({ offset: 56, size: 8, length: 1, view: "Float64" }),
    mean_motion_dot: Object.freeze({ offset: 64, size: 8, length: 1, view: "Float64" }),
    mean_motion_ddot: Object.freeze({ offset: 72, size: 8, length: 1, view: "Float64" }),
    norad_cat_id: Object.freeze({ offset: 80, size: 4, length: 1, view: "Uint32" }),
  }),
});

export const ORBPRO_PROPAGATOR_ABI = Object.freeze({
  StateVector: ORBPRO_STATE_VECTOR,
  OrbitalElements: ORBPRO_ORBITAL_ELEMENTS,
  OMMRecord: ORBPRO_OMM_RECORD,
});
