// The module runtime contracts (schemas/runtime/*.fbs, namespace sdn.runtime): the typed FlatBuffer frames that cross a
// module port, a host connector or the flow runtime - TimerTick, HttpRequest, HttpResponse, ModuleConfig,
// IngestRequest, IngestResult, FlowNotice (typed-contracts 1.0, owner 2026-10-13: "flatbuffer SDS only"; no JSON
// forms). The generated classes (scripts/generate-runtime-bindings.mjs) and, for JS hosts and tests, one encoder and
// decoder per frame over plain objects. A frame is one FlatBuffer finished with its file identifier (TICK, HREQ, ...);
// identifierOf reads it back. 64-bit times and counts are numbers here (exact to 2^53) and BigInt in the bindings.
import * as flatbuffers from "flatbuffers";
import {
  ArchiveTargetT,
  ConfigEntryT,
  ConfigTableT,
  FlowNotice,
  FlowNoticeT,
  HeaderT,
  HttpRequest,
  HttpRequestT,
  HttpResponse,
  HttpResponseT,
  IngestRequest,
  IngestRequestT,
  IngestResult,
  IngestResultT,
  ModuleConfig,
  ModuleConfigT,
  ProvenanceT,
  SourceTagsT,
  TimerTick,
  TimerTickT,
  configValueKind,
  flowNoticeKind,
  reconcileMode,
} from "../generated/runtime/sdn/runtime.js";

export * from "../generated/runtime/sdn/runtime.js";

export const RUNTIME_FILE_IDENTIFIERS = Object.freeze({
  TimerTick: "TICK",
  HttpRequest: "HREQ",
  HttpResponse: "HRSP",
  ModuleConfig: "MCFG",
  IngestRequest: "INGQ",
  IngestResult: "INGR",
  FlowNotice: "FNTC",
});

/** The 4-character file identifier of a FlatBuffer frame (bytes 4-7), or "" when it has none. */
export function identifierOf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 8) return "";
  return String.fromCharCode(b[4], b[5], b[6], b[7]);
}

const big = (n) => BigInt(Math.max(0, Math.trunc(Number(n) || 0)));
const num = (n) => (typeof n === "bigint" ? Number(n) : Number(n) || 0);
const bytesOf = (v) => (v == null ? [] : Array.from(v instanceof Uint8Array ? v : new Uint8Array(v)));
const u8 = (a) => Uint8Array.from(a || []);
const str = (v) => (v == null ? "" : String(v));

