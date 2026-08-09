/**
 * THE RUNTIME-TARGET GATE — one assert, called by every loader that stands for
 * a runtime leg.
 *
 * Composed flows derive their `runtimeTargets` from their parts (see
 * `collectFlowRuntimeTargets` in `src/flow/flowCompiler.js`), so an artifact
 * that legitimately runs on only ONE leg now exists. That artifact must never
 * be loaded QUIETLY on a leg it does not declare: the failure would surface as
 * a hostcall trap several frames deep in a capability that leg cannot serve,
 * which is indistinguishable from the cross-runtime divergence the isomorphism
 * invariant exists to catch. Refuse at the door, by name, quoting the
 * declaration that made it ineligible.
 *
 * The gate lives here rather than inside one harness because there are two
 * doors into a composed artifact — `createBrowserModuleHarness` (a single
 * module) and `createFlowRuntimeHost` (the composed flow runtime) — and a gate
 * on only one of them is not a gate.
 *
 * Browser-safe: no node builtins, no bundle/signing surface, and the embedded
 * declaration is read with `WebAssembly.Module.customSections`, which needs no
 * copy of the source bytes (they are scrubbed by the time this runs).
 */

import { SDS_MANIFEST_SECTION_NAME } from "../bundle/constants.js";
import { decodePlgManifest, isPlgManifestBuffer } from "../manifest/plgCodec.js";
import { LegIncompatibleCapabilityIds } from "../capabilities.js";

/**
 * `wasi` is the STRICT PORTABILITY BASELINE, not a fourth runtime: compliance
 * confines a `wasi`-declaring artifact to the pure WASI capability subset and
 * the `command` invoke surface. So a declaration of `wasi` admits either leg —
 * WITH ONE EXCEPTION, which is why capabilities are part of this question.
 * `pipe` is in both the standalone-WASI subset and the browser-incompatible
 * set, so `runtimeTargets:["wasi"] + capabilities:["pipe"]` passes compliance
 * (it names no browser target for the rule to fire on) and would otherwise be
 * admitted to the browser leg against the SDK's own policy. The baseline
 * admits a leg only when the artifact carries nothing that leg cannot serve.
 *
 * DO NOT "UNIFY" THIS WITH THE LITERAL PATH. A declaration that names the leg
 * outright is NOT capability-checked here, and that asymmetry is deliberate:
 *
 *   declaration -> trust the author;  inference -> prove it.
 *
 * An explicit `browser` target is the author's statement and the embedder's
 * business — five of the browser-incompatible capabilities (`network`, `ipfs`,
 * `protocol_dial`, `protocol_handle`, `wallet_sign`) ARE served by
 * `BrowserHost` when the embedder injects an adapter, so refusing them at load
 * time would break legitimate embedders. Publish-time compliance already
 * refuses the incoherent declaration. The `wasi` path, by contrast, is an
 * inference the SDK makes on the author's behalf, and an inference must be
 * conservative.
 */
const LEG_SATISFYING_TARGETS = Object.freeze({
  browser: Object.freeze(["browser", "wasi"]),
  wasmedge: Object.freeze(["wasmedge", "wasi"]),
});

const WASI_PORTABILITY_TARGET = "wasi";

function legIncompatibleCapabilities(capabilities, leg) {
  const incompatible = LegIncompatibleCapabilityIds[leg];
  if (!incompatible || !Array.isArray(capabilities)) return [];
  return capabilities
    .map((capability) =>
      typeof capability === "string"
        ? capability
        : (capability?.capabilityId ?? capability?.name ?? ""),
    )
    .filter((capability) => incompatible.includes(capability))
    .sort();
}

/**
 * Does a declared target set admit this leg?
 *
 * ONE RULE, used by the loaders AND by the flow compiler's derivation. Two
 * rules for one field is how a manifest comes to mean different things to the
 * compiler and to the door: the compiler stripped the browser leg from a
 * `["wasi","wasmedge"]` part while the gate happily admitted the same
 * declaration to the browser.
 *
 * An empty/absent declaration admits everything, matching compliance, which
 * skips the runtime-target rule on an absent field.
 *
 * @param {string[]|undefined} targets declared runtimeTargets
 * @param {string} leg the runtime target being asked about
 * @param {Array<string|{capabilityId?: string, name?: string}>} [capabilities]
 *   the artifact's declared capabilities; consulted only to keep the `wasi`
 *   baseline from admitting a leg that cannot serve them
 */
export function runtimeTargetSatisfies(targets, leg, capabilities) {
  if (!Array.isArray(targets) || targets.length === 0) return true;
  const accepted = LEG_SATISFYING_TARGETS[leg] ?? [leg];
  if (targets.includes(leg)) return true;
  if (!targets.some((target) => accepted.includes(target))) return false;
  // Admitted only via the portability baseline — prove it, do not assume it.
  return (
    targets.includes(WASI_PORTABILITY_TARGET) &&
    legIncompatibleCapabilities(capabilities, leg).length === 0
  );
}

export class RuntimeTargetError extends Error {
  constructor(message, { declaredTargets, source, leg }) {
    super(message);
    this.name = "RuntimeTargetError";
    this.code = "runtime-target-out-of-scope";
    this.declaredTargets = declaredTargets;
    this.leg = leg;
    // "embedded" (the artifact's own signed record) or "caller" (the manifest
    // the loader was handed). Which one refused is evidence, not trivia.
    this.declarationSource = source;
  }
}

