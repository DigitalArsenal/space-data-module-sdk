/**
 * secp256k1 ECDSA verification over a 32-byte digest, computed directly
 * (security audit 2026-10-15, SEC-002 defence in depth).
 *
 * The SDK used to verify a digest signature by asking the wallet to RECOVER a
 * public key for recovery ids 0 and 1 and comparing. That makes the verdict
 * depend on the recovery export's error reporting: hd-wallet-wasm before 2.1.1
 * returned positive error codes its wrapper read as success, so a forged
 * signature could "recover" a stale key. This is the textbook verification
 * instead, with every input range-checked:
 *
 *   - r and s in [1, n-1]. Both s and n-s verify by default, as in OpenSSL,
 *     Go and the node's verifyDigest: the two encodings are one signature by
 *     the same key, not a forgery. `{ lowS: true }` also refuses s > n/2 for
 *     callers that need a single encoding (BIP-62 style);
 *   - the public key is a valid point: 33-byte compressed or 65-byte
 *     uncompressed, coordinates below p, on the curve;
 *   - R = (z/s)G + (r/s)Q is not the point at infinity, and R.x mod n == r.
 *
 * Only public data is involved, so the arithmetic need not be constant-time.
 */

const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = N >> 1n;
const G = {
  x: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  y: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
};

function mod(a, m) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function powMod(base, exponent, m) {
  let result = 1n;
  let b = mod(base, m);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

function invMod(a, m) {
  // m is prime for both p and n
  return powMod(a, m - 2n, m);
}

function bytesToBigInt(bytes) {
  let out = 0n;
  for (const byte of bytes) out = (out << 8n) | BigInt(byte);
  return out;
}

// Jacobian coordinates; Z = 0 is the point at infinity.
const INFINITY = { X: 1n, Y: 1n, Z: 0n };

function toJacobian(point) {
  return { X: point.x, Y: point.y, Z: 1n };
}

function jDouble(p1) {
  if (p1.Z === 0n || p1.Y === 0n) return INFINITY;
  const Y2 = (p1.Y * p1.Y) % P;
  const S = (4n * p1.X * Y2) % P;
  const M = (3n * p1.X * p1.X) % P; // a = 0
  const X3 = mod(M * M - 2n * S, P);
  const Y3 = mod(M * (S - X3) - 8n * Y2 * Y2, P);
  const Z3 = (2n * p1.Y * p1.Z) % P;
  return { X: X3, Y: Y3, Z: Z3 };
}

function jAdd(p1, p2) {
  if (p1.Z === 0n) return p2;
  if (p2.Z === 0n) return p1;
  const Z1Z1 = (p1.Z * p1.Z) % P;
  const Z2Z2 = (p2.Z * p2.Z) % P;
  const U1 = (p1.X * Z2Z2) % P;
  const U2 = (p2.X * Z1Z1) % P;
  const S1 = (p1.Y * p2.Z * Z2Z2) % P;
  const S2 = (p2.Y * p1.Z * Z1Z1) % P;
  if (U1 === U2) {
    return S1 === S2 ? jDouble(p1) : INFINITY;
  }
  const H = mod(U2 - U1, P);
  const R = mod(S2 - S1, P);
  const H2 = (H * H) % P;
  const H3 = (H * H2) % P;
  const U1H2 = (U1 * H2) % P;
  const X3 = mod(R * R - H3 - 2n * U1H2, P);
  const Y3 = mod(R * (U1H2 - X3) - S1 * H3, P);
  const Z3 = (H * p1.Z * p2.Z) % P;
  return { X: X3, Y: Y3, Z: Z3 };
}

// u1*A + u2*B (Shamir's trick)
function doubleScalarMultiply(u1, A, u2, B) {
  const a = toJacobian(A);
  const b = toJacobian(B);
  const ab = jAdd(a, b);
  let acc = INFINITY;
  const bits = Math.max(u1.toString(2).length, u2.toString(2).length);
  for (let i = bits - 1; i >= 0; i -= 1) {
    acc = jDouble(acc);
    const bit1 = (u1 >> BigInt(i)) & 1n;
    const bit2 = (u2 >> BigInt(i)) & 1n;
    if (bit1 && bit2) acc = jAdd(acc, ab);
    else if (bit1) acc = jAdd(acc, a);
    else if (bit2) acc = jAdd(acc, b);
  }
  return acc;
}

function isOnCurve(x, y) {
  return mod(y * y - (x * x * x + 7n), P) === 0n;
}

/**
 * Decode a secp256k1 public key (33-byte compressed or 65-byte uncompressed)
 * to an affine point, or throw RangeError when it is not a valid point.
 */
export function decodeSecp256k1PublicKey(bytes) {
  const key = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  if (key.length === 65 && key[0] === 0x04) {
    const x = bytesToBigInt(key.subarray(1, 33));
    const y = bytesToBigInt(key.subarray(33, 65));
    if (x >= P || y >= P || !isOnCurve(x, y)) {
      throw new RangeError("secp256k1 public key is not a point on the curve.");
    }
    return { x, y };
  }
  if (key.length === 33 && (key[0] === 0x02 || key[0] === 0x03)) {
    const x = bytesToBigInt(key.subarray(1, 33));
    if (x >= P) throw new RangeError("secp256k1 public key x-coordinate is out of range.");
    const y2 = mod(x * x * x + 7n, P);
    let y = powMod(y2, (P + 1n) / 4n, P);
    if ((y * y) % P !== y2) {
      throw new RangeError("secp256k1 public key is not a point on the curve.");
    }
    if ((y & 1n) !== BigInt(key[0] & 1)) y = P - y;
    return { x, y };
  }
  throw new RangeError(
    `secp256k1 public key must be 33 (compressed) or 65 (uncompressed) bytes, got ${key.length}.`,
  );
}

/**
 * Whether `signature` (64 bytes, r || s) is a valid ECDSA signature over the
 * 32-byte `digest` (used as given, not hashed again) for `publicKey`.
 * Malformed signatures verify false; a malformed digest or public key throws.
 */
export function secp256k1EcdsaVerifyDigest(digest, signature, publicKey, options = {}) {
  const hash = digest instanceof Uint8Array ? digest : new Uint8Array(digest ?? []);
  if (hash.length !== 32) {
    throw new RangeError(`secp256k1 digest must be 32 bytes, got ${hash.length}.`);
  }
  const Q = decodeSecp256k1PublicKey(publicKey);
  const sig = signature instanceof Uint8Array ? signature : new Uint8Array(signature ?? []);
  if (sig.length !== 64) return false;
  const r = bytesToBigInt(sig.subarray(0, 32));
  const s = bytesToBigInt(sig.subarray(32, 64));
  if (r <= 0n || r >= N || s <= 0n || s >= N) return false;
  if (options.lowS === true && s > HALF_N) return false;
  const z = mod(bytesToBigInt(hash), N);
  const w = invMod(s, N);
  const u1 = (z * w) % N;
  const u2 = (r * w) % N;
  const R = doubleScalarMultiply(u1, G, u2, Q);
  if (R.Z === 0n) return false;
  const zInv = invMod(R.Z, P);
  const x = (R.X * zInv * zInv) % P;
  return mod(x, N) === r;
}
