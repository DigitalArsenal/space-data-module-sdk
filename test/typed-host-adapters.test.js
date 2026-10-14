import test from "node:test";
import assert from "node:assert/strict";
import { WASI } from "node:wasi";
import { createCipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, sign as createSignature, verify as verifySignature } from "node:crypto";

import { cleanupCompilation, compileModuleFromSource } from "../src/index.js";
import { createNodeHost } from "../src/host/nodeHost.js";
import { createBrowserHost } from "../src/host/browserHost.js";
import { createNodeHostSyncHostcallBridge } from "../src/host/abi.js";
import { createWorkerModuleHarness } from "../src/host/workerModuleHarness.js";
import { getWasmWallet } from "../src/utils/wasmCrypto.js";

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
#include <unistd.h>
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

static void dump(const sdm_piv::ConfigTable& t, std::string& s) {
  char number[64];
  if (!t.entries()) return;
  for (const auto* e : *t.entries()) {
    s += e->KEY()->str() + "=";
    switch (e->KIND()) {
      case sdn::runtime::configValueKind_String: s += "s:" + (e->STRING_VALUE() ? e->STRING_VALUE()->str() : std::string()); break;
      case sdn::runtime::configValueKind_Number: std::snprintf(number, sizeof number, "n:%g", e->NUMBER_VALUE()); s += number; break;
      case sdn::runtime::configValueKind_Bool: s += e->BOOL_VALUE() ? "b:true" : "b:false"; break;
      case sdn::runtime::configValueKind_NumberList:
        s += "n[";
        for (double v : t.numbers(e->KEY()->c_str())) { std::snprintf(number, sizeof number, "%g,", v); s += number; }
        s += "]";
        break;
      case sdn::runtime::configValueKind_StringList:
        s += "s[";
        for (auto v : t.strings(e->KEY()->c_str())) { s += std::string(v) + ","; }
        s += "]";
        break;
      case sdn::runtime::configValueKind_TableList:
        s += "[";
        for (size_t i = 0; i < t.tables(e->KEY()->c_str()); ++i) { s += "{"; dump(t.table(e->KEY()->c_str(), i), s); s += "}"; }
        s += "]";
        break;
    }
    s += ";";
  }
}
int t_config(void) {
  const sdm_piv::Config c = sdm_piv::get_config();
  FAILED(c);
  std::string s;
  dump(c, s);
  // bounds: an item past a list's end is missing; count() reads a list's length
  return report("1 %zu %s|%s|%g|%d|%d %d %zu %zu %d", c.size(), s.c_str(), std::string(c.string("targets.0.provider_id")).c_str(),
                c.number("targets.0.widths.1"), (int)c.boolean("enabled"), (int)c.has("targets.0.widths.5"),
                (int)c.has("targets.0.widths.1"), c.count("targets.0.widths"), c.count("targets"), (int)c.has("targets.3"));
}
// A large config (a 1,000,000-number index): the module's memory grows by about the payload, not by a record per
// value. Reports the count, the sum, the payload size and the growth in bytes.
int t_big_config(void) {
  const uintptr_t before = (uintptr_t)sbrk(0);
  const size_t pages_before = __builtin_wasm_memory_size(0);
  const sdm_piv::Config c = sdm_piv::get_config();
  FAILED(c);
  const uintptr_t after = (uintptr_t)sbrk(0);
  const size_t pages_after = __builtin_wasm_memory_size(0);
  const auto index = c.numbers("index");
  double sum = 0;
  for (double v : index) sum += v;
  return report("1 %zu %.0f %zu %zu %zu %zu", index.size(), sum, c.byte_size(), (size_t)(after - before), pages_before, pages_after);
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
// keyslot, protocol, ipfs, pubsub: their answers on raw "data" and the list ports
static std::string items(const sdm_piv::Response& r) {
  auto v = r.list<A::TextValue>("items", "TextValue");
  std::string s;
  for (size_t i = 0; i < v.second; ++i) s += v.first[i].VALUE.str() + ",";
  return s;
}
int t_keyslot_sign(void) {
  A::KeyslotParams p{};
  TEXT(p, SLOT_ID, "sign-ed");
  auto ed = sdm_piv::call("keyslot.sign", "KeyslotParams", p, {sdm_piv::raw("payload", "sign me")});
  FAILED(ed);
  A::KeyslotParams k{};
  TEXT(k, SLOT_ID, "sign-k1");
  k.ALGORITHM = A::cryptoAlgorithm_Secp256k1;
  auto k1 = sdm_piv::call("keyslot.sign", "KeyslotParams", k, {sdm_piv::raw("payload", "sign me")});
  FAILED(k1);
  return report("1 %s %s", hex(ed.raw("data")).c_str(), hex(k1.raw("data")).c_str());
}
// crypto.secp256k1.*: the key and node:crypto's signatures, made by the test: "<private> <public 65> <public 33>
// <digest> <DER over sha256(message)> <raw over sha256(message)> <DER over sha256(sha256(message))>" (hex): the last a
// double-hashed signature, which must be refused. Reports what each operation answers.
static std::string unhex(const std::string& h) {
  std::string b;
  for (size_t i = 0; i + 1 < h.size(); i += 2) b += (char)std::stoi(h.substr(i, 2), nullptr, 16);
  return b;
}
static std::string answer_of(const sdm_piv::Response& r, bool boolean) {
  if (!r.ok()) return r.error_code();
  if (boolean) { const auto* v = r.result<A::BoolValue>("BoolValue"); return v && v->VALUE ? "true" : "false"; }
  return hex(r.raw("data"));
}
int t_secp256k1(void) {
  std::string staged("@K1@"), part[7];
  for (int i = 0, at = 0; i < 7; ++i) { size_t sp = staged.find(' ', at); part[i] = staged.substr(at, sp == std::string::npos ? std::string::npos : sp - at); at = (int)sp + 1; }
  const std::string key = unhex(part[0]), pub65 = unhex(part[1]), pub33 = unhex(part[2]), digest = unhex(part[3]), der = unhex(part[4]), rs = unhex(part[5]), doubled = unhex(part[6]);
  const std::string message = "sign me", other = "sign me!";
  std::string s = "1 ";
  s += answer_of(sdm_piv::call("crypto.secp256k1.sign", {sdm_piv::raw("data", message), sdm_piv::raw("private_key", key)}), false) + "|";
  s += answer_of(sdm_piv::call("crypto.secp256k1.verify", {sdm_piv::raw("data", message), sdm_piv::raw("signature", der), sdm_piv::raw("public_key", pub33)}), true) + "|";
  s += answer_of(sdm_piv::call("crypto.secp256k1.verify", {sdm_piv::raw("data", other), sdm_piv::raw("signature", der), sdm_piv::raw("public_key", pub33)}), true) + "|";
  s += answer_of(sdm_piv::call("crypto.secp256k1.verify", {sdm_piv::raw("data", message), sdm_piv::raw("signature", doubled), sdm_piv::raw("public_key", pub33)}), true) + "|";
  s += answer_of(sdm_piv::call("crypto.secp256k1.signDigest", {sdm_piv::raw("data", digest), sdm_piv::raw("private_key", key)}), false) + "|";
  s += answer_of(sdm_piv::call("crypto.secp256k1.verifyDigest", {sdm_piv::raw("data", digest), sdm_piv::raw("signature", rs), sdm_piv::raw("public_key", pub65)}), true) + "|";
  s += answer_of(sdm_piv::call("crypto.secp256k1.verifyDigest", {sdm_piv::raw("data", digest), sdm_piv::raw("signature", rs), sdm_piv::raw("public_key", pub33)}), true) + "|";
  s += answer_of(sdm_piv::call("crypto.secp256k1.verifyDigest", {sdm_piv::raw("data", message), sdm_piv::raw("signature", rs), sdm_piv::raw("public_key", pub33)}), true);
  return report("%s", s.c_str());
}
int t_keyslot_unwrap(void) {
  A::KeyslotParams p{};
  TEXT(p, SLOT_ID, "wrap");
  // the wrapped key's parts, made by the test: "<ephemeral public key hex> <nonce hex> <ciphertext + tag hex>"
  std::string staged("@WRAPPED@"), parts[3];
  for (int i = 0, at = 0; i < 3; ++i) { size_t sp = staged.find(' ', at); parts[i] = staged.substr(at, sp == std::string::npos ? std::string::npos : sp - at); at = (int)sp + 1; }
  auto unhex = [](const std::string& h) { std::string b; for (size_t i = 0; i + 1 < h.size(); i += 2) b += (char)std::stoi(h.substr(i, 2), nullptr, 16); return b; };
  const std::string epk = unhex(parts[0]), nonce = unhex(parts[1]), ct = unhex(parts[2]);
  auto r = sdm_piv::call("keyslot.unwrap", "KeyslotParams", p, {sdm_piv::raw("ephemeral_public_key", epk), sdm_piv::raw("nonce", nonce), sdm_piv::raw("ciphertext", ct)});
  FAILED(r);
  return report("1 %s", std::string(r.raw("data")).c_str());
}
int t_protocol(void) {
  A::ProtocolParams p{};
  TEXT(p, TARGET, "12D3Other");
  TEXT(p, PROTOCOL_ID, "/sdn/echo/1.0.0");
  p.TIMEOUT_MS = 2500;
  const uint8_t payload[] = {0, 1, 2, 250};
  auto r = sdm_piv::call("protocol.request", "ProtocolParams", p, {sdm_piv::raw("payload", payload, sizeof payload)});
  FAILED(r);
  return report("1 %s", hex(r.raw("data")).c_str());
}
// ipfs.cat answered as a Uint8Array, an ArrayBuffer, a typed view, base64 text and {__type: "bytes", base64}; then
// an answer with no bytes
int t_ipfs_cat(void) {
  std::string s;
  for (const char* cid : {"u8", "buffer", "view", "base64", "tagged", "none"}) {
    A::IpfsParams p{};
    TEXT(p, CID, cid);
    auto r = sdm_piv::call("ipfs.cat", "IpfsParams", p);
    s += r.ok() ? hex(r.raw("data")) : r.error_code() + ":" + r.error_message();
    s += "|";
  }
  return report("1 %s", s.c_str());
}
int t_ipfs_dag(void) {
  A::IpfsParams p{};
  TEXT(p, CID, "bafy-dag");
  auto r = sdm_piv::call("ipfs.dag_get", "IpfsParams", p);
  FAILED(r);
  return report("1 %s", std::string(r.raw("data")).c_str());
}
int t_ipfs_ls(void) {
  A::IpfsParams p{};
  TEXT(p, CID, "bafy-dir");
  auto r = sdm_piv::call("ipfs.ls", "IpfsParams", p);
  FAILED(r);
  auto l = r.list<A::IpfsLink>("links", "IpfsLink");
  std::string s;
  for (size_t i = 0; i < l.second; ++i) s += l.first[i].NAME.str() + ":" + l.first[i].CID.str() + ":" + std::to_string(l.first[i].SIZE) + ":" + std::to_string(l.first[i].TYPE) + ",";
  return report("1 %zu %s", l.second, s.c_str());
}
int t_ipfs_pins(void) {
  A::IpfsParams p{};
  TEXT(p, CID, "bafy-b");
  auto add = sdm_piv::call("ipfs.pin_add", "IpfsParams", p);
  FAILED(add);
  auto rm = sdm_piv::call("ipfs.pin_rm", "IpfsParams", p);
  FAILED(rm);
  A::IpfsParams q{};
  TEXT(q, TYPE, "recursive");
  auto ls = sdm_piv::call("ipfs.pin_ls", "IpfsParams", q);
  FAILED(ls);
  auto pins = ls.list<A::IpfsPin>("pins", "IpfsPin");
  std::string s;
  for (size_t i = 0; i < pins.second; ++i) s += pins.first[i].CID.str() + ":" + pins.first[i].TYPE.str() + ",";
  return report("1 %s %s %s", items(add).c_str(), items(rm).c_str(), s.c_str());
}
int t_ipfs_id(void) {
  auto r = sdm_piv::call("ipfs.id");
  FAILED(r);
  const auto* x = r.result<A::IpfsResult>("IpfsResult");
  auto a = r.list<A::TextValue>("addresses", "TextValue");
  std::string s;
  for (size_t i = 0; i < a.second; ++i) s += a.first[i].VALUE.str() + ",";
  return report("1 %s %s %s %s %s", x->NAME.str().c_str(), x->VALUE.str().c_str(), x->AGENT_VERSION.str().c_str(), x->PROTOCOL_VERSION.str().c_str(), s.c_str());
}
int t_ipfs_swarm(void) {
  auto r = sdm_piv::call("ipfs.swarm_peers");
  FAILED(r);
  auto l = r.list<A::IpfsSwarmPeer>("peers", "IpfsSwarmPeer");
  std::string s;
  char row[400];
  for (size_t i = 0; i < l.second; ++i) {
    std::snprintf(row, sizeof row, "%s:%s:%g,", l.first[i].PEER_ID.str().c_str(), l.first[i].ADDRESS.str().c_str(), l.first[i].LATENCY_MS);
    s += row;
  }
  return report("1 %zu %s", l.second, s.c_str());
}
int t_topics(void) {
  auto r = sdm_piv::call("pubsub.list_topics");
  FAILED(r);
  return report("1 %s", items(r).c_str());
}
}
`;

const METHODS = ["t_config", "t_big_config", "t_node", "t_secrets", "t_write", "t_query", "t_delete", "t_expire", "t_ingest", "t_sql_stream", "t_epoch", "t_sandboxed",
  "t_surface", "t_cache_key", "t_peers", "t_standards", "t_history", "t_latest", "t_status", "t_activity", "t_keyslot_sign", "t_secp256k1", "t_keyslot_unwrap",
  "t_protocol", "t_ipfs_cat", "t_ipfs_dag", "t_ipfs_ls", "t_ipfs_pins", "t_ipfs_id", "t_ipfs_swarm", "t_topics", "guest_out_ptr", "guest_out_len"];
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
  t_config: "1 3 enabled=b:true;name=s:gfs;targets=[{provider_id=s:noaa;widths=n[1,2.5,];}];|noaa|2.5|1|0 1 2 1 0",
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

// ---- keyslot, protocol, ipfs and pubsub: the hosts' async operations, answered through the worker harness ----------
const hexOf = (b) => Buffer.from(b).toString("hex");
const range = (from) => Uint8Array.from({ length: 32 }, (_, i) => from + i);
const KEYS = { "sign-ed": range(1), "sign-k1": range(33), wrap: range(65) };
const pkcs8 = (prefix, key) => createPrivateKey({ key: Buffer.concat([Buffer.from(prefix, "hex"), key]), format: "der", type: "pkcs8" });
const edKey = pkcs8("302e020100300506032b657004220420", KEYS["sign-ed"]);
// secp256k1, cross-checked with node:crypto (the Go node's semantics): sign / verify / keyslot.sign are ECDSA over
// sha256(message); signDigest / verifyDigest over the 32-byte digest as given. Here digest = sha256(message), so a
// signature over the digest as given is a node:crypto "sha256" signature over the message.
const K1_MESSAGE = Buffer.from("sign me");
const k1Key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e0201010420", "hex"), KEYS["sign-k1"], Buffer.from("a00706052b8104000a", "hex")]), format: "der", type: "sec1" });
const k1Public = createPublicKey(k1Key);
const K1_PUB65 = k1Public.export({ format: "der", type: "spki" }).subarray(-65);
const K1_PUB33 = Buffer.concat([Buffer.from([K1_PUB65[64] & 1 ? 3 : 2]), K1_PUB65.subarray(1, 33)]);
const K1_DIGEST = createHash("sha256").update(K1_MESSAGE).digest();
const K1_STAGED = [KEYS["sign-k1"], K1_PUB65, K1_PUB33, K1_DIGEST,
  createSignature("sha256", K1_MESSAGE, { key: k1Key, dsaEncoding: "der" }),
  createSignature("sha256", K1_MESSAGE, { key: k1Key, dsaEncoding: "ieee-p1363" }),
  createSignature("sha256", K1_DIGEST, { key: k1Key, dsaEncoding: "der" })].map(hexOf).join(" ");
const k1Verifies = (signature, dsaEncoding) => verifySignature("sha256", K1_MESSAGE, { key: k1Public, dsaEncoding }, Buffer.from(signature, "hex"));
// a content key wrapped to the "wrap" slot the way the Go node's keyslot.unwrap takes it: X25519 -> HKDF-SHA256 -> AES-256-GCM
const CONTENT_KEY = "content-key-0123";
const WRAPPED = (() => {
  const slot = pkcs8("302e020100300506032b656e04220420", KEYS.wrap);
  const ephemeral = pkcs8("302e020100300506032b656e04220420", range(97));
  const epk = createPublicKey(ephemeral).export({ format: "der", type: "spki" }).subarray(-32);
  const shared = diffieHellman({ privateKey: ephemeral, publicKey: createPublicKey(slot) });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.alloc(0), Buffer.from("sdn-server/keyslot.unwrap/v1"), 32));
  const nonce = Buffer.from("0102030405060708090a0b0c", "hex");
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(CONTENT_KEY), cipher.final(), cipher.getAuthTag()]);
  return `${hexOf(epk)} ${hexOf(nonce)} ${hexOf(ct)}`;
})();

function oracleAdapters(wrap) {
  const calls = [];
  const method = (name, answer) => (params) => { calls.push([name, params]); return wrap(answer(params)); };
  const cat = { u8: bytes(0xca, 0xfe), buffer: bytes(1, 2).buffer, view: new Uint16Array([0x0201, 0x0403]), base64: "3q2+7w==", tagged: { __type: "bytes", base64: "AAE=" }, none: { nope: 1 } };
  return {
    calls,
    wallet_sign: { get: method("wallet.get", (p) => KEYS[p.slotId]) },
    protocol_dial: { request: method("protocol.request", (p) => Buffer.from(Buffer.from(p.payloadBase64, "base64").reverse()).toString("base64")) },
    pubsub: { list_topics: method("pubsub.list_topics", () => ({ topics: ["sdn/wx", "sdn/omm"] })) },
    ipfs: {
      cat: method("ipfs.cat", (p) => cat[p.cid]),
      dag_get: method("ipfs.dag_get", () => ({ z: 1, a: { b: "<x>&" }, Links: [] })),
      ls: method("ipfs.ls", () => ({ Objects: [{ Hash: "bafy-dir", Links: [{ Name: "b.txt", Hash: "bafy-b", Size: 12, Type: 2 }, { Name: "sub", Hash: "bafy-sub", Size: 0, Type: 1 }] }] })),
      // the remaining operations through invoke(method, params)
      invoke: (name, p) => {
        calls.push([`ipfs.${name}`, p]);
        const answers = {
          pin_add: { Pins: ["bafy-b", "bafy-a"] },
          pin_rm: { Pins: ["bafy-b"] },
          pin_ls: { Keys: { "bafy-z": { Type: "recursive" }, "bafy-a": { Type: "direct" } } },
          id: { ID: "12D3KooWSelf", PublicKey: "CAESIA==", AgentVersion: "kubo/0.30.0", ProtocolVersion: "ipfs/0.1.0", Addresses: ["/ip4/10.0.0.1/tcp/4001", "/ip4/127.0.0.1/tcp/4001"] },
          swarm_peers: { Peers: [{ Peer: "12D3Other", Addr: "/ip4/10.0.0.2/tcp/4001", Latency: "12.5ms" }, { Peer: "12D3Far", Addr: "/ip4/10.0.0.3/udp/4001/quic-v1", Latency: "1m2.5s" }, { Peer: "12D3Unknown", Addr: "", Latency: "n/a" }] },
        };
        return wrap(answers[name]);
      },
    },
  };
}
const ORACLE_GRANTED = ["ipfs", "wallet_sign", "protocol_dial", "pubsub", "crypto_sign", "crypto_verify"];
const EXPECTED_ORACLE = {
  t_keyslot_unwrap: `1 ${CONTENT_KEY}`,
  t_protocol: "1 fa020100",
  t_ipfs_cat: "1 cafe|0102|01020304|deadbeef|0001|failed:ipfs.cat: the host answered no bytes|",
  t_ipfs_dag: '1 {"Links":[],"a":{"b":"\\u003cx\\u003e\\u0026"},"z":1}',
  t_ipfs_ls: "1 2 b.txt:bafy-b:12:2,sub:bafy-sub:0:1,",
  t_ipfs_pins: "1 bafy-a,bafy-b, bafy-b, bafy-a:direct,bafy-z:recursive,",
  t_ipfs_id: "1 12D3KooWSelf CAESIA== kubo/0.30.0 ipfs/0.1.0 /ip4/10.0.0.1/tcp/4001,/ip4/127.0.0.1/tcp/4001,",
  t_ipfs_swarm: "1 3 12D3Other:/ip4/10.0.0.2/tcp/4001:12.5,12D3Far:/ip4/10.0.0.3/udp/4001/quic-v1:62500,12D3Unknown::0,",
};
async function assertOracle(label, run, calls) {
  // keyslot.sign: ed25519 is deterministic; the secp256k1 signature (DER) is ECDSA over sha256(payload), as the Go
  // node's: node:crypto verifies it over the payload with "sha256" (one hash), not over sha256(payload)
  const [ok, ed, k1] = (await run("t_keyslot_sign")).split(" ");
  assert.equal(ok, "1");
  assert.equal(ed, hexOf(cryptoSign(edKey)));
  assert.ok(k1Verifies(k1, "der"), `${label} keyslot.sign secp256k1 is ECDSA over sha256(payload)`);
  assert.ok(!verifySignature("sha256", K1_DIGEST, { key: k1Public, dsaEncoding: "der" }, Buffer.from(k1, "hex")), `${label} keyslot.sign is not double-hashed`);
  // crypto.secp256k1.*: sign over sha256(message), verify accepting node:crypto's signature (and refusing another
  // message), signDigest over the digest as given, verifyDigest accepting node:crypto's signature over it with a 65- or
  // 33-byte key; a digest that is not 32 bytes is refused. The browser host has no digest operations.
  const [head, verified, otherMessage, doubledRefused, digestSig, digest65, digest33, notDigest] = (await run("t_secp256k1")).split("|");
  assert.match(head, /^1 30/);
  assert.ok(k1Verifies(head.slice(2), "der"), `${label} crypto.secp256k1.sign is ECDSA over sha256(message)`);
  assert.deepEqual([verified, otherMessage, doubledRefused], ["true", "false", "false"], `${label} crypto.secp256k1.verify (a double-hashed signature is refused)`);
  if (label === "NodeHost") {
    assert.equal(digestSig.length, 128);
    assert.ok(k1Verifies(digestSig, "ieee-p1363"), "NodeHost crypto.secp256k1.signDigest signs the digest as given");
    assert.deepEqual([digest65, digest33], ["true", "true"], "NodeHost crypto.secp256k1.verifyDigest");
    assert.equal(notDigest, "invalid-params");
  } else {
    assert.deepEqual([digestSig, digest65, digest33, notDigest], ["unsupported", "unsupported", "unsupported", "unsupported"]);
  }
  for (const [name, expected] of Object.entries(EXPECTED_ORACLE)) assert.equal(await run(name), expected, `${label} ${name}`);
  if (label === "BrowserHost") assert.equal(await run("t_topics"), "1 sdn/omm,sdn/wx,");
  else assert.match(await run("t_topics"), /^0 unsupported /);
  const request = (name) => calls.filter(([n]) => n === name).map(([, p]) => p);
  assert.deepEqual(request("wallet.get").map((p) => p.slotId), ["sign-ed", "sign-k1", "wrap"]);
  assert.deepEqual(request("protocol.request"), [{ target: "12D3Other", protocolId: "/sdn/echo/1.0.0", timeoutMs: 2500, payloadBase64: "AAEC+g==" }]);
  assert.deepEqual(request("ipfs.cat").map((p) => p.cid), ["u8", "buffer", "view", "base64", "tagged", "none"]);
  assert.deepEqual(request("ipfs.cat")[0], { cid: "u8" });
  assert.deepEqual(request("ipfs.pin_add"), [{ cid: "bafy-b" }]);
  assert.deepEqual(request("ipfs.pin_ls"), [{ type: "recursive" }]);
  assert.deepEqual(request("ipfs.id"), [{}]);
}
function cryptoSign(key) {
  return createSignature(null, Buffer.from("sign me"), key);
}

const HOSTS = {
  NodeHost: (options) => createNodeHost(options),
  BrowserHost: (options) => createBrowserHost(options),
};

let compilation;
test.before(async () => {
  compilation = await compileModuleFromSource({ manifest: manifest(), sourceCode: GUEST_SOURCE.replace("@WRAPPED@", WRAPPED).replace("@K1@", K1_STAGED), language: "c++", allowUndefinedImports: true });
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
    assert.equal(await bare("t_config"), "1 0 ||0|0|0 0 0 0 0");
    // a config the encoder has no kind for is a typed failure, not a trap
    assert.match(await (await syncGuest(createHost({ config: { mixed: [1, "a"] } })))("t_config"), /^0 failed plugin.getConfig: ModuleConfig: mixed mixes value kinds/);
    const noAdapter = await syncGuest(createHost({ capabilities: GRANTED }));
    assert.match(await noAdapter("t_expire"), /^0 unsupported storage adapter is not configured/);
    // an async adapter on the sync bridge is refused with a code, not a trap
    const asyncOnSync = await syncGuest(createHost({ capabilities: GRANTED, capabilityAdapters: { storage: adapters((v) => Promise.resolve(v)).storage } }));
    assert.match(await asyncOnSync("t_expire"), /^0 unsupported /);
  });

  test(`typed host adapters: ${label} serves a 1,000,000-number config as one ModuleConfig; the module grows by about its size`, { timeout: 300_000 }, async (t) => {
    const N = 1_000_000;
    const index = Array.from({ length: N }, (_, i) => i);
    const host = createHost({ config: { name: "terrain", index } });
    const run = await syncGuest(host);
    const [ok, count, sum, payload, growth, pagesBefore, pagesAfter] = (await run("t_big_config")).split(" ").map(Number);
    assert.deepEqual([ok, count, sum], [1, N, (N * (N - 1)) / 2]);
    assert.ok(payload >= N * 8 && payload < N * 8 + 4096, `payload ${payload}`);
    // the response is kept whole (one copy of the payload) and read in place: the heap grows by about the payload, never
    // a record per value (the old aligned ConfigEntry list was ~536 bytes a value - 536 MB here)
    assert.ok(growth >= payload && growth <= payload * 1.25 + (1 << 20), `the heap grew ${growth} bytes for a ${payload}-byte config`);
    assert.ok((pagesAfter - pagesBefore) * 65536 <= payload * 1.25 + (1 << 20), `memory grew ${pagesBefore} -> ${pagesAfter} pages`);
    t.diagnostic(`${label}: ModuleConfig ${payload} bytes; heap grew ${growth} bytes; memory ${pagesBefore} -> ${pagesAfter} pages`);
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

  test(`typed host adapters: ${label} answers keyslot, protocol, ipfs and pubsub through the worker harness - raw "data", the list ports, every byte form`, { timeout: 300_000 }, async (t) => {
    if (typeof SharedArrayBuffer !== "function" || typeof Atomics !== "object") { t.skip("SharedArrayBuffer/Atomics unavailable"); return; }
    const a = oracleAdapters((v) => new Promise((resolve) => setTimeout(() => resolve(v), 1)));
    const host = createHost({ capabilities: ORACLE_GRANTED, wasmWallet: await getWasmWallet(), capabilityAdapters: { ipfs: a.ipfs, wallet_sign: a.wallet_sign, protocol_dial: a.protocol_dial, pubsub: a.pubsub } });
    for (const op of ["ipfs.ls", "ipfs.pin_ls", "ipfs.swarm_peers", "ipfs.dag_get", "keyslot.unwrap", "protocol.request"]) assert.ok(host.listOperations().includes(op), op);
    const harness = await createWorkerModuleHarness({ wasmSource: compilation.wasmBytes, host });
    const run = async (name) => {
      assert.equal(await harness.callExport(name), 0, name);
      const out = await harness.readMemory(await harness.callExport("guest_out_ptr"), await harness.callExport("guest_out_len"));
      return new TextDecoder().decode(out instanceof Uint8Array ? out : new Uint8Array(out));
    };
    try {
      await assertOracle(label, run, a.calls);
      // capability-gated: a typed not-authorized answer
      const bare = await createWorkerModuleHarness({ wasmSource: compilation.wasmBytes, host: createHost({ capabilities: ["clock"], capabilityAdapters: { ipfs: a.ipfs } }) });
      try {
        assert.equal(await bare.callExport("t_ipfs_ls"), 0);
        const out = await bare.readMemory(await bare.callExport("guest_out_ptr"), await bare.callExport("guest_out_len"));
        assert.match(new TextDecoder().decode(out instanceof Uint8Array ? out : new Uint8Array(out)), /^0 not-authorized /);
      } finally {
        await bare.destroy?.();
      }
    } finally {
      await harness.destroy?.();
    }
  });
}
