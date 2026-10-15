// Regression tests for the 2026-10-15 security audit, host side:
//   SEC-009 BrowserHost default-deny (direct and through a host-bridge guest)
//   SEC-022 redirects re-checked against the origin allow-list
//   SEC-023 exec: allow-list required, minimal env, cwd confined
//   SEC-024 keyslot slots bound to the embedder's policy, reserved preimages refused
//   SEC-002 secp256k1 digest verification is real ECDSA (range checks, low-S)
//   hd-wallet-wasm 2.1.1: publicKeyFromPrivate is told the curve
// Every key here is generated at runtime; no fixture key is used.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto";

import { BrowserHostCapabilityError, createBrowserHost } from "../src/host/browserHost.js";
import { createNodeHost } from "../src/host/nodeHost.js";
import { createWorkerModuleHarness } from "../src/host/workerModuleHarness.js";
import {
  getWasmWallet,
  secp256k1PublicKey,
  secp256k1SignDigest,
  secp256k1VerifyDigest,
} from "../src/utils/wasmCrypto.js";
import { bytesToBase64 } from "../src/utils/encoding.js";
import { canonicalBytes } from "../src/auth/canonicalize.js";
import { DOMAIN_MODULE_PUBLICATION_V1, statement } from "../src/bundle/sigdomain.js";
// Modules this branch adds are imported where they are used, so that on a
// tree without the fix each test fails on its security assertion, not on a
// missing module at load time.
const secp256k1Ecdsa = () => import("../src/utils/secp256k1Ecdsa.js");

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const hex32 = (value) => Buffer.from(value.toString(16).padStart(64, "0"), "hex");

// The audit's SEC-009 guest (repro/guest.wat): its only imports are the
// space_data_module_host bridge; guest_op(i) calls, in order,
// host.listCapabilities, secrets.get, storage.write, http.request
// (127.0.0.1:47123) and keyslot.sign {slotId: "node-identity"}.
const GUEST_WASM = Buffer.from(
  "AGFzbQEAAAABGARgBH9/f38Bf2AAAX9gAn9/AX9gAX8BfwJsAxZzcGFjZV9kYXRhX21vZHVsZV9ob3N0BGNhbGwAABZzcGFjZV9kYXRhX21vZHVsZV9ob3N0DHJlc3BvbnNlX2xlbgABFnNwYWNlX2RhdGFfbW9kdWxlX2hvc3QNcmVhZF9yZXNwb25zZQACAwUEAAMBAQUDAQAEBgYBfwFBAAsHPwQGbWVtb3J5AgAIZ3Vlc3Rfb3AABBJndWVzdF9yZXNwb25zZV9wdHIABRJndWVzdF9yZXNwb25zZV9sZW4ABgqYAQQcAQF/IAAgASACIAMQACEEQYCABBABEAIkACAEC20AIABBAEYEQEGACEEVQYAKQQoQAw8LIABBAUYEQEGAEEELQYASQRwQAw8LIABBAkYEQEGAGEENQYAaQSYQAw8LIABBA0YEQEGAIEEMQYAiQT4QAw8LIABBBEYEQEGAKEEMQYAqQT8QAw8LQX8LBgBBgIAECwQAIwALC8sCCgBBgAgLFWhvc3QubGlzdENhcGFiaWxpdGllcwBBgAoLCgIAAAB7fQAAAAAAQYAQCwtzZWNyZXRzLmdldABBgBILHBQAAAB7Im5hbWUiOiJhcGktdG9rZW4ifQAAAAAAQYAYCw1zdG9yYWdlLndyaXRlAEGAGgsmHgAAAHsic2NoZW1hIjoiT01NIiwiZGF0YSI6IkFBQUEifQAAAAAAQYAgCwxodHRwLnJlcXVlc3QAQYAiCz42AAAAeyJ1cmwiOiJodHRwOi8vMTI3LjAuMC4xOjQ3MTIzL2FwaS9tZSIsIm1ldGhvZCI6IkdFVCJ9AAAAAABBgCgLDGtleXNsb3Quc2lnbgBBgCoLPzcAAAB7InNsb3RJZCI6Im5vZGUtaWRlbnRpdHkiLCJwYXlsb2FkIjoiWlhacGJDMXdZWGxzYjJGayJ9AAAAAA==",
  "base64",
);

