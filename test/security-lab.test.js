// Regression test for the 2026-10-15 security audit, SEC-059 (and the lab leg
// of SEC-035): the module lab listens on loopback only, answers only loopback
// Host names, requires its per-run token, runs only .wasm files inside the
// plugins directory, and never returns a signing mnemonic.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "..", "lab", "server.js");
const VECTOR = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function request({ host = "127.0.0.1", port, method = "GET", urlPath, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, method, path: urlPath, headers, timeout: 5000 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body !== undefined) req.end(body);
    else req.end();
  });
}

function nonLoopbackAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

test("SEC-059: the module lab is loopback-only, token-gated, contained, and returns no mnemonic", { timeout: 60_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sdm-lab-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packages = path.join(root, "packages");
  await mkdir(path.join(packages, "demo", "dist"), { recursive: true });
  await writeFile(path.join(packages, "demo", "dist", "module.wasm"), new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  const outside = path.join(root, "outside.wasm");
  await writeFile(outside, new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  await symlink(outside, path.join(packages, "demo", "dist", "escape.wasm"));

  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), SPACE_DATA_NETWORK_PLUGINS_ROOT: root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGKILL"));
  const banner = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`lab did not start: ${out}`)), 20_000);
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (/listening/.test(out)) {
        clearTimeout(timer);
        resolve(out);
      }
    });
    child.once("exit", (code) => reject(new Error(`lab exited ${code}: ${out}`)));
  });
  const token = /[?&]token=([0-9a-f]+)/.exec(banner)?.[1] ?? null;

  // loopback only: another interface of this machine does not reach it
  const lanAddress = nonLoopbackAddress();
  if (lanAddress) {
    await assert.rejects(
      request({ host: lanAddress, port, urlPath: "/api/standards" }),
      /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|timeout/,
      `the lab must not answer on ${lanAddress}`,
    );
  }

  // no token, no API (and no plugin files)
  const anonymous = await request({ port, urlPath: "/api/standards" });
  assert.equal(anonymous.status, 401);
  assert.equal((await request({ port, urlPath: "/plugins/demo/dist/module.wasm" })).status, 401);
  assert.ok(token, `the banner prints a per-run token URL: ${banner}`);

  // a rebinding page reaches loopback under a foreign Host name: refused
  const rebound = await request({ port, urlPath: "/api/standards", headers: { host: `attacker.example:${port}`, "x-lab-token": token } });
  assert.equal(rebound.status, 421);

  const authorized = await request({ port, urlPath: "/api/standards", headers: { "x-lab-token": token } });
  assert.equal(authorized.status, 200);

  // the token URL sets a SameSite=Strict cookie the lab UI then uses
  const opened = await request({ port, urlPath: `/?token=${token}` });
  assert.equal(opened.status, 302);
  assert.match(String(opened.headers["set-cookie"]), /HttpOnly; SameSite=Strict/);

  const invoke = (wasmPath) =>
    request({
      port,
      method: "POST",
      urlPath: "/api/wasmedge-invoke",
      headers: { "content-type": "application/json", "x-lab-token": token },
      body: JSON.stringify({ wasmPath, stdinBase64: "" }),
    });
  for (const wasmPath of ["../outside.wasm", outside, "demo/dist/escape.wasm", "../../../../../../../bin/ls", "demo/dist/module.wat"]) {
    const response = await invoke(wasmPath);
    assert.equal(response.status, 400, `${wasmPath} -> ${response.status} ${response.body}`);
  }

  const protectedResponse = await request({
    port,
    method: "POST",
    urlPath: "/api/protect",
    headers: { "content-type": "application/json", "x-lab-token": token },
    body: JSON.stringify({
      manifest: {
        pluginId: "com.digitalarsenal.tests.lab",
        name: "Lab",
        version: "1.0.0",
        pluginFamily: "analysis",
        capabilities: [],
        invokeSurfaces: ["direct"],
        runtimeTargets: ["browser"],
        methods: [{ methodId: "invoke", inputPorts: [], outputPorts: [], maxBatch: 1, drainPolicy: "single-shot" }],
      },
      wasmBase64: Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]).toString("base64"),
      mnemonic: VECTOR,
    }),
  });
  assert.equal(protectedResponse.status, 200, protectedResponse.body);
  assert.doesNotMatch(protectedResponse.body, /mnemonic|abandon/);

  // ROUND 2 (the verifier's v059/v059b): Express routes ignore case, so a
  // case-sensitive prefix gate was bypassed. Every spelling needs the token.
  const outsideLink = path.join(packages, "link.wasm");
  await symlink(outside, outsideLink);
  for (const [method, urlPath] of [
    ["POST", "/API/wasmedge-invoke"],
    ["POST", "/API/protect"],
    ["POST", "/Api/compile"],
    ["GET", "/API/plugins"],
    ["GET", "/aPi/standards"],
    ["GET", "/api/standards/"],
    ["GET", "//api/standards"],
    ["GET", "/%61pi/standards"],
    ["GET", "/./api/standards"],
    ["GET", "/Plugins/demo/dist/module.wasm"],
    ["GET", "/PLUGINS/link.wasm"],
    ["GET", "/plugins/link.wasm"],
    ["HEAD", "/plugins/demo/dist/module.wasm"],
    ["GET", "/no-such-route"],
  ]) {
    const response = await request({ port, method, urlPath, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
    assert.ok([401].includes(response.status), `${method} ${urlPath} without a token -> ${response.status} ${response.body.slice(0, 80)}`);
  }
  // the UI itself still loads without a token
  assert.equal((await request({ port, urlPath: "/" })).status, 200);
  assert.equal((await request({ port, urlPath: "/app.js" })).status, 200);

  // with the token: the contained plugin file is served, nothing outside is
  const withToken = (urlPath) => request({ port, urlPath, headers: { "x-lab-token": token } });
  const served = await withToken("/plugins/demo/dist/module.wasm");
  assert.equal(served.status, 200);
  assert.equal(served.headers["content-type"], "application/wasm");
  for (const urlPath of ["/plugins/link.wasm", "/PLUGINS/link.wasm", "/plugins/demo/dist/escape.wasm", "/plugins/%2e%2e/outside.wasm", "/plugins/..%2foutside.wasm", "/Plugins/demo/dist/module.wasm"]) {
    const response = await withToken(urlPath);
    assert.notEqual(response.status, 200, `${urlPath} -> ${response.status}`);
    assert.doesNotMatch(response.body, /asm/, urlPath);
  }
});
