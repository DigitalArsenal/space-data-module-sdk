import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserHostCapabilityError,
  createBrowserHost,
  createHostSyncDispatcher,
} from "../src/browser.js";
import { getWasmWallet } from "../src/utils/wasmCrypto.js";
import { base64ToBytes, bytesToBase64, bytesToHex } from "../src/utils/encoding.js";

// A valid 32-byte ed25519 seed used only to prove the generic
// capabilityAdapters.wallet_sign wiring still round-trips through
// keyslot.sign (see the "awaited filesystem, network, ipfs, and protocol
// adapters" test below). Deeper keyslot.sign / keyslot.unwrap coverage
// lives in the dedicated "browser host keyslot.*" tests further down.
const GENERIC_ADAPTER_ED25519_SEED = Uint8Array.from(
  { length: 32 },
  (_, index) => index + 1,
);

test("browser host exposes awaited filesystem, network, ipfs, and protocol adapters", async () => {
  const wasmWallet = await getWasmWallet();
  const host = createBrowserHost({
    capabilities: [
      "filesystem",
      "network",
      "ipfs",
      "wallet_sign",
      "protocol_handle",
      "protocol_dial",
    ],
    wasmWallet,
    capabilityAdapters: {
      filesystem: {
        resolvePath(path) {
          return `/virtual/${path}`;
        },
        async mkdir(path) {
          return { path: `/virtual/${path}` };
        },
        async writeFile(path, value, options) {
          return {
            path: `/virtual/${path}`,
            value,
            encoding: options?.encoding ?? null,
          };
        },
        async readFile(path, options) {
          return `browser:${path}:${options?.encoding ?? "bytes"}`;
        },
      },
      network: {
        async request(params) {
          return {
            transport: params.transport,
            url: params.url,
          };
        },
      },
      ipfs: {
        async add(params) {
          return {
            cid: "bafybrowseradd",
            bytes: params.base64?.length ?? 0,
          };
        },
        async cat(params) {
          return {
            cid: params.cid,
            base64: "YnJvd3Nlci1pcGZzLWNhdA==",
          };
        },
        async resolve(params) {
          return {
            path: params.path,
            cid: "bafybrowsercid",
          };
        },
      },
      wallet_sign: {
        // Internal-only key-slot resolver: consumed by the host's
        // keyslot.sign/keyslot.unwrap crypto oracle, never by a
        // guest-facing "keyslot.get" hostcall (that operation is removed).
        async get(params) {
          assert.equal(params.slotId, "browser-provider-signing");
          return GENERIC_ADAPTER_ED25519_SEED;
        },
      },
      protocol_handle: {
        async register(params) {
          return {
            registered: params.protocolId,
          };
        },
        async unregister(params) {
          return {
            unregistered: params.protocolId,
          };
        },
      },
      protocol_dial: {
        async dial(params) {
          return {
            dialed: params.protocolId,
            peerId: params.peerId,
          };
        },
        async request(params) {
          return {
            target: params.target,
            protocolId: params.protocolId,
            payloadBase64: params.payloadBase64 ?? null,
          };
        },
      },
    },
  });

  const mkdirResponse = await host.invoke("filesystem.mkdir", {
    path: "cache",
    recursive: true,
  });
  const writeResponse = await host.invoke("filesystem.writeFile", {
    path: "cache/demo.txt",
    value: "browser-data",
    encoding: "utf8",
  });

  const fileText = await host.invoke("filesystem.readFile", {
    path: "cache/demo.txt",
    encoding: "utf8",
  });
  const networkResponse = await host.invoke("network.request", {
    transport: "http",
    url: "https://example.test/runtime",
    responseType: "json",
  });
  const ipfsResponse = await host.invoke("ipfs.invoke", {
    operation: "resolve",
    path: "/ipns/browser-demo",
  });
  const ipfsAddResponse = await host.invoke("ipfs.add", {
    base64: "YnJvd3Nlci1hZGQ=",
  });
  const ipfsCatResponse = await host.invoke("ipfs.cat", {
    cid: "bafybrowsercid",
  });
  const registerResponse = await host.invoke("protocol_handle.register", {
    protocolId: "/space-data-network/module-delivery/1.0.0",
  });
  const unregisterResponse = await host.invoke("protocol_handle.unregister", {
    protocolId: "/space-data-network/module-delivery/1.0.0",
  });
  const dialResponse = await host.invoke("protocol_dial.dial", {
    protocolId: "/space-data-network/module-delivery/1.0.0",
    peerId: "12D3KooWBrowserPeer",
  });
  const requestResponse = await host.invoke("protocol.request", {
    target: "12D3KooWBrowserPeer",
    protocolId: "/space-data-network/module-delivery/1.0.0",
    payloadBase64: "YnJvd3Nlci1yZXF1ZXN0",
  });
  const keyslotResponse = await host.invoke("keyslot.sign", {
    slotId: "browser-provider-signing",
    payload: bytesToBase64(
      new TextEncoder().encode("generic-adapter-routing"),
    ),
  });

  assert.equal(host.hasCapability("http"), true);
  assert.equal(host.listOperations().includes("network.request"), true);
  assert.deepEqual(mkdirResponse, {
    path: "/virtual/cache",
  });
  assert.deepEqual(writeResponse, {
    path: "/virtual/cache/demo.txt",
    value: "browser-data",
    encoding: "utf8",
  });
  assert.equal(fileText, "browser:cache/demo.txt:utf8");
  assert.deepEqual(networkResponse, {
    transport: "http",
    url: "https://example.test/runtime",
  });
  assert.deepEqual(ipfsResponse, {
    path: "/ipns/browser-demo",
    cid: "bafybrowsercid",
  });
  assert.deepEqual(ipfsAddResponse, {
    cid: "bafybrowseradd",
    bytes: 16,
  });
  assert.deepEqual(ipfsCatResponse, {
    cid: "bafybrowsercid",
    base64: "YnJvd3Nlci1pcGZzLWNhdA==",
  });
  assert.deepEqual(registerResponse, {
    registered: "/space-data-network/module-delivery/1.0.0",
  });
  assert.deepEqual(unregisterResponse, {
    unregistered: "/space-data-network/module-delivery/1.0.0",
  });
  assert.deepEqual(dialResponse, {
    dialed: "/space-data-network/module-delivery/1.0.0",
    peerId: "12D3KooWBrowserPeer",
  });
  assert.deepEqual(requestResponse, {
    target: "12D3KooWBrowserPeer",
    protocolId: "/space-data-network/module-delivery/1.0.0",
    payloadBase64: "YnJvd3Nlci1yZXF1ZXN0",
  });
  // keyslot.sign returns only the output of a private-key operation
  // (a signature) — never the key material or the slotId echoed back.
  assert.deepEqual(Object.keys(keyslotResponse).sort(), ["algorithm", "signature"]);
  assert.equal(keyslotResponse.algorithm, "ed25519");
  assert.equal(base64ToBytes(keyslotResponse.signature).length, 64);
});

