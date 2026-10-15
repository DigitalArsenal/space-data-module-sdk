import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { WASI } from "node:wasi";

import { cleanupCompilation, compileModuleFromSource } from "../src/index.js";
import { createNodeHost } from "../src/host/nodeHost.js";
import { createNodeHostSyncHostcallBridge } from "../src/host/abi.js";
import { createWorkerModuleHarness } from "../src/host/workerModuleHarness.js";

// Typed contracts 1.0: a C++ module built by the SDK compiler calls the reference Node host through
// typedHostcall.hpp - SDS $PIV requests carrying HostOps aligned records and raw frames, no JSON - first on the sync
// bridge, then through the worker harness, where the async operations (filesystem, crypto, http, context) run on
// the controlling thread while the guest blocks.
const GUEST_SOURCE = `
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <string>
#include "typedHostcall.hpp"
#include "HttpRequest_generated.h"

namespace A = sdn::runtime::Aligned;
static char out_buffer[1024];
static int out_length = 0;
static int report(const char* format, ...) __attribute__((format(printf, 1, 2)));
static int report(const char* format, ...) {
  va_list args;
  va_start(args, format);
  out_length = std::vsnprintf(out_buffer, sizeof out_buffer, format, args);
  va_end(args);
  return 0;
}
static std::string hex(std::string_view bytes, size_t n) {
  static const char* digits = "0123456789abcdef";
  std::string s;
  for (size_t i = 0; i < n && i < bytes.size(); ++i) {
    s += digits[(unsigned char)bytes[i] >> 4];
    s += digits[(unsigned char)bytes[i] & 15];
  }
  return s;
}

extern "C" {
int guest_out_ptr(void) { return (int)(intptr_t)out_buffer; }
int guest_out_len(void) { return out_length; }

int t_clock(void) {
  auto r = sdm_piv::call("clock.now");
  const auto* t = r.result<A::TimeValue>("TimeValue");
  return report("%d %llu", r.ok(), t ? (unsigned long long)t->UNIX_MS : 0ull);
}
int t_random(void) {
  A::RandomBytesParams p{};
  p.LENGTH = 16;
  auto r = sdm_piv::call("random.bytes", "RandomBytesParams", p);
  return report("%d %zu", r.ok(), r.raw("data").size());
}
int t_ops(void) {
  auto r = sdm_piv::call("host.listOperations");
  const auto items = r.list<A::TextValue>("items", "TextValue");
  int clock = 0;
  for (size_t i = 0; i < items.second; ++i) clock |= items.first[i].VALUE.str() == "clock.now";
  return report("%d %d %d", r.ok(), items.second > 5, clock);
}
int t_schedule(void) {
  A::ScheduleParams p{};
  sdm_piv::put(p.EXPRESSION, "* * * * *"); p.set_has_EXPRESSION(true);
  auto r = sdm_piv::call("schedule.matches", "ScheduleParams", p);
  const auto* b = r.result<A::BoolValue>("BoolValue");
  return report("%d %d", r.ok(), b ? (int)b->VALUE : -1);
}
int t_denied(void) {
  auto r = sdm_piv::call("filesystem.resolvePath", {sdm_piv::raw("path", "demo.txt")});
  return report("%d %s", r.ok(), r.error_code().c_str());
}
int t_files(void) {
  const uint8_t bytes[] = {1, 2, 3, 250};
  auto w = sdm_piv::call("filesystem.writeFile", {sdm_piv::raw("path", "typed/a.bin"), sdm_piv::raw("data", bytes, sizeof bytes)});
  auto r = sdm_piv::call("filesystem.readFile", {sdm_piv::raw("path", "typed/a.bin")});
  auto s = sdm_piv::call("filesystem.stat", {sdm_piv::raw("path", "typed/a.bin")});
  const auto* st = s.result<A::FsStat>("FsStat");
  auto d = sdm_piv::call("filesystem.readdir", {sdm_piv::raw("path", "typed")});
  const auto entries = d.list<A::FsEntry>("entries", "FsEntry");
  return report("%d %d %s %llu %zu %s", w.ok(), r.ok(), hex(r.raw("data"), 4).c_str(), st ? (unsigned long long)st->SIZE : 0ull,
                entries.second, entries.second ? entries.first[0].NAME.str().c_str() : "-");
}
int t_sha(void) {
  auto r = sdm_piv::call("crypto.sha256", {sdm_piv::raw("data", "abc")});
  return report("%d %s", r.ok(), hex(r.raw("data"), 4).c_str());
}
int t_http(int port) {
  char url[64];
  std::snprintf(url, sizeof url, "http://127.0.0.1:%d/gfs.t06z.pgrb2.0p25.f006.idx", port);
  A::HttpParams h{};
  sdm_piv::put(h.METHOD, "GET"); h.set_has_METHOD(true);
  auto r = sdm_piv::call("http.request", "HttpParams", h, {sdm_piv::raw("url", url), sdm_piv::raw("headers", "range: bytes=0-63")});
  const auto* res = r.result<A::HttpResult>("HttpResult");
  return report("%d %d %s", r.ok(), res ? res->STATUS : 0, std::string(r.raw("body")).c_str());
}
int t_context(void) {
  A::ContextParams p{};
  sdm_piv::put(p.SCOPE, "typed"); p.set_has_SCOPE(true);
  sdm_piv::put(p.KEY, "k"); p.set_has_KEY(true);
  auto s = sdm_piv::call("context.set", "ContextParams", p, {sdm_piv::raw("value", "v1")});
  auto g = sdm_piv::call("context.get", "ContextParams", p);
  const auto* found = g.result<A::BoolValue>("BoolValue");
  return report("%d %d %d %s", s.ok(), g.ok(), found ? (int)found->VALUE : -1, std::string(g.raw("value")).c_str());
}
int t_runtime_types(void) {
  flatbuffers::FlatBufferBuilder b(256);
  sdn::runtime::FinishHttpRequestBuffer(b, sdn::runtime::CreateHttpRequestDirect(b, "GET", "https://example.org/x.idx"));
  const auto* request = sdn::runtime::GetHttpRequest(b.GetBufferPointer());
  return report("%s %s", sdn::runtime::HttpRequestIdentifier(), request->URL()->c_str());
}
int t_config(void) {
  const sdm_piv::Config c = sdm_piv::get_config();
  const auto index = c.numbers("index");
  return report("%d %zu %s %zu %.1f %s", c.ok(), c.size(), std::string(c.string("targets.0.provider_id")).c_str(), index.size(),
                c.number("index.999999", -1), c.root() ? "MCFG" : c.error_message().c_str());
}
int t_sync_async(void) {
  auto r = sdm_piv::call("crypto.sha256", {sdm_piv::raw("data", "abc")});
  return report("%d %s", r.ok(), r.error_code().c_str());
}
}
`;

