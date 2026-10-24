// E2E (module-sdk-hd-wallet-advisory-20261024): the SDK runs on a hd-wallet-wasm that the two
// published advisories do not cover, and the paths that use it still round-trip known vectors in the
// browser host and under native WasmEdge.
//
//   GHSA-gvwv-r86g-4q35 (fixed in hd-wallet-wasm 2.1.1): P-384 signatures leak the private key; a
//     secp256k1 recovery that fails hands back the key the previous verification recovered, so a forged
//     signature verifies; Ed25519 verification accepts S + L; a zero private key signs heap bytes; a
//     NUL ends a mnemonic.
//   GHSA-wp9p-ffrh-ccwm (fixed in 2.1.2): lying-length inputs read or overwrite the WASM heap;
//     Ethereum and Bitcoin parsing and output defects.
//
// 1. pin: package.json pins hd-wallet-wasm exactly, that is what is installed, and it is 2.1.2 or later;
//    every other copy of it the lockfile resolves is listed (the SDK never calls flatc-wasm's HD APIs);
// 2. known vectors through the SDK's wallet paths (src/utils/wasmCrypto.js) and the browser host's crypto
//    operations, run in Node AND in headless Chromium, with identical results: RFC 8032 Ed25519 vectors,
//    a secp256k1 ECDSA vector (the message API and the digest API agree), the BIP-39 "abandon ... about"
//    seed - and OpenSSL, an independent verifier, accepts the signatures;
// 3. the advisories' effects are gone, on the SDK's own functions: a signature that recovers to no key
//    does not verify right after a genuine verification, an Ed25519 signature with S + L does not
//    verify, a zero private key does not sign, a NUL-terminated mnemonic does not validate;
// 4. native WasmEdge and the browser: a module signed with an RFC 8032 key (signModuleArtifact) loads
//    through loadModule under a signature policy and answers on WasmEdge 0.16.4; a tampered copy, an
//    untrusted signer and an unsigned copy are refused before WasmEdge starts; the same signed bytes
//    verify in Chromium (verifyModuleArtifact) and a tampered copy does not.
// usage: node scripts/e2e/hd-wallet-advisory.mjs   (browser lane: run it through headless-run)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";
import { chromium } from "playwright-core";

import { compileModuleFromSource } from "../../src/compiler/compileModule.js";
import { ModuleSignatureError, signModuleArtifact, verifyModuleArtifact } from "../../src/bundle/signing.js";
import { createBrowserHost } from "../../src/host/browserHost.js";
import { loadModule } from "../../src/host/isomorphicLoader.js";
import { rawSignatureToDer } from "../../src/utils/ecdsaDer.js";
import * as walletPaths from "../../src/utils/wasmCrypto.js";
import { resolveWasmEdgeBinary } from "../../src/testing/parityLanes.js";
import { assertWasmEdgeVersionMatchesPin, loadWasmEdgePin } from "../../src/testing/parityHarness.js";
import { resolveHeadlessShell } from "../../src/testing/headlessShell.js";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// The first release neither advisory covers.
const FIRST_PATCHED = "2.1.2";