test("browser host exposes shared-wallet crypto operations through the sync hostcall dispatcher", async () => {
  const wallet = await getWasmWallet();
  const host = createBrowserHost({
    capabilities: [
      "crypto_hash",
      "crypto_sign",
      "crypto_verify",
      "crypto_encrypt",
      "crypto_decrypt",
      "crypto_key_agreement",
      "crypto_kdf",
    ],
    wasmWallet: wallet,
  });
  const dispatch = createHostSyncDispatcher(host);
  const message = new TextEncoder().encode("browser-host-crypto");
  const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const publicKey = dispatch("crypto.ed25519.publicKeyFromSeed", { seed });
  const signature = dispatch("crypto.ed25519.sign", { message, seed });

  assert.equal(host.hasCapability("crypto_sign"), true);
  assert.equal(host.listOperations().includes("crypto.hkdf"), true);
  assert.equal(publicKey.length, 32);
  assert.equal(signature.length, 64);
  assert.equal(
    dispatch("crypto.ed25519.verify", {
      message,
      signature,
      publicKey,
    }),
    true,
  );

  const firstPair = dispatch("crypto.x25519.generateKeypair");
  const secondPair = dispatch("crypto.x25519.generateKeypair");
  const firstSharedSecret = dispatch("crypto.x25519.sharedSecret", {
    privateKey: firstPair.privateKey,
    publicKey: secondPair.publicKey,
  });
  const secondSharedSecret = dispatch("crypto.x25519.sharedSecret", {
    privateKey: secondPair.privateKey,
    publicKey: firstPair.publicKey,
  });
  assert.deepEqual(
    dispatch("crypto.x25519.publicKey", {
      privateKey: firstPair.privateKey,
    }),
    firstPair.publicKey,
  );
  assert.deepEqual(firstSharedSecret, secondSharedSecret);

  const hkdfKey = dispatch("crypto.hkdf", {
    ikm: firstSharedSecret,
    salt: new Uint8Array(32),
    info: new TextEncoder().encode("browser-host"),
    length: 32,
  });
  assert.equal(hkdfKey.length, 32);

  const iv = Uint8Array.from({ length: 12 }, (_, index) => 255 - index);
  const encrypted = dispatch("crypto.aesGcmEncrypt", {
    key: hkdfKey,
    plaintext: message,
    iv,
  });
  assert.equal(encrypted.ciphertext.length > 0, true);
  assert.equal(encrypted.tag.length, 16);
  assert.deepEqual(
    dispatch("crypto.aesGcmDecrypt", {
      key: hkdfKey,
      ciphertext: encrypted.ciphertext,
      tag: encrypted.tag,
      iv,
    }),
    message,
  );
});

