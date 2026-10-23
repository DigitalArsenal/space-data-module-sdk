// The SDK JS hosts' side of the typed hostcall (an SDS $PIV invocation, module -> host; see HOST_OPERATIONS in
// src/standards/runtimeContracts.js): a decoded call's aligned records, list ports and raw ports become the arguments
// the host's operation already takes, and its answer becomes the operation's result record, list and raw ports. The
// hosts' own methods are unchanged; only the wire is typed.
import {
  HOST_OPERATIONS,
  decodeHostCall,
  decodeSqlValues,
  encodeHostCallResult,
  encodeModuleConfig,
  encodeSqlValues,
} from "../standards/runtimeContracts.js";
import * as hostOps from "../generated/runtime/aligned/HostOps_aligned.js";
import { cryptoAlgorithm, deliverMode, reconcileKind, sandboxWant } from "../generated/runtime/aligned/HostOps_enums.js";
import { base64ToBytes, bytesToBase64 } from "../utils/encoding.js";
import { decodeGuestText } from "../utils/guestText.js";

const textEncoder = new TextEncoder();
const text = (bytes) => (bytes === undefined ? undefined : decodeGuestText(bytes));
const bytesOf = (value) => (value === undefined || value === null ? undefined : value instanceof Uint8Array ? value : typeof value === "string" ? textEncoder.encode(value) : new Uint8Array(value));
const items = (values) => (values || []).map((v) => ({ VALUE: String(v) }));
const unix = (value) => BigInt(Math.round(value instanceof Date ? value.getTime() : Number(value)));

/** FIELD_NAME -> fieldName */
const camel = (field) => field.toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
/** fieldName -> FIELD_NAME */
const upper = (key) => key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();

/** A record's set fields as the host's camelCase options (zero / empty = not given). */
function optionsOf(record) {
  const out = {};
  for (const [field, value] of Object.entries(record || {})) {
    if (value === null || value === undefined || value === "" || value === 0 || value === 0n || value === false) continue;
    out[camel(field)] = typeof value === "bigint" ? Number(value) : value;
  }
  return out;
}
/** The host's camelCase answer as a record of `type` (fields the record does not have are left out). */
function recordOf(type, value) {
  if (!type || !value || typeof value !== "object") return null;
  const record = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === null || v === undefined || v instanceof Uint8Array || typeof v === "object") continue;
    record[upper(key)] = v;
  }
  return pick(type, record);
}
// Only the fields the record declares (the encoder refuses unknown fields).
function pick(type, record) {
  const proto = hostOps[type]?.prototype;
  if (!proto) return record;
  return Object.fromEntries(Object.entries(record).filter(([k]) => typeof proto[`set${k}`] === "function"));
}

/** "name: value" lines -> header object, and back. */
function headersIn(block) {
  if (!block) return undefined;
  const headers = {};
  for (const line of text(block).split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return headers;
}
function headersOut(headers) {
  if (!headers) return undefined;
  const entries = typeof headers.entries === "function" && !(headers instanceof Map) && !Array.isArray(headers) ? Array.from(headers.entries()) : headers instanceof Map ? Array.from(headers) : Object.entries(headers);
  return entries.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("\r\n");
}

const GCM_TAG = 16;
function splitGcm(data) {
  if (!data || data.length < GCM_TAG) throw Object.assign(new Error("AES-GCM data is shorter than its 16-byte tag"), { hostcallCode: "invalid-params" });
  return { ciphertext: data.subarray(0, data.length - GCM_TAG), tag: data.subarray(data.length - GCM_TAG) };
}
const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out; };

// ---- the Go node's handler shapes (sdn-server internal/modulert/typed_hostcall_ops.go), bytes as Uint8Array ---------

const failed = (message, code = "failed") => Object.assign(new Error(message), { hostcallCode: code });
const str = (v) => (v === undefined || v === null ? "" : String(v));
/** An answer's time (RFC 3339 text, a Date or unix ms) as unix ms; undefined when not given, 0 when unreadable. */
function ms(v) {
  if (v === undefined || v === null || v === "") return undefined;
  if (v instanceof Date) return BigInt(Number.isFinite(v.getTime()) ? v.getTime() : 0);
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Number.isFinite(v) ? Math.trunc(v) : 0);
  const t = Date.parse(String(v));
  return BigInt(Number.isFinite(t) ? t : 0);
}
const enumName = (values, v) => Object.keys(values).find((k) => values[k] === Number(v ?? 0)) ?? "";
const binary = (v) => (v instanceof Uint8Array ? v : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : v instanceof ArrayBuffer ? new Uint8Array(v) : undefined);

// A probe view per record class: the generated accessors say each field's JS type (bigint / number / boolean / string).
const probes = new Map();
function probeOf(Class) {
  let view = probes.get(Class);
  if (!view) probes.set(Class, (view = Class.fromPointer(new ArrayBuffer(Class.SIZE), 0)));
  return view;
}
function toBigInt(v) {
  if (typeof v === "bigint") return v;
  if (typeof v === "boolean") return v ? 1n : 0n;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  const n = Number(v);
  return BigInt(Number.isFinite(n) ? Math.trunc(n) : 0);
}
/** Field values (FIELD_NAME: value) as the record of class `Class` takes them; undeclared fields and null / undefined left out. */
function fitClass(Class, record) {
  const view = probeOf(Class), proto = Class.prototype, out = {};
  for (const [field, v] of Object.entries(record || {})) {
    if (v === undefined || v === null) continue;
    const g = field[0].toLowerCase() + field.slice(1);
    if (typeof proto[`set${field}`] !== "function") {
      if (typeof proto[g] === "function" && typeof proto[`setHas${field}`] === "function" && typeof v === "object") out[field] = fitClass(view[g]().constructor, v);
      continue;
    }
    const kind = typeof view[g]();
    out[field] = kind === "bigint" ? toBigInt(v) : kind === "number" ? (Number.isFinite(Number(v)) ? Number(v) : 0) : kind === "boolean" ? v === true || v === "true" : String(v);
  }
  return out;
}
const fit = (type, record) => fitClass(hostOps[type], record);
/** A handler object's scalar values whose upper-cased keys the record declares (the Go node's recordFromObject). */
function fromObject(type, object) {
  const record = {};
  for (const [key, v] of Object.entries(object || {})) {
    if (["string", "number", "boolean", "bigint"].includes(typeof v)) record[key.toUpperCase()] = v;
  }
  return fit(type, record);
}
/** A record's set fields as the handlers' lower-case keys (zero / empty = not given; the Go node's defaultTypedRequest). */
function lower(record) {
  const out = {};
  for (const [field, v] of Object.entries(record || {})) {
    if (v === null || v === undefined || v === "" || v === false || v === 0 || v === 0n) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[field.toLowerCase()] = typeof v === "bigint" ? Number(v) : v;
  }
  return out;
}
/** Bytes [len u32 LE][bytes]... (the size-prefixed record stream on raw "records"). */
function sizePrefixed(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + 4 + c.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const c of chunks) { view.setUint32(at, c.length, true); out.set(c, at + 4); at += 4 + c.length; }
  return out;
}
const MAX_SAFE = 2 ** 53;
/**
 * Raw "params" (FlatSQL's tagged parameter encoding) -> the handlers' tagged params ({t, v}): an i64 beyond 2^53
 * travels as text, bytes as Uint8Array (the Go node: base64).
 */
