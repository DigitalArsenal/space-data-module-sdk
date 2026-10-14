// The Go node's capability operations that the SDK JS hosts (NodeHost, BrowserHost) serve through an embedder's
// capability adapters: secrets, storage, p2p and node status. Each adapter method takes and returns the same
// handler-shaped object the Go node's capability handler does (sdn-server internal/modulert/caps), except that bytes
// are Uint8Array, never base64. typedDispatch.js maps them to and from the typed hostcall's records and frames.
//
//   capabilityAdapters: {
//     secrets: { get, status, put, clear },                              // {id, username?, secret?}
//     storage: { write, query, delete, expire, ingest_with_source,       // storage.<method>
//                flatsql_query_stream, flatsql_epoch_stream, query_sandboxed, query_surface, flatsql_cache_key },
//     p2p:     { peers_snapshot, standards_snapshot, pnm_history, latest_dataset },
//     node:    { peerId, publicKey, status, activity },                  // peerId / publicKey may be strings
//   }
//
// An adapter may instead implement invoke(method, params). Methods may answer synchronously (then the operation also
// works on the synchronous hostcall bridge) or with a Promise.

/** operation -> { capability (null: none), adapter, method } */
export const ADAPTER_OPERATIONS = Object.freeze({
  "node.peerId": { capability: null, adapter: "node", method: "peerId" },
  "node.publicKey": { capability: null, adapter: "node", method: "publicKey" },
  "secrets.get": { capability: "secrets", adapter: "secrets", method: "get" },
  "secrets.status": { capability: "secrets", adapter: "secrets", method: "status" },
  "secrets.put": { capability: "secrets", adapter: "secrets", method: "put" },
  "secrets.clear": { capability: "secrets", adapter: "secrets", method: "clear" },
  "storage.write": { capability: "storage_write", adapter: "storage", method: "write" },
  "storage.query": { capability: "storage_query", adapter: "storage", method: "query" },
  "storage.delete": { capability: "storage_write", adapter: "storage", method: "delete" },
  "storage.expire": { capability: "storage_write", adapter: "storage", method: "expire" },
  "storage.ingest_with_source": { capability: "storage_ingest", adapter: "storage", method: "ingest_with_source" },
  "storage.flatsql_query_stream": { capability: "storage_query", adapter: "storage", method: "flatsql_query_stream" },
  "storage.flatsql_epoch_stream": { capability: "storage_query", adapter: "storage", method: "flatsql_epoch_stream" },
  "storage.query_sandboxed": { capability: "storage_query", adapter: "storage", method: "query_sandboxed" },
  "storage.query_surface": { capability: "storage_query", adapter: "storage", method: "query_surface" },
  "storage.flatsql_cache_key": { capability: "storage_query", adapter: "storage", method: "flatsql_cache_key" },
  "p2p.peers_snapshot": { capability: "p2p_read", adapter: "p2p", method: "peers_snapshot" },
  "p2p.standards_snapshot": { capability: "p2p_read", adapter: "p2p", method: "standards_snapshot" },
  "p2p.pnm_history": { capability: "p2p_read", adapter: "p2p", method: "pnm_history" },
  "p2p.latest_dataset": { capability: "p2p_read", adapter: "p2p", method: "latest_dataset" },
  "node_status_read.status": { capability: "node_status_read", adapter: "node", method: "status" },
  "node_activity_read.activity": { capability: "node_activity_read", adapter: "node", method: "activity" },
});

/** The capabilities those operations need. */
export const ADAPTER_CAPABILITIES = Object.freeze(
  [...new Set(Object.values(ADAPTER_OPERATIONS).map((o) => o.capability).filter(Boolean))],
);

/** The adapters a host's options name: options.<name> or options.capabilityAdapters.<name> (and its aliases). */
export function resolveServiceAdapters(options = {}) {
  const adapters = options.capabilityAdapters && typeof options.capabilityAdapters === "object" ? options.capabilityAdapters : {};
  return {
    secrets: options.secrets ?? adapters.secrets ?? null,
    storage: options.storage ?? adapters.storage ?? adapters.storage_write ?? adapters.storage_query ?? adapters.storage_ingest ?? null,
    p2p: options.p2p ?? adapters.p2p ?? adapters.p2p_read ?? null,
    node: options.node ?? adapters.node ?? adapters.node_status_read ?? adapters.node_activity_read ?? null,
  };
}

/** The host's plugin config (options.config): a plain object, {} when not given. */
export function normalizePluginConfig(config) {
  if (config === undefined || config === null) return {};
  if (typeof config !== "object" || Array.isArray(config)) throw new TypeError("Host config must be an object.");
  return structuredClone(config);
}

const unsupported = (message) => Object.assign(new Error(message), { hostcallCode: "unsupported" });

/**
 * Call `method` on an adapter: its function (sync or async), a plain value it carries under that name
 * (node.peerId: "12D3Koo..."), or adapter.invoke(method, params).
 */
export function callServiceAdapter(adapter, label, method, params) {
  if (!adapter || typeof adapter !== "object") throw unsupported(`${label} adapter is not configured for this host.`);
  const member = adapter[method];
  if (typeof member === "function") return member.call(adapter, params);
  if (member !== undefined) return member;
  if (typeof adapter.invoke === "function") return adapter.invoke(method, params);
  throw unsupported(`${label} adapter does not implement "${method}" or invoke().`);
}