test("browser host verifies secp256k1 ECDSA-DER signatures through the sync hostcall dispatcher", async () => {
  const wallet = await getWasmWallet();
  const host = createBrowserHost({
    capabilities: ["crypto_hash", "crypto_sign", "crypto_verify"],
    wasmWallet: wallet,
  });
  const dispatch = createHostSyncDispatcher(host);
  const message = new TextEncoder().encode("epm-secp256k1-message");
  const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

  assert.equal(
    host.listOperations().includes("crypto.secp256k1.verify"),
    true,
  );

  const publicKey = dispatch("crypto.secp256k1.publicKeyFromPrivate", {
    privateKey,
  });
  assert.equal(publicKey.length, 33);

  const signature = dispatch("crypto.secp256k1.sign", {
    message,
    privateKey,
  });
  // DER ECDSA signatures are a SEQUENCE (0x30 tag).
  assert.equal(signature[0], 0x30);

  assert.deepEqual(
    dispatch("crypto.secp256k1.verify", {
      message,
      signature,
      publicKey,
    }),
    { result: true },
  );

  // Negative: a different message must not verify against the signature.
  const tamperedMessage = new TextEncoder().encode("epm-secp256k1-message!");
  assert.deepEqual(
    dispatch("crypto.secp256k1.verify", {
      message: tamperedMessage,
      signature,
      publicKey,
    }),
    { result: false },
  );
});

// --- B2-followup-2: keyslot.get raw-key-export removal ------------------
//
// B2 (Go, commit 3c6bd6e0) removed the "keyslot.get" hostcall, which
// returned a slot's raw private-key bytes to the guest, and replaced it
// with a host-side crypto oracle: keyslot.sign and keyslot.unwrap. Guests
// now only ever receive the *outputs* of private-key operations (a
// signature, or unwrapped plaintext) — never the key itself. These tests
// pin that contract for the Browser host, mirroring
// sdn-server/internal/modulert/caps/keyslot.go.

test("browser host keyslot.get is removed and fails closed", async () => {
  const wasmWallet = await getWasmWallet();
  const host = createBrowserHost({
    capabilities: ["wallet_sign"],
    wasmWallet,
    capabilityAdapters: {
      wallet_sign: {
        async get() {
          throw new Error(
            "wallet_sign.get must not be reachable via a guest-facing keyslot.get hostcall",
          );
        },
      },
    },
  });

  assert.equal(host.listOperations().includes("keyslot.get"), false);
  assert.equal(host.listOperations().includes("keyslot.sign"), true);
  assert.equal(host.listOperations().includes("keyslot.unwrap"), true);
  assert.equal(typeof host.keyslot.get, "undefined");

  await assert.rejects(
    () => host.invoke("keyslot.get", { slotId: "browser-signing" }),
    /Unknown browser host operation/,
  );
});

