/**
 * Independent two-body closed form, for the conformance runner's SELF-TEST.
 *
 * This is adjudication scaffolding, not product physics: the finding's Tier B
 * definition REQUIRES anchors computed independently of any module under test
 * (graph/findings/official-harness-shapes.md §5), and the self-test needs a
 * conformant baseline to prove that every planted defect is caught. Written
 * from the textbook relations; it mirrors — by construction, not by copy-check
 * — the reference corpus generator in space-data-network-modules
 * propagator/keplerian-reference/vectors/index.mjs. Where the two agree, they
 * agree because two-body motion has one answer.
 */

/// WGS-72 gravitational parameter, m^3/s^2 — the model OMM mean elements are
/// fitted under.
export const MU = 398600.8e9;

/// Earth rotation rate, rad/s (IAU 1982).
export const EARTH_ROTATION_RATE = 7.292115146706979e-5;

export const SECONDS_PER_DAY = 86400.0;
export const J2000_JD = 2451545.0;

/** `fail <=> |observed - expected| > abs + rel * |expected|` */
export function withinBand(observed, expected, band) {
  return Math.abs(observed - expected) <= band.abs + band.rel * Math.abs(expected);
}

/** Solve Kepler's equation independently of any module under test. */
export function solveKepler(meanAnomaly, eccentricity) {
  let M = meanAnomaly % (2 * Math.PI);
  if (M < 0) M += 2 * Math.PI;
  let E = eccentricity < 0.8 ? M : Math.PI;
  for (let i = 0; i < 200; i += 1) {
    const f = E - eccentricity * Math.sin(E) - M;
    const fp = 1 - eccentricity * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < 1e-15) return E;
  }
  throw new Error("reference Kepler solve did not converge");
}

/** Greenwich Mean Sidereal Time, radians (IAU 1982). */
export function gmstRadians(julianDate) {
  const tut1 = (julianDate - J2000_JD) / 36525.0;
  const seconds =
    67310.54841 +
    (876600.0 * 3600.0 + 8640184.812866) * tut1 +
    0.093104 * tut1 * tut1 -
    6.2e-6 * tut1 * tut1 * tut1;
  let gmst = (seconds * ((2 * Math.PI) / SECONDS_PER_DAY)) % (2 * Math.PI);
  if (gmst < 0) gmst += 2 * Math.PI;
  return gmst;
}

/**
 * Closed-form two-body propagation from mean elements to an ECEF state, in
 * METERS (the ABI's normative unit — the km/meters contradiction was W0.1).
 */
export function propagateTwoBody(elements, julianDate) {
  const {
    epochJd,
    meanMotionRevPerDay,
    eccentricity,
    inclinationDeg,
    raOfAscNodeDeg,
    argOfPericenterDeg,
    meanAnomalyDeg,
  } = elements;

  const deg = Math.PI / 180;
  const n = (meanMotionRevPerDay * 2 * Math.PI) / SECONDS_PER_DAY;
  const a = Math.cbrt(MU / (n * n));
  const dt = (julianDate - epochJd) * SECONDS_PER_DAY;
  const M = meanAnomalyDeg * deg + n * dt;
  const E = solveKepler(M, eccentricity);

  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const beta = Math.sqrt(1 - eccentricity * eccentricity);
  const xPqw = a * (cosE - eccentricity);
  const yPqw = a * beta * sinE;
  const eDot = n / (1 - eccentricity * cosE);
  const vxPqw = -a * sinE * eDot;
  const vyPqw = a * beta * cosE * eDot;

  const O = raOfAscNodeDeg * deg;
  const i = inclinationDeg * deg;
  const w = argOfPericenterDeg * deg;
  const cO = Math.cos(O);
  const sO = Math.sin(O);
  const ci = Math.cos(i);
  const si = Math.sin(i);
  const cw = Math.cos(w);
  const sw = Math.sin(w);

  const r11 = cO * cw - sO * sw * ci;
  const r12 = -cO * sw - sO * cw * ci;
  const r21 = sO * cw + cO * sw * ci;
  const r22 = -sO * sw + cO * cw * ci;
  const r31 = sw * si;
  const r32 = cw * si;

  const xI = r11 * xPqw + r12 * yPqw;
  const yI = r21 * xPqw + r22 * yPqw;
  const zI = r31 * xPqw + r32 * yPqw;
  const vxI = r11 * vxPqw + r12 * vyPqw;
  const vyI = r21 * vxPqw + r22 * vyPqw;
  const vzI = r31 * vxPqw + r32 * vyPqw;

  const theta = gmstRadians(julianDate);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);

  const x = ct * xI + st * yI;
  const y = -st * xI + ct * yI;
  const z = zI;
  const vxRot = ct * vxI + st * vyI;
  const vyRot = -st * vxI + ct * vyI;

  return {
    position: [x, y, z],
    velocity: [
      vxRot + EARTH_ROTATION_RATE * y,
      vyRot - EARTH_ROTATION_RATE * x,
      vzI,
    ],
    semiMajorAxis: a,
    meanMotion: n,
  };
}
