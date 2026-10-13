import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getInvokeCppSchemaHeaders } from "../src/compiler/flatcSupport.js";
import { encodeHostcallEnvelope } from "../src/host/hostcallWire.js";
import { decodePluginInvokeRequest } from "../src/invoke/codec.js";
import {
  HOST_OPERATIONS,
  configEntryKind,
  decodeHostCall,
  decodeHostCallResult,
  encodeHostCall,
  encodeHostCallResult,
  identifierOf,
  isTypedHostCall,
  reconcileKind,
} from "../src/standards/runtimeContracts.js";
import * as hostOps from "../src/generated/runtime/aligned/HostOps_aligned.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// A hostcall is an SDS $PIV invocation in the module -> host direction (typed contracts 1.0): METHOD_ID the operation,
// its "params" an aligned-binary record (HostOps.fbs), unbounded bytes on raw ports beside it, and a $PIV response with
// the "result" record, list / raw ports, or ERROR_CODE / ERROR_MESSAGE - no JSON.
test("hostcall: a $PIV call carries an aligned params record; the result record round-trips; errors carry a code", () => {
  const call = encodeHostCall("storage.expire", { params: { SCHEMA: "WXF.fbs", PROVIDER_ID: "noaa-ncep", BEFORE_MS: 1791900000000n } });
  assert.equal(identifierOf(call), "$PIV");
  assert.equal(isTypedHostCall(call), true);
  const frame = decodePluginInvokeRequest(call).inputs[0];
  assert.deepEqual([frame.portId, frame.typeRef.wireFormat, frame.typeRef.rootTypeName ?? frame.typeRef.rootType, frame.payload.length],
    ["params", "aligned-binary", "StorageExpireParams", hostOps.StorageExpireParams.SIZE]);
  const decoded = decodeHostCall(call);
  assert.deepEqual([decoded.op, decoded.params.SCHEMA, decoded.params.SOURCE_NAME, decoded.params.BEFORE_MS], ["storage.expire", "WXF.fbs", null, 1791900000000n]);

  const ok = decodeHostCallResult(encodeHostCallResult({ ok: true, op: "storage.expire", result: { DELETED: 4608n } }));
  assert.deepEqual([ok.ok, ok.result.DELETED, ok.error], [true, 4608n, null]);

  const refused = decodeHostCallResult(encodeHostCallResult({ ok: false, error: { code: "not-authorized", message: "requires the storage_write capability grant" } }));
  assert.deepEqual(refused, { ok: false, result: null, lists: {}, raw: {}, error: { code: "not-authorized", message: "requires the storage_write capability grant" } });
});

test("hostcall: unbounded bytes travel on raw ports; lists are runs of aligned records", () => {
  const records = new Uint8Array([4, 0, 0, 0, 1, 2, 3, 4]);
  const ingest = decodeHostCall(encodeHostCall("storage.ingest_with_source", {
    params: { SCHEMA: "WXF.fbs", PROVIDER_ID: "noaa-ncep", SOURCE_NAME: "gfs-0p25-sea", BATCH_ID: "c".repeat(64), RECONCILE: reconcileKind.Current },
    raw: { records },
  }));
  assert.deepEqual(ingest.raw.records, records);
  assert.deepEqual([ingest.params.SOURCE_NAME, ingest.params.RECONCILE], ["gfs-0p25-sea", reconcileKind.Current]);

  const url = `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261013/06/atmos/${"x".repeat(400)}.idx`;   // longer than any aligned string
  const http = decodeHostCall(encodeHostCall("http.request", { params: { METHOD: "GET" }, raw: { url, headers: "range: bytes=0-1023\r\n" } }));
  assert.deepEqual([http.params.METHOD, http.params.NO_REDIRECTS, new TextDecoder().decode(http.raw.url)], ["GET", false, url]);

  const config = decodeHostCallResult(encodeHostCallResult({ op: "plugin.getConfig", ok: true, lists: { entries: [
    { KEY: "nwp_max_lead", KIND: configEntryKind.Number, NUMBER_VALUE: 72 },
    { KEY: "targets.0.provider_id", KIND: configEntryKind.String, STRING_VALUE: "noaa-ncep" },
  ] } }));
  assert.deepEqual(config.lists.entries.map((e) => [e.KEY, e.NUMBER_VALUE, e.STRING_VALUE]), [["nwp_max_lead", 72, null], ["targets.0.provider_id", 0, "noaa-ncep"]]);
  assert.deepEqual(decodeHostCallResult(encodeHostCallResult({ op: "plugin.getConfig", ok: true, lists: { entries: [] } })).lists.entries, []);
  assert.deepEqual(decodeHostCall(encodeHostCall("plugin.getConfig")), { op: "plugin.getConfig", params: null, lists: {}, raw: {} });
});