function recordingAdapters(log) {
  const seed = randomBytes(32);
  return {
    secrets: { get: (params) => { log.push("secrets.get"); return { value: "test-secret" }; } },
    storage: { write: (params) => { log.push("storage.write"); return { cid: "bafy-test" }; } },
    walletSign: { get: ({ slotId }) => { log.push(`walletSign.get ${slotId}`); return seed; } },
  };
}

test("SEC-009: a BrowserHost built without a capability list grants nothing, and capabilities: [] means deny", async () => {
  const wasmWallet = await getWasmWallet();
  for (const options of [{}, { capabilities: [] }, { capabilities: null }]) {
    const log = [];
    const host = createBrowserHost({
      ...options,
      wasmWallet,
      capabilityAdapters: recordingAdapters(log),
      fetch: async () => new Response("reached"),
    });
    assert.deepEqual(host.listCapabilities(), []);
    for (const capability of ["http", "network", "secrets", "storage_write", "wallet_sign", "crypto_sign", "pubsub"]) {
      assert.equal(host.hasCapability(capability), false, capability);
    }
    await assert.rejects(host.invoke("secrets.get", { name: "api-token" }), BrowserHostCapabilityError);
    await assert.rejects(host.invoke("storage.write", { schema: "OMM", data: "AAAA" }), BrowserHostCapabilityError);
    await assert.rejects(host.invoke("http.request", { url: "https://example.test/" }), BrowserHostCapabilityError);
    await assert.rejects(
      host.invoke("keyslot.sign", { slotId: "node-identity", payload: bytesToBase64(Buffer.from("evil-payload")) }),
      BrowserHostCapabilityError,
    );
    assert.deepEqual(log, [], "no adapter was reached");
  }
  assert.throws(() => createBrowserHost({ capabilities: "http" }), TypeError);
});

test("SEC-009: a host-bridge guest in the worker harness reaches no adapter without a grant", { timeout: 120_000 }, async () => {
  const wasmWallet = await getWasmWallet();
  const ops = ["host.listCapabilities", "secrets.get", "storage.write", "http.request", "keyslot.sign"];
  async function statuses(hostOptions) {
    const harness = await createWorkerModuleHarness({ wasmSource: new Uint8Array(GUEST_WASM), hostOptions });
    try {
      const out = {};
      for (let i = 0; i < ops.length; i += 1) out[ops[i]] = await harness.callExport("guest_op", i);
      return out;
    } finally {
      await harness.destroy?.();
    }
  }
  const log = [];
  const denied = await statuses({ capabilityAdapters: recordingAdapters(log), wasmWallet });
  assert.notEqual(denied["secrets.get"], 0, "secrets.get refused");
  assert.notEqual(denied["storage.write"], 0, "storage.write refused");
  assert.notEqual(denied["http.request"], 0, "http.request refused");
  assert.notEqual(denied["keyslot.sign"], 0, "keyslot.sign refused");
  assert.deepEqual(log, [], "no adapter was reached from guest code");

  // control: the same guest path works when the embedder grants it
  const granted = await statuses({ capabilities: ["secrets"], capabilityAdapters: recordingAdapters(log), wasmWallet });
  assert.equal(granted["secrets.get"], 0);
  assert.notEqual(granted["storage.write"], 0);
  assert.deepEqual(log, ["secrets.get"]);
});

