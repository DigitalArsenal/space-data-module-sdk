import { toUint8Array } from "./encoding.js";

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
  return wallet.curves.publicKeyFromPrivate(toUint8Array(privateKey));
}

export async function secp256k1SignDigest(digest, privateKey) {
  const wallet = await getWasmWallet();
  return wallet.curves.secp256k1.sign(
    toUint8Array(digest),
    toUint8Array(privateKey),
  );
}

export async function secp256k1VerifyDigest(digest, signature, publicKey) {
  const wallet = await getWasmWallet();
  return wallet.curves.secp256k1.verify(
    toUint8Array(digest),
    toUint8Array(signature),
    toUint8Array(publicKey),
  );
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

function normalizeCtrIv(nonceStart) {
  const nonce = toUint8Array(nonceStart);
  if (nonce.length !== 12) {
    throw new Error("AES-256-CTR expects a 12-byte NONCE_START value.");
  }
  const iv = new Uint8Array(16);
  iv.set(nonce, 0);
  return iv;
}

async function getAesCtrApi() {
  const wallet = await getWasmWallet();
  const aesCtr = wallet?.aesCtr;
  if (
    !aesCtr ||
    typeof aesCtr.encrypt !== "function" ||
    typeof aesCtr.decrypt !== "function"
  ) {
    throw new Error(
      "hd-wallet-wasm aesCtr API is unavailable; cannot process ENC payloads.",
    );
  }
  return aesCtr;
}

export async function aesCtrEncrypt(key, plaintext, nonceStart) {
  const aesCtr = await getAesCtrApi();
  return aesCtr.encrypt(
    toUint8Array(key),
    toUint8Array(plaintext),
    normalizeCtrIv(nonceStart),
  );
}

export async function aesCtrDecrypt(key, ciphertext, nonceStart) {
  const aesCtr = await getAesCtrApi();
  return aesCtr.decrypt(
    toUint8Array(key),
    toUint8Array(ciphertext),
    normalizeCtrIv(nonceStart),
  );
}
