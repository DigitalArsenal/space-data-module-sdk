import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HostCallParams,
  HostCallValue,
  IngestRequestT,
  SourceTagsT,
  StorageExpireParamsT,
  StorageExpireResultT,
  StorageIngestParamsT,
  decodeHostCall,
  decodeHostCallResult,
  encodeHostCall,
  encodeHostCallResult,
  identifierOf,
  reconcileMode,
} from "../src/standards/runtimeContracts.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The typed hostcall envelope (typed contracts 1.0): a HostCall (HCLQ) carries the operation and its typed
// parameters, a HostCallResult (HCLR) the typed value or a typed error - no JSON meta, no base64, no segments.
test("hostcall: a call and its typed result round-trip; errors carry a code", () => {
  const call = encodeHostCall("storage.expire", "StorageExpireParams", new StorageExpireParamsT("WXF.fbs", "noaa-ncep", "", 1791900000000n, 0, 0));
  assert.equal(identifierOf(call), "HCLQ");
  const decoded = decodeHostCall(call);
  assert.equal(decoded.op, "storage.expire");
  assert.equal(decoded.paramsType, "StorageExpireParams");
  assert.equal(decoded.params.SCHEMA, "WXF.fbs");
  assert.equal(decoded.params.BEFORE_MS, 1791900000000n);

  const ok = decodeHostCallResult(encodeHostCallResult({ ok: true, valueType: "StorageExpireResult", value: new StorageExpireResultT(4608n, 0n, false) }));
  assert.deepEqual([ok.ok, ok.valueType, ok.value.DELETED, ok.error], [true, "StorageExpireResult", 4608n, null]);

  const refused = decodeHostCallResult(encodeHostCallResult({ ok: false, error: { code: "notAuthorized", message: "requires the storage_write capability grant" } }));
  assert.deepEqual(refused, { ok: false, valueType: null, value: null, error: { code: "notAuthorized", message: "requires the storage_write capability grant", sandbox: "", capability: "" } });
});

test("hostcall: a record stream travels as bytes inside the typed ingest call", () => {
  const records = new Uint8Array([4, 0, 0, 0, 1, 2, 3, 4]);
  const request = new IngestRequestT("WXF.fbs", new SourceTagsT("noaa-ncep", "gfs-0p25-sea", "c".repeat(64)), reconcileMode.Duplicates, null, null);
  const decoded = decodeHostCall(encodeHostCall("storage.ingest_with_source", "StorageIngestParams", new StorageIngestParamsT(request, Array.from(records), [])));
  assert.equal(decoded.paramsType, "StorageIngestParams");
  assert.deepEqual(Uint8Array.from(decoded.params.RECORDS), records);
  assert.equal(decoded.params.REQUEST.TAGS.SOURCE_NAME, "gfs-0p25-sea");
});

test("hostcall: refuses an unknown union member and a value without its generated type", () => {
  assert.throws(() => encodeHostCall("x.y", "NoSuchParams", new StorageExpireParamsT()), /unknown member NoSuchParams/);
  assert.throws(() => encodeHostCall("storage.expire", "StorageExpireParams", { SCHEMA: "x" }), /needs a generated object/);
  assert.throws(() => encodeHostCallResult({ ok: false, error: { code: "nope" } }), /unknown error code/);
});