test("SEC-009/SEC-022: BrowserHost http is an explicit opt-in: origin allow-list, no credentials, every redirect re-checked", async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url === "https://api.example.test/redirect") {
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    }
    if (url === "https://api.example.test/hop") {
      return new Response(null, { status: 307, headers: { location: "/final" } });
    }
    return new Response(`body of ${url}`, { status: 200 });
  };

  const noList = createBrowserHost({ capabilities: ["http"], fetch: fakeFetch });
  await assert.rejects(noList.invoke("http.request", { url: "https://api.example.test/a" }), /allowedHttpOrigins/);
  assert.equal(calls.length, 0);

  const networkOnly = createBrowserHost({ capabilities: ["network"], fetch: fakeFetch, allowAnyHttpOrigin: true });
  assert.equal(networkOnly.hasCapability("http"), false, "network does not imply http");
  await assert.rejects(networkOnly.invoke("http.request", { url: "https://api.example.test/a" }), BrowserHostCapabilityError);

  const host = createBrowserHost({
    capabilities: ["http"],
    fetch: fakeFetch,
    allowedHttpOrigins: ["https://api.example.test"],
  });
  const ok = await host.invoke("http.request", { url: "https://api.example.test/a" });
  assert.equal(ok.status, 200);
  assert.equal(calls.at(-1).init.credentials, "omit");
  assert.equal(calls.at(-1).init.redirect, "manual");

  await assert.rejects(host.invoke("http.request", { url: "https://other.example.test/a" }), /not permitted/);
  const before = calls.length;
  await assert.rejects(host.invoke("http.request", { url: "https://api.example.test/redirect" }), /169\.254\.169\.254.*not permitted|not permitted/);
  assert.equal(calls.length, before + 1, "the redirect target was never fetched");

  const hopped = await host.invoke("http.request", { url: "https://api.example.test/hop", responseType: "utf8" });
  assert.equal(hopped.url, "https://api.example.test/final");
  assert.equal(hopped.body, "body of https://api.example.test/final");
});

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

test("SEC-022: NodeHost re-checks every redirect hop against allowedHttpOrigins", async (t) => {
  const internalHits = [];
  const internal = await listen((req, res) => { internalHits.push(req.url); res.end("INTERNAL-ONLY"); });
  t.after(() => internal.server.close());
  const partner = await listen((req, res) => {
    if (req.url === "/open-redirect") {
      res.writeHead(302, { location: `${internal.origin}/secret` });
      return res.end();
    }
    if (req.url === "/same-origin-hop") {
      res.writeHead(303, { location: "/landing" });
      return res.end();
    }
    res.end(`partner:${req.method}:${req.url}`);
  });
  t.after(() => partner.server.close());

  const host = createNodeHost({ capabilities: ["http"], allowedHttpOrigins: [partner.origin] });
  await assert.rejects(host.invoke("http.request", { url: `${internal.origin}/secret` }), /not permitted/);
  await assert.rejects(
    host.invoke("http.request", { url: `${partner.origin}/open-redirect`, responseType: "text" }),
    /not permitted/,
  );
  // a guest cannot opt back into unchecked following
  await assert.rejects(
    host.invoke("http.request", { url: `${partner.origin}/open-redirect`, redirect: "follow", responseType: "text" }),
    /not permitted/,
  );
  assert.deepEqual(internalHits, [], "the internal server was never reached");

  const hop = await host.invoke("http.request", { url: `${partner.origin}/same-origin-hop`, method: "POST", body: "x", responseType: "text" });
  assert.equal(hop.status, 200);
  assert.equal(hop.url, `${partner.origin}/landing`);
  assert.equal(hop.body, "partner:GET:/landing", "a 303 continues as GET");
});

// --- round 2 (verifier variants) ----------------------------------------------

function recordingWebSocket(dialed) {
  return class FakeWebSocket {
    constructor(url) {
      dialed.push(String(url));
      this.url = String(url);
      this.protocol = "";
      this.extensions = "";
      setTimeout(() => this.onopen?.(), 0);
    }
    send() {}
    close() {}
  };
}

