// Regression corpus for the wildcard-port edge contract.
//
// 4810b01 ("add isomorphic WASM flow host ABI") introduced edge type checking
// that filtered `acceptsAnyFlatbuffer` out of the concrete type sets but never
// handled a port whose ONLY declaration is a wildcard. Such a port has a
// non-empty types array and zero concrete entries, so it fell past both the
// `length === 0` host-boundary cases and the concrete matching loop, producing
// the self-contradictory "* does not satisfy *".
//
// That made the shipped, live-deployed celestrak ingest family unbuildable
// (18 edge-type-mismatch errors on `flow check`). 65 manifests across every
// module family declare a wildcard, and for generic host-capability nodes
// (http-request, storage-ingest, clock, random, file) plus the compiler's OWN
// synthesized egress ports it is the CORRECT declaration — so the fix belongs
// here, not in the manifests.
import test from "node:test";
import assert from "node:assert/strict";

import {
  __testables,
  checkFlowProgram,
  generateFlowTables,
} from "../src/flow/flowCompiler.js";
import { normalizeManifestForSdnFlow } from "../src/flow/normalize.js";

const { resolveEdgeTypeContract } = __testables;

const WILDCARD = [{ acceptsAnyFlatbuffer: true }];
const OMM = [
  { schemaName: "OMM.fbs", fileIdentifier: "$OMM", rootTypeName: "OMM" },
  {
    schemaName: "OMM.fbs", fileIdentifier: "$OMM", rootTypeName: "OMM",
    wireFormat: "aligned-binary", requiredAlignment: 8, byteLength: 64,
  },
];
const CAT = [
  { schemaName: "CAT.fbs", fileIdentifier: "$CAT", rootTypeName: "CAT" },
  {
    schemaName: "CAT.fbs", fileIdentifier: "$CAT", rootTypeName: "CAT",
    wireFormat: "aligned-binary", requiredAlignment: 8, byteLength: 64,
  },
];

test("generic -> generic is a legitimate untyped byte edge", () => {
  const contract = resolveEdgeTypeContract(WILDCARD, WILDCARD);
  assert.ok(contract, "wildcard -> wildcard must resolve, not read as '* does not satisfy *'");
  assert.equal(contract.errorCode, undefined);
  assert.equal(contract.wildcard, true);
  // No identity is invented for an edge that genuinely has none.
  assert.equal(contract.schemaName, null);
  assert.equal(contract.fileIdentifier, null);
});

test("generic meeting the untyped host egress sink resolves", () => {
  // The flow egress sink declares NO types at all — neither concrete nor
  // wildcard — so it is not covered by the wildcard-to-wildcard case.
  for (const [from, to] of [[WILDCARD, []], [[], WILDCARD]]) {
    const contract = resolveEdgeTypeContract(from, to);
    assert.ok(contract, "wildcard <-> untyped host boundary must resolve");
    assert.equal(contract.errorCode, undefined);
    assert.equal(contract.wildcard, true);
  }
});

test("a generic side adopts the typed side's identity", () => {
  const intoTyped = resolveEdgeTypeContract(WILDCARD, OMM);
  assert.equal(intoTyped.fileIdentifier, "$OMM");
  assert.equal(intoTyped.canonical.producer, null);
  assert.equal(intoTyped.canonical.consumer.fileIdentifier, "$OMM");

  const fromTyped = resolveEdgeTypeContract(OMM, WILDCARD);
  assert.equal(fromTyped.fileIdentifier, "$OMM");
  assert.equal(fromTyped.canonical.consumer, null);
  assert.equal(fromTyped.canonical.producer.fileIdentifier, "$OMM");
});

test("TYPED edges stay strict — the fix widens nothing", () => {
  // The whole point: two concrete, mismatched identities must still fail.
  const mismatch = resolveEdgeTypeContract(OMM, CAT);
  assert.ok(
    !mismatch || mismatch.errorCode,
    "OMM -> CAT must NOT resolve; wildcard handling must not become a bypass",
  );

  const matched = resolveEdgeTypeContract(OMM, OMM);
  assert.ok(matched && !matched.errorCode, "OMM -> OMM must still resolve");
  assert.equal(matched.fileIdentifier, "$OMM");
  assert.notEqual(matched.wildcard, true);
});

test("a port mixing a wildcard WITH a concrete identity takes the strict path", () => {
  // Otherwise a wildcard would be an escape hatch for dodging type checking.
  const mixed = [...OMM, { acceptsAnyFlatbuffer: true }];
  const contract = resolveEdgeTypeContract(mixed, CAT);
  assert.ok(
    !contract || contract.errorCode,
    "a mixed wildcard+concrete producer must not silently satisfy a different concrete consumer",
  );
});

