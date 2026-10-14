import test from "node:test";
import assert from "node:assert/strict";
import { WASI } from "node:wasi";

import { cleanupCompilation, compileModuleFromSource } from "../src/index.js";
import { createNodeHost } from "../src/host/nodeHost.js";
import { createBrowserHost } from "../src/host/browserHost.js";
import { createNodeHostSyncHostcallBridge } from "../src/host/abi.js";
import { createWorkerModuleHarness } from "../src/host/workerModuleHarness.js";

// The Go node's operations on the SDK JS hosts: a C++ module calls plugin.getConfig, node.*, secrets.*, storage.*,
// p2p.* and node status / activity as typed $PIV hostcalls; NodeHost and BrowserHost answer them from their config
// option and from capability adapters shaped like the Go node's handlers (sdn-server internal/modulert/caps, bytes as
// Uint8Array). Every list and raw port has to arrive - on the sync bridge (sync adapters) and through the worker
// harness (async adapters).
const GUEST_SOURCE = `
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include "typedHostcall.hpp"
#include "HostOps_aligned.h"

namespace A = sdn::runtime::Aligned;
static char out_buffer[4096];
static int out_length = 0;
static int report(const char* format, ...) __attribute__((format(printf, 1, 2)));
static int report(const char* format, ...) {
  va_list args;
  va_start(args, format);
  out_length = std::vsnprintf(out_buffer, sizeof out_buffer, format, args);
  va_end(args);
  return 0;
}
static std::string hex(std::string_view bytes) {
  static const char* digits = "0123456789abcdef";
  std::string s;
  for (unsigned char c : bytes) { s += digits[c >> 4]; s += digits[c & 15]; }
  return s;
}
static unsigned long long u(uint64_t v) { return (unsigned long long)v; }
#define TEXT(record, field, value) (sdm_piv::put((record).field, value), (record).set_has_##field(true))
#define FAILED(r) if (!(r).ok()) return report("0 %s %s", (r).error_code().c_str(), (r).error_message().c_str())

extern "C" {
int guest_out_ptr(void) { return (int)(intptr_t)out_buffer; }
int guest_out_len(void) { return out_length; }

int t_config(void) {
  auto r = sdm_piv::call("plugin.getConfig");
  FAILED(r);
  auto e = r.list<A::ConfigEntry>("entries", "ConfigEntry");
  std::string s;
  char number[64];
  for (size_t i = 0; i < e.second; ++i) {
    const auto& entry = e.first[i];
    s += entry.KEY.str() + "=";
    if (entry.KIND == A::configEntryKind_String) s += "s:" + entry.STRING_VALUE.str();
    else if (entry.KIND == A::configEntryKind_Number) { std::snprintf(number, sizeof number, "n:%g", entry.NUMBER_VALUE); s += number; }
    else s += entry.BOOL_VALUE ? "b:true" : "b:false";
    s += ";";
  }
  return report("1 %zu %s", e.second, s.c_str());
}
int t_node(void) {
  auto p = sdm_piv::call("node.peerId");
  FAILED(p);
  auto k = sdm_piv::call("node.publicKey");
  FAILED(k);
  return report("1 %s %s", std::string(p.raw("value")).c_str(), std::string(k.raw("value")).c_str());
}
int t_secrets(void) {
  A::SecretParams p{};
  TEXT(p, ID, "noaa-key");
  TEXT(p, USERNAME, "tj");
  auto g = sdm_piv::call("secrets.get", "SecretParams", p);
  FAILED(g);
  const auto* gr = g.result<A::SecretResult>("SecretResult");
  auto s = sdm_piv::call("secrets.status", "SecretParams", p);
  FAILED(s);
  const auto* sr = s.result<A::SecretResult>("SecretResult");
  auto w = sdm_piv::call("secrets.put", "SecretParams", p, {sdm_piv::raw("secret", "n3w")});
  FAILED(w);
  const auto* wr = w.result<A::SecretResult>("SecretResult");
  auto c = sdm_piv::call("secrets.clear", "SecretParams", p);
  FAILED(c);
  return report("1 %s %s %d %s|%d %s %llu|%d|%d", gr->ID.str().c_str(), gr->USERNAME.str().c_str(), (int)gr->CONFIGURED,
                std::string(g.raw("secret")).c_str(), (int)sr->CONFIGURED, sr->USERNAME_MASKED.str().c_str(), u(sr->UPDATED_MS),
                (int)wr->CONFIGURED, (int)c.ok());
}
int t_write(void) {
  A::StorageWriteParams p{};
  TEXT(p, SCHEMA, "WXF.fbs");
  const uint8_t bytes[] = {0, 1, 2, 255};
  auto r = sdm_piv::call("storage.write", "StorageWriteParams", p, {sdm_piv::raw("data", bytes, sizeof bytes)});
  FAILED(r);
  const auto* w = r.result<A::StorageWriteResult>("StorageWriteResult");
  return report("1 %s", w ? w->CID.str().c_str() : "-");
}
int t_query(void) {
  A::StorageQueryParams p{};
  TEXT(p, SCHEMA, "WXF.fbs");
  p.LIMIT = 10;
  auto r = sdm_piv::call("storage.query", "StorageQueryParams", p);
  FAILED(r);
  auto m = r.list<A::StoredRecordMeta>("records_meta", "StoredRecordMeta");
  std::string s;
  char row[512];
  for (size_t i = 0; i < m.second; ++i) {
    const auto& x = m.first[i];
    std::snprintf(row, sizeof row, "%s:%lld:%s:%lld:%lld:%u:%s:%s:%s:%s:%s,", x.CID.str().c_str(), (long long)x.ROW_ID, x.PEER_ID.str().c_str(),
                  (long long)x.TIMESTAMP_MS, (long long)x.MATERIALIZED_MS, x.LENGTH, x.PROVIDER_ID.str().c_str(), x.SOURCE_NAME.str().c_str(),
                  x.BATCH_ID.str().c_str(), x.PRODUCER_PEER_ID.str().c_str(), x.LICENSE.str().c_str());
    s += row;
  }
  return report("1 %zu %s %s", m.second, s.c_str(), hex(r.raw("records")).c_str());
}
int t_delete(void) {
  A::StorageDeleteParams p{};
  TEXT(p, SCHEMA, "WXF.fbs");
  TEXT(p, CID, "cid-a");
  auto r = sdm_piv::call("storage.delete", "StorageDeleteParams", p);
  FAILED(r);
  return report("1");
}
int t_expire(void) {
  A::StorageExpireParams p{};
  TEXT(p, SCHEMA, "WXF.fbs");
  TEXT(p, PROVIDER_ID, "noaa");
  TEXT(p, SOURCE_NAME, "gfs");
  p.BEFORE_MS = 1791849600000ull;
  p.MAX_DELETES = 100;
  auto r = sdm_piv::call("storage.expire", "StorageExpireParams", p);
  FAILED(r);
  const auto* x = r.result<A::StorageExpireResult>("StorageExpireResult");
  return report("1 %llu %llu %d", u(x->DELETED), u(x->MISSING), (int)x->CAPPED);
}
int t_ingest(void) {
  A::StorageIngestParams p{};
  TEXT(p, SCHEMA, "WXF.fbs");
  TEXT(p, PROVIDER_ID, "noaa");
  TEXT(p, SOURCE_NAME, "gfs");
  TEXT(p, BATCH_ID, "b1");
  TEXT(p, LICENSE, "CC0-1.0");
  p.SHARE_ALIKE = true;
  p.RECONCILE = A::reconcileKind_Current;
  TEXT(p, ARCHIVE_SOURCE, "noaa");
  TEXT(p, ARCHIVE_NAME, "gfs.idx");
  A::Provenance prov{};
  TEXT(prov, SOURCE_URL, "https://noaa.example/gfs.idx");
  prov.HTTP_STATUS = 200;
  prov.RETRIEVED_MS = 1791849600000ull;
  TEXT(prov, PARSER, "grib2-idx");
  prov.NORMALIZED_COUNT = 2;
  prov.FROM_CACHE = true;
  A::ProvenanceAttribute attributes[2]{};
  TEXT(attributes[0], NAME, "method");
  TEXT(attributes[0], VALUE, "nearest-neighbour regrid to 0.25 deg");
  TEXT(attributes[1], NAME, "units");
  TEXT(attributes[1], VALUE, "m s-1");
  const uint8_t records[] = {2, 0, 0, 0, 1, 2, 1, 0, 0, 0, 3};
  auto r = sdm_piv::call("storage.ingest_with_source", "StorageIngestParams", p,
                         {sdm_piv::raw("records", records, sizeof records), sdm_piv::raw("archive", "idx-bytes"),
                          sdm_piv::list("provenance", "Provenance", &prov, 1),
                          sdm_piv::list("provenance_attributes", "ProvenanceAttribute", attributes, 2)});
  FAILED(r);
  const auto* x = r.result<A::StorageIngestResult>("StorageIngestResult");
  return report("1 %s %s %llu %llu %llu %s %s", x->SCHEMA.str().c_str(), x->BATCH_ID.str().c_str(), u(x->INSERTED), u(x->RECONCILED_DUPLICATES),
                u(x->RECONCILED_OLD_BATCHES), x->ARCHIVED.str().c_str(), x->PROVENANCE_FILE.str().c_str());
}
int t_sql_stream(void) {
  A::SqlStreamParams p{};
  p.DELIVER = A::deliverMode_Inline;
  const uint8_t key[] = {0xde, 0xad, 0xbe, 0xef};
  const std::string long_text(300, 'x');
  sdm_piv::SqlValues v;
  v.i64(9007199254740993ll).str("OMM").f64(1.5).boolean(true).null().bytes(key, sizeof key).str(long_text);
  auto r = sdm_piv::call("storage.flatsql_query_stream", "SqlStreamParams", p,
                         {sdm_piv::raw("sql", "SELECT data FROM OMM WHERE NORAD_CAT_ID > ? AND OBJECT = ?"), v.frame()});
  FAILED(r);
  const auto* x = r.result<A::StreamResult>("StreamResult");
  return report("1 %llu %u %d %s", u(x->ROWS), x->COLUMNS, (int)x->has_REF(), hex(r.raw("stream")).c_str());
}
int t_epoch(void) {
  A::EpochStreamParams p{};
  TEXT(p, SCHEMA, "OMM.fbs");
  TEXT(p, PROFILE, "nearest");
  p.EPOCH = 2461000.5;
  p.LIMIT = 5;
  p.DELIVER = A::deliverMode_Ref;
  auto r = sdm_piv::call("storage.flatsql_epoch_stream", "EpochStreamParams", p);
  FAILED(r);
  const auto* x = r.result<A::StreamResult>("StreamResult");
  return report("1 %llu %u %d %llu %llu %lld %s %zu", u(x->ROWS), x->COLUMNS, (int)x->has_REF(), u(x->REF.TOKEN), u(x->REF.SIZE),
                (long long)x->REF.FRAMES, x->REF.FNV1A64.str().c_str(), r.raw("stream").size());
}
int t_sandboxed(void) {
  A::SandboxQueryParams p{};
  p.WANT = A::sandboxWant_Rows;
  auto r = sdm_piv::call("storage.query_sandboxed", "SandboxQueryParams", p, {sdm_piv::raw("sql", "SELECT NAME, N FROM t")});
  FAILED(r);
  const auto* x = r.result<A::SandboxQueryResult>("SandboxQueryResult");
  auto cols = r.list<A::TextValue>("columns", "TextValue");
  std::vector<sdm_piv::SqlValue> cells;
  if (!sdm_piv::read_sql_values(r.raw("cells"), cells)) return report("0 malformed cells");
  std::string c, v;
  char cell[300];
  for (size_t i = 0; i < cols.second; ++i) c += cols.first[i].VALUE.str() + ",";
  for (const auto& k : cells) {
    if (k.tag == sdm_piv::kSqlStr) std::snprintf(cell, sizeof cell, "s:%zu:%c,", k.payload.size(), k.payload.empty() ? '-' : k.payload[0]);
    else if (k.tag == sdm_piv::kSqlI64) std::snprintf(cell, sizeof cell, "i:%lld,", (long long)k.as_i64());
    else if (k.tag == sdm_piv::kSqlF64) std::snprintf(cell, sizeof cell, "f:%g,", k.as_f64());
    else if (k.tag == sdm_piv::kSqlBool) std::snprintf(cell, sizeof cell, "b:%d,", (int)k.as_bool());
    else std::snprintf(cell, sizeof cell, "null,");
    v += cell;
  }
  return report("1 %d %llu %u %s %s", (int)x->KIND, u(x->ROWS), x->COLUMNS, c.c_str(), v.c_str());
}
int t_surface(void) {
  auto r = sdm_piv::call("storage.query_surface");
  FAILED(r);
  const auto* x = r.result<A::QuerySurfaceLimits>("QuerySurfaceLimits");
  auto tables = r.list<A::SurfaceTable>("tables", "SurfaceTable");
  auto cols = r.list<A::SurfaceColumn>("columns", "SurfaceColumn");
  std::string t, c;
  for (size_t i = 0; i < tables.second; ++i)
    t += tables.first[i].NAME.str() + ":" + tables.first[i].KIND.str() + ":" + tables.first[i].SOURCE.str() + ":" + std::to_string(tables.first[i].RECORDS) + ",";
  for (size_t i = 0; i < cols.second; ++i) c += cols.first[i].TABLE.str() + "." + cols.first[i].NAME.str() + ":" + std::to_string((int)cols.first[i].PLACEHOLDER) + ",";
  return report("1 %u %llu %llu %s %s", x->TIMEOUT_MS, u(x->MAX_ROWS), u(x->MAX_BYTES), t.c_str(), c.c_str());
}
int t_cache_key(void) {
  A::CacheKeyParams p{};
  TEXT(p, SCHEMA_NAME, "OMM.fbs");
  TEXT(p, FORMAT, "json");
  A::TextValue projection[2]{};
  TEXT(projection[0], VALUE, "NORAD_CAT_ID");
  TEXT(projection[1], VALUE, "EPOCH");
  auto r = sdm_piv::call("storage.flatsql_cache_key", "CacheKeyParams", p,
                         {sdm_piv::raw("sql", "SELECT * FROM OMM"), sdm_piv::list("projection", "TextValue", projection, 2)});
  FAILED(r);
  return report("1 %s", std::string(r.raw("value")).c_str());
}
int t_peers(void) {
  A::P2pParams p{};
  auto r = sdm_piv::call("p2p.peers_snapshot", "P2pParams", p);
  FAILED(r);
  const auto* x = r.result<A::P2pSummary>("P2pSummary");
  auto peers = r.list<A::P2pPeer>("peers", "P2pPeer");
  auto addrs = r.list<A::P2pPeerValue>("peer_addresses", "P2pPeerValue");
  auto stds = r.list<A::P2pPeerValue>("peer_standards", "P2pPeerValue");
  std::string s, a, d;
  for (size_t i = 0; i < peers.second; ++i) {
    const auto& q = peers.first[i];
    s += q.PEER_ID.str() + ":" + std::to_string((int)q.CONNECTED) + ":" + std::to_string((int)q.SELF) + ":" + std::to_string(q.EPM_INDEX) + ":" + q.AGENT_VERSION.str() + ",";
  }
  for (size_t i = 0; i < addrs.second; ++i) a += addrs.first[i].PEER_ID.str() + "=" + addrs.first[i].VALUE.str() + ",";
  for (size_t i = 0; i < stds.second; ++i) d += stds.first[i].PEER_ID.str() + "=" + stds.first[i].VALUE.str() + ",";
  return report("1 %s %s %s %s %s", x->SELF.str().c_str(), s.c_str(), a.c_str(), d.c_str(), hex(r.raw("records")).c_str());
}
static std::string pnm(const A::P2pPnmEntry& e) {
  char row[1400];
  std::snprintf(row, sizeof row, "%s:%s:%s:%s:%s:%s:%s:%s:%llu:%s:%s:%d:%s:%d:%s:%s,", e.PEER_ID.str().c_str(), e.PUBLISHER_PEER_ID.str().c_str(),
                e.GOSSIP_PEER_ID.str().c_str(), e.STANDARD.str().c_str(), e.SCHEMA.str().c_str(), e.FILE_ID.str().c_str(), e.FILE_NAME.str().c_str(),
                e.CID.str().c_str(), u(e.PUBLISH_MS), e.SIGNATURE_TYPE.str().c_str(), e.SIGNATURE_HEX.str().c_str(), (int)e.SIGNATURE_VERIFIED,
                e.ATTRIBUTION.str().c_str(), e.PNM_INDEX, e.PUBLISHER_KEY_HEX.str().c_str(), e.PUBLISHER_KEY_SOURCE.str().c_str());
  return row;
}
int t_standards(void) {
  A::P2pParams p{};
  auto r = sdm_piv::call("p2p.standards_snapshot", "P2pParams", p);
  FAILED(r);
  auto e = r.list<A::P2pPnmEntry>("entries", "P2pPnmEntry");
  std::string s;
  for (size_t i = 0; i < e.second; ++i) s += pnm(e.first[i]);
  return report("1 %zu %s %s", e.second, s.c_str(), hex(r.raw("records")).c_str());
}
int t_history(void) {
  A::P2pParams p{};
  TEXT(p, PEER_ID, "12D3Other");
  p.LIMIT = 5;
  auto r = sdm_piv::call("p2p.pnm_history", "P2pParams", p);
  FAILED(r);
  const auto* x = r.result<A::P2pSummary>("P2pSummary");
  auto e = r.list<A::P2pPnmEntry>("entries", "P2pPnmEntry");
  std::string s;
  for (size_t i = 0; i < e.second; ++i) s += pnm(e.first[i]);
  return report("1 %s %d %u %zu %s %s", x->PEER_ID.str().c_str(), (int)x->PUBLISHER_KEY_AVAILABLE, x->GOSSIP_ONLY_EXCLUDED, e.second, s.c_str(),
                hex(r.raw("records")).c_str());
}
int t_latest(void) {
  A::P2pParams p{};
  TEXT(p, PEER_ID, "12D3Other");
  TEXT(p, STANDARD, "OMM");
  auto r = sdm_piv::call("p2p.latest_dataset", "P2pParams", p);
  FAILED(r);
  const auto* x = r.result<A::P2pLatestDataset>("P2pLatestDataset");
  return report("1 %d %d %d %d %s %s %s %s %s %llu %d %s %s %s %s %llu %llu %u %llu %s %d %s", (int)x->KNOWN, (int)x->PINNED, (int)x->SELF, (int)x->FRESH,
                x->STANDARD.str().c_str(), x->SCHEMA.str().c_str(), x->PNM_CID.str().c_str(), x->PNM_FILE_ID.str().c_str(), x->REASON.str().c_str(),
                u(x->PNM_PUBLISH_MS), (int)x->PNM_SIGNATURE_VERIFIED, x->PNM_ATTRIBUTION.str().c_str(), x->BATCH_ID.str().c_str(),
                x->PROVIDER_ID.str().c_str(), x->SOURCE_NAME.str().c_str(), u(x->RECORD_COUNT), u(x->BYTE_COUNT), x->PARTS, u(x->PUBLISHED_MS),
                x->ETAG_FNV1A64.str().c_str(), (int)x->has_REF(), hex(r.raw("stream")).c_str());
}
int t_status(void) {
  auto r = sdm_piv::call("node_status_read.status");
  FAILED(r);
  const auto* x = r.result<A::NodeStatusReport>("NodeStatusReport");
  auto h = r.list<A::NodeBandwidthSample>("bandwidth_history", "NodeBandwidthSample");
  std::string s;
  char row[200];
  for (size_t i = 0; i < h.second; ++i) {
    std::snprintf(row, sizeof row, "%llu:%llu:%llu:%g:%g,", u(h.first[i].TS_MS), u(h.first[i].TOTAL_IN_BYTES), u(h.first[i].TOTAL_OUT_BYTES),
                  h.first[i].RATE_IN_BPS, h.first[i].RATE_OUT_BPS);
    s += row;
  }
  return report("1 %llu %llu %llu %llu %s %d %llu %llu %llu %s %s %d %llu %llu %g %g %s", u(x->UPTIME_S), u(x->STARTED_MS), u(x->STORE_TOTAL_BYTES),
                u(x->STORE_TOTAL_RECORDS), x->STORAGE_PATH.str().c_str(), (int)x->HAS_DISK, u(x->DISK_CAPACITY_BYTES), u(x->DISK_FREE_BYTES),
                u(x->DISK_AVAILABLE_BYTES), x->SERVICE_STATE.str().c_str(), x->SERVICE_MODE.str().c_str(), (int)x->HAS_BANDWIDTH,
                u(x->TOTAL_IN_BYTES), u(x->TOTAL_OUT_BYTES), x->RATE_IN_BPS, x->RATE_OUT_BPS, s.c_str());
}
int t_activity(void) {
  A::NodeActivityParams p{};
  p.LIMIT = 3;
  auto r = sdm_piv::call("node_activity_read.activity", "NodeActivityParams", p);
  FAILED(r);
  auto e = r.list<A::NodeActivityEvent>("events", "NodeActivityEvent");
  std::string s;
  for (size_t i = 0; i < e.second; ++i)
    s += std::to_string(e.first[i].TS_MS) + ":" + e.first[i].KIND.str() + ":" + e.first[i].DETAIL.str() + ":" + e.first[i].PEER_ID.str() + ",";
  return report("1 %zu %s", e.second, s.c_str());
}
}
`;

