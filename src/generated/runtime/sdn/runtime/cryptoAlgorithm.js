var cryptoAlgorithm = /* @__PURE__ */ ((cryptoAlgorithm2) => {
  cryptoAlgorithm2[cryptoAlgorithm2["Ed25519"] = 0] = "Ed25519";
  cryptoAlgorithm2[cryptoAlgorithm2["Secp256k1"] = 1] = "Secp256k1";
  cryptoAlgorithm2[cryptoAlgorithm2["Secp256k1Digest"] = 2] = "Secp256k1Digest";
  cryptoAlgorithm2[cryptoAlgorithm2["X25519"] = 3] = "X25519";
  cryptoAlgorithm2[cryptoAlgorithm2["Sha256"] = 4] = "Sha256";
  cryptoAlgorithm2[cryptoAlgorithm2["Sha512"] = 5] = "Sha512";
  cryptoAlgorithm2[cryptoAlgorithm2["Aes256Gcm"] = 6] = "Aes256Gcm";
  cryptoAlgorithm2[cryptoAlgorithm2["HkdfSha256"] = 7] = "HkdfSha256";
  return cryptoAlgorithm2;
})(cryptoAlgorithm || {});
export {
  cryptoAlgorithm
};