function finish(object, finishBuffer) {
  const builder = new flatbuffers.Builder(256);
  finishBuffer(builder, object.pack(builder));
  return builder.asUint8Array().slice();
}
function rootOf(bytes, Type, getRoot, id) {
  const bb = new flatbuffers.ByteBuffer(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (!Type.bufferHasIdentifier(bb)) throw new Error(`not a ${id} frame (identifier "${identifierOf(bytes)}")`);
  return getRoot(bb).unpack();
}
const headersT = (headers) =>
  Object.entries(headers || {})
    .map(([name, value]) => new HeaderT(String(name).toLowerCase(), String(value)))
    .sort((a, b) => (a.NAME < b.NAME ? -1 : a.NAME > b.NAME ? 1 : 0));
const headersOf = (list) => Object.fromEntries((list || []).map((h) => [h.NAME, h.VALUE]));

// ---- TimerTick --------------------------------------------------------------------------------------------------

/** @param {{triggerId?:string, scheduledMs?:number, firedMs?:number, sequence?:number}} t */
export function encodeTimerTick(t = {}) {
  return finish(new TimerTickT(str(t.triggerId), big(t.scheduledMs), big(t.firedMs), big(t.sequence)), TimerTick.finishTimerTickBuffer);
}
export function decodeTimerTick(bytes) {
  const t = rootOf(bytes, TimerTick, TimerTick.getRootAsTimerTick, "TICK");
  return { triggerId: t.TRIGGER_ID || "", scheduledMs: num(t.SCHEDULED_MS), firedMs: num(t.FIRED_MS), sequence: num(t.SEQUENCE) };
}

// ---- HttpRequest / HttpResponse -------------------------------------------------------------------------------

/** @param {{method?:string, url:string, headers?:Record<string,string>, body?:Uint8Array, timeoutMs?:number, maxBytes?:number, context?:Uint8Array}} r */
export function encodeHttpRequest(r) {
  if (!r?.url) throw new Error("HttpRequest: url is required");
  return finish(
    new HttpRequestT(str(r.method || "GET").toUpperCase(), String(r.url), headersT(r.headers), bytesOf(r.body), Math.max(0, r.timeoutMs | 0), big(r.maxBytes), bytesOf(r.context)),
    HttpRequest.finishHttpRequestBuffer,
  );
}
export function decodeHttpRequest(bytes) {
  const r = rootOf(bytes, HttpRequest, HttpRequest.getRootAsHttpRequest, "HREQ");
  return { method: r.METHOD || "GET", url: r.URL || "", headers: headersOf(r.HEADERS), body: u8(r.BODY), timeoutMs: r.TIMEOUT_MS, maxBytes: num(r.MAX_BYTES), context: u8(r.CONTEXT) };
}
/** @param {{url?:string, status?:number, headers?:Record<string,string>, body?:Uint8Array, context?:Uint8Array, error?:string, retrievedMs?:number}} r */
export function encodeHttpResponse(r = {}) {
  return finish(
    new HttpResponseT(str(r.url), r.status | 0, headersT(r.headers), bytesOf(r.body), bytesOf(r.context), str(r.error), big(r.retrievedMs)),
    HttpResponse.finishHttpResponseBuffer,
  );
}
export function decodeHttpResponse(bytes) {
  const r = rootOf(bytes, HttpResponse, HttpResponse.getRootAsHttpResponse, "HRSP");
  return { url: r.URL || "", status: r.STATUS, headers: headersOf(r.HEADERS), body: u8(r.BODY), context: u8(r.CONTEXT), error: r.ERROR || "", retrievedMs: num(r.RETRIEVED_MS) };
}

// ---- ModuleConfig -----------------------------------------------------------------------------------------------

function entryOf(key, value) {
  const e = new ConfigEntryT(String(key));
  if (typeof value === "string") { e.KIND = configValueKind.String; e.STRING_VALUE = value; }
  else if (typeof value === "number" || typeof value === "bigint") { e.KIND = configValueKind.Number; e.NUMBER_VALUE = Number(value); }
  else if (typeof value === "boolean") { e.KIND = configValueKind.Bool; e.BOOL_VALUE = value; }
  else if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "number")) { e.KIND = configValueKind.NumberList; e.NUMBERS = value.map(Number); }
    else if (value.every((v) => v && typeof v === "object" && !Array.isArray(v))) { e.KIND = configValueKind.TableList; e.TABLES = value.map((t) => new ConfigTableT(entriesOf(t))); }
    else if (value.every((v) => typeof v === "string")) { e.KIND = configValueKind.StringList; e.STRINGS = value.slice(); }
    else throw new Error(`ModuleConfig: ${key} mixes value kinds`);
  } else if (value && typeof value === "object") { e.KIND = configValueKind.TableList; e.TABLES = [new ConfigTableT(entriesOf(value))]; }
  else throw new Error(`ModuleConfig: ${key} has no config value kind (${value === null ? "null" : typeof value})`);
  return e;
}
const entriesOf = (object) => Object.keys(object || {}).filter((k) => object[k] !== undefined).sort().map((k) => entryOf(k, object[k]));
function valueOf(e) {
  switch (e.KIND) {
    case configValueKind.String: return e.STRING_VALUE || "";
    case configValueKind.Number: return e.NUMBER_VALUE;
    case configValueKind.Bool: return e.BOOL_VALUE;
    case configValueKind.StringList: return (e.STRINGS || []).slice();
    case configValueKind.NumberList: return (e.NUMBERS || []).slice();
    case configValueKind.TableList: return (e.TABLES || []).map((t) => objectOf(t.ENTRIES));
    default: throw new Error(`ModuleConfig: ${e.KEY} has an unknown value kind ${e.KIND}`);
  }
}
const objectOf = (entries) => Object.fromEntries((entries || []).map((e) => [e.KEY, valueOf(e)]));

