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
import * as hostOps from "../generated/runtime/aligned/HostOps_aligned.js";
import {
  decodePluginInvokeRequest,
  decodePluginInvokeResponse,
  encodePluginInvokeRequest,
  encodePluginInvokeResponse,
} from "../invoke/codec.js";

export * from "../generated/runtime/sdn/runtime.js";
export * from "../generated/runtime/aligned/HostOps_enums.js";

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
 *   archive?:{source:string, name:string}, provenance?:object}} r  provenance.attributes: [{name, value}] in order
 */
export function encodeIngestRequest(r) {
  if (!r?.schema || !r?.tags) throw new Error("IngestRequest: schema and tags are required");
  const t = r.tags;
  const tags = new SourceTagsT(str(t.providerId), str(t.sourceName), str(t.batchId), str(t.sourceUrl), str(t.contentKeyId), str(t.sourcePeer), str(t.license), str(t.licenseUrl), str(t.citation), !!t.shareAlike);
  const p = r.provenance;
  const provenance = p
    ? new ProvenanceT(str(p.sourceUrl), p.httpStatus | 0, str(p.etag), str(p.lastModified), str(p.contentType), big(p.retrievedMs), str(p.parser), str(p.parserVersion),
        str(p.sourceSha256), str(p.normalizedSha256), big(p.normalizedCount), Object.keys(p.schemaCounts || {}), Object.values(p.schemaCounts || {}).map(big), (p.warnings || []).map(String), !!p.fromCache,
        (p.attributes || []).map((a) => new HeaderT(String(a.name), String(a.value))))
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
          schemaCounts: Object.fromEntries((p.SCHEMAS || []).map((s, i) => [s, num(p.SCHEMA_COUNTS[i])])), warnings: (p.WARNINGS || []).slice(), fromCache: p.FROM_CACHE,
          attributes: (p.ATTRIBUTES || []).map((a) => ({ name: a.NAME || "", value: a.VALUE || "" })) }
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

// ---- hostcalls: SDS $PIV in the module -> host direction, aligned-binary records + raw frames ---------------------

/** The schema a hostcall record frame's TAB.TYPE_REF names (schemas/runtime/HostOps.fbs, aligned layout). */
export const HOST_OPS_SCHEMA = "HostOps.fbs";

