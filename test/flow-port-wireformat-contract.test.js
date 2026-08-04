// Regression corpus for the PORT WIRE-FORMAT contract.
//
// Five defects, one family, all from 4810b01 ("add isomorphic WASM flow host
// ABI") and its normalize sibling. Together they made every HTTP-served flow
// bundle in space-data-network-modules impossible to recompile from main:
// discovery, public-query, node-status, node-activity and data-retrieval all
// failed `flow check` or `flow compile`, and the failure text accused the
// manifests ("CAQ.fbs/$CAQ does not satisfy CAQ.fbs/$CAQ") rather than the SDK.
//
//   1. normalize defaulted a MISSING wireFormat to "aligned-binary", because it
//      compared against `PayloadWireFormat.AlignedBinary` — a member that does
//      not exist on the generated enum (it is ALIGNED_BINARY), so the guard was
//      `undefined === undefined`. Every canonical port type in every manifest
//      normalized to aligned-binary and vanished from the canonical type sets.
//   2. resolveEdgeTypeContract made the aligned-binary PEER mandatory on a
//      typed edge, so a plain canonical FlatBuffer edge was illegal.
//   3. The trigger binding demanded the same pair, so a $HTQ ingress — a
//      variable-length record with no aligned peer — could never compile.
//   4. Compliance required an integer byteLength on EVERY aligned-binary type,
//      making a variable-length aligned byte stream inexpressible. 149
//      declarations across the shipped fleet use exactly that shape.
//   5. A wildcard port admitted the FLATBUFFER wire format only, so every frame
//      emitted through plugin_push_output_ex(..., ALIGNED_BINARY, ...) — the
//      only SDK API for variable-length bytes — was refused by the guest glue
//      the SDK itself generated.
//
// The rule these tests pin: wireFormat is a DECLARATION (absent means
// canonical FlatBuffer, never aligned-binary); an aligned peer is an
// OPTIMISATION, not a precondition; byteLength declares a FIXED stride and is
// optional; a wildcard is blind to framing as well as to identity.
import test from "node:test";
import assert from "node:assert/strict";

import { __testables } from "../src/flow/flowCompiler.js";
import { normalizeManifestForSdnFlow } from "../src/flow/normalize.js";
import { validatePluginManifest } from "../src/compliance/pluginCompliance.js";
import { payloadTypeRefsMatch } from "../src/manifest/typeRefs.js";

const { resolveEdgeTypeContract } = __testables;

const CANONICAL_HTQ = {
  schemaName: "HttpRequestAbi.fbs",
  fileIdentifier: "$HTQ",
  rootTypeName: "HttpRequest",
};
const CANONICAL_CAQ = {
  schemaName: "CAQ.fbs",
  fileIdentifier: "$CAQ",
  rootTypeName: "CAQ",
};
const ALIGNED_STREAM_OMM = {
  schemaName: "OMM.fbs",
  fileIdentifier: "$OMM",
  rootTypeName: "OMM",
  wireFormat: "aligned-binary",
  requiredAlignment: 8,
};

function manifestWithPortTypes(allowedTypes) {
  return {
    pluginId: "com.digitalarsenal.test.wireformat",
    name: "Wire Format Fixture",
    version: "0.0.1",
    description:
      "Fixture plugin used to pin the port wire-format contract. It declares one method with one output port so the compliance layer sees exactly the type under test.",
    pluginFamily: "foundation",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser", "wasmedge"],
    methods: [
      {
        methodId: "emit",
        displayName: "Emit",
        inputPorts: [],
        outputPorts: [
          {
            portId: "stream",
            acceptedTypeSets: [{ setId: "s", allowedTypes, description: "under test" }],
            minStreams: 1,
            maxStreams: 1,
            required: true,
            description: "the port under test",
          },
        ],
      },
    ],
  };
}

// --- 1. wireFormat is a declaration, never a default-by-accident ------------

