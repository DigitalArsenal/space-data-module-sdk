import { toUint8Array } from "./encoding.js";
import { SECP256K1_CURVE } from "./walletCurves.js";

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

/** A 33-byte compressed secp256k1 public key (a 65-byte uncompressed 0x04 || X || Y is compressed). */
function compressedSecp256k1Key(publicKey) {
  if (publicKey.length === 33) return publicKey;
  if (publicKey.length === 65 && publicKey[0] === 0x04) {
    const out = new Uint8Array(33);
    out[0] = publicKey[64] & 1 ? 0x03 : 0x02;
    out.set(publicKey.subarray(1, 33), 1);
    return out;
  }
  throw new RangeError(`secp256k1 public key must be 33 or 65 bytes, got ${publicKey.length}.`);
}

/** ECDSA over the given 32-byte digest (not hashed again): the 64-byte raw (r || s) signature. */
export async function secp256k1SignDigest(digest, privateKey) {
  const wallet = await getWasmWallet();
  return wallet.curves.secp256k1.signRecoverable(assertDigest(toUint8Array(digest)), toUint8Array(privateKey)).signature;
}

/**
 * Whether a 64-byte raw (r || s) signature is ECDSA over the given 32-byte digest for the public key: the key
 * recovered with recovery id 0 or 1 equals it.
 */
export async function secp256k1VerifyDigest(digest, signature, publicKey) {
  const wallet = await getWasmWallet();
  const hash = assertDigest(toUint8Array(digest));
  const sig = toUint8Array(signature);
  const expected = compressedSecp256k1Key(toUint8Array(publicKey));
  if (sig.length !== 64) return false;
  for (const recoveryId of [0, 1]) {
    let recovered;
    try {
      recovered = toUint8Array(wallet.curves.secp256k1.recover(hash, sig, recoveryId));
    } catch {
      continue;
    }
    if (recovered.length === 33 && recovered.every((b, i) => b === expected[i])) return true;
  }
  return false;
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