export function normalizedRuntimeTargets(manifest) {
  return Array.isArray(manifest?.runtimeTargets)
    ? manifest.runtimeTargets
        .map((target) => String(target ?? "").trim().toLowerCase())
        .filter(Boolean)
    : [];
}

/**
 * The artifact's OWN declaration, read straight out of the embedded `$PLG`
 * custom section, so a caller that hands a loader nothing but bytes still gets
 * the refusal.
 *
 * @param {WebAssembly.Module} wasmModule
 * @returns {string[]} declared targets, or [] when the artifact declares none
 */
export function embeddedPlgManifest(wasmModule) {
  let sections;
  try {
    sections = WebAssembly.Module.customSections(
      wasmModule,
      SDS_MANIFEST_SECTION_NAME,
    );
  } catch {
    return null;
  }
  for (const section of sections ?? []) {
    try {
      const bytes = new Uint8Array(section);
      if (!isPlgManifestBuffer(bytes)) continue;
      // FIRST DECODABLE MANIFEST WINS — the same rule the node-side locator
      // (`locateEmbeddedPlgManifest`) applies. Skipping a manifest merely
      // because its runtimeTargets are empty made this reader disagree with
      // that one on the very same bytes, so an artifact could be scoped by one
      // declaration and enforced against another.
      return decodePlgManifest(bytes);
    } catch {
      // An UNDECODABLE section is not a declaration. Keep looking.
    }
  }
  return null;
}

export function embeddedRuntimeTargets(wasmModule) {
  return normalizedRuntimeTargets(embeddedPlgManifest(wasmModule));
}

/**
 * Resolve which declaration refuses this leg, if either does.
 *
 * EITHER source can refuse, and the EMBEDDED one wins on conflict. The
 * embedded `$PLG` is what the artifact's signature covers; `manifest` is
 * caller input. Trusting the caller first would make
 * `{manifest: {runtimeTargets: ["browser"]}}` a bypass for a signed
 * WasmEdge-only artifact — and the isomorphic flow host passes exactly such a
 * caller-side manifest for every child it mounts.
 *
 * An artifact that declares NOTHING is unconstrained, matching compliance,
 * which skips the runtime-target rule on an absent field.
 *
 * @returns {{targets: string[], source: "embedded"|"caller"}|null}
 */
export function resolveRuntimeTargetRefusal({
  wasmModule,
  manifest,
  leg,
  embeddedManifest: providedEmbeddedManifest,
}) {
  // A caller that already located the artifact's own manifest from BYTES (the
  // node leg does, via `locateEmbeddedPlgManifest`) passes it here rather than
  // making this gate compile the module just to read a custom section. The two
  // locators apply the same first-decodable-wins rule; the byte-side one can
  // additionally reach a manifest carried in a bundle entry or a data segment,
  // which only ever makes that leg MORE likely to refuse — the safe direction.
  const embeddedManifest =
    providedEmbeddedManifest ??
    (wasmModule ? embeddedPlgManifest(wasmModule) : null);
  const embedded = normalizedRuntimeTargets(embeddedManifest);
  if (!runtimeTargetSatisfies(embedded, leg, embeddedManifest?.capabilities)) {
    return { targets: embedded, source: "embedded" };
  }
  const caller = normalizedRuntimeTargets(manifest);
  if (!runtimeTargetSatisfies(caller, leg, manifest?.capabilities)) {
    return { targets: caller, source: "caller" };
  }
  return null;
}

/**
 * @param {object} options
 * @param {WebAssembly.Module} [options.wasmModule] compiled artifact
 * @param {object} [options.manifest] caller-supplied manifest
 * @param {string} options.leg the runtime target this loader stands for
 * @param {string} [options.what] noun used in the message ("module" by default)
 */
export function assertArtifactRuntimeTarget({
  wasmModule,
  manifest,
  embeddedManifest,
  leg,
  what = "module",
}) {
  const refusal = resolveRuntimeTargetRefusal({
    wasmModule,
    manifest,
    embeddedManifest,
    leg,
  });
  if (!refusal) return;
  const { targets, source } = refusal;
  throw new RuntimeTargetError(
    `Refusing to load a ${what} that does not target "${leg}": its ` +
      `${source === "embedded" ? "embedded manifest" : "supplied manifest"} declares ` +
      `runtimeTargets [${targets.join(", ")}], which does not admit this leg. Loading it ` +
      `here would trap on the first capability the "${leg}" host cannot serve. Run it on ` +
      "a host that provides one of its declared targets, or split the out-of-scope " +
      "surface into its own module.",
    { declaredTargets: targets, source, leg },
  );
}

/**
 * Is this JavaScript running in a browser (window or a Worker)? Used only to
 * DEFAULT the leg for loaders that are genuinely runtime-agnostic; every
 * caller may state its leg explicitly and that always wins.
 */
export function detectBrowserLeg() {
  try {
    if (typeof window !== "undefined" && typeof window.document !== "undefined") {
      return true;
    }
    const workerScope = globalThis.WorkerGlobalScope;
    return (
      typeof workerScope === "function" &&
      typeof self !== "undefined" &&
      self instanceof workerScope
    );
  } catch {
    return false;
  }
}
