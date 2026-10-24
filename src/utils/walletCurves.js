// hd-wallet-wasm names a curve by the number its C ABI takes (its `Curve` export). The SDK uses one
// of them, secp256k1, and says so on every call: hd-wallet-wasm 2.1.2 and later refuse a call that
// leaves the curve out (`curves.publicKeyFromPrivate(privateKey)` used to default to secp256k1);
// naming it works on every release the SDK has pinned.

/** hd-wallet-wasm `Curve.SECP256K1`. */
export const SECP256K1_CURVE = 0;
