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
  HostCall,
  HostCallT,
  HostCallParams,
  HostCallResult,
  HostCallResultT,
  HostCallValue,
  HostCallErrorT,
  hostCallErrorCode,
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
  HostCall: "HCLQ",
  HostCallResult: "HCLR",
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

// ---- HostCall / HostCallResult (the hostcall envelope) ------------------------------------------------------------

function unionMember(Enum, enumName, typeName, value) {
  const tag = Enum[typeName];
  if (typeof tag !== "number" || tag === 0) throw new Error(`${enumName}: unknown member ${typeName}`);
  if (!value || typeof value.pack !== "function") throw new Error(`${enumName}: ${typeName} needs a generated object (${typeName}T)`);
  return tag;
}

/**
 * One call from a module to its host.
 * @param {string} op the operation, e.g. "storage.expire"
 * @param {string} paramsType the HostCallParams member, e.g. "StorageExpireParams" (explicit: class names do not
 *   survive minification)
 * @param {object} params a generated object of that member (e.g. new StorageExpireParamsT(...))
 */
export function encodeHostCall(op, paramsType, params) {
  if (!op) throw new Error("HostCall: op is required");
  const tag = params == null ? HostCallParams.NONE : unionMember(HostCallParams, "HostCallParams", paramsType, params);
  return finish(new HostCallT(String(op), tag, params ?? null), HostCall.finishHostCallBuffer);
}
/** @returns {{op:string, paramsType:string|null, params:object|null}} params as the generated object */
export function decodeHostCall(bytes) {
  const c = rootOf(bytes, HostCall, HostCall.getRootAsHostCall, "HCLQ");
  return { op: c.OP || "", paramsType: c.PARAMS_type ? HostCallParams[c.PARAMS_type] : null, params: c.PARAMS ?? null };
}

const ERROR_CODE = Object.fromEntries(Object.entries(hostCallErrorCode).filter(([, v]) => typeof v === "number").map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v]));
const ERROR_NAME = Object.fromEntries(Object.entries(ERROR_CODE).map(([k, v]) => [v, k]));

/**
 * The host's answer.
 * @param {{ok:boolean, valueType?:string, value?:object, error?:{code:string, message?:string, sandbox?:string, capability?:string}}} r
 *   valueType is the HostCallValue member (e.g. "StorageExpireResult"), value its generated object; error.code one of
 *   unsupported, notAuthorized, invalidParams, failed, refused, sandbox, timeout, tooLarge.
 */
export function encodeHostCallResult(r) {
  const ok = !!r?.ok;
  let error = null;
  if (!ok) {
    const code = ERROR_CODE[r?.error?.code ?? "failed"];
    if (code === undefined || code === 0) throw new Error(`HostCallResult: unknown error code ${r?.error?.code}`);
    error = new HostCallErrorT(code, str(r.error.message), str(r.error.sandbox), str(r.error.capability));
  }
  const tag = ok && r.value != null ? unionMember(HostCallValue, "HostCallValue", r.valueType, r.value) : HostCallValue.NONE;
  return finish(new HostCallResultT(ok, error, tag, ok ? r.value ?? null : null), HostCallResult.finishHostCallResultBuffer);
}
/** @returns {{ok:boolean, valueType:string|null, value:object|null, error:{code:string, message:string, sandbox:string}|null}} */
export function decodeHostCallResult(bytes) {
  const r = rootOf(bytes, HostCallResult, HostCallResult.getRootAsHostCallResult, "HCLR");
  return {
    ok: r.OK,
    valueType: r.VALUE_type ? HostCallValue[r.VALUE_type] : null,
    value: r.VALUE ?? null,
    error: r.ERROR ? { code: ERROR_NAME[r.ERROR.CODE], message: r.ERROR.MESSAGE || "", sandbox: r.ERROR.SANDBOX || "", capability: r.ERROR.CAPABILITY || "" } : null,
  };
}

// ---- the one host operation set --------------------------------------------------------------------------------------

/**
 * Every host operation a module can call, with its HostCallParams member, its HostCallValue member and the
 * capability it needs (null: none). The Go node and the SDK JS hosts serve exactly this set under these names; a host
 * that lacks one answers Unsupported. (Typed contracts 1.0: the node's 67 operations and the JS hosts' set unified;
 * where they differed - crypto names, AES-GCM tag placement, secp256k1 signature encoding - one form is chosen: the
 * ciphertext carries its 16-byte tag at the end, secp256k1 signatures are DER.)
 */
