import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserHost, createHostSyncDispatcher } from "../src/browser.js";
import { getWasmWallet } from "../src/utils/wasmCrypto.js";

test("browser host exposes awaited filesystem, network, ipfs, and protocol adapters", async () => {
  const host = createBrowserHost({
    capabilities: [
      "filesystem",
      "network",
      "ipfs",
      "wallet_sign",
      "protocol_handle",
      "protocol_dial",
    ],
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
        async get(params) {
          return {
            slotId: params.slotId,
            base64: "YnJvd3Nlci1rZXktc2xvdA==",
          };
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
  const keyslotResponse = await host.invoke("keyslot.get", {
    slotId: "browser-provider-signing",
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
  assert.deepEqual(keyslotResponse, {
    slotId: "browser-provider-signing",
    base64: "YnJvd3Nlci1rZXktc2xvdA==",
  });
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