function atLeast(version, minimum) {
  const a = version.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

// --- the battery: one function, run in Node and in Chromium, whose results must match --------------------
// Self-contained (no closure): it is serialized into the page. `sdk` carries the SDK functions under test.
async function battery(sdk) {
  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const unhex = (text) => Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
  const out = {};

  // RFC 8032, section 7.1, tests 1 and 2.
  const rfc = [
    { seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", message: "",
      publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
      signature: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b" },
    { seed: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", message: "72",
      publicKey: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
      signature: "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00" },
  ];
  out.ed25519 = [];
  for (const vector of rfc) {
    const message = unhex(vector.message);
    const publicKey = await sdk.ed25519PublicKey(unhex(vector.seed));
    const signature = await sdk.ed25519Sign(message, unhex(vector.seed));
    const tampered = Uint8Array.from(signature);
    tampered[0] ^= 1;
    out.ed25519.push({
      publicKey: hex(publicKey),
      signature: hex(signature),
      verifies: await sdk.ed25519Verify(message, signature, publicKey),
      tamperedVerifies: await sdk.ed25519Verify(message, tampered, publicKey),
    });
  }
  // GHSA-gvwv: Ed25519 verification accepted a second encoding of every signature (S + L).
  const L = (1n << 252n) + 27742317777372353535851937790883648493n;
  const original = unhex(rfc[0].signature);
  let S = 0n;
  for (let i = 31; i >= 0; i -= 1) S = (S << 8n) | BigInt(original[32 + i]);
  const malleable = Uint8Array.from(original);
  const bumped = S + L;
  for (let i = 0; i < 32; i += 1) malleable[32 + i] = Number((bumped >> BigInt(8 * i)) & 0xffn);
  out.ed25519MalleableAccepted = await sdk.ed25519Verify(unhex(rfc[0].message), malleable, unhex(rfc[0].publicKey));

  // secp256k1: private key 1, message "Satoshi Nakamoto" - ECDSA over sha256(message), RFC 6979 nonce.
  const privateKey = new Uint8Array(32);
  privateKey[31] = 1;
  const message = new TextEncoder().encode("Satoshi Nakamoto");
  const publicKey = await sdk.secp256k1PublicKey(privateKey);
  const signature = await sdk.secp256k1SignMessage(message, privateKey);
  const digest = await sdk.sha256Bytes(message);
  const digestSignature = await sdk.secp256k1SignDigest(digest, privateKey);
  const flipped = Uint8Array.from(signature);
  flipped[10] ^= 1;
  out.secp256k1 = {
    publicKey: hex(publicKey),
    signature: hex(signature),
    digestSignature: hex(digestSignature),
    messageVerifies: await sdk.secp256k1VerifyMessage(message, signature, publicKey),
    digestVerifies: await sdk.secp256k1VerifyDigest(digest, signature, publicKey),
    tamperedMessageVerifies: await sdk.secp256k1VerifyMessage(message, flipped, publicKey),
    tamperedDigestVerifies: await sdk.secp256k1VerifyDigest(digest, flipped, publicKey),
  };
  // GHSA-gvwv: a recovery that failed returned the key the previous verification recovered. r = 0 recovers
  // to no key; right after a genuine verification by that key it must still not verify.
  const forged = new Uint8Array(64);
  forged[63] = 1;
  await sdk.secp256k1VerifyDigest(digest, signature, publicKey);
  out.forgedRecoveryAccepted = await sdk.secp256k1VerifyDigest(digest, forged, publicKey);
  // GHSA-gvwv: a zero private key signed with heap bytes.
  try {
    await sdk.secp256k1SignDigest(digest, new Uint8Array(32));
    out.zeroKeySigned = true;
  } catch {
    out.zeroKeySigned = false;
  }

  // The browser host's crypto operations on the same vectors (DER signatures, as the Go node's).
  const host = sdk.createBrowserHost({
    capabilities: ["crypto_hash", "crypto_sign", "crypto_verify"],
    wasmWallet: await sdk.getWasmWallet(),
  });
  const hostPublicKey = await host.crypto.secp256k1.publicKeyFromPrivate(privateKey);
  const hostDer = await host.crypto.secp256k1.sign(message, privateKey);
  const hostEdPublic = await host.crypto.ed25519.publicKeyFromSeed(unhex(rfc[0].seed));
  const hostEdSignature = await host.crypto.ed25519.sign(unhex(rfc[0].message), unhex(rfc[0].seed));
  out.browserHost = {
    secp256k1PublicKey: hex(hostPublicKey),
    secp256k1Der: hex(hostDer),
    secp256k1DerIsRawSignatureAsDer: hex(hostDer) === hex(sdk.rawSignatureToDer(signature)),
    secp256k1Verifies: (await host.crypto.secp256k1.verify(message, hostDer, hostPublicKey)).result,
    ed25519PublicKey: hex(hostEdPublic),
    ed25519Signature: hex(hostEdSignature),
    ed25519Verifies: await host.crypto.ed25519.verify(unhex(rfc[0].message), hostEdSignature, hostEdPublic),
  };

  // BIP-39: the standard "abandon ... about" mnemonic and its (empty-passphrase) seed.
  const wallet = await sdk.getWasmWallet();
  const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  out.mnemonic = {
    valid: wallet.mnemonic.validate(mnemonic),
    seed: hex(wallet.mnemonic.toSeed(mnemonic)),
    // GHSA-gvwv: text ended at the first NUL, so this validated.
    nulTerminatedValid: wallet.mnemonic.validate(`${mnemonic}\u0000junk`),
  };
  return out;
}

// What the battery must return: the vectors' published values, and the advisories' effects absent.
const EXPECTED = {
  ed25519: [
    {
      publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
      signature: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
      verifies: true,
      tamperedVerifies: false,
    },
    {
      publicKey: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
      signature: "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
      verifies: true,
      tamperedVerifies: false,
    },
  ],
  ed25519MalleableAccepted: false,
  secp256k1: {
    publicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    signature: "934b1ea10a4b3c1757e2b0c017d0b6143ce3c9a7e6a4a49860d7a6ab210ee3d82442ce9d2b916064108014783e923ec36b49743e2ffa1c4496f01a512aafd9e5",
    digestSignature: "934b1ea10a4b3c1757e2b0c017d0b6143ce3c9a7e6a4a49860d7a6ab210ee3d82442ce9d2b916064108014783e923ec36b49743e2ffa1c4496f01a512aafd9e5",
    messageVerifies: true,
    digestVerifies: true,
    tamperedMessageVerifies: false,
    tamperedDigestVerifies: false,
  },
  forgedRecoveryAccepted: false,
  zeroKeySigned: false,
  browserHost: {
    secp256k1PublicKey: "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    secp256k1Der: "3045022100934b1ea10a4b3c1757e2b0c017d0b6143ce3c9a7e6a4a49860d7a6ab210ee3d802202442ce9d2b916064108014783e923ec36b49743e2ffa1c4496f01a512aafd9e5",
    secp256k1DerIsRawSignatureAsDer: true,
    secp256k1Verifies: true,
    ed25519PublicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    ed25519Signature: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    ed25519Verifies: true,
  },
  mnemonic: {
    valid: true,
    seed: "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4",
    nulTerminatedValid: false,
  },
};

// An independent oracle: OpenSSL verifies what the wallet signed.
function openSslAgrees(results) {
  const ed = results.ed25519[0];
  const edKey = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(ed.publicKey, "hex")]),
    format: "der",
    type: "spki",
  });
  assert.equal(crypto.verify(null, Buffer.alloc(0), edKey, Buffer.from(ed.signature, "hex")), true, "OpenSSL rejects the Ed25519 signature");
  const uncompressed = crypto.ECDH.convertKey(Buffer.from(results.secp256k1.publicKey, "hex"), "secp256k1", undefined, undefined, "uncompressed");
  const ecKey = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from("3056301006072a8648ce3d020106052b8104000a034200", "hex"), uncompressed]),
    format: "der",
    type: "spki",
  });
  assert.equal(
    crypto.verify("sha256", Buffer.from("Satoshi Nakamoto"), { key: ecKey, dsaEncoding: "ieee-p1363" }, Buffer.from(results.secp256k1.signature, "hex")),
    true,
    "OpenSSL rejects the secp256k1 signature",
  );
}