function recordClass(type) {
  const Class = hostOps[type];
  if (typeof Class !== "function" || !Class.SIZE) throw new Error(`hostcall: ${type} is not a HostOps record`);
  return Class;
}
// The generated aligned accessors: field FIELD_NAME is read by fIELD_NAME() and written by setFIELD_NAME(); strings,
// nested records and vectors carry a presence bit (hasX / setHasX); vectors are xLength / xAt.
const getterOf = (field) => field[0].toLowerCase() + field.slice(1);
function fieldsOf(Class) {
  const names = Object.getOwnPropertyNames(Class.prototype);
  return names.filter((n) => n.startsWith("set") && !n.startsWith("setHas") && !n.endsWith("Length") && !n.endsWith("At")).map((n) => n.slice(3))
    .concat(names.filter((n) => n.startsWith("set") && n.endsWith("At") && !n.startsWith("setHas")).map((n) => n.slice(3, -2)));
}
function writeRecord(Class, view, value, where) {
  for (const [field, v] of Object.entries(value || {})) {
    if (v === undefined || v === null) continue;
    const proto = Class.prototype, g = getterOf(field);
    if (typeof proto[`set${field}At`] === "function") {
      view[`set${field}Length`](v.length);
      v.forEach((item, i) => view[`set${field}At`](i, item));
      if (typeof proto[`setHas${field}`] === "function") view[`setHas${field}`](true);
      if (view[`${g}Length`]() !== v.length) throw new RangeError(`${where}.${field}: ${v.length} items exceed the record's bound`);
      continue;
    }
    if (typeof proto[`set${field}`] !== "function") {
      // a nested record: written through its view
      if (typeof proto[g] === "function" && typeof v === "object") {
        const nested = view[g]();
        writeRecord(nested.constructor, nested, v, `${where}.${field}`);
        if (typeof proto[`setHas${field}`] === "function") view[`setHas${field}`](true);
        continue;
      }
      throw new Error(`${where}: no field ${field}`);
    }
    if (typeof proto[`setHas${field}`] === "function") view[`setHas${field}`](true);
    view[`set${field}`](typeof v === "number" && typeof view[g]() === "bigint" ? BigInt(v) : v);
    // an aligned string holds a bounded number of bytes: refuse rather than truncate
    if (typeof v === "string" && view[g]() !== v) throw new RangeError(`${where}.${field}: "${v.slice(0, 40)}..." exceeds the record's ${new TextEncoder().encode(view[g]()).length}-byte string`);
  }
}
function readRecord(Class, view) {
  const out = {};
  for (const field of fieldsOf(Class)) {
    const g = getterOf(field);
    if (typeof view[`has${field}`] === "function" && !view[`has${field}`]()) { out[field] = typeof view[`${g}Length`] === "function" ? [] : null; continue; }
    if (typeof view[`${g}Length`] === "function") { out[field] = Array.from({ length: view[`${g}Length`]() }, (_, i) => view[`${g}At`](i)); continue; }
    out[field] = view[g]();
  }
  for (const n of Object.getOwnPropertyNames(Class.prototype)) {   // nested records (getter, presence, no setter)
    if (n.startsWith("has") || n.startsWith("set") || n === "constructor") continue;
    const field = n[0].toUpperCase() + n.slice(1);
    if (field in out || typeof Class.prototype[`setHas${field}`] !== "function") continue;
    out[field] = view[`has${field}`]() ? readRecord(view[n]().constructor, view[n]()) : null;
  }
  return out;
}
/** One aligned record of HostOps type `type` from plain field values (FIELD_NAME: value). */
export function encodeHostOpsRecord(type, value) {
  const Class = recordClass(type), bytes = new Uint8Array(Class.SIZE);
  writeRecord(Class, Class.fromPointer(bytes.buffer, 0), value, type);
  return bytes;
}
/** A run of aligned records (a list port), back to back at the type's stride. */
export function encodeHostOpsList(type, values) {
  const Class = recordClass(type), bytes = new Uint8Array(Class.SIZE * values.length);
  values.forEach((v, i) => writeRecord(Class, Class.fromPointer(bytes.buffer, i * Class.SIZE), v, `${type}[${i}]`));
  return bytes;
}
function readFrames(frames, where) {
  const records = {}, lists = {}, raw = {};
  for (const frame of frames || []) {
    const port = frame.portId ?? frame.PORT_ID, tr = frame.typeRef || {}, type = tr.rootType ?? tr.rootTypeName ?? tr.ROOT_TYPE ?? null;
    const payload = frame.payload instanceof Uint8Array ? frame.payload : new Uint8Array(frame.payload || []);
    if ((frame.wireFormat ?? tr.wireFormat) === "aligned-binary" && type) {
      const Class = recordClass(type), copy = payload.slice();   // (a copy: the decoded views outlive the envelope)
      if (copy.length % Class.SIZE) throw new RangeError(`${where}: ${port} is ${copy.length} bytes, not a whole number of ${type} (${Class.SIZE})`);
      const items = Array.from({ length: copy.length / Class.SIZE }, (_, i) => readRecord(Class, Class.fromPointer(copy.buffer, i * Class.SIZE)));
      if (Number(tr.byteLength ?? 0) > 0) records[port] = { type, value: items[0] ?? null }; else lists[port] = { type, values: items };
    } else raw[port] = payload.slice();
  }
  return { records, lists, raw };
}
const toBytes = (v) => (typeof v === "string" ? new TextEncoder().encode(v) : v instanceof Uint8Array ? v : new Uint8Array(v));
function buildFrames(spec, { record, recordPort, recordType, raw = {}, lists = {} }, rawPorts, listPorts, where) {
  const frames = [];
  if (record != null) {
    if (!recordType) throw new Error(`${where}: takes no ${recordPort} record`);
    const Class = recordClass(recordType);
    frames.push({ portId: recordPort, wireFormat: "aligned-binary", typeRef: { schemaName: HOST_OPS_SCHEMA, rootType: recordType, wireFormat: "aligned-binary", byteLength: Class.SIZE, requiredAlignment: Class.ALIGN }, payload: encodeHostOpsRecord(recordType, record) });
  }
  for (const [port, values] of Object.entries(lists)) {
    const type = listPorts[port];
    if (!type) throw new Error(`${where}: no list port ${port}`);
    const Class = recordClass(type);
    frames.push({ portId: port, wireFormat: "aligned-binary", typeRef: { schemaName: HOST_OPS_SCHEMA, rootType: type, wireFormat: "aligned-binary", byteLength: 0, requiredAlignment: Class.ALIGN }, payload: encodeHostOpsList(type, values) });
  }
  for (const [port, bytes] of Object.entries(raw)) {
    if (!rawPorts.includes(port)) throw new Error(`${where}: no raw port ${port}`);
    frames.push({ portId: port, payload: toBytes(bytes) });
  }
  return frames;
}

