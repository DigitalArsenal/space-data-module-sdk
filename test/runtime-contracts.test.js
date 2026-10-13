import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RUNTIME_FILE_IDENTIFIERS,
  decodeFlowNotice,
  decodeHttpRequest,
  decodeHttpResponse,
  decodeIngestRequest,
  decodeIngestResult,
  decodeModuleConfig,
  decodeTimerTick,
  encodeFlowNotice,
  encodeHttpRequest,
  encodeHttpResponse,
  encodeIngestRequest,
  encodeIngestResult,
  encodeModuleConfig,
  encodeTimerTick,
  identifierOf,
} from "../src/standards/runtimeContracts.js";
import { sharedModuleCatalog } from "../src/standards/sharedCatalog.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The typed frames that replace the JSON contracts (typed-contracts 1.0): each one round-trips through its FlatBuffer
// exactly, carries its file identifier, and a decoder refuses another frame.
test("runtime contracts: every frame round-trips and carries its file identifier", () => {
  const cases = [
    ["TimerTick", encodeTimerTick, decodeTimerTick, { triggerId: "timer-nwp", scheduledMs: 1791900000000, firedMs: 1791900000123, sequence: 41 }],
    ["HttpRequest", encodeHttpRequest, decodeHttpRequest, {
      method: "GET", url: "https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261013/06/atmos/gfs.t06z.pgrb2.0p25.f006",
      headers: { range: "bytes=1024-2047", "user-agent": "sdn" }, body: new Uint8Array(0), timeoutMs: 60000, maxBytes: 67108864,
      context: encodeFlowNotice({ kind: "info", reason: "a typed context" }),
    }],
    ["HttpResponse", encodeHttpResponse, decodeHttpResponse, {
      url: "https://example.org/x.idx", status: 304, headers: { etag: "\"abc\"" }, body: new Uint8Array([1, 2, 3]), context: new Uint8Array([9, 8]), error: "", retrievedMs: 1791900001000,
    }],
    ["ModuleConfig", encodeModuleConfig, decodeModuleConfig, {
      nwp_products: "gfs-0p50-clouds,gfs-0p25-sea", nwp_max_lead: 72, nwp_live_access: true, widths: [4096, 2048, 1024], satellites: ["goes-east", "goes-west"],
      targets: [{ schema: "WXF.fbs", provider_id: "noaa-ncep" }, { schema: "WXF.fbs", provider_id: "noaa-goes", sources: ["noaa-goes19-world"] }],
    }],
    ["IngestRequest", encodeIngestRequest, decodeIngestRequest, {
      schema: "WXF.fbs",
      tags: { providerId: "noaa-ncep", sourceName: "gfs-0p25-sea", batchId: "c".repeat(64), sourceUrl: "https://noaa-gfs-bdp-pds.s3.amazonaws.com/x", contentKeyId: "public",
        sourcePeer: "source:noaa", license: "CC0-1.0", licenseUrl: "https://www.weather.gov/disclaimer", citation: "NOAA NCEP GFS", shareAlike: false },
      reconcile: "duplicates", archive: { source: "noaa-ncep", name: "gfs.grib2" },
      provenance: { sourceUrl: "https://noaa-gfs-bdp-pds.s3.amazonaws.com/x", httpStatus: 206, etag: "\"e\"", lastModified: "Tue, 13 Oct 2026 09:30:00 GMT", contentType: "application/octet-stream",
        retrievedMs: 1791900002000, parser: "nwp-grib2-parser", parserVersion: "0.2.0", sourceSha256: "a".repeat(64), normalizedSha256: "b".repeat(64), normalizedCount: 9,
        schemaCounts: { "WXF.fbs": 9 }, warnings: [], fromCache: false },
    }],
    ["IngestResult", encodeIngestResult, decodeIngestResult, {
      schema: "WXF.fbs", providerId: "noaa-ncep", sourceName: "gfs-0p25-sea", batchId: "c".repeat(64), inserted: 9, reconciledDuplicates: 0, reconciledOldBatches: 0, archived: "", refused: "",
    }],
    ["FlowNotice", encodeFlowNotice, decodeFlowNotice, {
      kind: "unchanged", schema: "WXF.fbs", providerId: "noaa-ncep", sourceName: "gfs-0p25-sea", batchId: "", count: 25, reason: "inventories-unchanged",
      items: ["https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261013/06/atmos/gfs.t06z.pgrb2.0p25.f000.idx"], atMs: 0,
    }],
  ];
  for (const [name, encode, decode, value] of cases) {
    const bytes = encode(value);
    assert.equal(identifierOf(bytes), RUNTIME_FILE_IDENTIFIERS[name], `${name} identifier`);
    assert.deepEqual(decode(bytes), value, `${name} round trip`);
    for (const [other, , otherDecode] of cases) if (other !== name) assert.throws(() => otherDecode(bytes), new RegExp(`not a ${RUNTIME_FILE_IDENTIFIERS[other]} frame`), `${other} refuses ${name}`);
  }
});