test("browser host keyslot.sign produces host-verifiable ed25519 and secp256k1 signatures without exposing key material", async () => {
  const wasmWallet = await getWasmWallet();
  const ed25519Seed = Uint8Array.from({ length: 32 }, (_, index) => index + 11);
  const secp256k1PrivateKey = Uint8Array.from(
    { length: 32 },
    (_, index) => index + 61,
  );

  const host = createBrowserHost({
    capabilities: ["wallet_sign", "crypto_sign", "crypto_verify"],
    wasmWallet,
    capabilityAdapters: {
      wallet_sign: {
        async get(params) {
          if (params.slotId === "browser-ed25519-slot") return ed25519Seed;
          if (params.slotId === "browser-secp256k1-slot") return secp256k1PrivateKey;
          throw new Error(`unknown key slot: ${params.slotId}`);
        },
      },
    },
  });

  const payload = new TextEncoder().encode("keyslot.sign integration payload");
  const payloadBase64 = bytesToBase64(payload);

  // ed25519 (default algorithm, matches Go's default).
  const ed25519PublicKeyBytes = host.crypto.ed25519.publicKeyFromSeed(ed25519Seed);
  const ed25519Response = await host.invoke("keyslot.sign", {
    slotId: "browser-ed25519-slot",
    payload: payloadBase64,
  });
  assert.deepEqual(Object.keys(ed25519Response).sort(), ["algorithm", "signature"]);
  assert.equal(ed25519Response.algorithm, "ed25519");
  const ed25519Signature = base64ToBytes(ed25519Response.signature);
  assert.equal(ed25519Signature.length, 64);
  assert.equal(
    host.crypto.ed25519.verify(payload, ed25519Signature, ed25519PublicKeyBytes),
    true,
  );

  // secp256k1 (explicit algorithm; response is DER, matching Go's
  // ecdsa.Sign(...).Serialize()).
  const secp256k1PublicKeyBytes = host.crypto.secp256k1.publicKeyFromPrivate(
    secp256k1PrivateKey,
  );
  const secp256k1Response = await host.invoke("keyslot.sign", {
    slotId: "browser-secp256k1-slot",
    payload: payloadBase64,
    algorithm: "secp256k1",
  });
  assert.deepEqual(Object.keys(secp256k1Response).sort(), ["algorithm", "signature"]);
  assert.equal(secp256k1Response.algorithm, "secp256k1");
  const secp256k1Signature = base64ToBytes(secp256k1Response.signature);
  assert.equal(secp256k1Signature[0], 0x30); // DER SEQUENCE tag.
  assert.deepEqual(
    host.crypto.secp256k1.verify(payload, secp256k1Signature, secp256k1PublicKeyBytes),
    { result: true },
  );

  // A tampered payload must not verify against either signature.
  const tamperedPayload = new TextEncoder().encode(
    "keyslot.sign integration payload!",
  );
  assert.equal(
    host.crypto.ed25519.verify(
      tamperedPayload,
      ed25519Signature,
      ed25519PublicKeyBytes,
    ),
    false,
  );
  assert.deepEqual(
    host.crypto.secp256k1.verify(
      tamperedPayload,
      secp256k1Signature,
      secp256k1PublicKeyBytes,
    ),
    { result: false },
  );

  // Response objects must never leak the raw key material, base64 or hex.
  const forbiddenEncodings = [
    bytesToBase64(ed25519Seed),
    bytesToHex(ed25519Seed),
    bytesToBase64(secp256k1PrivateKey),
    bytesToHex(secp256k1PrivateKey),
  ];
  for (const response of [ed25519Response, secp256k1Response]) {
    const serialized = JSON.stringify(response);
    for (const forbidden of forbiddenEncodings) {
      assert.equal(
        serialized.includes(forbidden),
        false,
        `response leaked key material: ${forbidden}`,
      );
    }
  }
});

