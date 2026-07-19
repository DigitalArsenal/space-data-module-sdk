// Regression coverage for the guest-link symbol prefix scheme.
//
// LATENT COLLISION BUG (2026-07-19): `guestLinkSymbolPrefix` truncated the
// pluginId hex to 24 chars (12 bytes) via `.slice(0, 24)`. Real plugin ids that
// share a 12-byte stem collided — e.g. `com.orbpro.iss-source` and
// `com.orbpro.intelsat-source` both truncated to hex("com.orbpro.i")
// (`636f6d2e6f726270726f2e69`) — which would silently merge/clash their symbols
// at `wasm-ld -r` compose time. The fix emits the FULL injective hex.
//
// The module node's committed artifacts (modules branch
// `sdn-od-flow-wasi-threads-module`, commits f99af02 + b73b605) already use
// full-hex prefixes for the iss source, and a LEGACY TRUNCATED prefix for the OD
// `fit` symbol. Both must remain compatible: fresh compiles must be collision-
// proof AND consumers must treat the guest-link metadata's `symbolPrefix` /
// `methodSymbols` as authoritative rather than re-deriving from pluginId.

import test from "node:test";
import assert from "node:assert/strict";

import { guestLinkSymbolPrefix } from "../src/compiler/compileModule.js";
import {
  checkFlowProgram,
  generateFlowTables,
} from "../src/flow/flowCompiler.js";
import { normalizeManifestForSdnFlow } from "../src/flow/normalize.js";

