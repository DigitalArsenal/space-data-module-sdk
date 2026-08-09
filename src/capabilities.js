export const RecommendedCapabilityIds = Object.freeze([
  "clock",
  "random",
  "logging",
  "timers",
  "schedule_cron",
  "http",
  "tls",
  "websocket",
  "mqtt",
  "tcp",
  "udp",
  "network",
  "filesystem",
  "pipe",
  "pubsub",
  "protocol_handle",
  "protocol_dial",
  "p2p_read",
  "database",
  "storage_adapter",
  "storage_query",
  "storage_write",
  "storage_ingest",
  "context_read",
  "context_write",
  "process_exec",
  "crypto_hash",
  "crypto_sign",
  "crypto_verify",
  "crypto_encrypt",
  "crypto_decrypt",
  "crypto_key_agreement",
  "crypto_kdf",
  "wallet_sign",
  "ipfs",
  "gpu_compute",
  "scene_access",
  "entity_access",
  "render_hooks",
]);

export const StandaloneWasiCapabilityIds = Object.freeze([
  "logging",
  "clock",
  "random",
  "filesystem",
  "pipe",
]);

/**
 * Capabilities a PORTABLE artifact may not claim against the canonical browser
 * runtime target. The browser HOST can route several of these when the
 * embedder injects an adapter (see BrowserHostSupportedCapabilities) — this
 * list is the DECLARATION policy, not the dispatch table: a published module
 * cannot assume its embedder wired one.
 *
 * It lives here, beside the other capability vocabularies, rather than inside
 * the compliance module, because two browser-facing surfaces need it: the flow
 * compiler (which subtracts `browser` from a composed artifact's derived
 * runtimeTargets on exactly this list, so the compiler never stamps a target
 * its own compliance pass would reject) and the runtime-target gate (which
 * must not admit an artifact to a leg on the `wasi` portability baseline while
 * it carries a capability that leg cannot serve).
 */
export const BrowserIncompatibleCapabilityIds = Object.freeze([
  "pipe",
  "network",
  "tcp",
  "udp",
  "mqtt",
  "tls",
  "database",
  "storage_write",
  "protocol_dial",
  "protocol_handle",
  "process_exec",
  "wallet_sign",
  "ipfs",
  "scene_access",
  "entity_access",
  "render_hooks",
]);

/** Which capabilities each runtime leg cannot serve. */
export const LegIncompatibleCapabilityIds = Object.freeze({
  browser: BrowserIncompatibleCapabilityIds,
});