test("SEC-009 (round 2): BrowserHost websocket is its own grant with an origin list; network implies neither", async () => {
  const dialed = [];
  const WebSocket = recordingWebSocket(dialed);
  const adapterCalls = [];
  const networkAdapter = { request: async (params) => { adapterCalls.push(params); return { ok: true }; } };

  // the verifier's v009ws: a guest with only "network" dialing a loopback admin socket
  const networkOnly = createBrowserHost({ capabilities: ["network"], WebSocket, allowAnyWebSocketOrigin: true });
  assert.equal(networkOnly.hasCapability("websocket"), false);
  await assert.rejects(networkOnly.invoke("websocket.exchange", { url: "ws://127.0.0.1:9999/admin" }), BrowserHostCapabilityError);
  await assert.rejects(networkOnly.invoke("network.request", { url: "ws://127.0.0.1:9999/admin" }), BrowserHostCapabilityError);
  await assert.rejects(networkOnly.invoke("network.request", { transport: "websocket", url: "ws://127.0.0.1:9999/admin" }), BrowserHostCapabilityError);

  // granted, but no origin list: refused
  const noList = createBrowserHost({ capabilities: ["websocket"], WebSocket });
  await assert.rejects(noList.invoke("websocket.exchange", { url: "ws://127.0.0.1:9999/admin" }), /allowedWebSocketOrigins/);

  const host = createBrowserHost({ capabilities: ["websocket"], WebSocket, allowedWebSocketOrigins: ["wss://feed.example.test"] });
  for (const url of ["ws://127.0.0.1:9999/admin", "wss://feed.example.test.evil.example/", "ws://feed.example.test/", "https://feed.example.test/", "wss://user@127.0.0.1/"]) {
    await assert.rejects(host.invoke("websocket.exchange", { url }), BrowserHostCapabilityError, url);
  }
  assert.deepEqual(dialed, [], "no socket was opened");
  const ok = await host.invoke("websocket.exchange", { url: "wss://feed.example.test/stream" });
  assert.equal(ok.url, "wss://feed.example.test/stream");
  assert.deepEqual(dialed, ["wss://feed.example.test/stream"]);

  // an embedder network adapter does not lift the transport's grant or origin rules
  const adapted = createBrowserHost({ capabilities: ["network"], capabilityAdapters: { network: networkAdapter } });
  await assert.rejects(adapted.invoke("network.request", { transport: "http", url: "http://127.0.0.1:47123/api/me" }), BrowserHostCapabilityError);
  await assert.rejects(adapted.invoke("network.request", { transport: "websocket", url: "ws://127.0.0.1:9999/admin" }), BrowserHostCapabilityError);
  // a transport label that disagrees with the URL's scheme is refused
  await assert.rejects(adapted.invoke("network.request", { transport: "libp2p", url: "http://127.0.0.1:47123/api/me" }), /does not match/);
  const adaptedHttp = createBrowserHost({
    capabilities: ["network", "http"],
    allowedHttpOrigins: ["https://api.example.test"],
    capabilityAdapters: { network: networkAdapter },
  });
  await assert.rejects(adaptedHttp.invoke("network.request", { transport: "http", url: "http://127.0.0.1:47123/api/me" }), /not permitted/);
  assert.deepEqual(adapterCalls, [], "the adapter was never reached");
  await adaptedHttp.invoke("network.request", { transport: "http", url: "https://api.example.test/x" });
  // an adapter-only transport still needs only "network"
  await adapted.invoke("network.request", { transport: "libp2p", peer: "12D3KooW" });
  assert.equal(adapterCalls.length, 2);
});