// --- Trigger bindings: the SAME regression, one surface further in ----------
//
// `flow check` passed while `flow compile` still threw "Validated trigger
// binding 0 (...) must resolve to exactly one paired canonical and aligned-binary
// SDS type." for the celestrak family: a timer TICK carries no payload, so every
// timer-driven node's target port is wildcard-only and yielded zero concrete
// types on both wire formats. An untyped trigger frame is emitted as untyped
// rather than being refused or given an invented identity.

const PLUGIN_ID = "com.test.wildcard-trigger";

function typedTypeSet(setId) {
  const identity = {
    schemaName: "OMM.fbs",
    fileIdentifier: "$OMM",
    schemaVersion: "1.0.0",
    rootTypeName: "OMM",
  };
  return {
    setId,
    allowedTypes: [
      { ...identity, wireFormat: "flatbuffer" },
      { ...identity, wireFormat: "aligned-binary", byteLength: 64, requiredAlignment: 8 },
    ],
  };
}

function wildcardTypeSet(setId) {
  return {
    setId,
    allowedTypes: [{ wireFormat: "flatbuffer", acceptsAnyFlatbuffer: true }],
  };
}

function triggerFixture({ tickTyped }) {
  const manifest = {
    pluginId: PLUGIN_ID,
    name: PLUGIN_ID,
    version: "1.0.0",
    pluginFamily: "data_source",
    // Host-boundary-blind, so the wildcard tick port is PERMITTED by the
    // compliance boundary (see test/wildcard-port-boundary.test.js) and the
    // compiler is the only thing under test here.
    capabilities: ["http"],
    externalInterfaces: [
      {
        interfaceId: "host-http",
        kind: "host-service",
        direction: "bidirectional",
        capability: "http",
        resource: "https://*",
      },
    ],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["wasmedge"],
    methods: [
      {
        methodId: "emit",
        displayName: "Emit",
        inputPorts: [
          {
            portId: "tick",
            required: true,
            minStreams: 1,
            maxStreams: 1,
            acceptedTypeSets: [
              tickTyped ? typedTypeSet("tick-omm") : wildcardTypeSet("tick-any"),
            ],
          },
        ],
        outputPorts: [
          {
            portId: "out",
            required: false,
            minStreams: 0,
            maxStreams: 1,
            acceptedTypeSets: [typedTypeSet("out-omm")],
          },
        ],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    schemasUsed: [],
    abiVersion: 1,
  };
  const dependencies = new Map([
    [
      PLUGIN_ID,
      {
        pluginId: PLUGIN_ID,
        manifest,
        normalized: normalizeManifestForSdnFlow(manifest),
        guestLink: {
          objectBytes: new Uint8Array([0]),
          metadata: {
            symbolPrefix: "sdm_guest_test_",
            methodSymbols: { emit: "sdm_guest_test_emit" },
          },
        },
        wasmPath: "/nonexistent/module.wasm",
      },
    ],
  ]);
  const flow = {
    programId: "test.trigger-flow",
    name: "Trigger",
    version: "0.1.0",
    nodes: [
      { nodeId: "src", pluginId: PLUGIN_ID, methodId: "emit", kind: "source" },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [
      { fromNodeId: "src", fromPortId: "out", toNodeId: "sink", toPortId: "result" },
    ],
    triggers: [{ triggerId: "tick", kind: "timer", defaultIntervalMs: 1000 }],
    triggerBindings: [
      { triggerId: "tick", targetNodeId: "src", targetPortId: "tick" },
    ],
    requiredPlugins: [PLUGIN_ID],
  };
  return { flow, dependencies };
}

test("a trigger bound to a wildcard-only port compiles as an untyped frame", () => {
  const { flow, dependencies } = triggerFixture({ tickTyped: false });
  const check = checkFlowProgram({ flow, dependencies });
  assert.equal(check.ok, true, JSON.stringify(check.issues ?? ""));

  const { source } = generateFlowTables({ flow, check, dependencies });

  // The trigger edge is the last entry of g_edges. It must carry no invented
  // identity and must NOT be advertised as aligned-shared-arena eligible.
  const triggerEdgeLine = source
    .split("\n")
    .find((line) => line.includes('"@trigger:tick:0"'));
  assert.ok(triggerEdgeLine, "trigger sentinel edge must be emitted");
  assert.ok(
    triggerEdgeLine.includes("nullptr, nullptr, nullptr, nullptr, 0u, nullptr"),
    `untyped trigger must emit null identity fields: ${triggerEdgeLine}`,
  );
  assert.ok(
    /nullptr,\s*1u,\s*0u,\s*0u,\s*0u,\s*0u,\s*0u\s*\}/.test(triggerEdgeLine),
    `untyped trigger must not claim an aligned layout: ${triggerEdgeLine}`,
  );
});

test("a trigger bound to a TYPED port still binds that exact identity", () => {
  const { flow, dependencies } = triggerFixture({ tickTyped: true });
  const check = checkFlowProgram({ flow, dependencies });
  assert.equal(check.ok, true, JSON.stringify(check.issues ?? ""));

  const { source } = generateFlowTables({ flow, check, dependencies });
  const triggerEdgeLine = source
    .split("\n")
    .find((line) => line.includes('"@trigger:tick:0"'));
  assert.ok(triggerEdgeLine.includes('"OMM.fbs"'), triggerEdgeLine);
  assert.ok(triggerEdgeLine.includes('"$OMM"'), triggerEdgeLine);
  assert.ok(
    triggerEdgeLine.includes("1u, 1u,"),
    `a typed trigger must stay aligned-eligible: ${triggerEdgeLine}`,
  );
});

// --- OPAQUE: the $PLG 1.0.13 / SDS v1.164.0 narrowing --------------------
//
// Themis rejected BOTH `required` markings. `PLGFlowEdge.CONTRACT` and
// `PLGFlowEdgeContract.CANONICAL_TYPE` ship OPTIONAL — marking them required
// would have broken every pre-1.0.13 buffer — so presence is enforced by the
// SIGNING COMPILER refusing to sign, and by verifiers rejecting signed edges
// without one. A contract carries EXACTLY ONE of CANONICAL_TYPE or
// OPAQUE = true, and an opaque edge is never aligned-eligible. Opaque-by-design
// is an explicit flag, never an absent field: "carries bytes by design" must
// stay distinguishable from "somebody forgot the type".

const { signedFlowEdgeContract } = __testables;

test("an untyped edge is signed as OPAQUE, never as an absent type", () => {
  const signed = signedFlowEdgeContract(
    resolveEdgeTypeContract(WILDCARD, WILDCARD),
    "linked-direct",
    "linked-direct",
  );
  assert.equal(signed.opaque, true);
  assert.equal(signed.canonicalType, null);
  assert.equal(signed.alignedType, null);
  // ALIGNED_ELIGIBLE MUST be false when OPAQUE — there is no layout to prove
  // bounds, alignment, ownership or lifetime against. Both nodes here are
  // linked-direct, so this is the case that would otherwise qualify.
  assert.equal(signed.alignedEligible, false);
  assert.equal(signed.routePolicy, "canonical-only");
});

test("the signing compiler refuses an edge with neither a type nor OPAQUE", () => {
  assert.throws(
    () =>
      signedFlowEdgeContract(
        { canonical: { producer: null, consumer: null }, compatibleWireFormats: ["flatbuffer"] },
        "linked-direct",
        "linked-direct",
      ),
    /missing CANONICAL_TYPE and is not marked OPAQUE/,
  );
});

test("the signing compiler refuses BOTH a type and OPAQUE", () => {
  assert.throws(
    () =>
      signedFlowEdgeContract(
        {
          canonical: { producer: OMM[0], consumer: OMM[0] },
          compatibleWireFormats: ["flatbuffer"],
          opaque: true,
        },
        "linked-direct",
        "linked-direct",
      ),
    /exactly one/,
  );
});

test("the signing compiler refuses a contract-less edge outright", () => {
  assert.throws(
    () => signedFlowEdgeContract(null, "linked-direct", "linked-direct"),
    /Refusing to sign a flow edge with no type contract/,
  );
});

test("a TYPED edge is never marked opaque and keeps its aligned route", () => {
  const signed = signedFlowEdgeContract(
    resolveEdgeTypeContract(OMM, OMM),
    "linked-direct",
    "linked-direct",
  );
  assert.equal(signed.opaque, false);
  assert.equal(signed.canonicalType.fileIdentifier, "$OMM");
  assert.equal(signed.alignedEligible, true);
  assert.equal(signed.routePolicy, "aligned-shared-arena-or-canonical");
});

test("an author's opacity marking must agree with the resolved port types", () => {
  // Marking is an assertion the compiler CHECKS, never an override: you may not
  // sign away an identity you have, nor claim one you cannot name.
  const { flow, dependencies } = triggerFixture({ tickTyped: true });
  flow.edges[0].opaque = true; // src.out -> sink.result resolves to $OMM
  const lying = checkFlowProgram({ flow, dependencies });
  assert.equal(lying.ok, false);
  assert.ok(lying.issues.some((issue) => issue.code === "edge-opacity-mismatch"));

  const honest = triggerFixture({ tickTyped: true });
  honest.flow.edges[0].opaque = false;
  const check = checkFlowProgram({
    flow: honest.flow,
    dependencies: honest.dependencies,
  });
  assert.equal(check.ok, true, JSON.stringify(check.issues ?? ""));
});