test("browser host keyslot.sign rejects unsupported algorithms and requires wallet_sign", async () => {
  const wasmWallet = await getWasmWallet();
  const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 5);
  const host = createBrowserHost({
    capabilities: ["wallet_sign"],
    wasmWallet,
    capabilityAdapters: {
      wallet_sign: { async get() { return seed; } },
    },
  });

  await assert.rejects(
    () =>
      host.invoke("keyslot.sign", {
        slotId: "browser-ed25519-slot",
        payload: bytesToBase64(new TextEncoder().encode("x")),
        algorithm: "rsa",
      }),
    /unsupported keyslot\.sign algorithm/,
  );

  const noWalletSignHost = createBrowserHost({ capabilities: [], wasmWallet });
  await assert.rejects(
    () =>
      noWalletSignHost.invoke("keyslot.sign", {
        slotId: "browser-ed25519-slot",
        payload: bytesToBase64(new TextEncoder().encode("x")),
      }),
    BrowserHostCapabilityError,
  );
});

test("browser host keyslot.unwrap round-trips an ECIES-wrapped payload without exposing key material", async () => {
  const wasmWallet = await getWasmWallet();
  const x25519PrivateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 101);

  const host = createBrowserHost({
    capabilities: [
      "wallet_sign",
      "crypto_key_agreement",
      "crypto_kdf",
      "crypto_encrypt",
    ],
    wasmWallet,
    capabilityAdapters: {
      wallet_sign: {
        async get(params) {
          assert.equal(params.slotId, "browser-x25519-slot");
          return x25519PrivateKey;
        },
      },
    },
  });

  // Build a wrapped envelope the same way a sender would: ephemeral X25519
  // keypair, ECDH against the slot's public key, HKDF-SHA256 with the
  // keyslot.unwrap info string, AES-256-GCM. Wire format matches Go's
  // crypto/cipher.GCM convention: ciphertext field is (ciphertext || tag).
  const slotPublicKey = host.crypto.x25519PublicKey(x25519PrivateKey);
  const ephemeralKeyPair = host.crypto.generateX25519Keypair();
  const senderSharedSecret = host.crypto.x25519SharedSecret(
    ephemeralKeyPair.privateKey,
    slotPublicKey,
  );
  const aesKey = host.crypto.hkdf({
    ikm: senderSharedSecret,
    salt: new Uint8Array(),
    info: new TextEncoder().encode("sdn-server/keyslot.unwrap/v1"),
    length: 32,
  });
  const plaintext = new TextEncoder().encode(
    "keyslot.unwrap round-trip content key",
  );
  const nonce = Uint8Array.from({ length: 12 }, (_, index) => index + 1);
  const encrypted = host.crypto.aesGcmEncrypt({
    key: aesKey,
    plaintext,
    iv: nonce,
  });
  const wireCiphertext = new Uint8Array(
    encrypted.ciphertext.length + encrypted.tag.length,
  );
  wireCiphertext.set(encrypted.ciphertext, 0);
  wireCiphertext.set(encrypted.tag, encrypted.ciphertext.length);

  const unwrapResponse = await host.invoke("keyslot.unwrap", {
    slotId: "browser-x25519-slot",
    ephemeralPublicKey: bytesToBase64(ephemeralKeyPair.publicKey),
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(wireCiphertext),
  });

  assert.deepEqual(Object.keys(unwrapResponse), ["plaintext"]);
  assert.deepEqual(base64ToBytes(unwrapResponse.plaintext), plaintext);

  // A tampered ciphertext must fail to unwrap (AES-GCM authentication).
  const tamperedCiphertext = new Uint8Array(wireCiphertext);
  tamperedCiphertext[0] ^= 0xff;
  await assert.rejects(() =>
    host.invoke("keyslot.unwrap", {
      slotId: "browser-x25519-slot",
      ephemeralPublicKey: bytesToBase64(ephemeralKeyPair.publicKey),
      nonce: bytesToBase64(nonce),
      ciphertext: bytesToBase64(tamperedCiphertext),
    }),
  );

  // Response objects must never leak the raw key material, base64 or hex.
  const forbiddenEncodings = [
    bytesToBase64(x25519PrivateKey),
    bytesToHex(x25519PrivateKey),
  ];
  const serialized = JSON.stringify(unwrapResponse);
  for (const forbidden of forbiddenEncodings) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `response leaked key material: ${forbidden}`,
    );
  }
});