// --- the module the signature covers ----------------------------------------------------------------------
const OMM = { schemaName: "OMM.fbs", fileIdentifier: "$OMM", rootTypeName: "OMM", wireFormat: "flatbuffer" };
const CAT = { schemaName: "CAT.fbs", fileIdentifier: "$CAT", rootTypeName: "CAT", wireFormat: "flatbuffer" };
const manifest = {
  pluginId: "com.digitalarsenal.e2e.signed-echo",
  name: "Signed echo",
  version: "0.1.0",
  pluginFamily: "analysis",
  capabilities: [],
  externalInterfaces: [],
  invokeSurfaces: ["direct", "command"],
  runtimeTargets: ["browser", "wasmedge"],
  sequentialJustification: { kind: "pure-transform", detail: "E2E fixture: one pure call that hands its input back; it never spawns a thread." },
  methods: [{
    methodId: "echo_bytes",
    displayName: "Echo bytes",
    inputPorts: [{ portId: "samples", acceptedTypeSets: [{ setId: "omm", allowedTypes: [OMM] }], minStreams: 1, maxStreams: 1, required: true }],
    outputPorts: [{ portId: "result", acceptedTypeSets: [{ setId: "cat", allowedTypes: [CAT] }], minStreams: 1, maxStreams: 1, required: true }],
    maxBatch: 1,
    drainPolicy: "single-shot",
  }],
};
const echoSource = `
#include "space_data_module_invoke.h"
int echo_bytes(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "No frame was provided.");
    return 3;
  }
  return plugin_push_output("result", "CAT.fbs", "$CAT", frame->payload, frame->payload_length) < 0 ? 1 : 0;
}
`;