const METHODS = ["t_clock", "t_random", "t_ops", "t_schedule", "t_denied", "t_files", "t_sha", "t_http", "t_context", "t_runtime_types", "t_config", "t_sync_async", "guest_out_ptr", "guest_out_len"];
function manifest() {
  return {
    pluginId: "com.digitalarsenal.examples.typed-hostcalls",
    name: "Typed Hostcall Guest",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: ["clock", "random", "schedule_cron", "filesystem", "crypto_hash", "http", "context_read", "context_write"],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    methods: METHODS.map((methodId) => ({ methodId, displayName: methodId, inputPorts: [], outputPorts: [], maxBatch: 1, drainPolicy: "single-shot" })),
  };
}

let compilation;
test.before(async () => {
  compilation = await compileModuleFromSource({ manifest: manifest(), sourceCode: GUEST_SOURCE, language: "c++", allowUndefinedImports: true });
});
test.after(async () => { if (compilation) await cleanupCompilation(compilation); });

test("typed hostcalls: a C++ module on the sync bridge reads records, lists and raw frames from the Node host", async () => {
  const host = createNodeHost({ capabilities: ["clock", "random", "schedule_cron"], config: { targets: [{ provider_id: "noaa" }], index: [1, 2] } });
  let exports = null;
  const wasi = new WASI({ version: "preview1", args: ["typed"], env: {}, preopens: {}, returnOnExit: true });
  const bridge = createNodeHostSyncHostcallBridge({ host, getMemory: () => exports.memory });
  const { instance } = await WebAssembly.instantiate(compilation.wasmBytes, { ...wasi.getImportObject(), ...bridge.imports });
  exports = instance.exports;
  const run = (name) => {
    assert.equal(exports[name](), 0, name);
    return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, exports.guest_out_ptr(), exports.guest_out_len()));
  };
  const [ok, ms] = run("t_clock").split(" ");
  assert.equal(ok, "1");
  assert.ok(Math.abs(Number(ms) - Date.now()) < 60_000, `clock.now ${ms}`);
  assert.equal(run("t_random"), "1 16");
  assert.equal(run("t_ops"), "1 1 1");
  assert.equal(run("t_schedule"), "1 1");
  // the compiler stages the runtime types a module's ports carry
  assert.equal(run("t_runtime_types"), "HREQ https://example.org/x.idx");
  // plugin.getConfig: one ModuleConfig on raw "config"; "index.999999" is past the end (the default)
  assert.equal(run("t_config"), "1 2 noaa 2 -1.0 MCFG");
  assert.equal(run("t_denied"), "0 not-authorized");
  // an async-only operation on the sync bridge is refused with a code, not a trap
  assert.equal(run("t_sync_async"), "0 unsupported");
  // the bridge's last answer is a $PIV response, not the JSON envelope
  assert.equal(new TextDecoder().decode(bridge.getLastResponseBytes().subarray(4, 8)), "$PIV");
});