test("SEC-022 (round 2): NodeHost outbound transports fail closed without an allow-list", async (t) => {
  const hits = [];
  const internal = await listen((req, res) => { hits.push(req.url); res.end("INTERNAL"); });
  t.after(() => internal.server.close());

  // the verifier's v022: http granted, no allowedHttpOrigins, internal origin
  const noList = createNodeHost({ capabilities: ["http", "websocket", "tcp", "udp", "tls", "mqtt"] });
  await assert.rejects(noList.invoke("http.request", { url: `${internal.origin}/secret` }), /allowedHttpOrigins/);
  await assert.rejects(noList.invoke("websocket.exchange", { url: "ws://127.0.0.1:9/admin" }), /allowedWebSocketOrigins/);
  await assert.rejects(noList.invoke("tcp.request", { host: "127.0.0.1", port: 9 }), /no allowed TCP hosts/);
  await assert.rejects(noList.invoke("udp.request", { host: "127.0.0.1", port: 9 }), /no allowed UDP hosts/);
  await assert.rejects(noList.invoke("tls.request", { host: "127.0.0.1", port: 9 }), /no allowed TLS hosts/);
  const networkOnly = createNodeHost({ capabilities: ["network"] });
  await assert.rejects(networkOnly.invoke("network.request", { transport: "http", url: `${internal.origin}/secret` }), /allowedHttpOrigins/);
  const adapterCalls = [];
  const adapted = createNodeHost({ capabilities: ["network"], capabilityAdapters: { network: { request: async (p) => { adapterCalls.push(p); return {}; } } } });
  await assert.rejects(adapted.invoke("network.request", { transport: "http", url: `${internal.origin}/secret` }), /allowedHttpOrigins/);
  await assert.rejects(adapted.invoke("network.request", { transport: "tcp", host: "127.0.0.1", port: 9 }), /no allowed TCP hosts/);
  assert.deepEqual(adapterCalls, []);
  assert.deepEqual(hits, [], "nothing was reached");

  // the explicit opt-in still works
  const anywhere = createNodeHost({ capabilities: ["http"], allowAnyHttpOrigin: true });
  assert.equal((await anywhere.invoke("http.request", { url: `${internal.origin}/ok`, responseType: "text" })).body, "INTERNAL");
});

test("SEC-022 (round 2): a fetch implementation that follows redirects itself is refused on both hosts", async () => {
  // what an embedder fetch that ignores redirect: "manual" returns after it
  // has already followed a hop to an internal origin
  const selfFollowing = (flag) => async () => {
    const response = new Response("INTERNAL", { status: 200 });
    if (flag === "redirected") Object.defineProperty(response, "redirected", { value: true });
    if (flag === "url") Object.defineProperty(response, "url", { value: "http://169.254.169.254/latest/meta-data/" });
    return response;
  };
  for (const flag of ["redirected", "url"]) {
    const browser = createBrowserHost({ capabilities: ["http"], allowedHttpOrigins: ["https://api.example.test"], fetch: selfFollowing(flag) });
    await assert.rejects(browser.invoke("http.request", { url: "https://api.example.test/redirect" }), /unchecked hop/, `browser ${flag}`);
    const node = createNodeHost({ capabilities: ["http"], allowedHttpOrigins: ["https://api.example.test"], fetch: selfFollowing(flag) });
    await assert.rejects(node.invoke("http.request", { url: "https://api.example.test/redirect" }), /unchecked hop/, `node ${flag}`);
  }
  // a response that reports the URL it was asked for is fine
  const honest = async (url) => {
    const response = new Response("ok", { status: 200 });
    Object.defineProperty(response, "url", { value: `${url}#fragment` });
    return response;
  };
  const node = createNodeHost({ capabilities: ["http"], allowedHttpOrigins: ["https://api.example.test"], fetch: honest });
  assert.equal((await node.invoke("http.request", { url: "https://api.example.test/a", responseType: "text" })).body, "ok");
});