const METHODS = ["t_config", "t_node", "t_secrets", "t_write", "t_query", "t_delete", "t_expire", "t_ingest", "t_sql_stream", "t_epoch", "t_sandboxed",
  "t_surface", "t_cache_key", "t_peers", "t_standards", "t_history", "t_latest", "t_status", "t_activity", "guest_out_ptr", "guest_out_len"];
const GRANTED = ["secrets", "storage_query", "storage_write", "storage_ingest", "p2p_read", "node_status_read", "node_activity_read"];

function manifest() {
  return {
    pluginId: "com.digitalarsenal.examples.typed-host-adapters",
    name: "Typed Host Adapters Guest",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: ["storage_query", "storage_write", "storage_ingest", "p2p_read"],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    methods: METHODS.map((methodId) => ({ methodId, displayName: methodId, inputPorts: [], outputPorts: [], maxBatch: 1, drainPolicy: "single-shot" })),
  };
}

const CONFIG = { name: "gfs", enabled: true, targets: [{ provider_id: "noaa", widths: [1, 2.5] }], unset: null };
const T0 = "2026-10-13T00:00:00Z";
const T0_MS = Date.parse(T0);
const T6 = "2026-10-13T06:00:00Z";
const T6_MS = Date.parse(T6);
const FILE_ID = `OMM.fbs:${"c".repeat(64)}`; // a publication's FILE_ID: the schema and its sha256 batch id
const bytes = (...b) => new Uint8Array(b);