function sqlParams(raw) {
  if (!raw.params) return undefined;
  let values;
  try { values = decodeSqlValues(raw.params); } catch (error) { throw failed(`params: ${error.message}`, "invalid-params"); }
  return values.map(({ t, v }) => {
    if (t === "null") return { t };
    if (t === "i64") return { t, v: v > BigInt(MAX_SAFE) || v < -BigInt(MAX_SAFE) ? v.toString() : Number(v) };
    return { t, v };
  });
}
const deliverOf = (params) => (enumName(deliverMode, params?.DELIVER) === "Ref" ? "ref" : undefined);
function withDeliver(request, params) {
  delete request.deliver;
  const deliver = deliverOf(params);
  if (deliver) request.deliver = deliver;
  return request;
}
function sqlRequest({ params, raw }) {
  const request = { sql: text(raw.sql) ?? "" };
  const tagged = sqlParams(raw);
  if (tagged) request.params = tagged;
  return withDeliver(request, params);
}
const bodyRef = (ref) => ({ TOKEN: ref.token, SIZE: ref.size, FRAMES: ref.frames ?? -1, FNV1A64: str(ref.fnv1a64) });
/** {rows, columns, stream: bytes | ref: {token, size, frames, fnv1a64}} -> StreamResult-shaped record + raw "stream". */
function streamAnswer(v, type = "StreamResult") {
  const record = { ROWS: v?.rows ?? 0, COLUMNS: v?.columns ?? 0 };
  const answer = { raw: {} };
  if (v?.ref && typeof v.ref === "object") record.REF = bodyRef(v.ref);
  else if (binary(v?.stream)) answer.raw.stream = binary(v.stream);
  answer.result = fit(type, record);
  return answer;
}
/** A rows-answer cell (a JSON value) as a tagged SQL value: an integer is i64, any other number f64. */
function sqlCell(v) {
  if (v === null || v === undefined) return { t: "null" };
  if (typeof v === "boolean") return { t: "bool", v };
  if (typeof v === "number") return Number.isInteger(v) ? { t: "i64", v: BigInt(v) } : { t: "f64", v };
  if (typeof v === "string") return { t: "str", v };
  throw failed(`storage.query_sandboxed: a cell is a ${Array.isArray(v) ? "list" : typeof v} (nested values are not SQL values)`);
}
/**
 * plugin.getConfig: the config as one ModuleConfig FlatBuffer (MCFG) on raw "config" - number arrays NumberList, string
 * arrays StringList, nested objects and arrays of objects TableList, keys sorted (encodeModuleConfig). Unset values
 * (null / undefined) are left out; a value with no config kind (a Date, a function, a list mixing kinds) is refused.
 */
function configOf(value, path) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.filter((v) => v !== null && v !== undefined).map((v, i) => configOf(v, `${path}.${i}`));
  if (typeof value === "object") {
    if (value instanceof Date || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) throw failed(`plugin.getConfig: ${path} is a ${value.constructor?.name ?? "object"}`);
    const out = {};
    for (const key of Object.keys(value)) { const v = configOf(value[key], path ? `${path}.${key}` : key); if (v !== undefined) out[key] = v; }
    return out;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw failed(`plugin.getConfig: ${path} is a ${typeof value}`);
}
function moduleConfig(config) {
  const plain = configOf(config ?? {}, "") ?? {};
  if (Array.isArray(plain) || typeof plain !== "object") throw failed("plugin.getConfig: the config is not an object");
  try {
    return encodeModuleConfig(plain);
  } catch (error) {
    throw failed(`plugin.getConfig: ${error.message}`);
  }
}
function secretRequest({ params, raw }) {
  const request = { id: str(params?.ID) };
  if (params?.USERNAME) request.username = params.USERNAME;
  if (raw.secret) request.secret = text(raw.secret);
  return request;
}
function secretStatus(v) {
  return { result: fit("SecretResult", {
    ID: str(v?.id), CONFIGURED: v?.configured === true || v?.stored === true, USERNAME_MASKED: str(v?.username_masked),
    UPDATED_MS: ms(v?.updated_at ?? v?.updatedAt) ?? 0n, VERIFIED_MS: ms(v?.verified_at) ?? 0n,
  }) };
}
function nodeText(what) {
  return (v) => {
    if (v === undefined || v === null || v === "") throw failed(`node ${what} not available`);
    return { raw: { value: String(v) } };
  };
}
// p2p: the handler's entries -> P2pPnmEntry (the PNM's publish time as unix ms, the signature as hex).
function pnmEntry(e) {
  return fit("P2pPnmEntry", {
    PEER_ID: e.peer_id, PUBLISHER_PEER_ID: e.publisher_peer_id, GOSSIP_PEER_ID: e.gossip_peer_id, STANDARD: e.standard, SCHEMA: e.schema,
    FILE_ID: e.file_id, FILE_NAME: e.file_name, CID: e.cid, PUBLISH_MS: ms(e.publish_timestamp ?? e.publish_ms), SIGNATURE_TYPE: e.signature_type,
    SIGNATURE_HEX: e.signature ?? e.signature_hex, SIGNATURE_VERIFIED: e.signature_verified, ATTRIBUTION: e.attribution, PNM_INDEX: e.pnm_index ?? -1,
    PUBLISHER_KEY_HEX: e.publisher_key ?? e.publisher_key_hex, PUBLISHER_KEY_SOURCE: e.publisher_key_source,
  });
}
const p2pRecords = (v) => (binary(v?.records) ? { records: binary(v.records) } : {});