/**
 * A module's call to its host: an SDS $PIV request. METHOD_ID is the operation; its frames are the "params" aligned
 * record, its list ports (runs of aligned records) and its raw ports (bytes) as HOST_OPERATIONS declares them.
 * @param {string} op
 * @param {{params?:object, lists?:Record<string,object[]>, raw?:Record<string,Uint8Array|string>}} [call] field values
 *   by schema name (e.g. { params: { SCHEMA: "WXF.fbs", BEFORE_MS: 1791900000000n } })
 */
export function encodeHostCall(op, call = {}) {
  const spec = HOST_OPERATIONS[op];
  if (!spec) throw new Error(`hostcall: unknown operation ${op}`);
  const inputs = buildFrames(spec, { record: call.params, recordPort: "params", recordType: spec.params, raw: call.raw, lists: call.lists }, spec.rawIn, spec.listsIn, op);
  return encodePluginInvokeRequest({ methodId: op, inputs });
}
/** @returns {{op:string, params:object|null, lists:Record<string,object[]>, raw:Record<string,Uint8Array>}} */
export function decodeHostCall(bytes) {
  const request = decodePluginInvokeRequest(bytes);
  const op = request.methodId ?? "", { records, lists, raw } = readFrames(request.inputs, op);
  const spec = HOST_OPERATIONS[op];
  if (spec && records.params && records.params.type !== spec.params) throw new Error(`hostcall: ${op} takes ${spec.params}, the frame carries ${records.params.type}`);
  return { op, params: records.params?.value ?? null, lists: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.values])), raw };
}

// ---- SQL values: FlatSQL's tagged parameter encoding (flatsql capi decodeParamsNoThrow) ---------------------------------

/** The tags of FlatSQL's parameter encoding. */
export const SQL_VALUE_TAGS = Object.freeze({ null: 0, bool: 1, i64: 2, f64: 3, str: 4, bytes: 5 });
const SQL_TAG_NAME = Object.fromEntries(Object.entries(SQL_VALUE_TAGS).map(([k, v]) => [v, k]));

/**
 * SQL values (raw "params" in, raw "cells" out) in FlatSQL's tagged parameter encoding: value after value, a u8 tag,
 * a u32 little-endian payload length, the payload. Values are tagged {t, v} (t: null | bool | i64 | f64 | str |
 * bytes; i64 as a BigInt, a safe integer number or decimal text), or plain JS values: null, boolean, bigint, number
 * (an integer is i64, else f64), string, Uint8Array.
 */