/** A plain object (strings, numbers, booleans, lists of them, nested objects or lists of objects) as a ModuleConfig. */
export function encodeModuleConfig(config = {}) {
  return finish(new ModuleConfigT(entriesOf(config)), ModuleConfig.finishModuleConfigBuffer);
}
/** A ModuleConfig back as a plain object (a single nested table is returned as a one-element list). */
export function decodeModuleConfig(bytes) {
  return objectOf(rootOf(bytes, ModuleConfig, ModuleConfig.getRootAsModuleConfig, "MCFG").ENTRIES);
}

// ---- IngestRequest / IngestResult -------------------------------------------------------------------------------

const RECONCILE = { duplicates: reconcileMode.Duplicates, none: reconcileMode.None, current: reconcileMode.Current };
const RECONCILE_NAME = Object.fromEntries(Object.entries(RECONCILE).map(([k, v]) => [v, k]));

/**
 * @param {{schema:string, tags:{providerId?:string, sourceName?:string, batchId?:string, sourceUrl?:string, contentKeyId?:string,
 *   sourcePeer?:string, license?:string, licenseUrl?:string, citation?:string, shareAlike?:boolean}, reconcile?:"duplicates"|"none"|"current",
 *   archive?:{source:string, name:string}, provenance?:object}} r
 */