test("hostcall: refuses unknown operations and ports, strings too long for their record, and unknown error codes", () => {
  assert.throws(() => encodeHostCall("no.such"), /unknown operation no.such/);
  assert.throws(() => encodeHostCall("storage.expire", { params: { SCHEMA: "x".repeat(100) } }), /SCHEMA.*exceeds/);
  assert.throws(() => encodeHostCall("storage.expire", { params: { NOPE: 1 } }), /no field NOPE/);
  assert.throws(() => encodeHostCall("plugin.getConfig", { params: { SCHEMA: "x" } }), /takes no params record/);
  assert.throws(() => encodeHostCall("storage.expire", { raw: { body: "x" } }), /no raw port body/);
  assert.throws(() => encodeHostCallResult({ ok: false, error: { code: "nope" } }), /unknown error code/);
});

test("hostcall: tells a $PIV call from the JSON envelope", () => {
  assert.equal(isTypedHostCall(encodeHostCall("clock.now")), true);
  assert.equal(isTypedHostCall(encodeHostcallEnvelope({ a: 1 })), false);
});

test("hostcall: every operation names generated aligned records", () => {
  const ops = Object.keys(HOST_OPERATIONS);
  assert.ok(ops.length >= 90, `${ops.length} operations`);
  const isRecord = (type) => typeof hostOps[type] === "function" && hostOps[type].SIZE > 0;
  for (const [op, spec] of Object.entries(HOST_OPERATIONS)) {
    for (const type of [spec.params, spec.result, ...Object.values(spec.listsIn), ...Object.values(spec.listsOut)]) {
      if (type) assert.ok(isRecord(type), `${op}: ${type}`);
    }
  }
});