test("a type ref that omits wireFormat normalizes to flatbuffer, not aligned-binary", () => {
  const normalized = normalizeManifestForSdnFlow(manifestWithPortTypes([CANONICAL_CAQ]));
  const [type] = normalized.methods[0].outputPorts[0].acceptedTypeSets[0].allowedTypes;
  assert.equal(type.wireFormat, "flatbuffer");
});

test("an explicit aligned-binary declaration survives normalization, in both spellings", () => {
  for (const spelling of ["aligned-binary", "ALIGNED_BINARY", 1]) {
    const normalized = normalizeManifestForSdnFlow(
      manifestWithPortTypes([{ ...ALIGNED_STREAM_OMM, wireFormat: spelling }]),
    );
    const [type] = normalized.methods[0].outputPorts[0].acceptedTypeSets[0].allowedTypes;
    assert.equal(type.wireFormat, "aligned-binary", `spelling ${JSON.stringify(spelling)}`);
  }
});

test("a wildcard normalizes to flatbuffer and is never mistaken for an aligned type", () => {
  const normalized = normalizeManifestForSdnFlow(
    manifestWithPortTypes([{ acceptsAnyFlatbuffer: true }]),
  );
  const [type] = normalized.methods[0].outputPorts[0].acceptedTypeSets[0].allowedTypes;
  assert.equal(type.acceptsAnyFlatbuffer, true);
  assert.equal(type.wireFormat, "flatbuffer");
});

// --- 2. the aligned peer is an optimisation, not a precondition -------------

test("a canonical edge with no aligned peer on either side resolves, canonical-only", () => {
  const contract = resolveEdgeTypeContract([CANONICAL_CAQ], [CANONICAL_CAQ]);
  assert.ok(contract, "an identical canonical type on both ports must resolve");
  assert.equal(contract.errorCode, undefined);
  assert.equal(contract.fileIdentifier, "$CAQ");
  assert.deepEqual(contract.compatibleWireFormats, ["flatbuffer"]);
  assert.equal(contract.aligned, null, "no aligned route is advertised when neither side declares one");
});

test("an aligned peer on ONE side only still resolves canonical-only", () => {
  const withPeer = [CANONICAL_CAQ, { ...CANONICAL_CAQ, wireFormat: "aligned-binary", requiredAlignment: 8 }];
  for (const [from, to] of [[withPeer, [CANONICAL_CAQ]], [[CANONICAL_CAQ], withPeer]]) {
    const contract = resolveEdgeTypeContract(from, to);
    assert.ok(contract && !contract.errorCode);
    assert.deepEqual(contract.compatibleWireFormats, ["flatbuffer"]);
    assert.equal(contract.aligned, null);
  }
});

test("an aligned peer on BOTH sides advertises the aligned route", () => {
  const both = [
    { schemaName: "OMM.fbs", fileIdentifier: "$OMM", rootTypeName: "OMM" },
    ALIGNED_STREAM_OMM,
  ];
  const contract = resolveEdgeTypeContract(both, both);
  assert.ok(contract && !contract.errorCode);
  assert.deepEqual(contract.compatibleWireFormats, ["flatbuffer", "aligned-binary"]);
  assert.equal(contract.aligned.producer.requiredAlignment, 8);
});

test("incompatible aligned layouts are still fatal", () => {
  const at8 = [{ schemaName: "OMM.fbs", fileIdentifier: "$OMM", rootTypeName: "OMM" }, ALIGNED_STREAM_OMM];
  const at1 = [
    { schemaName: "OMM.fbs", fileIdentifier: "$OMM", rootTypeName: "OMM" },
    { ...ALIGNED_STREAM_OMM, requiredAlignment: 1 },
  ];
  const contract = resolveEdgeTypeContract(at8, at1);
  assert.equal(contract.errorCode, "edge-aligned-layout-mismatch");
});