// The module side (src/host/cpp/typedHostcall.hpp) against a host stub in the same program: the stub records the HCLQ
// frame the guest sent and answers with an HCLR; JS then decodes what the C++ guest sent.
test("hostcall: the C++ guest helper calls a host and reads its typed answer", (t) => {
  const cxx = process.env.CXX || "c++";
  const fbInclude = process.env.FLATBUFFERS_INCLUDE || path.resolve(ROOT, "../../main-packages/flatbuffers/include");
  try { execFileSync(cxx, ["--version"], { stdio: "ignore" }); } catch { t.skip(`no C++ compiler (${cxx})`); return; }
  if (!fs.existsSync(path.join(fbInclude, "flatbuffers/flatbuffers.h"))) { t.skip(`no flatbuffers headers at ${fbInclude} (set FLATBUFFERS_INCLUDE)`); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdn-typed-hostcall-"));
  const src = path.join(dir, "guest.cpp"), exe = path.join(dir, "guest"), sent = path.join(dir, "sent.bin");
  fs.writeFileSync(src, `
#include <cstdio>
#include <vector>
#include "typedHostcall.hpp"
// ---- a host stub: records the call, answers storage.expire with StorageExpireResult{deleted 4608}, others with an error
static std::vector<uint8_t> g_request, g_response;
extern "C" int32_t sdm_typed_host_call(const uint8_t*, int32_t, const uint8_t* payload, int32_t len) {
  g_request.assign(payload, payload + len);
  flatbuffers::Verifier v(payload, len);
  flatbuffers::FlatBufferBuilder b;
  if (!sdn::runtime::VerifyHostCallBuffer(v)) return 1;
  const auto* call = sdn::runtime::GetHostCall(payload);
  if (call->OP()->str() == "storage.expire" && call->PARAMS_type() == sdn::runtime::HostCallParams_StorageExpireParams) {
    auto value = sdn::runtime::CreateStorageExpireResult(b, 4608, 0, false);
    sdn::runtime::FinishHostCallResultBuffer(b, sdn::runtime::CreateHostCallResult(b, true, 0, sdn::runtime::HostCallValue_StorageExpireResult, value.Union()));
  } else {
    auto err = sdn::runtime::CreateHostCallErrorDirect(b, sdn::runtime::hostCallErrorCode_Unsupported, "operation not supported");
    sdn::runtime::FinishHostCallResultBuffer(b, sdn::runtime::CreateHostCallResult(b, false, err));
  }
  g_response.assign(b.GetBufferPointer(), b.GetBufferPointer() + b.GetSize());
  return 0;
}
extern "C" int32_t sdm_typed_host_response_len(void) { return static_cast<int32_t>(g_response.size()); }
extern "C" int32_t sdm_typed_host_read_response(uint8_t* dst, int32_t len) {
  const int32_t n = len < (int32_t)g_response.size() ? len : (int32_t)g_response.size();
  std::memcpy(dst, g_response.data(), n);
  return n;
}
// ---- the guest
int main(int argc, char** argv) {
  auto r = sdm_typed::call("storage.expire", [](flatbuffers::FlatBufferBuilder& b) {
    return sdm_typed::params(sdn::runtime::HostCallParams_StorageExpireParams,
                             sdn::runtime::CreateStorageExpireParamsDirect(b, "WXF.fbs", "noaa-ncep", nullptr, 1791900000000ull, 500, 100000));
  });
  FILE* f = std::fopen(argv[1], "wb"); std::fwrite(g_request.data(), 1, g_request.size(), f); std::fclose(f);
  const auto* expired = r.value_as<sdn::runtime::StorageExpireResult>();
  auto u = sdm_typed::call("no.such");
  std::printf("%d %llu %d %d %s\\n", r.ok(), expired ? (unsigned long long)expired->DELETED() : 0ull, u.ok(), (int)u.code(), u.message().c_str());
  return 0;
}
`);
  execFileSync(cxx, ["-std=c++17", "-I", path.join(ROOT, "src/generated/runtime/cpp"), "-I", path.join(ROOT, "src/host/cpp"), "-I", fbInclude, src, "-o", exe], { stdio: "pipe" });
  const out = execFileSync(exe, [sent], { encoding: "utf8" }).trim();
  assert.equal(out, `1 4608 0 ${1} operation not supported`.replace(" 1 operation", ` ${Number(1)} operation`));
  const call = decodeHostCall(fs.readFileSync(sent));
  assert.equal(call.op, "storage.expire");
  assert.equal(call.paramsType, "StorageExpireParams");
  assert.equal(call.params.PROVIDER_ID, "noaa-ncep");
  assert.equal(call.params.BEFORE_MS, 1791900000000n);
  assert.equal(call.params.BATCH, 500);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("hostcall: every union member name resolves in both directions", () => {
  for (const [name, tag] of Object.entries(HostCallParams)) if (typeof tag === "number" && tag) assert.equal(HostCallParams[tag], name);
  for (const [name, tag] of Object.entries(HostCallValue)) if (typeof tag === "number" && tag) assert.equal(HostCallValue[tag], name);
});

test("hostcall: the operation set names real union members, once each", async () => {
  const { HOST_OPERATIONS } = await import("../src/standards/runtimeContracts.js");
  const ops = Object.keys(HOST_OPERATIONS);
  assert.equal(new Set(ops).size, ops.length);
  assert.ok(ops.length >= 80, `${ops.length} operations`);
  for (const [op, { params, result }] of Object.entries(HOST_OPERATIONS)) {
    assert.match(op, /^[a-z0-9]+(?:\.[a-z0-9_]+)+$/, `${op}: snake_case family.operation`);
    assert.equal(typeof HostCallParams[params], "number", `${op}: params ${params}`);
    assert.equal(typeof HostCallValue[result], "number", `${op}: result ${result}`);
  }
  // every params member is used by some operation (no orphan tables)
  const used = new Set(Object.values(HOST_OPERATIONS).map((o) => o.params));
  for (const [name, tag] of Object.entries(HostCallParams)) if (typeof tag === "number" && tag) assert.ok(used.has(name), `params ${name} unused`);
});

test("hostcall: the wire tells a typed call from the JSON envelope", async () => {
  const { isTypedHostCall } = await import("../src/standards/runtimeContracts.js");
  const { encodeHostcallEnvelope } = await import("../src/host/hostcallWire.js");
  const typed = encodeHostCall("clock.now", "ClockNowParams", new (await import("../src/standards/runtimeContracts.js")).ClockNowParamsT());
  assert.equal(isTypedHostCall(typed), true);
  assert.equal(isTypedHostCall(new Uint8Array(8)), false);
  if (encodeHostcallEnvelope) assert.equal(isTypedHostCall(encodeHostcallEnvelope({ a: 1 })), false);
});