// ---- keyslot, ipfs, pubsub, protocol: the Go node's request maps (bytes as base64) and answers ----------------------
// the HostOps cryptoAlgorithm enum -> the handlers' algorithm names (the Go node's cryptoAlgorithmNames; "" = default)
const KEYSLOT_ALGORITHMS = {
  Default: "", Ed25519: "ed25519", Secp256k1: "secp256k1", X25519: "x25519", Sha256: "sha256", Sha512: "sha512", Aes256Gcm: "aes-256-gcm", HkdfSha256: "hkdf-sha256",
};
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
/**
 * A handler's binary answer (the Go node's bytesOf): bytes (Uint8Array, a typed view, an ArrayBuffer), base64 text or
 * {__type: "bytes", base64}; undefined when it is none of them.
 */
function answerBytes(v) {
  const b = binary(v);
  if (b) return b;
  const encoded = typeof v === "string" ? v : v && typeof v === "object" && v.__type === "bytes" ? str(v.base64) : undefined;
  if (encoded === undefined || !BASE64.test(encoded)) return undefined;
  return base64ToBytes(encoded);
}
/** The bytes as one raw port (the Go node's dataAnswer / fieldBytes): no bytes is a failure. */
function bytesAnswer(port, field) {
  return (v, { op }) => {
    const value = field === undefined ? v : v && typeof v === "object" && !binary(v) ? v[field] : undefined;
    const bytes = answerBytes(value);
    if (!bytes) throw failed(`${op}: the host answered no ${field ?? "bytes"}`);
    return { raw: { [port]: bytes } };
  };
}
/** A raw port's bytes as base64 under `key` when the module sent it (the Go node's rawB64). */
function rawBase64(request, key, raw, port) {
  if (raw[port] !== undefined) request[key] = bytesToBase64(raw[port]);
  return request;
}
const intOf = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; };
/** The answer's `field` (a list) as sorted text items (the Go node's listOfText). */
const textListOf = (field) => (v) => ({ lists: { items: (Array.isArray(v?.[field]) ? v[field] : []).map(str).sort().map((value) => ({ VALUE: value })) } });
const GO_DURATION_UNITS = { ns: 1e-6, us: 1e-3, "µs": 1e-3, "μs": 1e-3, ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
/** A Go duration ("1h2m3.5s", "350µs", "-12ms") in milliseconds; 0 when unreadable (time.ParseDuration's error). */
function goDurationMs(v) {
  const s = str(v);
  if (s === "0") return 0;
  const m = /^([-+]?)((?:(?:\d+\.?\d*|\.\d+)(?:ns|us|µs|μs|ms|s|m|h))+)$/.exec(s);
  if (!m) return 0;
  let total = 0;
  for (const [, n, unit] of m[2].matchAll(/(\d+\.?\d*|\.\d+)(ns|us|µs|μs|ms|s|m|h)/g)) total += Number(n) * GO_DURATION_UNITS[unit];
  return m[1] === "-" ? -total : total;
}
/** encoding/json's Marshal of a decoded JSON value: object keys sorted, <, >, & and U+2028 / U+2029 escaped. */
function goJson(v) {
  const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])])) : x);
  return JSON.stringify(sortKeys(v) ?? null).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
const objectOf = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const p2pRequest = ({ params }) => withDeliver(lower(params), params);
const objects = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);