test("a typed producer into an untyped host sink resolves (the flow egress edge)", () => {
  const contract = resolveEdgeTypeContract(
    [{ schemaName: "HttpResponseAbi.fbs", fileIdentifier: "$HTR", rootTypeName: "HttpResponse" }],
    [],
  );
  assert.ok(contract && !contract.errorCode, "$HTR -> egress must not read as a type mismatch");
  assert.equal(contract.fileIdentifier, "$HTR");
});

// --- 3/4. byteLength declares a FIXED stride and is optional ----------------

// The compliance API returns issues without a path here, so these match on the
// diagnostic TEXT — which is the thing an author actually reads.
function errorsMentioning(manifest, needle) {
  const report = validatePluginManifest(manifest);
  return (report.issues ?? []).filter(
    (issue) => issue.severity === "error" && String(issue.message ?? "").includes(needle),
  );
}

test("an aligned-binary type may omit byteLength (a variable-length aligned stream)", () => {
  const issues = errorsMentioning(manifestWithPortTypes([ALIGNED_STREAM_OMM]), "byteLength");
  assert.deepEqual(issues, [], JSON.stringify(issues, null, 2));
});

test("an aligned-binary type that DOES declare byteLength is still range-checked", () => {
  const issues = errorsMentioning(
    manifestWithPortTypes([{ ...ALIGNED_STREAM_OMM, byteLength: 0 }]),
    "byteLength",
  );
  assert.equal(issues.length, 1, "byteLength 0 is not a stride; declaring it must fail");
});

test("requiredAlignment stays MANDATORY on an aligned-binary type", () => {
  const { requiredAlignment, ...noAlignment } = ALIGNED_STREAM_OMM;
  assert.equal(requiredAlignment, 8);
  const issues = errorsMentioning(manifestWithPortTypes([noAlignment]), "requiredAlignment");
  assert.equal(
    issues.length,
    1,
    "alignment is what makes an aligned frame placeable; it is not optional",
  );
});

// --- 5. a wildcard is blind to framing as well as to identity ---------------
//
// This is the JS half. The in-wasm half (WildcardAcceptsWireFormat in
// src/compiler/invokeGlue.js) must answer identically or the SAME artifact
// admits a frame in the browser and refuses it under WasmEdge.

test("a wildcard port admits an aligned-binary frame that declares its alignment", () => {
  assert.equal(
    payloadTypeRefsMatch({ acceptsAnyFlatbuffer: true }, {
      wireFormat: "aligned-binary",
      requiredAlignment: 1,
    }),
    true,
  );
});

test("a wildcard port still admits a canonical FlatBuffer frame", () => {
  assert.equal(
    payloadTypeRefsMatch({ acceptsAnyFlatbuffer: true }, {
      schemaName: "OMM.fbs",
      fileIdentifier: "$OMM",
    }),
    true,
  );
});

test("a wildcard port refuses an aligned-binary frame that declares NO alignment", () => {
  assert.equal(
    payloadTypeRefsMatch({ acceptsAnyFlatbuffer: true }, {
      wireFormat: "aligned-binary",
      requiredAlignment: 0,
    }),
    false,
  );
});

// --- the two guest-side rules, read out of the generated glue ---------------
//
// invokeGlue emits C++, so the pin is on the emitted SOURCE: these are the
// exact predicates whose absence produced "Output frame does not match a
// declared type on port" and "aligned type requiredAlignment must be a
// positive power of two" on every wildcard byte frame.

test("the generated guest glue carries the wildcard framing rule and the wildcard-override guard", async () => {
  const { generateInvokeSupportSource } = await import("../src/compiler/invokeGlue.js");
  const source = generateInvokeSupportSource({
    manifest: manifestWithPortTypes([CANONICAL_HTQ]),
    includeCommandMain: false,
  });
  assert.match(source, /WildcardAcceptsWireFormat/, "the wildcard framing predicate must exist");
  assert.match(
    source,
    /typed_match/,
    "a matched wildcard must not overwrite the frame's declared identity/layout",
  );
  assert.match(
    source,
    /accepted\.byte_length == 0u/,
    "byte_length 0 must be read as a variable-length aligned stream, not as a rejection",
  );
});
