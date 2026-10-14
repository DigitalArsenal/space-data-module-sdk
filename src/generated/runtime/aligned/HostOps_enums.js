const deliverMode = Object.freeze({ "Inline": 0, "Ref": 1 });
const reconcileKind = Object.freeze({ "Duplicates": 0, "None": 1, "Current": 2 });
const sandboxWant = Object.freeze({ "Stream": 0, "Rows": 1, "Auto": 2 });
const cryptoAlgorithm = Object.freeze({ "Default": 0, "Ed25519": 1, "Secp256k1": 2, "Secp256k1Digest": 3, "X25519": 4, "Sha256": 5, "Sha512": 6, "Aes256Gcm": 7, "HkdfSha256": 8 });
export {
  cryptoAlgorithm,
  deliverMode,
  reconcileKind,
  sandboxWant
};