export const HOST_OPERATIONS = Object.freeze(Object.fromEntries([
  // clock, random, host, node, config
  ["clock.now", "ClockNowParams", "ClockNow", "clock"],
  ["random.bytes", "RandomBytesParams", "BytesValue", "random"],
  ["host.info", "HostInfoParams", "HostInfo", null],
  ["host.has_capability", "HasCapabilityParams", "BoolValue", null],
  ["node.identity", "NodeIdentityParams", "NodeIdentity", null],
  ["plugin.get_config", "GetConfigParams", "ModuleConfig", null],
  ["timers.delay", "TimersDelayParams", "Empty", "timers"],
  ["schedule.parse", "ScheduleParams", "ScheduleParsed", "schedule_cron"],
  ["schedule.matches", "ScheduleParams", "BoolValue", "schedule_cron"],
  ["schedule.next", "ScheduleParams", "TimeValue", "schedule_cron"],
  // network
  ["http.request", "HttpRequest", "HttpResponse", "http"],
  ["websocket.exchange", "WebsocketExchangeParams", "WebsocketExchange", "websocket"],
  ["mqtt.publish", "MqttParams", "MqttPublished", "mqtt"],
  ["mqtt.subscribe_once", "MqttParams", "MqttMessage", "mqtt"],
  ["tcp.request", "SocketRequestParams", "SocketResponse", "tcp"],
  ["udp.request", "SocketRequestParams", "SocketResponse", "udp"],
  ["tls.request", "SocketRequestParams", "SocketResponse", "tls"],
  // storage
  ["storage.query", "StorageQueryParams", "StoredRecords", "storage_query"],
  ["storage.write", "StorageWriteParams", "StorageWriteResult", "storage_write"],
  ["storage.delete", "StorageDeleteParams", "Empty", "storage_write"],
  ["storage.expire", "StorageExpireParams", "StorageExpireResult", "storage_write"],
  ["storage.ingest_with_source", "StorageIngestParams", "IngestResult", "storage_ingest"],
  ["storage.flatsql_query_stream", "SqlStreamParams", "RecordStream", "storage_query"],
  ["storage.flatsql_epoch_stream", "EpochStreamParams", "RecordStream", "storage_query"],
  ["storage.query_sandboxed", "SandboxQueryParams", "SandboxQueryResult", "storage_query"],
  ["storage.query_surface", "QuerySurfaceParams", "QuerySurface", "storage_query"],
  ["storage.flatsql_cache_key", "CacheKeyParams", "TextValue", "storage_query"],
  // crypto (one family)
  ["crypto.hash", "CryptoHashParams", "BytesValue", "crypto_hash"],
  ["crypto.public_key", "CryptoPublicKeyParams", "BytesValue", "crypto_sign"],
  ["crypto.sign", "CryptoSignParams", "BytesValue", "crypto_sign"],
  ["crypto.verify", "CryptoVerifyParams", "BoolValue", "crypto_verify"],
  ["crypto.encrypt", "CryptoEncryptParams", "CryptoCiphertext", "crypto_encrypt"],
  ["crypto.decrypt", "CryptoDecryptParams", "BytesValue", "crypto_decrypt"],
  ["crypto.key_agreement", "CryptoKeyAgreementParams", "BytesValue", "crypto_key_agreement"],
  ["crypto.kdf", "CryptoKdfParams", "BytesValue", "crypto_kdf"],
  ["crypto.generate_key", "CryptoGenerateKeyParams", "CryptoKeyPair", "crypto_sign"],
  ["crypto.seal", "CryptoSealParams", "BytesValue", "crypto_encrypt"],
  ["crypto.open", "CryptoOpenParams", "BytesValue", "crypto_decrypt"],
  // keyslot, secrets
  ["keyslot.sign", "KeyslotSignParams", "BytesValue", "wallet_sign"],
  ["keyslot.unwrap", "KeyslotUnwrapParams", "BytesValue", "wallet_sign"],
  ["secrets.get", "SecretIdParams", "Secret", "secrets"],
  ["secrets.status", "SecretIdParams", "SecretStatus", "secrets"],
  ["secrets.put", "SecretPutParams", "SecretStored", "secrets"],
  ["secrets.clear", "SecretIdParams", "Empty", "secrets"],
  // ipfs, pubsub, protocol, p2p
  ["ipfs.add", "IpfsAddParams", "IpfsAddResult", "ipfs"],
  ["ipfs.cat", "IpfsCidParams", "BytesValue", "ipfs"],
  ["ipfs.ls", "IpfsCidParams", "IpfsLinks", "ipfs"],
  ["ipfs.pin_add", "IpfsCidParams", "TextList", "ipfs"],
  ["ipfs.pin_rm", "IpfsCidParams", "TextList", "ipfs"],
  ["ipfs.pin_ls", "IpfsPinLsParams", "IpfsPins", "ipfs"],
  ["ipfs.dag_get", "IpfsCidParams", "BytesValue", "ipfs"],
  ["ipfs.name_resolve", "IpfsNameResolveParams", "TextValue", "ipfs"],
  ["ipfs.name_publish", "IpfsNamePublishParams", "IpfsNamePublished", "ipfs"],
  ["ipfs.id", "IpfsIdParams", "IpfsIdentity", "ipfs"],
  ["ipfs.swarm_peers", "IpfsSwarmPeersParams", "IpfsSwarmPeers", "ipfs"],
  ["pubsub.publish", "PubsubPublishParams", "Empty", "pubsub"],
  ["pubsub.subscribe", "PubsubTopicParams", "PubsubSubscribed", "pubsub"],
  ["pubsub.unsubscribe", "PubsubTopicParams", "Empty", "pubsub"],
  ["pubsub.list_topics", "PubsubListTopicsParams", "TextList", "pubsub"],
  ["protocol.request", "ProtocolRequestParams", "BytesValue", "protocol_dial"],
  ["protocol.dial", "ProtocolDialParams", "Empty", "protocol_dial"],
  ["protocol.register", "ProtocolHandleParams", "Empty", "protocol_handle"],
  ["protocol.unregister", "ProtocolHandleParams", "Empty", "protocol_handle"],
  ["p2p.peers_snapshot", "P2pParams", "P2pPeersSnapshot", "p2p_read"],
  ["p2p.standards_snapshot", "P2pParams", "P2pStandardsSnapshot", "p2p_read"],
  ["p2p.pnm_history", "P2pParams", "P2pPnmHistory", "p2p_read"],
  ["p2p.latest_dataset", "P2pParams", "P2pLatestDataset", "p2p_read"],
  ["node.status", "NodeStatusParams", "NodeStatusReport", "node_status_read"],
  ["node.activity", "NodeActivityParams", "NodeActivity", "node_activity_read"],
  // filesystem, exec, context
  ["filesystem.resolve_path", "FsPathParams", "TextValue", "filesystem"],
  ["filesystem.read_file", "FsPathParams", "BytesValue", "filesystem"],
  ["filesystem.write_file", "FsWriteParams", "Empty", "filesystem"],
  ["filesystem.delete_file", "FsPathParams", "Empty", "filesystem"],
  ["filesystem.mkdir", "FsMkdirParams", "Empty", "filesystem"],
  ["filesystem.readdir", "FsPathParams", "FsEntries", "filesystem"],
  ["filesystem.stat", "FsPathParams", "FsStat", "filesystem"],
  ["filesystem.rename", "FsRenameParams", "Empty", "filesystem"],
  ["exec.exec_file", "ExecParams", "ExecResult", "process_exec"],
  ["context.get", "ContextParams", "ContextValue", "context_read"],
  ["context.list_keys", "ContextParams", "TextList", "context_read"],
  ["context.list_scopes", "ContextListScopesParams", "TextList", "context_read"],
  ["context.set", "ContextParams", "Empty", "context_write"],
  ["context.delete", "ContextParams", "BoolValue", "context_write"],
].map(([op, params, result, capability]) => [op, Object.freeze({ params, result, capability })])));

/**
 * Whether a hostcall payload is the typed envelope (a HostCall, "HCLQ" at bytes 4-7) rather than the JSON-meta
 * envelope of src/host/hostcallWire.js: while hosts move over they answer a typed call with a HostCallResult. The JSON
 * envelope goes once every module is typed (graph: sdk-compliance-typed-only-20261013).
 */
export function isTypedHostCall(payload) {
  return identifierOf(payload) === "HCLQ";
}
