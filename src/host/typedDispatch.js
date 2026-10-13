// The SDK JS hosts' side of the typed hostcall (an SDS $PIV invocation, module -> host; see HOST_OPERATIONS in
// src/standards/runtimeContracts.js): a decoded call's aligned records, list ports and raw ports become the arguments
// the host's operation already takes, and its answer becomes the operation's result record, list and raw ports. The
// hosts' own methods are unchanged; only the wire is typed.
import {
  HOST_OPERATIONS,
  decodeHostCall,
  encodeHostCallResult,
} from "../standards/runtimeContracts.js";
import * as hostOps from "../generated/runtime/aligned/HostOps_aligned.js";
import { base64ToBytes, bytesToBase64 } from "../utils/encoding.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const text = (bytes) => (bytes === undefined ? undefined : textDecoder.decode(bytes));
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
};
function data(v) { return { raw: { data: bytesOf(v) ?? new Uint8Array(0) } }; }
function bool(v) { return { result: { VALUE: Boolean(v) } }; }
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
  if (name === "HostCapabilityError" || error?.code === "host-capability-denied") return "not-authorized";
  if (name === "HostFilesystemScopeError") return "sandbox";
  if (name === "AbortError" || name === "TimeoutError" || /timed out/i.test(error?.message ?? "")) return "timeout";
  if (/^Unknown .* operation|not available in the synchronous hostcall ABI|does not implement/.test(error?.message ?? "")) return "unsupported";
  if (error instanceof RangeError || error instanceof TypeError) return "invalid-params";
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