// In-test adapters shaped like the Go node's capability handlers; `wrap` makes each answer sync or a Promise.
function adapters(wrap) {
  const calls = [];
  const method = (name, answer) => (params) => { calls.push([name, params]); return wrap(answer(params)); };
  const pnmPointer = { CID: "bafy-pnm", FILE_ID, PUBLISH_TIMESTAMP: T0, batch_id: "b1", standard: "OMM", schema: "OMM.fbs", signature_verified: true, attribution: "signature" };
  return {
    calls,
    node: {
      peerId: "12D3KooWSelf",
      publicKey: method("node.publicKey", () => "08011220abcd"),
      status: method("node.status", () => ({
        uptime_seconds: 3600, started_at: T0,
        store: { total_bytes: 5_000_000_000, total_records: 5000, storage_path: "/var/lib/sdn" },
        service: { state: "running", mode: "systemd" },
        disk: { capacity_bytes: 100_000_000_000, free_bytes: 40_000_000_000, available_bytes: 38_000_000_000 },
        bandwidth: {
          total_in_bytes: 1000, total_out_bytes: 2000, rate_in_bps: 1.5, rate_out_bps: 2.5,
          history: [{ ts: T0, total_in_bytes: 10, total_out_bytes: 20, rate_in_bps: 0.5, rate_out_bps: 0.25 }, { ts: T6, total_in_bytes: 30, total_out_bytes: 40, rate_in_bps: 1, rate_out_bps: 2 }],
        },
      })),
      activity: method("node.activity", () => ({ events: [{ ts: T6, kind: "ingest", detail: "WXF 2 records", peer_id: "12D3Other" }, { ts: T0, kind: "peer", detail: "connected" }] })),
    },
    secrets: {
      get: method("secrets.get", (p) => ({ id: p.id, username: p.username, secret: "s3cr3t" })),
      status: method("secrets.status", (p) => ({ id: p.id, configured: true, username_masked: "t*", updated_at: T0 })),
      put: method("secrets.put", (p) => ({ id: p.id, stored: true, updatedAt: T6 })),
      clear: method("secrets.clear", () => true),
    },
    storage: {
      write: method("storage.write", () => ({ cid: "bafy-1" })),
      query: method("storage.query", () => [
        { CID: "cid-a", RowID: 7, PeerID: "12D3Other", Timestamp: T0, MaterializedAt: T6, SourceTags: { ProviderID: "noaa", SourceName: "gfs", BatchID: "b1", ProducerPeerID: "12D3KooWSelf", License: "CC0-1.0" }, Data: bytes(1, 2, 3) },
        { CID: "cid-b", RowID: 8, PeerID: "12D3Other", Timestamp: T6, MaterializedAt: T6, SourceTags: {}, Data: bytes(4, 5) },
      ]),
      delete: method("storage.delete", () => true),
      expire: method("storage.expire", () => ({ deleted: 12, missing: 1, capped: false })),
      ingest_with_source: method("storage.ingest_with_source", () => ({ schema: "WXF.fbs", inserted: 2, batch_id: "b1", reconciled_old_batches: 3, reconciled_duplicates: 0, archived: "/raw/noaa/2026-10-13/gfs.idx", provenance: "/raw/provenance/gfs/p.json" })),
      flatsql_query_stream: method("storage.flatsql_query_stream", () => ({ rows: 2, columns: 1, stream: bytes(9, 9, 9, 9) })),
      flatsql_epoch_stream: method("storage.flatsql_epoch_stream", () => ({ rows: 5, columns: 1, ref: { token: 42, size: 1000, frames: 5, fnv1a64: "00ff00ff00ff00ff" } })),
      query_sandboxed: method("storage.query_sandboxed", () => ({ kind: "rows", rows: 2, columns: 2, json: new TextEncoder().encode('[{"NAME":"a","N":1},{"NAME":"' + "y".repeat(300) + '","N":2.5}]') })),
      query_surface: method("storage.query_surface", () => ({ tables: [{ name: "WXF", kind: "table", source: "records", records: 10, columns: ["CID", { name: "EPOCH", placeholder: true }] }], caps: { timeout_ms: 5000, max_rows: 1000, max_bytes: 1048576 } })),
      flatsql_cache_key: method("storage.flatsql_cache_key", (p) => ({ key: `ck-${p.schema_name}-${p.format}-${p.projection.join(",")}` })),
    },
    p2p: {
      peers_snapshot: method("p2p.peers_snapshot", () => ({
        self: "12D3KooWSelf",
        peers: [
          { peer_id: "12D3KooWSelf", addrs: ["/ip4/10.0.0.1/tcp/4001", "/ip4/10.0.0.1/udp/4001/quic-v1"], connected: true, self: true, standards: ["OMM"], epm_index: 0, agent_version: "sdn/1.0" },
          { peer_id: "12D3Other", addrs: [], connected: false, self: false, standards: ["CAT", "OMM"], epm_index: -1 },
        ],
        records: bytes(4, 0, 0, 0, 0xe, 0xb, 0xa, 0xd),
      })),
      standards_snapshot: method("p2p.standards_snapshot", () => ({
        entries: [{ peer_id: "12D3Other", standard: "OMM", schema: "OMM.fbs", file_id: FILE_ID, file_name: "omm.fb", cid: "bafy-pnm", publish_timestamp: T0, pnm_index: 0 }],
        records: bytes(2, 0, 0, 0, 0xa, 0xb),
      })),
      pnm_history: method("p2p.pnm_history", (p) => ({
        peer_id: p.peer_id, publisher_key_available: true, gossip_only_excluded: 2,
        entries: [{ publisher_peer_id: p.peer_id, gossip_peer_id: "12D3Relay", standard: "OMM", schema: "OMM.fbs", file_id: FILE_ID, file_name: "omm.fb", cid: "bafy-pnm", publish_timestamp: T6, signature_type: "ed25519", signature: "abcd01", signature_verified: true, attribution: "signature", pnm_index: 0, publisher_key: "08011220", publisher_key_source: "peer-id" }],
        records: bytes(1, 0, 0, 0, 0xc),
      })),
      latest_dataset: method("p2p.latest_dataset", () => ({
        known: true, pinned: true, self: false, standard: "OMM", schema: "OMM.fbs", pnm: { ...pnmPointer, CID: "bafy-newest" }, fresh: true,
        serving: { batch_id: "b1", provider_id: "noaa", source_name: "gfs", record_count: 3, byte_count: 4, parts: 1, published_at: T6, pnm: pnmPointer, etag_fnv1a64: "0123456789abcdef", stream: bytes(7, 7, 7, 7) },
      })),
    },
  };
}