// Per operation: in(call) -> the host's params; out(value) -> { result, lists, raw }. Operations not listed here pass
// their record's fields as camelCase options and answer a record from the host's camelCase fields.
const ADAPTERS = {
  "host.runtimeTarget": { out: (v) => ({ raw: { value: String(v) } }) },
  "host.listCapabilities": { out: (v) => ({ lists: { items: items(v) } }) },
  "host.listSupportedCapabilities": { out: (v) => ({ lists: { items: items(v) } }) },
  "host.listOperations": { out: (v) => ({ lists: { items: items(v) } }) },
  "host.hasCapability": { in: ({ params }) => ({ capability: params?.CAPABILITY }), out: (v) => ({ result: { VALUE: Boolean(v) } }) },
  "clock.now": { out: (v) => ({ result: { UNIX_MS: unix(v) } }) },
  "clock.nowIso": { out: (v) => ({ raw: { value: String(v) } }) },
  "clock.monotonicNow": { out: (v) => ({ result: { VALUE: Number(v) } }) },
  "random.bytes": { in: ({ params }) => ({ length: params?.LENGTH || 32 }), out: (v) => ({ raw: { data: bytesOf(v) } }) },
  "timers.delay": { in: ({ params }) => ({ ms: params?.MS ?? 0 }), out: () => ({}) },
  "schedule.parse": {
    in: ({ params }) => ({ expression: params?.EXPRESSION }),
    out: (v) => ({ lists: { fields: Object.entries(v || {}).filter(([, f]) => f && typeof f === "object" && Array.isArray(f.values)).map(([name, f]) => ({ NAME: name, SOURCE: String(f.source ?? ""), HAS_WILDCARD: Boolean(f.hasWildcard), VALUES: f.values })) } }),
  },
  "schedule.matches": { in: ({ params }) => ({ expression: params?.EXPRESSION, date: params?.AT_MS ? new Date(Number(params.AT_MS)) : new Date() }), out: (v) => ({ result: { VALUE: Boolean(v) } }) },
  "schedule.next": { in: ({ params }) => ({ expression: params?.EXPRESSION, from: params?.AT_MS ? new Date(Number(params.AT_MS)) : new Date() }), out: (v) => ({ result: { UNIX_MS: unix(v) } }) },
  "http.request": {
    in: ({ params, raw }) => ({
      url: text(raw.url), method: params?.METHOD || "GET", headers: headersIn(raw.headers), body: raw.body,
      timeoutMs: params?.TIMEOUT_MS || undefined, responseType: "bytes", redirect: params?.NO_REDIRECTS ? "manual" : "follow",
      maxBytes: params?.MAX_BYTES ? Number(params.MAX_BYTES) : undefined,
    }),
    out: (v, { params }) => {
      const body = bytesOf(v?.body) ?? new Uint8Array(0);
      if (params?.MAX_BYTES && body.length > Number(params.MAX_BYTES)) throw Object.assign(new Error(`HTTP body of ${body.length} bytes exceeds MAX_BYTES ${params.MAX_BYTES}`), { hostcallCode: "too-large" });
      return { result: { STATUS: v?.status ?? 0, RETRIEVED_MS: BigInt(Date.now()) }, raw: { url: String(v?.url ?? ""), headers: headersOut(v?.headers) ?? "", body } };
    },
  },
  "websocket.exchange": {
    in: ({ params, raw }) => ({
      url: text(raw.url), protocols: raw.protocols ? text(raw.protocols).split(",").map((p) => p.trim()).filter(Boolean) : undefined,
      message: raw.message === undefined ? undefined : params?.MESSAGE_IS_TEXT ? text(raw.message) : raw.message,
      timeoutMs: params?.TIMEOUT_MS || undefined, expectResponse: !params?.NO_RESPONSE, responseType: "bytes",
    }),
    out: (v) => ({ result: { PROTOCOL: v?.protocol ?? "", EXTENSIONS: v?.extensions ?? "", CLOSE_CODE: v?.closeCode ?? -1, CLOSE_REASON: v?.closeReason ?? "", BODY_IS_TEXT: typeof v?.body === "string" }, raw: { url: String(v?.url ?? ""), ...(v?.body == null ? {} : { body: bytesOf(v.body) }) } }),
  },
  "mqtt.publish": { in: ({ params, raw }) => ({ ...optionsOf(params), keepAliveSeconds: params?.KEEP_ALIVE_S || undefined, payload: raw.payload, password: text(raw.password) }), out: (v) => ({ result: recordOf("MqttResult", v) }) },
  "mqtt.subscribeOnce": { in: ({ params, raw }) => ({ ...optionsOf(params), keepAliveSeconds: params?.KEEP_ALIVE_S || undefined, password: text(raw.password), responseType: "bytes" }), out: (v) => ({ result: recordOf("MqttResult", v), raw: v?.payload == null && v?.body == null ? {} : { body: bytesOf(v.payload ?? v.body) } }) },
  "tcp.request": socket(),
  "udp.request": socket(),
  "tls.request": socket(({ raw }) => ({ ca: text(raw.ca), cert: text(raw.cert), key: text(raw.key) })),
  "filesystem.resolvePath": { in: ({ raw }) => ({ path: text(raw.path) }), out: (v) => ({ raw: { path: String(v) } }) },
  "filesystem.readFile": { in: ({ raw }) => ({ path: text(raw.path) }), out: (v) => ({ raw: { data: bytesOf(v) } }) },
  "filesystem.writeFile": { in: ({ raw }) => ({ path: text(raw.path), value: raw.data ?? new Uint8Array(0) }), out: () => ({}) },
  "filesystem.appendFile": { in: ({ raw }) => ({ path: text(raw.path), value: raw.data ?? new Uint8Array(0) }), out: () => ({}) },
  "filesystem.deleteFile": { in: ({ raw }) => ({ path: text(raw.path) }), out: () => ({}) },
  "filesystem.mkdir": { in: ({ params, raw }) => ({ path: text(raw.path), recursive: !params?.NOT_RECURSIVE }), out: () => ({}) },
  "filesystem.readdir": { in: ({ raw }) => ({ path: text(raw.path) ?? "." }), out: (v) => ({ lists: { entries: (v || []).map((e) => ({ NAME: e.name, IS_FILE: Boolean(e.isFile), IS_DIRECTORY: Boolean(e.isDirectory) })) } }) },
  "filesystem.stat": { in: ({ raw }) => ({ path: text(raw.path) }), out: (v) => ({ result: { SIZE: BigInt(v?.size ?? 0), IS_FILE: Boolean(v?.isFile), IS_DIRECTORY: Boolean(v?.isDirectory), CTIME_MS: Number(v?.ctimeMs ?? 0), MTIME_MS: Number(v?.mtimeMs ?? 0) }, raw: { path: String(v?.path ?? "") } }) },
  "filesystem.rename": { in: ({ raw }) => ({ fromPath: text(raw.path), toPath: text(raw.to_path) }), out: () => ({}) },
  "exec.execFile": {
    in: ({ params, raw, lists }) => ({
      file: text(raw.file), args: (lists.args || []).map((a) => a.VALUE), cwd: text(raw.cwd), input: raw.input,
      env: lists.env ? Object.fromEntries(lists.env.map((e) => [e.NAME, e.VALUE])) : undefined, timeoutMs: params?.TIMEOUT_MS || undefined,
    }),
    out: (v) => ({ result: { EXIT_CODE: v?.exitCode ?? -1, SIGNAL: v?.signal ?? "" }, raw: { stdout: bytesOf(v?.stdout) ?? new Uint8Array(0), stderr: bytesOf(v?.stderr) ?? new Uint8Array(0) } }),
  },
  "context.get": { in: ({ params }) => ({ scope: params?.SCOPE, key: params?.KEY }), out: (v) => ({ result: { VALUE: v !== undefined && v !== null }, raw: v == null ? {} : { value: bytesOf(v) } }) },
  "context.set": { in: ({ params, raw }) => ({ scope: params?.SCOPE, key: params?.KEY, value: raw.value ?? new Uint8Array(0) }), out: () => ({}) },
  "context.delete": { in: ({ params }) => ({ scope: params?.SCOPE, key: params?.KEY }), out: (v) => ({ result: { VALUE: Boolean(v) } }) },
  "context.listKeys": { in: ({ params }) => ({ scope: params?.SCOPE }), out: (v) => ({ lists: { items: items(v) } }) },
  "context.listScopes": { out: (v) => ({ lists: { items: items(v) } }) },
  // crypto: keys, data, signatures and nonces are raw frames; AES-GCM data carries its 16-byte tag at the end
  "crypto.sha256": { in: ({ raw }) => ({ value: raw.data ?? new Uint8Array(0) }), out: data },
  "crypto.sha512": { in: ({ raw }) => ({ value: raw.data ?? new Uint8Array(0) }), out: data },
  "crypto.hkdf": { in: ({ params, raw }) => ({ ikm: raw.ikm, salt: raw.salt ?? new Uint8Array(0), info: raw.info, length: params?.LENGTH || 32 }), out: data },
  "crypto.aesGcmEncrypt": { in: ({ raw }) => ({ key: raw.key, plaintext: raw.data ?? new Uint8Array(0), iv: raw.nonce, aad: raw.aad }), out: (v, { raw }) => ({ raw: { data: concat(v.ciphertext, v.tag), nonce: raw.nonce } }) },
  "crypto.aesGcmDecrypt": { in: ({ raw }) => ({ key: raw.key, ...splitGcm(raw.data), iv: raw.nonce, aad: raw.aad }), out: data },
  "crypto.x25519.generateKeypair": { out: (v) => ({ raw: { private_key: v.privateKey, public_key: v.publicKey } }) },
  "crypto.x25519.publicKey": { in: ({ raw }) => ({ privateKey: raw.private_key }), out: data },
  "crypto.x25519.sharedSecret": { in: ({ raw }) => ({ privateKey: raw.private_key, publicKey: raw.public_key }), out: data },
  // the sealed box's envelope is its protected blob: ciphertext + tag with the SDS $REC / $ENC records appended
  "crypto.sealedBox.encryptForRecipient": { in: ({ raw }) => ({ plaintext: raw.data ?? new Uint8Array(0), recipientPublicKey: raw.public_key, context: raw.info ? text(raw.info) : undefined }), out: (v) => ({ raw: { data: base64ToBytes(v.protectedBlobBase64) } }) },
  "crypto.sealedBox.decryptFromEnvelope": { in: ({ raw }) => ({ envelope: { protectedBlobBase64: bytesToBase64(raw.envelope ?? raw.data) }, recipientPrivateKey: raw.private_key }), out: data },
  "crypto.secp256k1.publicKeyFromPrivate": { in: ({ raw }) => ({ privateKey: raw.private_key }), out: data },
  "crypto.secp256k1.sign": { in: ({ raw }) => ({ message: raw.data, privateKey: raw.private_key }), out: data },
  "crypto.secp256k1.verify": { in: ({ raw }) => ({ message: raw.data, signature: raw.signature, publicKey: raw.public_key }), out: bool },
  "crypto.secp256k1.signDigest": { in: ({ raw }) => ({ digest: raw.data, privateKey: raw.private_key }), out: data },
  "crypto.secp256k1.verifyDigest": { in: ({ raw }) => ({ digest: raw.data, signature: raw.signature, publicKey: raw.public_key }), out: bool },
  "crypto.ed25519.publicKeyFromSeed": { in: ({ raw }) => ({ seed: raw.private_key }), out: data },
  "crypto.ed25519.sign": { in: ({ raw }) => ({ message: raw.data, seed: raw.private_key }), out: data },
  "crypto.ed25519.verify": { in: ({ raw }) => ({ message: raw.data, signature: raw.signature, publicKey: raw.public_key }), out: bool },

  // ---- the Go node's operations, through the embedder's adapters (adapterOperations.js) ------------------------------
  "plugin.getConfig": { in: () => ({}), out: (v) => ({ raw: { config: moduleConfig(v) } }) },
  "node.peerId": { in: () => ({}), out: nodeText("peer ID") },
  "node.publicKey": { in: () => ({}), out: nodeText("public key") },
  "secrets.get": { in: secretRequest, out: (v) => ({ result: fit("SecretResult", { ID: str(v?.id), USERNAME: str(v?.username), CONFIGURED: true }), raw: { secret: bytesOf(v?.secret) ?? new Uint8Array(0) } }) },
  "secrets.status": { in: secretRequest, out: secretStatus },
  "secrets.put": { in: secretRequest, out: secretStatus },
  "secrets.clear": { in: secretRequest, out: () => ({}) },
  // storage: {schema, data} -> {cid}
  "storage.write": { in: ({ params, raw }) => ({ ...lower(params), data: raw.data ?? new Uint8Array(0) }), out: (v) => ({ result: fit("StorageWriteResult", { CID: str(v?.cid) }) }) },
  // the store's records ({CID, RowID, PeerID, Timestamp, MaterializedAt, SourceTags, Data}) -> list "records_meta" + the
  // size-prefixed records on raw "records"
  "storage.query": {
    in: ({ params }) => lower(params),
    out: (v) => {
      const meta = [], chunks = [];
      for (const r of objects(Array.isArray(v) ? v : v?.records)) {
        const tags = r.SourceTags || {}, data = binary(r.Data) ?? new Uint8Array(0);
        chunks.push(data);
        meta.push(fit("StoredRecordMeta", {
          CID: str(r.CID), ROW_ID: r.RowID ?? 0, PEER_ID: str(r.PeerID), TIMESTAMP_MS: ms(r.Timestamp) ?? 0n, MATERIALIZED_MS: ms(r.MaterializedAt) ?? 0n,
          LENGTH: data.length, PROVIDER_ID: str(tags.ProviderID), SOURCE_NAME: str(tags.SourceName), BATCH_ID: str(tags.BatchID),
          PRODUCER_PEER_ID: str(tags.ProducerPeerID), LICENSE: str(tags.License),
        }));
      }
      return { lists: { records_meta: meta }, raw: { records: sizePrefixed(chunks) } };
    },
  },
  "storage.delete": { in: ({ params }) => lower(params), out: () => ({}) },
  // {schema, provider_id, source_name, before_ms, batch, max_deletes} -> {deleted, missing, capped}
  "storage.expire": { in: ({ params }) => lower(params), out: (v) => ({ result: fromObject("StorageExpireResult", v) }) },
  // flat source tags, reconcile "duplicates" | "none" | "current", records, archive {source, name, raw}, provenance
  // {source, json} (the "provenance" record as a JSON document, keys lower-cased)
  "storage.ingest_with_source": {
    in: ({ params, raw, lists }) => {
      const request = lower(params);
      delete request.archive_source; delete request.archive_name;
      request.reconcile = enumName(reconcileKind, params?.RECONCILE).toLowerCase();
      if (raw.records) request.records = raw.records;
      if (raw.archive) request.archive = { source: str(params?.ARCHIVE_SOURCE), name: str(params?.ARCHIVE_NAME), raw: raw.archive };
      const provenance = lists.provenance?.[0], attributes = lists.provenance_attributes;
      if (provenance || attributes?.length) {
        const document = {};
        if (attributes?.length) document.attributes = attributes.map((a) => ({ name: str(a.NAME), value: str(a.VALUE) }));
        for (const [key, v] of Object.entries(provenance || {})) document[key.toLowerCase()] = typeof v === "bigint" ? Number(v) : v ?? "";
        const sorted = Object.fromEntries(Object.keys(document).sort().map((k) => [k, document[k]]));
        request.provenance = { source: str(params?.SOURCE_NAME), json: textEncoder.encode(JSON.stringify(sorted)) };
      }
      return request;
    },
    out: (v) => {
      const result = fromObject("StorageIngestResult", v);
      if (v?.provenance) result.PROVENANCE_FILE = str(v.provenance);
      return { result };
    },
  },
  "storage.flatsql_query_stream": { in: sqlRequest, out: (v) => streamAnswer(v) },
  "storage.flatsql_epoch_stream": { in: ({ params }) => withDeliver(lower(params), params), out: (v) => streamAnswer(v) },
  // want "stream" answers like flatsql_query_stream (KIND Stream); "rows" ({kind: "rows", json}) with list "columns"
  // and raw "cells" (tagged SQL values, row-major)
  "storage.query_sandboxed": {
    in: (call) => ({ ...sqlRequest(call), want: enumName(sandboxWant, call.params?.WANT).toLowerCase() }),
    out: (v) => {
      if (v?.kind !== "rows") {
        const answer = streamAnswer(v, "SandboxQueryResult");
        answer.result.KIND = sandboxWant.Stream;
        return answer;
      }
      const doc = typeof v.json === "string" ? v.json : binary(v.json) ? text(binary(v.json)) : undefined;
      if (doc === undefined) throw failed("storage.query_sandboxed: rows answer carries no rows");
      let rows;
      try { rows = JSON.parse(doc); } catch (error) { throw failed(`storage.query_sandboxed: ${error.message}`); }
      if (!Array.isArray(rows)) throw failed("storage.query_sandboxed: rows are not a JSON array");
      const columns = rows.length && rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : [];
      const cells = [];
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw failed("storage.query_sandboxed: a row is not an object");
        for (const cell of Object.values(row)) cells.push(sqlCell(cell));
      }
      return {
        result: fit("SandboxQueryResult", { KIND: sandboxWant.Rows, ROWS: rows.length, COLUMNS: columns.length }),
        lists: { columns: columns.map((c) => ({ VALUE: c })) },
        raw: { cells: encodeSqlValues(cells) },
      };
    },
  },
  // {tables: [{name, kind, source, records, columns: [name | {name, placeholder}]}], caps: {timeout_ms, max_rows, max_bytes}}
  "storage.query_surface": {
    in: () => ({}),
    out: (v) => {
      const tables = [], columns = [];
      for (const t of objects(v?.tables)) {
        const name = str(t.name);
        tables.push(fit("SurfaceTable", { NAME: name, KIND: str(t.kind), SOURCE: str(t.source), RECORDS: t.records ?? 0 }));
        for (const c of Array.isArray(t.columns) ? t.columns : []) {
          if (typeof c === "string") columns.push(fit("SurfaceColumn", { TABLE: name, NAME: c }));
          else if (c && typeof c === "object") columns.push(fit("SurfaceColumn", { TABLE: name, NAME: str(c.name), PLACEHOLDER: c.placeholder === true }));
        }
      }
      const caps = v?.caps && typeof v.caps === "object" ? v.caps : null;
      return {
        ...(caps ? { result: fit("QuerySurfaceLimits", { TIMEOUT_MS: caps.timeout_ms ?? 0, MAX_ROWS: caps.max_rows ?? 0, MAX_BYTES: caps.max_bytes ?? 0 }) } : {}),
        lists: { tables, columns },
      };
    },
  },
  "storage.flatsql_cache_key": {
    in: (call) => {
      const request = { ...lower(call.params), ...sqlRequest(call) };
      if (call.lists.projection) request.projection = call.lists.projection.map((p) => str(p.VALUE));
      return request;
    },
    out: (v) => ({ raw: { value: str(v?.key) } }),
  },
  // p2p: the frames ($EPM / $PNM, size-prefixed and concatenated) on raw "records"
  "p2p.peers_snapshot": {
    in: p2pRequest,
    out: (v) => {
      const peers = [], addresses = [], standards = [];
      for (const p of objects(v?.peers)) {
        peers.push(fit("P2pPeer", { PEER_ID: str(p.peer_id), CONNECTED: p.connected === true, SELF: p.self === true, EPM_INDEX: p.epm_index ?? -1, AGENT_VERSION: p.agent_version }));
        for (const a of Array.isArray(p.addrs) ? p.addrs : []) addresses.push(fit("P2pPeerValue", { PEER_ID: str(p.peer_id), VALUE: str(a) }));
        for (const s of Array.isArray(p.standards) ? p.standards : []) standards.push(fit("P2pPeerValue", { PEER_ID: str(p.peer_id), VALUE: str(s) }));
      }
      return { result: fromObject("P2pSummary", v), lists: { peers, peer_addresses: addresses, peer_standards: standards }, raw: p2pRecords(v) };
    },
  },
  "p2p.standards_snapshot": { in: p2pRequest, out: (v) => ({ lists: { entries: objects(v?.entries).map(pnmEntry) }, raw: p2pRecords(v) }) },
  "p2p.pnm_history": { in: p2pRequest, out: (v) => ({ result: fromObject("P2pSummary", v), lists: { entries: objects(v?.entries).map(pnmEntry) }, raw: p2pRecords(v) }) },
  // {known, reason, pinned, self, fresh, standard, schema, pnm, serving: {batch_id, ..., pnm, ref | stream}}: the served
  // batch's PNM pointer when one is served, else the newest
  "p2p.latest_dataset": {
    in: p2pRequest,
    out: (v) => {
      const serving = v?.serving && typeof v.serving === "object" ? v.serving : {};
      const pnm = (serving.pnm && typeof serving.pnm === "object" ? serving.pnm : v?.pnm) || {};
      const result = fit("P2pLatestDataset", {
        KNOWN: v?.known === true, REASON: v?.reason, PINNED: v?.pinned, SELF: v?.self, FRESH: v?.fresh, STANDARD: v?.standard, SCHEMA: v?.schema,
        PNM_CID: pnm.CID ?? pnm.cid, PNM_FILE_ID: pnm.FILE_ID ?? pnm.file_id, PNM_PUBLISH_MS: ms(pnm.PUBLISH_TIMESTAMP ?? pnm.publish_timestamp),
        PNM_SIGNATURE_VERIFIED: pnm.signature_verified, PNM_ATTRIBUTION: pnm.attribution,
        BATCH_ID: serving.batch_id, PROVIDER_ID: serving.provider_id, SOURCE_NAME: serving.source_name, RECORD_COUNT: serving.record_count,
        BYTE_COUNT: serving.byte_count, PARTS: serving.parts, PUBLISHED_MS: ms(serving.published_at), ETAG_FNV1A64: serving.etag_fnv1a64,
        REF: serving.ref && typeof serving.ref === "object" ? bodyRef(serving.ref) : undefined,
      });
      return { result, raw: binary(serving.stream) ? { stream: binary(serving.stream) } : {} };
    },
  },
  // keyslot: the host's crypto oracle takes and answers base64 ({signature} / {plaintext})
  "keyslot.sign": {
    in: ({ params, raw }) => {
      const request = { slotId: str(params?.SLOT_ID) };
      const algorithm = KEYSLOT_ALGORITHMS[enumName(cryptoAlgorithm, params?.ALGORITHM)];
      if (algorithm) request.algorithm = algorithm;
      return rawBase64(request, "payload", raw, "payload");
    },
    out: bytesAnswer("data", "signature"),
  },
  "keyslot.unwrap": {
    in: ({ params, raw }) => {
      const request = { slotId: str(params?.SLOT_ID) };
      rawBase64(request, "ephemeralPublicKey", raw, "ephemeral_public_key");
      rawBase64(request, "nonce", raw, "nonce");
      return rawBase64(request, "ciphertext", raw, "ciphertext");
    },
    out: bytesAnswer("data", "plaintext"),
  },
  // protocol: {target, protocolId, timeoutMs, payloadBase64} -> the peer's answer bytes
  "protocol.request": {
    in: ({ params, raw }) => {
      const request = { target: str(params?.TARGET), protocolId: str(params?.PROTOCOL_ID) };
      if (Number(params?.TIMEOUT_MS) > 0) request.timeoutMs = Number(params.TIMEOUT_MS);
      return rawBase64(request, "payloadBase64", raw, "payload");
    },
    out: bytesAnswer("data"),
  },
  "pubsub.list_topics": { in: () => ({}), out: textListOf("topics") },
  // ipfs: the record's set fields as lower-case keys; Kubo's answers ({Objects: [{Links}]}, {Pins}, {Keys}, {ID, ...})
  "ipfs.cat": { in: ({ params }) => lower(params), out: bytesAnswer("data") },
  // the DAG node as Kubo encodes it (dag-json); bytes pass as they are
  "ipfs.dag_get": { in: ({ params }) => lower(params), out: (v) => ({ raw: { data: binary(v) ?? textEncoder.encode(goJson(v)) } }) },
  "ipfs.ls": {
    in: ({ params }) => lower(params),
    out: (v) => ({ lists: { links: objects(objectOf(v).Objects).flatMap((o) => objects(o.Links)).map((l) => fit("IpfsLink", { NAME: str(l.Name), CID: str(l.Hash), SIZE: intOf(l.Size), TYPE: intOf(l.Type) })) } }),
  },
  "ipfs.pin_add": { in: ({ params }) => lower(params), out: textListOf("Pins") },
  "ipfs.pin_rm": { in: ({ params }) => lower(params), out: textListOf("Pins") },
  "ipfs.pin_ls": {
    in: ({ params }) => lower(params),
    out: (v) => {
      const keys = objectOf(objectOf(v).Keys);
      return { lists: { pins: Object.keys(keys).sort().map((cid) => fit("IpfsPin", { CID: cid, TYPE: str(objectOf(keys[cid]).Type) })) } };
    },
  },
  "ipfs.name_resolve": { in: ({ params }) => lower(params), out: (v) => ({ result: fit("IpfsResult", { VALUE: str(v?.Path) }) }) },
  "ipfs.name_publish": { in: ({ params }) => lower(params), out: (v) => ({ result: fit("IpfsResult", { NAME: str(v?.Name), VALUE: str(v?.Value) }) }) },
  "ipfs.id": {
    in: () => ({}),
    out: (v) => ({
      result: fit("IpfsResult", { NAME: str(v?.ID), VALUE: str(v?.PublicKey), AGENT_VERSION: str(v?.AgentVersion), PROTOCOL_VERSION: str(v?.ProtocolVersion) }),
      lists: { addresses: (Array.isArray(v?.Addresses) ? v.Addresses : []).map((a) => ({ VALUE: str(a) })) },
    }),
  },
  "ipfs.swarm_peers": {
    in: () => ({}),
    out: (v) => ({ lists: { peers: objects(objectOf(v).Peers).map((p) => fit("IpfsSwarmPeer", { PEER_ID: str(p.Peer), ADDRESS: str(p.Addr), LATENCY_MS: goDurationMs(p.Latency) })) } }),
  },
  "ipfs.pubsub_publish": { in: ({ params, raw }) => rawBase64({ topic: str(params?.TOPIC) }, "base64", raw, "data"), out: () => ({}) },
  // node status and activity
  "node_status_read.status": {
    in: () => ({}),
    out: (v) => {
      const store = v?.store || {}, service = v?.service || {};
      const record = {
        UPTIME_S: v?.uptime_seconds ?? 0, STARTED_MS: ms(v?.started_at) ?? 0n, STORE_TOTAL_BYTES: store.total_bytes ?? 0, STORE_TOTAL_RECORDS: store.total_records ?? 0,
        STORAGE_PATH: str(store.storage_path), SERVICE_STATE: str(service.state), SERVICE_MODE: str(service.mode),
      };
      if (v?.disk && typeof v.disk === "object") {
        Object.assign(record, { HAS_DISK: true, DISK_CAPACITY_BYTES: v.disk.capacity_bytes ?? 0, DISK_FREE_BYTES: v.disk.free_bytes ?? 0, DISK_AVAILABLE_BYTES: v.disk.available_bytes ?? 0 });
      }
      const history = [];
      if (v?.bandwidth && typeof v.bandwidth === "object") {
        const bw = v.bandwidth;
        Object.assign(record, { HAS_BANDWIDTH: true, TOTAL_IN_BYTES: bw.total_in_bytes ?? 0, TOTAL_OUT_BYTES: bw.total_out_bytes ?? 0, RATE_IN_BPS: bw.rate_in_bps ?? 0, RATE_OUT_BPS: bw.rate_out_bps ?? 0 });
        for (const s of objects(bw.history)) {
          history.push(fit("NodeBandwidthSample", { TS_MS: ms(s.ts) ?? 0n, TOTAL_IN_BYTES: s.total_in_bytes ?? 0, TOTAL_OUT_BYTES: s.total_out_bytes ?? 0, RATE_IN_BPS: s.rate_in_bps ?? 0, RATE_OUT_BPS: s.rate_out_bps ?? 0 }));
        }
      }
      return { result: fit("NodeStatusReport", record), lists: { bandwidth_history: history } };
    },
  },
  "node_activity_read.activity": {
    in: ({ params }) => lower(params),
    out: (v) => ({ lists: { events: objects(v?.events).map((e) => fit("NodeActivityEvent", { TS_MS: ms(e.ts) ?? 0n, KIND: str(e.kind), DETAIL: str(e.detail), PEER_ID: str(e.peer_id) })) } }),
  },
};
function data(v) { return { raw: { data: bytesOf(v) ?? new Uint8Array(0) } }; }
// a verify's answer: a boolean, or the hosts' {result: boolean} (the secp256k1 verifies) - an object is not "true"
function bool(v) { return { result: { VALUE: v !== null && typeof v === "object" ? v.result === true : Boolean(v) } }; }
function socket(extra = () => ({})) {
  return {
    in: (call) => {
      const { params, raw } = call;
      const options = optionsOf(params);
      delete options.noResponse; delete options.allowUnauthorized; delete options.serverName;
      return {
        ...options, data: raw.data, responseEncoding: "bytes",
        expectResponse: !params?.NO_RESPONSE, rejectUnauthorized: !params?.ALLOW_UNAUTHORIZED,
        servername: params?.SERVER_NAME || undefined, ...extra(call),
      };
    },
    out: (v) => ({ result: recordOf("SocketResult", v), raw: v?.body == null ? {} : { body: bytesOf(v.body) } }),
  };
}

