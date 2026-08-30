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


export enum ReferenceFrame {
  TEME = 0,
  J2000 = 1,
  ICRF = 2,
  ECEF = 3,
  MCI = 4,
  MCMF = 5,
  MJ2000EC = 6,
  MOD = 7,
  TOD = 8,
  MOE = 9,
  TOE = 10,
  BODY_FIXED = 11,
  BODY_INERTIAL = 12,
  OBJECT_REFERENCED = 13,
  LOCAL_ALIGNED_CONSTRAINED = 14,
  EQUATOR = 15,
  GSE = 16,
  GSM = 17,
  TOPOCENTRIC = 18,
  BODY_SPIN_SUN = 19,
  SPICE_DEFINED = 20,
  MOD_FK5 = 21,
  TOD_FK5 = 22,
}

/**
 * StateVector.flags is a BITFIELD carrying any OR-combination of these, so it
 * is declared `uint` on the struct rather than typed to this enum. The C
 * enumerators are generated from here anyway — they are the contract.
 */
export enum StateFlags {
  NONE = 0,
  VALID = 1,
  IN_ECLIPSE = 2,
  DECAYED = 4,
  MANEUVERING = 8,
  EXTRAPOLATED = 16,
  HAS_COVARIANCE = 32,
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
 * Orbital state vector — 64 bytes, 8-byte aligned. Mirrors
 * `OrbProStateVector` in orbpro-integration/sdk/include/orbpro_propagator.h
 * byte for byte:
 *
 *   0   8   epoch (Julian date, float64)
 *   8   24  position (METERS)
 *   32  24  velocity (METERS/SECOND)
 *   56  1   reference_frame (ubyte)
 *   57  3   padding, MUST be zero
 *   60  4   flags (uint32)
 *
 * NORMATIVE UNITS: position METERS, velocity METERS/SECOND. There is no km
 * variant and no host-side conversion — the engine hands these straight to
 * Cesium Cartesian3, whose unit is metres, and both shipped propagators emit
 * meters. The C header used to declare `reference_frame` as a uint32 at
 * offset 56, wire-identical to this ubyte+padding only by little-endian
 * accident; it now declares ubyte + 3 reserved so the two agree by
 * construction.
 *
 * Ruling: graph/findings/official-harness-shapes.md §4.1 / §4.2
 */
export const ORBPRO_STATE_VECTOR: AbiStruct = {
  name: "StateVector",
  cName: "OrbProStateVector",
  size: 64,
  alignment: 8,
  offsets: {
    epoch: 0,
    position: 8,
    velocity: 32,
    reference_frame: 56,
    flags: 60,
  },
  fields: {
    epoch: { offset: 0, size: 8, length: 1, view: "Float64" },
    position: { offset: 8, size: 24, length: 3, view: "Float64" },
    velocity: { offset: 32, size: 24, length: 3, view: "Float64" },
    reference_frame: { offset: 56, size: 1, length: 1, view: "Uint8" },
    flags: { offset: 60, size: 4, length: 1, view: "Uint32" },
  },
} as const;

/**
 * Keplerian orbital elements — the OPTIONAL initialization input accepted by
 * `plugin_init_elements`. 64 bytes, 8-byte aligned.
 *
 * UNITS NOTE: `semi_major_axis` is KILOMETRES. That is deliberate and it is
 * NOT an inconsistency with StateVector's metres: this is an INPUT element
 * set, not an output state vector, and the two are different structs on
 * different sides of the call. Do not "unify" them — see the normative units
 * block in the generated C header.
 */
export const ORBPRO_ORBITAL_ELEMENTS: AbiStruct = {
  name: "OrbitalElements",
  cName: "OrbProOrbitalElements",
  size: 64,
  alignment: 8,
  offsets: {
    semi_major_axis: 0,
    eccentricity: 8,
    inclination: 16,
    raan: 24,
    arg_periapsis: 32,
    true_anomaly: 40,
    epoch: 48,
    reserved: 56,
  },
  fields: {
    semi_major_axis: { offset: 0, size: 8, length: 1, view: "Float64" },
    eccentricity: { offset: 8, size: 8, length: 1, view: "Float64" },
    inclination: { offset: 16, size: 8, length: 1, view: "Float64" },
    raan: { offset: 24, size: 8, length: 1, view: "Float64" },
    arg_periapsis: { offset: 32, size: 8, length: 1, view: "Float64" },
    true_anomaly: { offset: 40, size: 8, length: 1, view: "Float64" },
    epoch: { offset: 48, size: 8, length: 1, view: "Float64" },
    reserved: { offset: 56, size: 8, length: 1, view: "Float64" },
  },
} as const;

/**
 * Binary OMM record — the mean-element ingest struct. 88 bytes, 8-byte
 * aligned.
 *
 * !! THIS STRUCT IS ALSO AN ON-DISK FORMAT !!
 * -----------------------------------------------------------------------
 * It crosses the ABI (`plugin_init_omm`, `plugin_entity_add_omm`) AND is
 * persisted verbatim as a SQLite BLOB by the first-party SGP4 module
 * (`sgp4_plugin.cpp`, `sqlite3_bind_blob(..., &omm, sizeof(OrbProOMMRecord), ...)`).
 * Until W1.1 it carried NO size or offset lock anywhere in the stack, so the
 * layout that every stored blob depends on was held only by the field order
 * of one hand-written C struct in one module.
 *
 * The layout declared here is that layout, EXACTLY as it has been written to
 * disk — the four trailing padding bytes at offset 84 included. This is a
 * description of the wire as it already exists, not a redesign of it; the
 * generated locks now pin it. Migrating the format is explicitly out of
 * scope and would invalidate every stored blob.
 *
 * UNITS: angles in DEGREES, mean motion in REV/DAY, bstar in 1/earth-radii.
 * These are the SDS $OMM units, carried through unconverted.
 */
export const ORBPRO_OMM_RECORD: AbiStruct = {
  name: "OMMRecord",
  cName: "OrbProOMMRecord",
  size: 88,
  alignment: 8,
  offsets: {
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
  },
  fields: {
    epoch_jd: { offset: 0, size: 8, length: 1, view: "Float64" },
    mean_motion: { offset: 8, size: 8, length: 1, view: "Float64" },
    eccentricity: { offset: 16, size: 8, length: 1, view: "Float64" },
    inclination: { offset: 24, size: 8, length: 1, view: "Float64" },
    ra_of_asc_node: { offset: 32, size: 8, length: 1, view: "Float64" },
    arg_of_pericenter: { offset: 40, size: 8, length: 1, view: "Float64" },
    mean_anomaly: { offset: 48, size: 8, length: 1, view: "Float64" },
    bstar: { offset: 56, size: 8, length: 1, view: "Float64" },
    mean_motion_dot: { offset: 64, size: 8, length: 1, view: "Float64" },
    mean_motion_ddot: { offset: 72, size: 8, length: 1, view: "Float64" },
    norad_cat_id: { offset: 80, size: 4, length: 1, view: "Uint32" },
  },
} as const;

/** Every ABI struct, keyed by its IDL name. */
export const ORBPRO_PROPAGATOR_ABI: Readonly<Record<string, AbiStruct>> = {
  StateVector: ORBPRO_STATE_VECTOR,
  OrbitalElements: ORBPRO_ORBITAL_ELEMENTS,
  OMMRecord: ORBPRO_OMM_RECORD,
} as const;
