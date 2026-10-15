import { toUint8Array } from "./encoding.js";
import { secp256k1EcdsaVerifyDigest } from "./secp256k1Ecdsa.js";

// hd-wallet-wasm's Curve.SECP256K1. From 2.1.1 publicKeyFromPrivate requires
// the curve; before, an omitted curve silently meant secp256k1.
const SECP256K1_CURVE = 0;

let walletPromise = null;

export async function getWasmWallet() {
  if (!walletPromise) {
    walletPromise = (async () => {
      const module = await import("hd-wallet-wasm");
      const init = module.default ?? module.createHDWallet;
      return init();
    })();
  }

  return walletPromise;
}

export async function randomBytes(length) {
  const wallet = await getWasmWallet();
  return wallet.utils.getRandomBytes(length);
}

export async function sha256Bytes(value) {
  const wallet = await getWasmWallet();
  return wallet.utils.sha256(toUint8Array(value));
}

export async function sha512Bytes(value) {
  const wallet = await getWasmWallet();
  return wallet.utils.sha512(toUint8Array(value));
}

export async function hkdfBytes(ikm, salt, info, length) {
  const wallet = await getWasmWallet();
  return wallet.utils.hkdf(
    toUint8Array(ikm),
    toUint8Array(salt),
    toUint8Array(info),
    length,
  );
}

export async function x25519PublicKey(privateKey) {
  const wallet = await getWasmWallet();
  return wallet.curves.x25519.publicKey(toUint8Array(privateKey));
}

export async function x25519SharedSecret(privateKey, publicKey) {
  const wallet = await getWasmWallet();
  return wallet.curves.x25519.ecdh(
    toUint8Array(privateKey),
    toUint8Array(publicKey),
  );
}

export async function secp256k1PublicKey(privateKey) {
  const wallet = await getWasmWallet();
  return wallet.curves.publicKeyFromPrivate(toUint8Array(privateKey), SECP256K1_CURVE);
}

// secp256k1 ECDSA. The wallet's sign / verify hash their input with sha256 (a message API); signRecoverable and
// recover take a 32-byte hash as given. Message APIs (the Go node's crypto.secp256k1.sign / verify and keyslot.sign:
// ECDSA over sha256(message)) pass the message to secp256k1SignMessage / secp256k1VerifyMessage; digest APIs
// (signDigest / verifyDigest: ECDSA over the given digest) use secp256k1SignDigest / secp256k1VerifyDigest.

/** ECDSA over sha256(message): the 64-byte raw (r || s) signature. */
export async function secp256k1SignMessage(message, privateKey) {
  const wallet = await getWasmWallet();
  return wallet.curves.secp256k1.sign(toUint8Array(message), toUint8Array(privateKey));
}

/** Whether a 64-byte raw (r || s) signature is ECDSA over sha256(message) for the public key. */
export async function secp256k1VerifyMessage(message, signature, publicKey) {
  const wallet = await getWasmWallet();
  return wallet.curves.secp256k1.verify(toUint8Array(message), toUint8Array(signature), toUint8Array(publicKey));
}

function assertDigest(digest) {
  if (digest.length !== 32) {
    throw Object.assign(new RangeError(`secp256k1 digest must be 32 bytes, got ${digest.length}.`), { hostcallCode: "invalid-params" });
  }
  return digest;
}

/** ECDSA over the given 32-byte digest (not hashed again): the 64-byte raw (r || s) signature. */
export async function secp256k1SignDigest(digest, privateKey) {
  const wallet = await getWasmWallet();
  return wallet.curves.secp256k1.signRecoverable(assertDigest(toUint8Array(digest)), toUint8Array(privateKey)).signature;
}

/**
 * Whether a 64-byte raw (r || s) signature is a valid ECDSA signature over the given 32-byte digest for the public
 * key (33-byte compressed or 65-byte uncompressed). Real ECDSA verification with r, s in [1, n-1] and the key checked
 * on the curve, not recover-and-compare: the verdict no longer depends on the wallet's recovery export (security
 * audit SEC-002). High-S encodings verify, as with node:crypto and the Go node.
 */
export async function secp256k1VerifyDigest(digest, signature, publicKey) {
  const hash = assertDigest(toUint8Array(digest));
  return secp256k1EcdsaVerifyDigest(hash, toUint8Array(signature), toUint8Array(publicKey));
}

export async function ed25519PublicKey(seed) {
  const wallet = await getWasmWallet();
  return wallet.curves.ed25519.publicKeyFromSeed(toUint8Array(seed));
}

export async function ed25519Sign(message, seed) {
  const wallet = await getWasmWallet();
  return wallet.curves.ed25519.sign(
    toUint8Array(message),
    toUint8Array(seed),
  );
}

export async function ed25519Verify(message, signature, publicKey) {
  const wallet = await getWasmWallet();
  return wallet.curves.ed25519.verify(
    toUint8Array(message),
    toUint8Array(signature),
    toUint8Array(publicKey),
  );
}

export async function aesGcmEncrypt(key, plaintext, iv, aad = null) {
  const wallet = await getWasmWallet();
  return wallet.utils.aesGcm.encrypt(
    toUint8Array(key),
    toUint8Array(plaintext),
    toUint8Array(iv),
    aad ? toUint8Array(aad) : undefined,
  );
}

export async function aesGcmDecrypt(key, ciphertext, tag, iv, aad = null) {
  const wallet = await getWasmWallet();
  return wallet.utils.aesGcm.decrypt(
    toUint8Array(key),
    toUint8Array(ciphertext),
    toUint8Array(tag),
    toUint8Array(iv),
    aad ? toUint8Array(aad) : undefined,
  );
}