export function encodeSqlValues(values) {
  const parts = (values || []).map((value) => {
    const tagged = value && typeof value === "object" && !(value instanceof Uint8Array) && "t" in value ? value : null;
    const t = tagged ? tagged.t : value === null || value === undefined ? "null" : typeof value === "boolean" ? "bool"
      : typeof value === "bigint" ? "i64" : typeof value === "number" ? (Number.isInteger(value) ? "i64" : "f64")
      : typeof value === "string" ? "str" : value instanceof Uint8Array ? "bytes" : null;
    const v = tagged ? tagged.v : value;
    let payload;
    switch (t) {
      case "null": payload = new Uint8Array(0); break;
      case "bool": payload = Uint8Array.of(v ? 1 : 0); break;
      case "i64": payload = new Uint8Array(8); new DataView(payload.buffer).setBigInt64(0, BigInt(v), true); break;
      case "f64": payload = new Uint8Array(8); new DataView(payload.buffer).setFloat64(0, Number(v), true); break;
      case "str": payload = new TextEncoder().encode(String(v)); break;
      case "bytes": payload = v instanceof Uint8Array ? v : new Uint8Array(v); break;
      default: throw new TypeError(`SQL value ${String(value)} has no FlatSQL parameter tag`);
    }
    return [SQL_VALUE_TAGS[t], payload];
  });
  const out = new Uint8Array(parts.reduce((n, [, p]) => n + 5 + p.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [tag, payload] of parts) { out[at] = tag; view.setUint32(at + 1, payload.length, true); out.set(payload, at + 5); at += 5 + payload.length; }
  return out;
}
/** The tagged values ({t, v}; i64 as a BigInt, bytes as Uint8Array) of a FlatSQL parameter encoding. */
export function decodeSqlValues(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength), out = [];
  let at = 0;
  while (at < b.length) {
    if (at + 5 > b.length) throw new RangeError("SQL values: truncated value header");
    const tag = b[at], size = view.getUint32(at + 1, true), start = at + 5;
    if (start + size > b.length) throw new RangeError("SQL values: payload exceeds the buffer");
    const t = SQL_TAG_NAME[tag];
    const fixed = { null: 0, bool: 1, i64: 8, f64: 8 }[t];
    if (t === undefined) throw new RangeError(`SQL values: unknown tag ${tag}`);
    if (fixed !== undefined && size !== fixed) throw new RangeError(`SQL values: a ${t} carries ${fixed} bytes, not ${size}`);
    const payload = b.subarray(start, start + size);
    out.push({ t, v: t === "null" ? null : t === "bool" ? payload[0] !== 0 : t === "i64" ? view.getBigInt64(start, true)
      : t === "f64" ? view.getFloat64(start, true) : t === "str" ? new TextDecoder().decode(payload) : payload.slice() });
    at = start + size;
  }
  return out;
}

/** The error codes a host answers with (PIVResponse.ERROR_CODE). */
export const HOSTCALL_ERROR_CODES = Object.freeze(["unsupported", "not-authorized", "invalid-params", "failed", "refused", "sandbox", "timeout", "too-large"]);

/**
 * The host's answer: an SDS $PIV response - the "result" aligned record, list and raw ports (STATUS OK), or STATUS
 * FAILED with ERROR_CODE (HOSTCALL_ERROR_CODES) and ERROR_MESSAGE.
 * @param {{op:string, ok:boolean, result?:object, lists?:Record<string,object[]>, raw?:Record<string,Uint8Array|string>, error?:{code:string, message?:string}}} r
 */
export function encodeHostCallResult(r) {
  if (r?.ok) {
    const spec = HOST_OPERATIONS[r.op];
    if (!spec) throw new Error(`hostcall: unknown operation ${r.op}`);
    const outputs = buildFrames(spec, { record: r.result, recordPort: "result", recordType: spec.result, raw: r.raw, lists: r.lists }, spec.rawOut, spec.listsOut, `${r.op} result`);
    return encodePluginInvokeResponse({ statusCode: 0, outputs });
  }
  const code = r?.error?.code ?? "failed";
  if (!HOSTCALL_ERROR_CODES.includes(code)) throw new Error(`hostcall: unknown error code ${code}`);
  return encodePluginInvokeResponse({ statusCode: 1, status: "FAILED", errorCode: code, errorMessage: str(r?.error?.message) });
}
/** @returns {{ok:boolean, result:object|null, lists:Record<string,object[]>, raw:Record<string,Uint8Array>, error:{code:string, message:string}|null}} */
export function decodeHostCallResult(bytes) {
  const response = decodePluginInvokeResponse(bytes);
  if (response.errorCode || (response.status !== undefined && response.status !== 0 && response.status !== "OK")) {
    return { ok: false, result: null, lists: {}, raw: {}, error: { code: response.errorCode || "failed", message: response.errorMessage || "" } };
  }
  const { records, lists, raw } = readFrames(response.outputs, "hostcall result");
  return { ok: true, result: records.result?.value ?? null, lists: Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.values])), raw, error: null };
}

/**
 * Whether a hostcall payload is the typed one (an SDS $PIV request) rather than the JSON-meta envelope of
 * src/host/hostcallWire.js: while hosts move over they answer a $PIV call with a $PIV response. The JSON envelope goes
 * once every module is typed (graph: sdk-compliance-typed-only-20261013).
 */
export function isTypedHostCall(payload) {
  return identifierOf(payload) === "$PIV";
}

// ---- the operations ---------------------------------------------------------------------------------------------------

/**
 * Every host operation a module can call, under the names the hosts serve today (the Go node's and the SDK JS hosts'),
 * with its frames: the "params" / "result" aligned record types (HostOps.fbs; null: none), raw ports (bytes) and list
 * ports (runs of aligned records), and the capability it needs (null: none).
 */