test("runtime contracts: the request's typed context comes back out of the response untouched", () => {
  const context = encodeFlowNotice({ kind: "info", reason: "lead 6 of gfs 2026101306" });
  const request = decodeHttpRequest(encodeHttpRequest({ url: "https://example.org/a", context }));
  const response = decodeHttpResponse(encodeHttpResponse({ status: 200, context: request.context }));
  assert.equal(identifierOf(response.context), "FNTC");
  assert.equal(decodeFlowNotice(response.context).reason, "lead 6 of gfs 2026101306");
});

test("runtime contracts: config refuses values with no typed kind", () => {
  assert.throws(() => encodeModuleConfig({ x: null }), /no config value kind/);
  assert.throws(() => encodeModuleConfig({ x: [1, "a"] }), /mixes value kinds/);
});

test("runtime contracts: every runtime contract is in the shared module catalog with their identifiers", () => {
  for (const [name, id] of Object.entries(RUNTIME_FILE_IDENTIFIERS)) {
    const entry = sharedModuleCatalog.find((e) => e.schemaName === `${name}.fbs`);
    assert.ok(entry, `${name}.fbs registered`);
    assert.equal(entry.fileIdentifier, id);
    assert.equal(entry.source, "shared-module-runtime");
  }
});

// The C++ headers modules inline compile (a host C++ compiler and the stack's flatbuffers headers; skipped when
// either is absent) and a frame they build decodes in JS.
test("runtime contracts: the generated C++ headers compile and their frames decode in JS", (t) => {
  const cxx = process.env.CXX || "c++";
  const fbInclude = process.env.FLATBUFFERS_INCLUDE || path.resolve(ROOT, "../../main-packages/flatbuffers/include");
  try { execFileSync(cxx, ["--version"], { stdio: "ignore" }); } catch { t.skip(`no C++ compiler (${cxx})`); return; }
  if (!fs.existsSync(path.join(fbInclude, "flatbuffers/flatbuffers.h"))) { t.skip(`no flatbuffers headers at ${fbInclude} (set FLATBUFFERS_INCLUDE)`); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sdn-runtime-contracts-"));
  const src = path.join(dir, "notice.cpp"), exe = path.join(dir, "notice"), out = path.join(dir, "notice.bin");
  fs.writeFileSync(src, `
#include <cstdio>
#include "TimerTick_generated.h"
#include "HttpRequest_generated.h"
#include "HttpResponse_generated.h"
#include "ModuleConfig_generated.h"
#include "IngestRequest_generated.h"
#include "IngestResult_generated.h"
#include "FlowNotice_generated.h"
int main(int argc, char** argv) {
  flatbuffers::FlatBufferBuilder b;
  auto notice = sdn::runtime::CreateFlowNoticeDirect(b, sdn::runtime::flowNoticeKind_Expired, "WXF.fbs", "noaa-ncep", nullptr, nullptr, 4608, "window");
  sdn::runtime::FinishFlowNoticeBuffer(b, notice);
  FILE* f = std::fopen(argv[1], "wb");
  std::fwrite(b.GetBufferPointer(), 1, b.GetSize(), f);
  std::fclose(f);
  return 0;
}
`);
  execFileSync(cxx, ["-std=c++17", "-I", path.join(ROOT, "src/generated/runtime/cpp"), "-I", fbInclude, src, "-o", exe], { stdio: "pipe" });
  execFileSync(exe, [out]);
  const notice = decodeFlowNotice(fs.readFileSync(out));
  assert.deepEqual(notice, { kind: "expired", schema: "WXF.fbs", providerId: "noaa-ncep", sourceName: "", batchId: "", count: 4608, reason: "window", items: [], atMs: 0 });
  fs.rmSync(dir, { recursive: true, force: true });
});