async function runInChromium(signedBytes, tamperedBytes, trustedPublicKey) {
  const imports = [
    ["ed25519PublicKey, ed25519Sign, ed25519Verify, secp256k1PublicKey, secp256k1SignMessage, secp256k1VerifyMessage, secp256k1SignDigest, secp256k1VerifyDigest, sha256Bytes, getWasmWallet", "src/utils/wasmCrypto.js"],
    ["createBrowserHost", "src/host/browserHost.js"],
    ["rawSignatureToDer", "src/utils/ecdsaDer.js"],
    ["verifyModuleArtifact", "src/bundle/signing.js"],
  ].map(([names, file]) => `import { ${names} } from ${JSON.stringify(path.join(root, file))};`).join("\n");
  const page = `${imports}
const sdk = { ed25519PublicKey, ed25519Sign, ed25519Verify, secp256k1PublicKey, secp256k1SignMessage, secp256k1VerifyMessage, secp256k1SignDigest, secp256k1VerifyDigest, sha256Bytes, getWasmWallet, createBrowserHost, rawSignatureToDer };
const battery = ${battery.toString()};
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
window.exercise = async (signedBase64, tamperedBase64, trusted) => {
  const results = await battery(sdk);
  const policy = { trustedPublicKeys: [trusted], requireSignature: true };
  const verified = await verifyModuleArtifact(fromBase64(signedBase64), policy);
  let tamperedCode = null;
  try { await verifyModuleArtifact(fromBase64(tamperedBase64), policy); } catch (error) { tamperedCode = error.code ?? String(error.message); }
  return { results, verified: verified.verified, signed: verified.signed, publicKeyHex: verified.publicKeyHex, tamperedCode };
};`;
  const bundle = await build({
    stdin: { contents: page, resolveDir: root, sourcefile: "hd-wallet-advisory-browser.js" },
    bundle: true, write: false, format: "esm", platform: "browser", nodePaths: [path.join(root, "node_modules")], logLevel: "silent",
  });
  const server = http.createServer((req, res) => {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    if (req.url === "/bundle.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].contents);
    } else if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end('<!doctype html><title>hd-wallet advisory E2E</title><script type="module" src="/bundle.js"></script>');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  let browser;
  try {
    browser = await chromium.launch({ executablePath: await resolveHeadlessShell(), headless: true });
    const tab = await browser.newPage();
    const pageErrors = [];
    tab.on("pageerror", (error) => pageErrors.push(error.message));
    await tab.goto(`http://127.0.0.1:${server.address().port}/`);
    await tab.waitForFunction(() => typeof window.exercise === "function");
    const result = await tab.evaluate(
      ([signed, tampered, trusted]) => window.exercise(signed, tampered, trusted),
      [Buffer.from(signedBytes).toString("base64"), Buffer.from(tamperedBytes).toString("base64"), trustedPublicKey],
    );
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join("; ")}`);
    return result;
  } finally {
    await browser?.close();
    server.close();
  }
}

async function main() {
  const started = Date.now();
  const dir = await mkdtemp(path.join(os.tmpdir(), "sdm-hd-wallet-e2e-"));
  try {
    // --- 1. the pin -------------------------------------------------------------------------------------
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const pinned = pkg.dependencies["hd-wallet-wasm"];
    const installed = JSON.parse(await readFile(path.join(root, "node_modules/hd-wallet-wasm/package.json"), "utf8")).version;
    assert.match(pinned, /^\d+\.\d+\.\d+$/, `hd-wallet-wasm must be pinned exactly, got ${pinned}`);
    assert.equal(installed, pinned, `installed hd-wallet-wasm ${installed} is not the pinned ${pinned}`);
    assert.ok(atLeast(installed, FIRST_PATCHED), `hd-wallet-wasm ${installed} is covered by GHSA-gvwv-r86g-4q35 (before 2.1.1) or GHSA-wp9p-ffrh-ccwm (before 2.1.2)`);
    const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
    const copies = Object.entries(lock.packages)
      .filter(([key]) => /(^|\/)node_modules\/hd-wallet-wasm$/.test(key))
      .map(([key, entry]) => ({ at: key, version: entry.version }));
    for (const copy of copies) {
      if (copy.at.includes("node_modules/flatc-wasm/")) continue; // reported below
      assert.ok(atLeast(copy.version, FIRST_PATCHED), `${copy.at} is hd-wallet-wasm ${copy.version}, covered by an advisory`);
    }
    // flatc-wasm's own pin of hd-wallet-wasm is a follow-up, and the SDK never reaches it: it takes only FlatcRunner.
    const sourceFiles = [];
    const walk = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!["vendor", "generated"].includes(entry.name)) await walk(full);
        } else if (entry.name.endsWith(".js") && entry.name !== "hostWorkerBundleSources.js") {
          sourceFiles.push(full);
        }
      }
    };
    await walk(path.join(root, "src"));
    const flatcImports = new Set();
    for (const file of sourceFiles) {
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']flatc-wasm[^"']*["']/g)) {
        for (const name of match[1].split(",").map((part) => part.trim()).filter(Boolean)) flatcImports.add(name);
      }
      assert.ok(!/from\s*["']flatc-wasm\/(hd-keys|pipeline|he)/.test(text), `${file} imports a flatc-wasm HD or encryption module`);
    }
    assert.deepEqual([...flatcImports], ["FlatcRunner"], "the SDK takes more from flatc-wasm than FlatcRunner");
    const flatcCopy = copies.find((copy) => copy.at.includes("node_modules/flatc-wasm/"));
    console.log(`pin: hd-wallet-wasm ${installed} (pinned exactly, installed; neither advisory covers it); other copies: ${copies.filter((copy) => copy !== flatcCopy && copy.version !== installed).map((copy) => `${copy.at.replace("node_modules/", "")} ${copy.version}`).join(", ") || "none"}`);
    if (flatcCopy && !atLeast(flatcCopy.version, FIRST_PATCHED)) {
      console.log(`follow-up: ${flatcCopy.at} is ${flatcCopy.version}, covered by both advisories; the SDK imports only FlatcRunner from flatc-wasm (code generation), never its HD-key or pipeline APIs - flatc-wasm needs a release on a patched hd-wallet-wasm`);
    }

    // --- 2, 3. known vectors and the advisories' effects, in Node ----------------------------------------
    const sdk = { ...walletPaths, createBrowserHost, rawSignatureToDer };
    const nodeResults = await battery(sdk);
    assert.deepEqual(nodeResults, EXPECTED, "the wallet paths in Node differ from the published vectors, or an advisory's effect is present");
    openSslAgrees(nodeResults);
    console.log("vectors (Node): RFC 8032 Ed25519 x2, secp256k1 message and digest signatures, BIP-39 seed, browser-host operations all match the published values; OpenSSL verifies the signatures");
    console.log("advisories (Node): a signature that recovers to no key is rejected right after a genuine verification, an Ed25519 S + L signature is rejected, a zero private key does not sign, a NUL-terminated mnemonic is invalid");

    // --- 4. a signed module: native WasmEdge, then Chromium ------------------------------------------------
    const wasmedge = await resolveWasmEdgeBinary();
    assertWasmEdgeVersionMatchesPin((await execFileAsync(wasmedge, ["--version"])).stdout, loadWasmEdgePin(), `native binary ${wasmedge}`);
    const compiled = await compileModuleFromSource({ manifest, sourceCode: echoSource, language: "c", threadModel: "wasi-sequential", compileCache: { dir: path.join(dir, "cache") } });
    const rfcSeed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    const rfcPublic = EXPECTED.ed25519[0].publicKey;
    const signed = await signModuleArtifact(compiled.wasmBytes, { privateKeySeedHex: rfcSeed, keyId: "rfc8032-test-1" });
    const tampered = Uint8Array.from(signed.wasmBytes);
    tampered[40] ^= 0xff; // inside the module, before the appended publication records
    const policy = { trustedPublicKeys: [rfcPublic], requireSignature: true };
    const verifiedHere = await verifyModuleArtifact(signed.wasmBytes, policy);
    assert.equal(verifiedHere.verified, true);
    assert.equal(verifiedHere.publicKeyHex, rfcPublic);

    const signedPath = path.join(dir, "signed.wasm");
    const tamperedPath = path.join(dir, "tampered.wasm");
    const unsignedPath = path.join(dir, "unsigned.wasm");
    await writeFile(signedPath, signed.wasmBytes);
    await writeFile(tamperedPath, tampered);
    await writeFile(unsignedPath, compiled.wasmBytes);
    const samples = new Uint8Array(64).map((_, index) => (index * 37 + 11) & 0xff);
    const load = (wasmSource, trustedPublicKeys = [rfcPublic]) =>
      loadModule({ wasmSource, runtimeKind: "wasmedge", wasmEdgeBinary: wasmedge, verifySignature: { trustedPublicKeys, requireSignature: true } });
    const harness = await load(signedPath);
    try {
      const response = await harness.invoke({ methodId: "echo_bytes", inputs: [{ portId: "samples", typeRef: OMM, payload: samples }] });
      assert.equal(response.statusCode, 0, `WasmEdge answered status ${response.statusCode} (${response.errorCode}: ${response.errorMessage})`);
      assert.equal(Buffer.compare(Buffer.from(response.outputs[0].payload), Buffer.from(samples)), 0, "the signed module did not echo its input on WasmEdge");
    } finally {
      await harness.destroy?.();
    }
    for (const [label, source, trusted, code] of [
      ["a tampered copy", tamperedPath, [rfcPublic], /./],
      ["an untrusted signer", signedPath, [EXPECTED.ed25519[1].publicKey], /./],
      ["an unsigned copy", unsignedPath, [rfcPublic], /./],
    ]) {
      await assert.rejects(load(source, trusted), (error) => error instanceof ModuleSignatureError && code.test(error.code), `${label} was not refused before WasmEdge started`);
    }
    console.log(`WasmEdge ${loadWasmEdgePin().wasmedgeVersion}: a module signed with the RFC 8032 key loads under a signature policy and echoes its input; a tampered copy, an untrusted signer and an unsigned copy are refused before the runtime starts`);

    const browser = await runInChromium(signed.wasmBytes, tampered, rfcPublic);
    assert.deepEqual(browser.results, nodeResults, "Chromium's results differ from Node's");
    assert.equal(browser.verified, true, "Chromium did not verify the signed module");
    assert.equal(browser.publicKeyHex, rfcPublic);
    assert.ok(browser.tamperedCode, "Chromium verified a tampered module");
    console.log(`Chromium: the same vectors and the browser host's operations give results identical to Node's; the signed module verifies, the tampered copy is refused (${browser.tamperedCode})`);

    console.log(`HD-WALLET-ADVISORY PASS in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.log(`HD-WALLET-ADVISORY FAIL: ${error?.stack ?? error}`);
  process.exit(1);
});