test("SEC-023: exec requires an allow-list, never inherits the host env, refuses loader variables, and stays in the filesystem root", async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "sdm-exec-root-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "work"));
  await symlink("/", path.join(root, "escape"));

  assert.throws(() => createNodeHost({ capabilities: ["process_exec"] }), /allowedCommands/);
  assert.throws(
    () => createNodeHost({ capabilities: ["process_exec"], allowedCommands: ["node"] }),
    /absolute path/,
  );
  assert.throws(
    () => createNodeHost({ capabilities: ["process_exec"], allowedCommands: [process.execPath], allowedExecEnv: ["LD_PRELOAD"] }),
    /may not allow/,
  );

  const host = createNodeHost({
    capabilities: ["process_exec"],
    allowedCommands: [process.execPath],
    filesystemRoot: root,
    allowedExecEnv: ["SDM_TEST_FLAG"],
  });
  const script = "process.stdout.write(JSON.stringify({ canary: process.env.SDM_AUDIT_CANARY ?? null, keys: Object.keys(process.env).sort(), cwd: process.cwd(), flag: process.env.SDM_TEST_FLAG ?? null }))";

  process.env.SDM_AUDIT_CANARY = "host-secret-canary";
  try {
    const plain = JSON.parse((await host.invoke("exec.execFile", { file: process.execPath, args: ["-e", script] })).stdout);
    assert.equal(plain.canary, null, "the host environment is not inherited");
    assert.ok(plain.keys.every((key) => key === "PATH" || /^__CF|^LC_|^LANG$/.test(key)), `child env keys: ${plain.keys}`);
    assert.equal(plain.cwd, root);
  } finally {
    delete process.env.SDM_AUDIT_CANARY;
  }

  for (const env of [
    { NODE_OPTIONS: "--require /tmp/evil.js" },
    { LD_PRELOAD: "/tmp/evil.so" },
    { DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib" },
    { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "alias.x", GIT_CONFIG_VALUE_0: "!touch /tmp/pwned" },
    { PATH: "/tmp/evil-bin" },
    { NOT_ALLOWED: "1" },
  ]) {
    await assert.rejects(
      host.invoke("exec.execFile", { file: process.execPath, args: ["-e", "0"], env }),
      /not permitted/,
      JSON.stringify(env),
    );
  }
  const flagged = JSON.parse((await host.invoke("exec.execFile", { file: process.execPath, args: ["-e", script], env: { SDM_TEST_FLAG: "on" } })).stdout);
  assert.equal(flagged.flag, "on");

  for (const cwd of ["/", "..", "../..", "escape", path.join(root, "..")]) {
    await assert.rejects(
      host.invoke("exec.execFile", { file: process.execPath, args: ["-e", "0"], cwd }),
      (error) => error.name === "HostFilesystemScopeError",
      cwd,
    );
  }
  const inWork = JSON.parse((await host.invoke("exec.execFile", { file: process.execPath, args: ["-e", script], cwd: "work" })).stdout);
  assert.equal(inWork.cwd, path.join(root, "work"));

  await assert.rejects(host.invoke("exec.execFile", { file: "/bin/sh", args: ["-c", "id"] }), /not permitted/);
});