function hexOf(text) {
  return Array.from(new TextEncoder().encode(text))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

test("guest-link prefixes are the full injective hex of the pluginId (no truncation)", () => {
  for (const id of [
    "com.orbpro.iss-source",
    "com.orbpro.intelsat-source",
    "orbit-determination",
    "analysis/conjunction-assessment",
  ]) {
    assert.equal(
      guestLinkSymbolPrefix(id),
      `sdm_guest_${hexOf(id)}_`,
      `prefix for "${id}" must be the full hex of its UTF-8 bytes`,
    );
  }
});

test("previously-colliding plugin ids now get distinct prefixes", () => {
  const iss = guestLinkSymbolPrefix("com.orbpro.iss-source");
  const intelsat = guestLinkSymbolPrefix("com.orbpro.intelsat-source");

  // Both ids share the 12-byte stem "com.orbpro.i", which the old [:24] hex
  // truncation collapsed to the same prefix stem. Guard against regression to
  // that shared stem explicitly, then assert full distinctness.
  const collidedStem = `sdm_guest_${hexOf("com.orbpro.i")}_`;
  assert.equal(collidedStem, "sdm_guest_636f6d2e6f726270726f2e69_");
  assert.notEqual(iss, collidedStem);
  assert.notEqual(intelsat, collidedStem);
  assert.notEqual(iss, intelsat);
});

test("fresh prefixes match the committed modules-branch artifacts byte-for-byte", () => {
  // The module node worked around the truncation collision by committing FULL-hex
  // prefixes for its five data-source modules (modules branch
  // `sdn-od-flow-wasi-threads-module`, commits f99af02 + b73b605). The fixed SDK
  // must reproduce every one of them exactly, so a rebuild is a no-op for symbols.
  const committedEmitSymbols = {
    "com.orbpro.cpf-source":
      "sdm_guest_636f6d2e6f726270726f2e6370662d736f75726365_emit",
    "com.orbpro.glonass-source":
      "sdm_guest_636f6d2e6f726270726f2e676c6f6e6173732d736f75726365_emit",
    "com.orbpro.intelsat-source":
      "sdm_guest_636f6d2e6f726270726f2e696e74656c7361742d736f75726365_emit",
    "com.orbpro.iss-source":
      "sdm_guest_636f6d2e6f726270726f2e6973732d736f75726365_emit",
    "com.orbpro.spacex-starlink-source":
      "sdm_guest_636f6d2e6f726270726f2e7370616365782d737461726c696e6b2d736f75726365_emit",
  };
  for (const [pluginId, emitSymbol] of Object.entries(committedEmitSymbols)) {
    assert.equal(`${guestLinkSymbolPrefix(pluginId)}emit`, emitSymbol);
  }
});

test("hex encoding is injective — no two distinct ids can share a prefix", () => {
  const ids = [
    "a",
    "ab",
    "com.orbpro.iss-source",
    "com.orbpro.intelsat-source",
    "com.orbpro.iss",
    "orbit-determination",
    "orbit-determ",
    "orbit-determinationX",
  ];
  const seen = new Map();
  for (const id of ids) {
    const prefix = guestLinkSymbolPrefix(id);
    assert.ok(
      !seen.has(prefix),
      `prefix collision between "${seen.get(prefix)}" and "${id}"`,
    );
    seen.set(prefix, id);
  }
});

// --- Metadata authoritativeness -------------------------------------------
//
// The OD `fit` symbol committed to the modules branch uses a LEGACY TRUNCATED
// prefix `sdm_guest_6f726269742d64657465726d_` (hex("orbit-determ")), which is
// the [:24] truncation of pluginId "orbit-determination". The fixed SDK derives
// the FULL-hex prefix for that id, so the two now differ. This must NOT break
// composition of the committed artifact: consumers read the method symbol from
// the guest-link METADATA, never re-deriving it from pluginId.

const OD_PLUGIN_ID = "orbit-determination";
const COMMITTED_OD_FIT_SYMBOL = "sdm_guest_6f726269742d64657465726d_fit";

function wildcardTypeSet(setId) {
  return { setId, allowedTypes: [{ acceptsAnyFlatbuffer: true }] };
}

function port(portId, required = true) {
  return {
    portId,
    required,
    minStreams: required ? 1 : 0,
    maxStreams: 1,
    acceptedTypeSets: [wildcardTypeSet(`${portId}-any`)],
  };
}

function makeOdFitDependency({ symbolPrefix, methodSymbols }) {
  const manifest = {
    pluginId: OD_PLUGIN_ID,
    name: OD_PLUGIN_ID,
    version: "1.0.0",
    pluginFamily: "foundation",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["wasmedge"],
    methods: [
      {
        methodId: "fit",
        displayName: "Fit",
        inputPorts: [port("in")],
        outputPorts: [port("out")],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    schemasUsed: [],
    abiVersion: 1,
  };
  return {
    pluginId: OD_PLUGIN_ID,
    manifest,
    normalized: normalizeManifestForSdnFlow(manifest),
    guestLink: {
      objectBytes: new Uint8Array([0]),
      metadata: { symbolPrefix, methodSymbols },
    },
    wasmPath: "/nonexistent/module.wasm",
  };
}

function makeOdFlow() {
  return {
    programId: "test.od-flow",
    name: "OD",
    version: "0.1.0",
    nodes: [
      { nodeId: "fit", pluginId: OD_PLUGIN_ID, methodId: "fit", kind: "transform" },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [{ fromNodeId: "fit", fromPortId: "out", toNodeId: "sink", toPortId: "result" }],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [{ triggerId: "manual", targetNodeId: "fit", targetPortId: "in" }],
    requiredPlugins: [OD_PLUGIN_ID],
  };
}

test("compose reads the method symbol from guest-link METADATA (authoritative), not re-derived from pluginId", () => {
  const dependency = makeOdFitDependency({
    symbolPrefix: "sdm_guest_6f726269742d64657465726d_",
    methodSymbols: { fit: COMMITTED_OD_FIT_SYMBOL },
  });
  const flow = makeOdFlow();
  const dependencies = new Map([[OD_PLUGIN_ID, dependency]]);

  const check = checkFlowProgram({ flow, dependencies });
  assert.equal(check.ok, true, JSON.stringify(check.issues ?? check.errors ?? ""));

  const { source } = generateFlowTables({ flow, check, dependencies });

  // The generated flow-runtime C++ must declare/call the committed metadata
  // symbol, proving the committed (legacy-truncated) OD artifact still composes.
  assert.ok(
    source.includes(COMMITTED_OD_FIT_SYMBOL),
    "compose must use the metadata's method symbol",
  );

  // It must NOT re-derive the full-hex symbol from the pluginId. If it did, the
  // committed truncated-prefix object would fail to link (symbol not found).
  const rederived = `${guestLinkSymbolPrefix(OD_PLUGIN_ID)}fit`;
  assert.notEqual(rederived, COMMITTED_OD_FIT_SYMBOL);
  assert.ok(
    !source.includes(rederived),
    "compose must not re-derive the symbol prefix from pluginId",
  );
});

test("compose honors an arbitrary metadata symbol prefix unrelated to the pluginId", () => {
  // A prefix that could never be produced by hex-deriving the pluginId proves
  // the metadata is the sole source of truth for symbol names.
  const arbitrarySymbol = "sdm_guest_deadbeefcafe_fit";
  const dependency = makeOdFitDependency({
    symbolPrefix: "sdm_guest_deadbeefcafe_",
    methodSymbols: { fit: arbitrarySymbol },
  });
  const flow = makeOdFlow();
  const dependencies = new Map([[OD_PLUGIN_ID, dependency]]);

  const check = checkFlowProgram({ flow, dependencies });
  assert.equal(check.ok, true, JSON.stringify(check.issues ?? check.errors ?? ""));

  const { source } = generateFlowTables({ flow, check, dependencies });
  assert.ok(
    source.includes(arbitrarySymbol),
    "compose must use whatever symbol the metadata declares",
  );
});
