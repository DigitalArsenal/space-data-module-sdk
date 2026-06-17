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