test("typed hostcalls: through the worker harness the async operations answer typed", { timeout: 300_000 }, async (t) => {
  if (typeof SharedArrayBuffer !== "function" || typeof Atomics !== "object") { t.skip("SharedArrayBuffer/Atomics unavailable"); return; }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "typed-hostcalls-"));
  let range = null;
  const server = http.createServer((request, response) => {
    range = request.headers.range ?? null;
    response.writeHead(206, { "content-type": "text/plain" });
    response.end("0:0:d=2026101306:PRMSL");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const index = Array.from({ length: 1_000_000 }, (_, i) => i * 0.5);
  const host = createNodeHost({ capabilities: ["filesystem", "crypto_hash", "http", "context_read", "context_write"], allowedHttpOrigins: [`http://127.0.0.1:${server.address().port}`], filesystemRoot: root, config: { targets: [{ provider_id: "noaa" }], index } });
  // the harness carries the host's config object across its SAB channel in its value envelope (~8 MB here; default 4 MiB)
  const harness = await createWorkerModuleHarness({ wasmSource: compilation.wasmBytes, host, maxHostcallResponseBytes: 32 << 20 });
  const run = async (name, ...args) => {
    assert.equal(await harness.callExport(name, ...args), 0, name);
    const ptr = await harness.callExport("guest_out_ptr");
    const len = await harness.callExport("guest_out_len");
    const bytes = await harness.readMemory(ptr, len);
    return new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  };
  try {
    assert.equal(await run("t_files"), "1 1 010203fa 4 1 a.bin");
    assert.deepEqual([...fs.readFileSync(path.join(root, "typed/a.bin"))], [1, 2, 3, 250]);
    assert.equal(await run("t_sha"), "1 ba7816bf");
    assert.equal(await run("t_http", server.address().port), "1 206 0:0:d=2026101306:PRMSL");
    assert.equal(range, "bytes=0-63");
    assert.equal(await run("t_context"), "1 1 1 v1");
    // a 1,000,000-number config (8 MB) crosses the worker harness as one ModuleConfig
    assert.equal(await run("t_config"), "1 2 noaa 1000000 499999.5 MCFG");
    // clock is not granted to this host: refused, typed
    assert.equal(await run("t_clock"), "0 0");
  } finally {
    await harness.destroy?.();
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