export function encodeIngestRequest(r) {
  if (!r?.schema || !r?.tags) throw new Error("IngestRequest: schema and tags are required");
  const t = r.tags;
  const tags = new SourceTagsT(str(t.providerId), str(t.sourceName), str(t.batchId), str(t.sourceUrl), str(t.contentKeyId), str(t.sourcePeer), str(t.license), str(t.licenseUrl), str(t.citation), !!t.shareAlike);
  const p = r.provenance;
  const provenance = p
    ? new ProvenanceT(str(p.sourceUrl), p.httpStatus | 0, str(p.etag), str(p.lastModified), str(p.contentType), big(p.retrievedMs), str(p.parser), str(p.parserVersion),
        str(p.sourceSha256), str(p.normalizedSha256), big(p.normalizedCount), Object.keys(p.schemaCounts || {}), Object.values(p.schemaCounts || {}).map(big), (p.warnings || []).map(String), !!p.fromCache)
    : null;
  const reconcile = RECONCILE[r.reconcile || "duplicates"];
  if (reconcile === undefined) throw new Error(`IngestRequest: unknown reconcile ${r.reconcile}`);
  return finish(
    new IngestRequestT(String(r.schema), tags, reconcile, r.archive ? new ArchiveTargetT(str(r.archive.source), str(r.archive.name)) : null, provenance),
    IngestRequest.finishIngestRequestBuffer,
  );
}
export function decodeIngestRequest(bytes) {
  const r = rootOf(bytes, IngestRequest, IngestRequest.getRootAsIngestRequest, "INGQ");
  const t = r.TAGS, p = r.PROVENANCE;
  return {
    schema: r.SCHEMA,
    tags: { providerId: t.PROVIDER_ID || "", sourceName: t.SOURCE_NAME || "", batchId: t.BATCH_ID || "", sourceUrl: t.SOURCE_URL || "", contentKeyId: t.CONTENT_KEY_ID || "",
      sourcePeer: t.SOURCE_PEER || "", license: t.LICENSE || "", licenseUrl: t.LICENSE_URL || "", citation: t.CITATION || "", shareAlike: t.SHARE_ALIKE },
    reconcile: RECONCILE_NAME[r.RECONCILE],
    archive: r.ARCHIVE ? { source: r.ARCHIVE.SOURCE || "", name: r.ARCHIVE.NAME || "" } : null,
    provenance: p
      ? { sourceUrl: p.SOURCE_URL || "", httpStatus: p.HTTP_STATUS, etag: p.ETAG || "", lastModified: p.LAST_MODIFIED || "", contentType: p.CONTENT_TYPE || "", retrievedMs: num(p.RETRIEVED_MS),
          parser: p.PARSER || "", parserVersion: p.PARSER_VERSION || "", sourceSha256: p.SOURCE_SHA256 || "", normalizedSha256: p.NORMALIZED_SHA256 || "", normalizedCount: num(p.NORMALIZED_COUNT),
          schemaCounts: Object.fromEntries((p.SCHEMAS || []).map((s, i) => [s, num(p.SCHEMA_COUNTS[i])])), warnings: (p.WARNINGS || []).slice(), fromCache: p.FROM_CACHE }
      : null,
  };
}
/** @param {{schema?:string, providerId?:string, sourceName?:string, batchId?:string, inserted?:number, reconciledDuplicates?:number, reconciledOldBatches?:number, archived?:string, refused?:string}} r */
export function encodeIngestResult(r = {}) {
  return finish(
    new IngestResultT(str(r.schema), str(r.providerId), str(r.sourceName), str(r.batchId), big(r.inserted), big(r.reconciledDuplicates), big(r.reconciledOldBatches), str(r.archived), str(r.refused)),
    IngestResult.finishIngestResultBuffer,
  );
}
export function decodeIngestResult(bytes) {
  const r = rootOf(bytes, IngestResult, IngestResult.getRootAsIngestResult, "INGR");
  return { schema: r.SCHEMA || "", providerId: r.PROVIDER_ID || "", sourceName: r.SOURCE_NAME || "", batchId: r.BATCH_ID || "", inserted: num(r.INSERTED),
    reconciledDuplicates: num(r.RECONCILED_DUPLICATES), reconciledOldBatches: num(r.RECONCILED_OLD_BATCHES), archived: r.ARCHIVED || "", refused: r.REFUSED || "" };
}

// ---- FlowNotice -------------------------------------------------------------------------------------------------

const NOTICE = { unchanged: flowNoticeKind.Unchanged, skipped: flowNoticeKind.Skipped, missing: flowNoticeKind.Missing, expired: flowNoticeKind.Expired, info: flowNoticeKind.Info };
const NOTICE_NAME = Object.fromEntries(Object.entries(NOTICE).map(([k, v]) => [v, k]));

/** @param {{kind:"unchanged"|"skipped"|"missing"|"expired"|"info", schema?:string, providerId?:string, sourceName?:string, batchId?:string, count?:number, reason?:string, items?:string[], atMs?:number}} n */
export function encodeFlowNotice(n) {
  const kind = NOTICE[n?.kind];
  if (kind === undefined) throw new Error(`FlowNotice: unknown kind ${n?.kind}`);
  return finish(
    new FlowNoticeT(kind, str(n.schema), str(n.providerId), str(n.sourceName), str(n.batchId), big(n.count), str(n.reason), (n.items || []).map(String), big(n.atMs)),
    FlowNotice.finishFlowNoticeBuffer,
  );
}
export function decodeFlowNotice(bytes) {
  const n = rootOf(bytes, FlowNotice, FlowNotice.getRootAsFlowNotice, "FNTC");
  return { kind: NOTICE_NAME[n.KIND], schema: n.SCHEMA || "", providerId: n.PROVIDER_ID || "", sourceName: n.SOURCE_NAME || "", batchId: n.BATCH_ID || "",
    count: num(n.COUNT), reason: n.REASON || "", items: (n.ITEMS || []).slice(), atMs: num(n.AT_MS) };
}