// What the module reads back, whichever host and bridge answer it.
const EXPECTED = {
  t_config: "1 5 enabled=b:true;name=s:gfs;targets.0.provider_id=s:noaa;targets.0.widths.0=n:1;targets.0.widths.1=n:2.5;",
  t_node: "1 12D3KooWSelf 08011220abcd",
  t_secrets: `1 noaa-key tj 1 s3cr3t|1 t* ${T0_MS}|1|1`,
  t_write: "1 bafy-1",
  t_query: `1 2 cid-a:7:12D3Other:${T0_MS}:${T6_MS}:3:noaa:gfs:b1:12D3KooWSelf:CC0-1.0,cid-b:8:12D3Other:${T6_MS}:${T6_MS}:2:::::, 03000000010203020000000405`,
  t_delete: "1",
  t_expire: "1 12 1 0",
  t_ingest: "1 WXF.fbs b1 2 0 3 /raw/noaa/2026-10-13/gfs.idx /raw/provenance/gfs/p.json",
  t_sql_stream: "1 2 1 0 09090909",
  t_epoch: "1 5 1 1 42 1000 5 00ff00ff00ff00ff 0",
  t_sandboxed: "1 1 2 2 NAME,N, s:1:a,i:1,s:300:y,f:2.5,",
  t_surface: "1 5000 1000 1048576 WXF:table:records:10, WXF.CID:0,WXF.EPOCH:1,",
  t_cache_key: "1 ck-OMM.fbs-json-NORAD_CAT_ID,EPOCH",
  t_peers: "1 12D3KooWSelf 12D3KooWSelf:1:1:0:sdn/1.0,12D3Other:0:0:-1:, 12D3KooWSelf=/ip4/10.0.0.1/tcp/4001,12D3KooWSelf=/ip4/10.0.0.1/udp/4001/quic-v1, 12D3KooWSelf=OMM,12D3Other=CAT,12D3Other=OMM, 040000000e0b0a0d",
  t_standards: `1 1 12D3Other:::OMM:OMM.fbs:${FILE_ID}:omm.fb:bafy-pnm:${T0_MS}:::0::0::, 020000000a0b`,
  t_history: `1 12D3Other 1 2 1 :12D3Other:12D3Relay:OMM:OMM.fbs:${FILE_ID}:omm.fb:bafy-pnm:${T6_MS}:ed25519:abcd01:1:signature:0:08011220:peer-id, 010000000c`,
  t_latest: `1 1 1 0 1 OMM OMM.fbs bafy-pnm ${FILE_ID}  ${T0_MS} 1 signature b1 noaa gfs 3 4 1 ${T6_MS} 0123456789abcdef 0 07070707`,
  t_status: `1 3600 ${T0_MS} 5000000000 5000 /var/lib/sdn 1 100000000000 40000000000 38000000000 running systemd 1 1000 2000 1.5 2.5 ${T0_MS}:10:20:0.5:0.25,${T6_MS}:30:40:1:2,`,
  t_activity: `1 2 ${T6_MS}:ingest:WXF 2 records:12D3Other,${T0_MS}:peer:connected:,`,
};