for (const [label, makeHost] of [
  ["NodeHost", (options) => createNodeHost(options)],
  ["BrowserHost", (options) => createBrowserHost(options)],
]) {
  test(`SEC-024: ${label} keyslot slots are bound to the embedder's policy and never sign a reserved preimage`, async () => {
    const wasmWallet = await getWasmWallet();
    const seed = randomBytes(32);
    const capabilityAdapters = { walletSign: { get: () => seed } };
    const sign = (host, slotId, payload, algorithm) =>
      host.invoke("keyslot.sign", { slotId, payload: bytesToBase64(payload), ...(algorithm ? { algorithm } : {}) });

    const unbound = makeHost({ capabilities: ["wallet_sign"], wasmWallet, capabilityAdapters });
    await assert.rejects(sign(unbound, "publisher", Buffer.from("hello world")), /not permitted/);

    const host = makeHost({
      capabilities: ["wallet_sign"],
      wasmWallet,
      capabilityAdapters,
      allowedKeySlots: {
        publisher: ["sign"],
        "grant-key": { operations: ["sign"], fileIdentifiers: ["$LGR"] },
      },
    });
    await assert.rejects(sign(host, "node-identity", Buffer.from("hello world")), /not permitted/);
    const ok = await sign(host, "publisher", Buffer.from("an ordinary application payload"));
    assert.equal(ok.algorithm, "ed25519");

    const evilHash = createHash("sha256").update("evil.wasm").digest();
    // the module-publication statement for somebody else's code
    await assert.rejects(sign(host, "publisher", statement(DOMAIN_MODULE_PUBLICATION_V1, evilHash)), /reserved signature domain/);
    // the legacy bare-digest module signature form
    await assert.rejects(sign(host, "publisher", evilHash), /bare 32-byte/);
    // a canonical deployment authorization, under either algorithm
    const authorization = Buffer.from('{"action":"deploy-flow","artifactId":"evil"}');
    const REFUSED = /reserved signature domain|refuses a JSON object/;
    await assert.rejects(sign(host, "publisher", authorization), REFUSED);
    await assert.rejects(sign(host, "publisher", authorization, "secp256k1"), REFUSED);
    // round-2 variants: an extra key that sorts before "action" moved the
    // canonical bytes off the old prefix; whitespace, a BOM and arrays too
    const deployPayload = {
      version: 1, action: "deploy-flow", artifactId: "evil", programId: "evil", graphHash: null, manifestHash: null,
      target: { kind: "remote", id: null, audience: null, url: null }, capabilities: ["secrets"],
      issuedAt: Date.now(), expiresAt: Date.now() + 60_000, nonce: "n".repeat(32), constraints: null,
    };
    for (const variant of [
      canonicalBytes({ aa: 1, ...deployPayload }),
      canonicalBytes({ _: 1, ...deployPayload }),
      canonicalBytes({ "!": 1, ...deployPayload }),
      Buffer.concat([Buffer.from(" \n\t"), canonicalBytes(deployPayload)]),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), canonicalBytes(deployPayload)]),
      Buffer.from(JSON.stringify([deployPayload])),
    ]) {
      await assert.rejects(sign(host, "publisher", variant, "secp256k1"), REFUSED, Buffer.from(variant).toString("utf8").slice(0, 24));
      await assert.rejects(sign(host, "publisher", variant), REFUSED);
    }
    // a slot bound to $LGR is not satisfied by JSON whose bytes 4..8 spell it
    await assert.rejects(sign(host, "grant-key", canonicalBytes({ "!!$LGR": 1, ...deployPayload }), "secp256k1"), REFUSED);
    await assert.rejects(sign(host, "grant-key", Buffer.from('{"!!$LGR":1}')), REFUSED);
    // plain text that merely contains braces still signs
    assert.equal((await sign(host, "publisher", Buffer.from("{not json"))).algorithm, "ed25519");

    const lgr = Buffer.concat([Buffer.from([8, 0, 0, 0]), Buffer.from("$LGR"), Buffer.alloc(8)]);
    const other = Buffer.concat([Buffer.from([8, 0, 0, 0]), Buffer.from("$OMM"), Buffer.alloc(8)]);
    assert.equal((await sign(host, "grant-key", lgr)).algorithm, "ed25519");
    await assert.rejects(sign(host, "grant-key", other), /bound FlatBuffer file identifiers/);

    await assert.rejects(
      host.invoke("keyslot.unwrap", { slotId: "publisher", ephemeralPublicKey: bytesToBase64(randomBytes(32)), ciphertext: bytesToBase64(randomBytes(48)) }),
      /not permitted/,
    );
  });
}

