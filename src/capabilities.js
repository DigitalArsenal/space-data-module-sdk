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
]);

/**
 * ENGINE-HOSTED capabilities: the three that reach into a live 3D engine —
 * its scene graph, its entity collection, its render loop.
 *
 * These used to sit in `BrowserIncompatibleCapabilityIds`, which was exactly
 * backwards and produced a compliance paradox: they are also in
 * `RecommendedCapabilityIds`, so a module was simultaneously told to declare
 * them and refused for declaring them alongside the only runtime where they
 * can possibly work. The flow compiler compounded it by unconditionally
 * subtracting `browser` from any composed flow whose capability union touched
 * one — meaning no flow that needs the engine could ever target the runtime
 * the engine lives in.
 *
 * The truth, established by sweep:
 *   - The ONE implementation of `scene_access` in the stack is OrbPro's
 *     `ProviderAccessPort` + the SDK's `providerAccessEngineAdapter`, both of
 *     which require a live Cesium/OrbPro `Scene`. That is a BROWSER object.
 *   - `NodeHostSupportedCapabilities` contains none of the three, and
 *     `assertCapability()` fails them closed with `host-capability-unsupported`.
 *   - `entity_access` and `render_hooks` have no serving implementation on any
 *     runtime yet — only manifest-vocabulary codec entries. They are declared
 *     engine-hosted here because that is where they can ever be served, not
 *     because they are wired today.
 *
 * So they are wasmedge-incompatible, not browser-incompatible. (The `wasi`
 * portability baseline already refuses them via
 * `StandaloneWasiCapabilityIds` — nothing outside that five-member subset is
 * admitted to a standalone WASI artifact.)
 *
 * Ruling: graph/findings/official-harness-shapes.md §8.4
 * Task:   graph/tasks/harness-w0-immediate-fixes.md (W0.4)
 */
export const EngineHostedCapabilityIds = Object.freeze([
  "scene_access",
  "entity_access",
  "render_hooks",
]);

/**
 * Capabilities the headless WasmEdge leg cannot serve. There is no scene, no
 * entity collection and no render loop in a headless server runtime, and no
 * adapter can invent one.
 */
export const WasmEdgeIncompatibleCapabilityIds = Object.freeze([
  ...EngineHostedCapabilityIds,
]);

/**
 * Which capabilities each runtime leg cannot serve.
 *
 * Consumed by `runtimeTargetGate.js` (load-time admission), the flow compiler's
 * `collectFlowRuntimeTargets` (derived runtimeTargets), and
 * `pluginCompliance.js` (publish-time declaration policy) — all three read
 * THIS table, so a leg's policy is stated once.
 */
export const LegIncompatibleCapabilityIds = Object.freeze({
  browser: BrowserIncompatibleCapabilityIds,
  wasmedge: WasmEdgeIncompatibleCapabilityIds,
});