// What the adapters receive: the Go node's handler requests, bytes as Uint8Array.
function assertRequests(calls) {
  const request = (name) => {
    const found = calls.find(([n]) => n === name);
    assert.ok(found, `${name} was called`);
    return found[1];
  };
  const write = request("storage.write");
  assert.equal(write.schema, "WXF.fbs");
  assert.ok(write.data instanceof Uint8Array);
  assert.deepEqual([...write.data], [0, 1, 2, 255]);
  assert.deepEqual(request("storage.query"), { schema: "WXF.fbs", limit: 10 });
  assert.deepEqual(request("storage.delete"), { schema: "WXF.fbs", cid: "cid-a" });
  assert.deepEqual(request("storage.expire"), { schema: "WXF.fbs", provider_id: "noaa", source_name: "gfs", before_ms: 1791849600000, max_deletes: 100 });
  const ingest = request("storage.ingest_with_source");
  assert.deepEqual([...ingest.records], [2, 0, 0, 0, 1, 2, 1, 0, 0, 0, 3]);
  assert.equal(ingest.archive.source, "noaa");
  assert.equal(ingest.archive.name, "gfs.idx");
  assert.equal(new TextDecoder().decode(ingest.archive.raw), "idx-bytes");
  assert.equal(ingest.provenance.source, "gfs");
  assert.ok(ingest.provenance.json instanceof Uint8Array);
  const provenance = JSON.parse(new TextDecoder().decode(ingest.provenance.json));
  assert.equal(provenance.source_url, "https://noaa.example/gfs.idx");
  assert.equal(provenance.http_status, 200);
  assert.equal(provenance.retrieved_ms, 1791849600000);
  assert.equal(provenance.parser, "grib2-idx");
  assert.equal(provenance.normalized_count, 2);
  assert.equal(provenance.from_cache, true);
  assert.deepEqual(provenance.attributes, [{ name: "method", value: "nearest-neighbour regrid to 0.25 deg" }, { name: "units", value: "m s-1" }]);
  assert.deepEqual(Object.keys(provenance), Object.keys(provenance).slice().sort());
  const { records, archive, provenance: _p, ...tags } = ingest;
  assert.deepEqual(tags, { schema: "WXF.fbs", provider_id: "noaa", source_name: "gfs", batch_id: "b1", license: "CC0-1.0", share_alike: true, reconcile: "current" });
  assert.deepEqual(request("storage.flatsql_query_stream"), {
    sql: "SELECT data FROM OMM WHERE NORAD_CAT_ID > ? AND OBJECT = ?",
    params: [{ t: "i64", v: "9007199254740993" }, { t: "str", v: "OMM" }, { t: "f64", v: 1.5 }, { t: "bool", v: true }, { t: "null" },
      { t: "bytes", v: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) }, { t: "str", v: "x".repeat(300) }],
  });
  assert.deepEqual(request("storage.flatsql_epoch_stream"), { schema: "OMM.fbs", profile: "nearest", epoch: 2461000.5, limit: 5, deliver: "ref" });
  assert.deepEqual(request("storage.query_sandboxed"), { sql: "SELECT NAME, N FROM t", want: "rows" });
  assert.deepEqual(request("storage.flatsql_cache_key"), { schema_name: "OMM.fbs", format: "json", sql: "SELECT * FROM OMM", projection: ["NORAD_CAT_ID", "EPOCH"] });
  assert.deepEqual(request("secrets.get"), { id: "noaa-key", username: "tj" });
  assert.deepEqual(request("secrets.put"), { id: "noaa-key", username: "tj", secret: "n3w" });
  assert.deepEqual(request("p2p.peers_snapshot"), {});
  assert.deepEqual(request("p2p.pnm_history"), { peer_id: "12D3Other", limit: 5 });
  assert.deepEqual(request("p2p.latest_dataset"), { peer_id: "12D3Other", standard: "OMM" });
  assert.deepEqual(request("node.activity"), { limit: 3 });
}