const op = (params, result, capability, frames = {}) => Object.freeze({
  params, result, capability,
  rawIn: Object.freeze(frames.rawIn || []), rawOut: Object.freeze(frames.rawOut || []),
  listsIn: Object.freeze(frames.listsIn || {}), listsOut: Object.freeze(frames.listsOut || {}),
});
const CRYPTO_IN = ["data", "key", "private_key", "public_key", "signature", "nonce", "aad", "ikm", "salt", "info", "envelope"];
const CRYPTO_OUT = ["data", "nonce", "private_key", "public_key"];
const crypto = (result, capability) => op("CryptoParams", result, capability, { rawIn: CRYPTO_IN, rawOut: CRYPTO_OUT });
const STREAM = { rawOut: ["stream"] };
const SQL_IN = { rawIn: ["sql", "params"] };
export const HOST_OPERATIONS = Object.freeze({
  // host, clock, random, node, config
  "host.runtimeTarget": op(null, null, null, { rawOut: ["value"] }),
  "host.listCapabilities": op(null, null, null, { listsOut: { items: "TextValue" } }),
  "host.listSupportedCapabilities": op(null, null, null, { listsOut: { items: "TextValue" } }),
  "host.listOperations": op(null, null, null, { listsOut: { items: "TextValue" } }),
  "host.hasCapability": op("HasCapabilityParams", "BoolValue", null),
  "clock.now": op(null, "TimeValue", "clock"),
  "clock.nowIso": op(null, null, "clock", { rawOut: ["value"] }),
  "clock.monotonicNow": op(null, "NumberValue", "clock"),
  "random.bytes": op("RandomBytesParams", null, "random", { rawOut: ["data"] }),
  "node.publicKey": op(null, null, null, { rawOut: ["value"] }),
  "node.peerId": op(null, null, null, { rawOut: ["value"] }),
  "plugin.getConfig": op(null, null, null, { rawOut: ["config"] }),
  // network
  "http.request": op("HttpParams", "HttpResult", "http", { rawIn: ["url", "headers", "body"], rawOut: ["url", "headers", "body"] }),
  "websocket.exchange": op("WebsocketParams", "WebsocketResult", "websocket", { rawIn: ["url", "protocols", "message"], rawOut: ["url", "body"] }),
  "mqtt.publish": op("MqttParams", "MqttResult", "mqtt", { rawIn: ["payload", "password"] }),
  "mqtt.subscribeOnce": op("MqttParams", "MqttResult", "mqtt", { rawIn: ["password"], rawOut: ["body"] }),
  "tcp.request": op("SocketParams", "SocketResult", "tcp", { rawIn: ["data"], rawOut: ["body"] }),
  "udp.request": op("SocketParams", "SocketResult", "udp", { rawIn: ["data"], rawOut: ["body"] }),
  "tls.request": op("SocketParams", "SocketResult", "tls", { rawIn: ["data", "ca", "cert", "key"], rawOut: ["body"] }),
  // storage
  "storage.query": op("StorageQueryParams", null, "storage_query", { listsOut: { records_meta: "StoredRecordMeta" }, rawOut: ["records"] }),
  "storage.write": op("StorageWriteParams", "StorageWriteResult", "storage_write", { rawIn: ["data"] }),
  "storage.delete": op("StorageDeleteParams", null, "storage_write"),
  "storage.expire": op("StorageExpireParams", "StorageExpireResult", "storage_write"),
  "storage.ingest_with_source": op("StorageIngestParams", "StorageIngestResult", "storage_ingest", { rawIn: ["records", "archive"], listsIn: { provenance: "Provenance", provenance_attributes: "ProvenanceAttribute" } }),
  "storage.flatsql_query_stream": op("SqlStreamParams", "StreamResult", "storage_query", { ...SQL_IN, ...STREAM }),
  "storage.flatsql_epoch_stream": op("EpochStreamParams", "StreamResult", "storage_query", STREAM),
  "storage.query_sandboxed": op("SandboxQueryParams", "SandboxQueryResult", "storage_query", { ...SQL_IN, rawOut: ["stream", "cells"], listsOut: { columns: "TextValue" } }),
  "storage.query_surface": op(null, "QuerySurfaceLimits", "storage_query", { listsOut: { tables: "SurfaceTable", columns: "SurfaceColumn" } }),
  "storage.flatsql_cache_key": op("CacheKeyParams", null, "storage_query", { ...SQL_IN, listsIn: { projection: "TextValue" }, rawOut: ["value"] }),
  // crypto: the node's operations
  "crypto.hash": crypto(null, "crypto_hash"),
  "crypto.sign": crypto(null, "crypto_sign"),
  "crypto.verify": crypto("BoolValue", "crypto_verify"),
  "crypto.encrypt": crypto(null, "crypto_encrypt"),
  "crypto.decrypt": crypto(null, "crypto_decrypt"),
  "crypto.key_agreement": crypto(null, "crypto_key_agreement"),
  "crypto.kdf": crypto(null, "crypto_kdf"),
  "crypto.generate_key": crypto(null, "crypto_sign"),
  "crypto.random": crypto(null, "crypto_hash"),
  // crypto: both hosts
  "crypto.ed25519.publicKeyFromSeed": crypto(null, "crypto_sign"),
  "crypto.ed25519.sign": crypto(null, "crypto_sign"),
  "crypto.ed25519.verify": crypto("BoolValue", "crypto_verify"),
  "crypto.secp256k1.publicKeyFromPrivate": crypto(null, "crypto_sign"),
  "crypto.secp256k1.sign": crypto(null, "crypto_sign"),
  "crypto.secp256k1.verify": crypto("BoolValue", "crypto_verify"),
  // crypto: the JS hosts' operations
  "crypto.sha256": crypto(null, "crypto_hash"),
  "crypto.sha512": crypto(null, "crypto_hash"),
  "crypto.hkdf": crypto(null, "crypto_kdf"),
  "crypto.aesGcmEncrypt": crypto(null, "crypto_encrypt"),
  "crypto.aesGcmDecrypt": crypto(null, "crypto_decrypt"),
  "crypto.x25519.generateKeypair": crypto(null, "crypto_key_agreement"),
  "crypto.x25519.publicKey": crypto(null, "crypto_key_agreement"),
  "crypto.x25519.sharedSecret": crypto(null, "crypto_key_agreement"),
  "crypto.sealedBox.encryptForRecipient": crypto(null, "crypto_encrypt"),
  "crypto.sealedBox.decryptFromEnvelope": crypto(null, "crypto_decrypt"),
  "crypto.secp256k1.signDigest": crypto(null, "crypto_sign"),
  "crypto.secp256k1.verifyDigest": crypto("BoolValue", "crypto_verify"),
  // keyslot, secrets
  "keyslot.sign": op("KeyslotParams", null, "wallet_sign", { rawIn: ["payload"], rawOut: ["data"] }),
  "keyslot.unwrap": op("KeyslotParams", null, "wallet_sign", { rawIn: ["ephemeral_public_key", "nonce", "ciphertext"], rawOut: ["data"] }),
  "secrets.get": op("SecretParams", "SecretResult", "secrets", { rawOut: ["secret"] }),
  "secrets.status": op("SecretParams", "SecretResult", "secrets"),
  "secrets.put": op("SecretParams", "SecretResult", "secrets", { rawIn: ["secret"] }),
  "secrets.clear": op("SecretParams", null, "secrets"),
  // ipfs, pubsub, protocol, p2p, node status
  "ipfs.add": op("IpfsParams", "IpfsResult", "ipfs", { rawIn: ["data"] }),
  "ipfs.cat": op("IpfsParams", null, "ipfs", { rawOut: ["data"] }),
  "ipfs.ls": op("IpfsParams", null, "ipfs", { listsOut: { links: "IpfsLink" } }),
  "ipfs.pin_add": op("IpfsParams", null, "ipfs", { listsOut: { items: "TextValue" } }),
  "ipfs.pin_rm": op("IpfsParams", null, "ipfs", { listsOut: { items: "TextValue" } }),
  "ipfs.pin_ls": op("IpfsParams", null, "ipfs", { listsOut: { pins: "IpfsPin" } }),
  "ipfs.dag_get": op("IpfsParams", null, "ipfs", { rawOut: ["data"] }),
  "ipfs.name_resolve": op("IpfsParams", "IpfsResult", "ipfs"),
  "ipfs.name_publish": op("IpfsParams", "IpfsResult", "ipfs"),
  "ipfs.id": op(null, "IpfsResult", "ipfs", { listsOut: { addresses: "TextValue" } }),
  "ipfs.swarm_peers": op(null, null, "ipfs", { listsOut: { peers: "IpfsSwarmPeer" } }),
  "ipfs.pubsub_publish": op("PubsubParams", null, "ipfs", { rawIn: ["data"] }),
  "pubsub.publish": op("PubsubParams", null, "pubsub", { rawIn: ["data"] }),
  "pubsub.subscribe": op("PubsubParams", "PubsubSubscribed", "pubsub"),
  "pubsub.unsubscribe": op("PubsubParams", null, "pubsub"),
  "pubsub.list_topics": op(null, null, "pubsub", { listsOut: { items: "TextValue" } }),
  "protocol.request": op("ProtocolParams", null, "protocol_dial", { rawIn: ["payload"], rawOut: ["data"] }),
  "protocol_dial.dial": op("ProtocolParams", null, "protocol_dial"),
  "protocol_handle.register": op("ProtocolParams", null, "protocol_handle"),
  "protocol_handle.unregister": op("ProtocolParams", null, "protocol_handle"),
  "p2p.peers_snapshot": op("P2pParams", "P2pSummary", "p2p_read", { listsOut: { peers: "P2pPeer", peer_addresses: "P2pPeerValue", peer_standards: "P2pPeerValue" }, rawOut: ["records"] }),
  "p2p.standards_snapshot": op("P2pParams", null, "p2p_read", { listsOut: { entries: "P2pPnmEntry" }, rawOut: ["records"] }),
  "p2p.pnm_history": op("P2pParams", "P2pSummary", "p2p_read", { listsOut: { entries: "P2pPnmEntry" }, rawOut: ["records"] }),
  "p2p.latest_dataset": op("P2pParams", "P2pLatestDataset", "p2p_read", { rawOut: ["stream"] }),
  "node_status_read.status": op(null, "NodeStatusReport", "node_status_read", { listsOut: { bandwidth_history: "NodeBandwidthSample" } }),
  "node_activity_read.activity": op("NodeActivityParams", null, "node_activity_read", { listsOut: { events: "NodeActivityEvent" } }),
  // the JS hosts' timers, schedule, filesystem, exec, context
  "timers.delay": op("TimersDelayParams", null, "timers"),
  "schedule.parse": op("ScheduleParams", null, "schedule_cron", { listsOut: { fields: "CronField" } }),
  "schedule.matches": op("ScheduleParams", "BoolValue", "schedule_cron"),
  "schedule.next": op("ScheduleParams", "TimeValue", "schedule_cron"),
  "filesystem.resolvePath": op(null, null, "filesystem", { rawIn: ["path"], rawOut: ["path"] }),
  "filesystem.readFile": op(null, null, "filesystem", { rawIn: ["path"], rawOut: ["data"] }),
  "filesystem.writeFile": op(null, null, "filesystem", { rawIn: ["path", "data"] }),
  "filesystem.appendFile": op(null, null, "filesystem", { rawIn: ["path", "data"] }),
  "filesystem.deleteFile": op(null, null, "filesystem", { rawIn: ["path"] }),
  "filesystem.mkdir": op("FsParams", null, "filesystem", { rawIn: ["path"] }),
  "filesystem.readdir": op(null, null, "filesystem", { rawIn: ["path"], listsOut: { entries: "FsEntry" } }),
  "filesystem.stat": op(null, "FsStat", "filesystem", { rawIn: ["path"], rawOut: ["path"] }),
  "filesystem.rename": op(null, null, "filesystem", { rawIn: ["path", "to_path"] }),
  "exec.execFile": op("ExecParams", "ExecResult", "process_exec", { rawIn: ["file", "cwd", "input"], listsIn: { args: "TextValue", env: "EnvVar" }, rawOut: ["stdout", "stderr"] }),
  "context.get": op("ContextParams", "BoolValue", "context_read", { rawOut: ["value"] }),
  "context.listKeys": op("ContextParams", null, "context_read", { listsOut: { items: "TextValue" } }),
  "context.listScopes": op(null, null, "context_read", { listsOut: { items: "TextValue" } }),
  "context.set": op("ContextParams", null, "context_write", { rawIn: ["value"] }),
  "context.delete": op("ContextParams", "BoolValue", "context_write"),
});