/** The host's params for a decoded typed call. */
export function hostParamsOf(call) {
  const adapter = ADAPTERS[call.op];
  if (adapter?.in) return adapter.in(call);
  return { ...optionsOf(call.params), ...Object.fromEntries(Object.entries(call.raw).map(([k, v]) => [camel(k), v])) };
}
/** The typed answer ({ result, lists, raw }) for the host's value. */
export function typedResultOf(call, value) {
  const adapter = ADAPTERS[call.op];
  if (adapter?.out) return adapter.out(value, call);
  const spec = HOST_OPERATIONS[call.op];
  return { result: spec?.result ? recordOf(spec.result, value) : undefined };
}

/** The HOSTCALL_ERROR_CODES code for a host error. */
export function hostcallErrorCode(error) {
  if (error?.hostcallCode) return error.hostcallCode;
  const name = error?.name ?? error?.constructor?.name ?? "";
  if (name === "HostCapabilityError" || name === "BrowserHostCapabilityError" || error?.code === "host-capability-denied") return "not-authorized";
  if (name === "HostFilesystemScopeError") return "sandbox";
  if (name === "AbortError" || name === "TimeoutError" || /timed out/i.test(error?.message ?? "")) return "timeout";
  if (/^Unknown .* operation|not available in the synchronous hostcall ABI|does not implement/.test(error?.message ?? "")) return "unsupported";
  // a string or list that does not fit its aligned record (the Go node's recordErr)
  if (/exceeds? the record/.test(error?.message ?? "")) return "too-large";
  // (by name too: an error that crossed the worker harness's channel is a plain Error carrying the name)
  if (error instanceof RangeError || error instanceof TypeError || name === "RangeError" || name === "TypeError") return "invalid-params";
  return "failed";
}