const HOSTS = {
  NodeHost: (options) => createNodeHost(options),
  BrowserHost: (options) => createBrowserHost(options),
};

let compilation;
test.before(async () => {
  compilation = await compileModuleFromSource({ manifest: manifest(), sourceCode: GUEST_SOURCE, language: "c++", allowUndefinedImports: true });
});
test.after(async () => { if (compilation) await cleanupCompilation(compilation); });

async function syncGuest(host) {
  let exports = null;
  const wasi = new WASI({ version: "preview1", args: ["typed-adapters"], env: {}, preopens: {}, returnOnExit: true });
  const bridge = createNodeHostSyncHostcallBridge({ host, getMemory: () => exports.memory });
  const { instance } = await WebAssembly.instantiate(compilation.wasmBytes, { ...wasi.getImportObject(), ...bridge.imports });
  exports = instance.exports;
  return async (name) => {
    assert.equal(exports[name](), 0, name);
    return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, exports.guest_out_ptr(), exports.guest_out_len()));
  };
}

for (const [label, createHost] of Object.entries(HOSTS)) {
  test(`typed host adapters: ${label} answers the node's operations on the sync bridge, every list and raw port`, async () => {
    const a = adapters((v) => v);
    const host = createHost({ capabilities: GRANTED, config: CONFIG, capabilityAdapters: { node: a.node, secrets: a.secrets, storage: a.storage, p2p: a.p2p } });
    assert.ok(host.listOperations().includes("plugin.getConfig"));
    for (const op of ["storage.expire", "p2p.latest_dataset", "node_status_read.status", "secrets.get", "node.peerId"]) assert.ok(host.listOperations().includes(op), op);
    const run = await syncGuest(host);
    for (const [name, expected] of Object.entries(EXPECTED)) assert.equal(await run(name), expected, `${label} ${name}`);
    assertRequests(a.calls);

    // capability-gated (typed not-authorized), adapter-gated (unsupported), config defaults to {}
    const bare = await syncGuest(createHost({ capabilities: ["clock"], capabilityAdapters: { p2p: a.p2p } }));
    assert.match(await bare("t_peers"), /^0 not-authorized /);
    assert.equal(await bare("t_config"), "1 0 ");
    const noAdapter = await syncGuest(createHost({ capabilities: GRANTED }));
    assert.match(await noAdapter("t_expire"), /^0 unsupported storage adapter is not configured/);
    // an async adapter on the sync bridge is refused with a code, not a trap
    const asyncOnSync = await syncGuest(createHost({ capabilities: GRANTED, capabilityAdapters: { storage: adapters((v) => Promise.resolve(v)).storage } }));
    assert.match(await asyncOnSync("t_expire"), /^0 unsupported /);
  });

  test(`typed host adapters: ${label} answers them through the worker harness from async adapters`, { timeout: 300_000 }, async (t) => {
    if (typeof SharedArrayBuffer !== "function" || typeof Atomics !== "object") { t.skip("SharedArrayBuffer/Atomics unavailable"); return; }
    const a = adapters((v) => new Promise((resolve) => setTimeout(() => resolve(v), 1)));
    const host = createHost({ capabilities: GRANTED, config: CONFIG, capabilityAdapters: { node: a.node, secrets: a.secrets, storage: a.storage, p2p: a.p2p } });
    const harness = await createWorkerModuleHarness({ wasmSource: compilation.wasmBytes, host });
    const run = async (name) => {
      assert.equal(await harness.callExport(name), 0, name);
      const ptr = await harness.callExport("guest_out_ptr");
      const len = await harness.callExport("guest_out_len");
      const out = await harness.readMemory(ptr, len);
      return new TextDecoder().decode(out instanceof Uint8Array ? out : new Uint8Array(out));
    };
    try {
      for (const [name, expected] of Object.entries(EXPECTED)) assert.equal(await run(name), expected, `${label} ${name}`);
      assertRequests(a.calls);
    } finally {
      await harness.destroy?.();
    }
  });
}