test("SEC-002: secp256k1VerifyDigest is real ECDSA with range checks, not recover-and-compare", async () => {
  const privateKey = randomBytes(32);
  const publicKey = await secp256k1PublicKey(privateKey);
  const digest = randomBytes(32);
  const signature = new Uint8Array(await secp256k1SignDigest(digest, privateKey));
  assert.equal(await secp256k1VerifyDigest(digest, signature, publicKey), true);

  const r = BigInt(`0x${Buffer.from(signature.subarray(0, 32)).toString("hex")}`);
  const s = BigInt(`0x${Buffer.from(signature.subarray(32)).toString("hex")}`);
  const highS = Buffer.concat([hex32(r), hex32(N - s)]);
  // the high-S encoding is the same signature (node:crypto and the Go node accept it); strict callers opt into low-S
  assert.equal(await secp256k1VerifyDigest(digest, highS, publicKey), true);
  // the same signature under any OTHER key is refused (recover-and-compare could be steered by the recovery export)
  const otherKey = await secp256k1PublicKey(randomBytes(32));
  assert.equal(await secp256k1VerifyDigest(digest, signature, otherKey), false);

  for (const [label, forged] of [
    ["all-zero", new Uint8Array(64)],
    ["all-ff", new Uint8Array(64).fill(0xff)],
    ["r = 0", Buffer.concat([hex32(0n), hex32(s)])],
    ["s = 0", Buffer.concat([hex32(r), hex32(0n)])],
    ["r = n", Buffer.concat([hex32(N), hex32(s)])],
    ["s = n", Buffer.concat([hex32(r), hex32(N)])],
    ["truncated", signature.subarray(0, 63)],
  ]) {
    assert.equal(await secp256k1VerifyDigest(digest, forged, publicKey), false, label);
  }
  const tampered = signature.slice();
  tampered[10] ^= 1;
  assert.equal(await secp256k1VerifyDigest(digest, tampered, publicKey), false);
  assert.equal(await secp256k1VerifyDigest(randomBytes(32), signature, publicKey), false);

  // an independent signer (OpenSSL) verifies, whichever S it produced; its uncompressed key form is accepted
  const keys = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const uncompressed = keys.publicKey.export({ format: "der", type: "spki" }).subarray(-65);
  for (let i = 0; i < 8; i += 1) {
    const message = Buffer.from(`independent signer ${i}`);
    const opensslSignature = cryptoSign("sha256", message, { key: keys.privateKey, dsaEncoding: "ieee-p1363" });
    assert.equal(await secp256k1VerifyDigest(createHash("sha256").update(message).digest(), opensslSignature, uncompressed), true);
  }

  // an off-curve "public key" is an error, never a verdict
  const offCurve = Buffer.concat([Buffer.from([0x04]), Buffer.alloc(31), Buffer.from([5]), Buffer.alloc(31), Buffer.from([7])]);
  await assert.rejects(secp256k1VerifyDigest(digest, signature, offCurve), RangeError);

  // the same verifier answers the NodeHost hostcall
  const host = createNodeHost({ capabilities: ["crypto_verify"] });
  assert.equal(await host.invoke("crypto.secp256k1.verifyDigest", { digest, signature: new Uint8Array(64), publicKey }), false);
  assert.equal(await host.invoke("crypto.secp256k1.verifyDigest", { digest, signature, publicKey }), true);

  // the strict low-S form is available to callers that want it
  const { secp256k1EcdsaVerifyDigest } = await secp256k1Ecdsa();
  assert.equal(secp256k1EcdsaVerifyDigest(digest, highS, publicKey, { lowS: true }), false);
  assert.equal(secp256k1EcdsaVerifyDigest(digest, signature, publicKey, { lowS: true }), true);
});

test("hd-wallet-wasm 2.1.1 compatibility: secp256k1 public keys are derived with the curve named", async () => {
  const wallet = await getWasmWallet();
  const original = wallet.curves.publicKeyFromPrivate;
  const seen = [];
  wallet.curves.publicKeyFromPrivate = function (privateKey, curve) {
    seen.push(curve);
    if (curve === undefined) throw new Error("Curve undefined is not supported here");
    return original.call(this, privateKey, curve);
  };
  try {
    const key = await secp256k1PublicKey(randomBytes(32));
    assert.equal(key.length, 33);
    assert.deepEqual(seen, [0]);
  } finally {
    wallet.curves.publicKeyFromPrivate = original;
  }

  const browserSeen = [];
  const host = createBrowserHost({
    capabilities: ["crypto_sign"],
    wasmWallet: {
      curves: {
        publicKeyFromPrivate: (privateKey, curve) => {
          browserSeen.push(curve);
          return new Uint8Array(33);
        },
      },
    },
  });
  await host.invoke("crypto.secp256k1.publicKeyFromPrivate", { privateKey: new Uint8Array(32).fill(1) });
  assert.deepEqual(browserSeen, [0]);
});