// The C++ guest (src/host/cpp/typedHostcall.hpp) against a host stub: the stub records the $PIV request the guest sent
// and answers with a $PIV response the JS encoder built; JS decodes the guest's request (the SDK codec also checks
// that PAYLOAD_ARENA starts 8-byte aligned).
test("hostcall: the C++ guest sends aligned records and raw frames the JS decoder reads, and reads the answer in place", async (t) => {
  const cxx = process.env.CXX || "c++";
  const fbInclude = process.env.FLATBUFFERS_INCLUDE || path.resolve(ROOT, "../../main-packages/flatbuffers/include");
  try { execFileSync(cxx, ["--version"], { stdio: "ignore" }); } catch { t.skip(`no C++ compiler (${cxx})`); return; }
  if (!fs.existsSync(path.join(fbInclude, "flatbuffers/flatbuffers.h"))) { t.skip(`no flatbuffers headers at ${fbInclude} (set FLATBUFFERS_INCLUDE)`); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdn-piv-hostcall-"));
  for (const [rel, text] of Object.entries(await getInvokeCppSchemaHeaders())) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  const answers = path.join(dir, "answers"), sent = path.join(dir, "sent"), src = path.join(dir, "guest.cpp"), exe = path.join(dir, "guest");
  fs.mkdirSync(answers);
  fs.mkdirSync(sent);
  fs.writeFileSync(path.join(answers, "0"), encodeHostCallResult({ ok: true, op: "storage.expire", result: { DELETED: 4608n } }));
  fs.writeFileSync(path.join(answers, "1"), encodeHostCallResult({ ok: true, op: "http.request", result: { STATUS: 206 }, raw: { body: "0:0:d=2026101306:PRMSL" } }));
  fs.writeFileSync(path.join(answers, "2"), encodeHostCallResult({ ok: true, op: "plugin.getConfig", lists: { entries: [{ KEY: "nwp_max_lead", KIND: configEntryKind.Number, NUMBER_VALUE: 72 }, { KEY: "a", STRING_VALUE: "b" }] } }));
  fs.writeFileSync(path.join(answers, "3"), encodeHostCallResult({ ok: false, error: { code: "not-authorized", message: "no grant" } }));
  fs.writeFileSync(src, `
#include <cstdio>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>
#include "typedHostcall.hpp"
namespace A = sdn::runtime::Aligned;
static std::vector<uint8_t> g_answer;
static std::string g_dir_answers, g_dir_sent;
static int g_n = 0;
extern "C" int32_t sdm_piv_host_call(const uint8_t*, int32_t, const uint8_t* payload, int32_t len) {
  std::ofstream(g_dir_sent + "/" + std::to_string(g_n), std::ios::binary).write(reinterpret_cast<const char*>(payload), len);
  std::ifstream in(g_dir_answers + "/" + std::to_string(g_n++), std::ios::binary);
  g_answer.assign(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
  return 0;
}
extern "C" int32_t sdm_piv_host_response_len(void) { return static_cast<int32_t>(g_answer.size()); }
extern "C" int32_t sdm_piv_host_read_response(uint8_t* dst, int32_t len) {
  const int32_t n = len < (int32_t)g_answer.size() ? len : (int32_t)g_answer.size();
  std::memcpy(dst, g_answer.data(), n);
  return n;
}
int main(int argc, char** argv) {
  g_dir_answers = argv[1];
  g_dir_sent = argv[2];
  A::StorageExpireParams p{};
  sdm_piv::put(p.SCHEMA, "WXF.fbs"); p.set_has_SCHEMA(true);
  sdm_piv::put(p.PROVIDER_ID, "noaa-ncep"); p.set_has_PROVIDER_ID(true);
  p.BEFORE_MS = 1791900000000ull; p.BATCH = 500; p.MAX_DELETES = 100000;
  const bool too_long = !sdm_piv::put(p.SOURCE_NAME, std::string(200, 'x'));
  auto r = sdm_piv::call("storage.expire", "StorageExpireParams", p);
  const auto* out = r.result<A::StorageExpireResult>("StorageExpireResult");
  A::HttpParams h{};
  sdm_piv::put(h.METHOD, "GET"); h.set_has_METHOD(true);
  const std::string url = "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261013/06/atmos/gfs.t06z.pgrb2.0p25.f006.idx";
  auto g = sdm_piv::call("http.request", "HttpParams", h, {sdm_piv::raw("url", url), sdm_piv::raw("headers", "range: bytes=0-63\\r\\n")});
  auto c = sdm_piv::call("plugin.getConfig");
  const auto entries = c.list<A::ConfigEntry>("entries", "ConfigEntry");
  auto f = sdm_piv::call("clock.now");
  std::printf("%d %d %llu|%d %d %s|%zu %s %g|%d %s %s\\n", too_long, r.ok(), out ? (unsigned long long)out->DELETED : 0ull,
              g.ok(), g.result<A::HttpResult>() ? g.result<A::HttpResult>()->STATUS : 0, std::string(g.raw("body")).c_str(),
              entries.second, entries.second ? entries.first[0].KEY.str().c_str() : "", entries.second ? entries.first[0].NUMBER_VALUE : 0.0,
              f.ok(), f.error_code().c_str(), f.error_message().c_str());
  return 0;
}
`);
  execFileSync(cxx, ["-std=c++17", "-I", dir, "-I", path.join(ROOT, "src/generated/runtime/cpp"), "-I", path.join(ROOT, "src/host/cpp"), "-I", fbInclude, src, "-o", exe], { stdio: "pipe" });
  assert.equal(execFileSync(exe, [answers, sent], { encoding: "utf8" }).trim(),
    "1 1 4608|1 206 0:0:d=2026101306:PRMSL|2 nwp_max_lead 72|0 not-authorized no grant");
  const expire = decodeHostCall(fs.readFileSync(path.join(sent, "0")));
  assert.deepEqual([expire.op, expire.params.SCHEMA, expire.params.PROVIDER_ID, expire.params.SOURCE_NAME, expire.params.BEFORE_MS, expire.params.BATCH],
    ["storage.expire", "WXF.fbs", "noaa-ncep", null, 1791900000000n, 500]);
  const http = decodeHostCall(fs.readFileSync(path.join(sent, "1")));
  assert.deepEqual([http.op, http.params.METHOD, new TextDecoder().decode(http.raw.url), new TextDecoder().decode(http.raw.headers)],
    ["http.request", "GET", "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261013/06/atmos/gfs.t06z.pgrb2.0p25.f006.idx", "range: bytes=0-63\r\n"]);
  assert.deepEqual(decodeHostCall(fs.readFileSync(path.join(sent, "2"))), { op: "plugin.getConfig", params: null, lists: {}, raw: {} });
  fs.rmSync(dir, { recursive: true, force: true });
});