/**
 * Answer one typed hostcall payload: decode the $PIV request, run `dispatch(op, params)` (sync, or a Promise when
 * `allowAsync`), and encode the $PIV response. Errors become STATUS FAILED with their code; nothing throws.
 */
export function answerTypedHostCall(payload, dispatch, { allowAsync = false } = {}) {
  let call;
  const failure = (error) => encodeHostCallResult({ ok: false, error: { code: hostcallErrorCode(error), message: String(error?.message ?? error) } });
  const success = (value) => {
    try { return encodeHostCallResult({ ok: true, op: call.op, ...typedResultOf(call, value) }); } catch (error) { return failure(error); }
  };
  try {
    call = decodeHostCall(payload);
    if (!HOST_OPERATIONS[call.op]) throw Object.assign(new Error(`Unknown host operation "${call.op}".`), { hostcallCode: "unsupported" });
    const value = dispatch(call.op, hostParamsOf(call));
    if (value && typeof value.then === "function") {
      if (!allowAsync) {
        if (typeof value.catch === "function") value.catch(() => {});
        throw Object.assign(new Error(`Operation "${call.op}" is not available in the synchronous hostcall ABI.`), { hostcallCode: "unsupported" });
      }
      return value.then(success, failure);
    }
    return success(value);
  } catch (error) {
    if (error && !error.hostcallCode && call === undefined) error.hostcallCode = "invalid-params";
    return failure(error);
  }
}
