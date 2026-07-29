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

import { __testables } from "../src/flow/flowCompiler.js";

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
