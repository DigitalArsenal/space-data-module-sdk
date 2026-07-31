#!/usr/bin/env node
// Stage 3 of the shared statement-domain vector generation: the BUNDLE-SCOPE
// and SCOPE-AMBIGUITY vectors (graph task
// sdn-modulert-bundle-scope-twin-divergence, Janus 2026-07-30).
//
// WHY THESE ARE MINTED HERE AND NOT IN GO. Stages 1-2 are Go-authoritative
// because the module-scope preimage is `domain || 0x00 || sha256(portable)` —
// a thing Go can build unaided. A BUNDLE-scope preimage is not: it is a
// canonical JSON statement over the MBL that only the SDK writer defines, so a
// Go-minted bundle vector would be a Go opinion about an SDK format. The
// authority therefore inverts for these vectors and only for these: the SDK
// signs, and both Go verifiers are asserted against the bytes it produced.
//
// A bundle-scope artifact also cannot be re-wrapped in the minimal Go-built
// trailer the other vectors use (that trailer carries no canonicalization rule
// and no canonical module hash, so bundle decoding fails before any signature
// is looked at). Those vectors carry sdkEnvelopeOnly: true and the Go suite
// checks them through sdkArtifactHex alone.
//
//   node test/support/statement-domain-vectors-bundle.mjs <in.json> <out.json>
//
// Output goes, byte-identical, to all three copies; pin the new sha256 in all
// three suites in the SAME commit.

import { readFile, writeFile } from "node:fs/promises";

import { signModuleArtifact } from "../../src/bundle/signing.js";
import { createSingleFileBundle } from "../../src/bundle/wasm.js";

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error(
    "usage: node test/support/statement-domain-vectors-bundle.mjs <in.json> <out.json>",
  );
  process.exit(2);
}

const vectors = JSON.parse(await readFile(inPath, "utf8"));
const portable = hexToBytes(vectors.portableHex);
const seedHex = vectors.signerSeedHex;
const signerHex = vectors.signerPublicKeyHex;

// ---- bundle scope, signed by the pinned vector key ------------------------
const bundleSigned = await signModuleArtifact(portable, {
  privateKeySeedHex: seedHex,
  keyId: "janus-vector-key",
  signatureScope: "bundle",
});
const bundleEntry = { ...bundleSigned.signature };
const bundleArtifactHex = bytesToHex(new Uint8Array(bundleSigned.wasmBytes));

// ---- the same bundle, with the recorded digest corrupted ------------------
const tamperedEntry = {
  ...bundleEntry,
  signedHashHex: `${"0".repeat(63)}1`,
};
const tampered = await createSingleFileBundle({
  wasmBytes: portable,
  signature: tamperedEntry,
});

// ---- an artifact that declares BOTH bases ---------------------------------
const domainVector = vectors.artifacts.find(
  (vector) => vector.name === "domain-signed-ok",
);
if (!domainVector) {
  throw new Error("expected the domain-signed-ok vector to exist");
}
const ambiguousEntry = {
  ...domainVector.signatureEntry,
  signedHashAlgorithm: "sha256-sdn-module-bundle-v1",
};
const ambiguous = await createSingleFileBundle({
  wasmBytes: portable,
  signature: ambiguousEntry,
});

// ---- a case-variant key: Go used to admit it, JS never saw it -------------
const caseVariantEntry = { ...domainVector.signatureEntry };
delete caseVariantEntry.statementDomain;
caseVariantEntry.StatementDomain = domainVector.signatureEntry.statementDomain;
const caseVariant = await createSingleFileBundle({
  wasmBytes: portable,
  signature: caseVariantEntry,
});

const added = [
  {
    name: "bundle-scope-signed-ok",
    why: "bundle scope: the signature covers the canonical whole-bundle statement, NOT sha256(portable) — sdn-server compared it against sha256(portable) unconditionally and reported hash_mismatch for an artifact the SDK and kubo both verified",
    portableHex: vectors.portableHex,
    sdkEnvelopeOnly: true,
    signatureEntry: bundleEntry,
    trustedPublicKeysHex: [signerHex],
    expect: {
      verified: true,
      reason: "ok",
      statementDomain: "",
      contentHashHex: vectors.artifacts[0].expect.contentHashHex,
      signatureScope: "bundle",
      signedHashHex: bundleEntry.signedHashHex,
      flowNodeAdmissible: true,
    },
    sdkArtifactHex: bundleArtifactHex,
  },
  {
    name: "bundle-scope-untrusted-signer",
    why: "same bundle artifact, empty trust set: every implementation must refuse for the SIGNER, not for the hash basis",
    portableHex: vectors.portableHex,
    sdkEnvelopeOnly: true,
    signatureEntry: bundleEntry,
    trustedPublicKeysHex: [],
    expect: {
      verified: false,
      reason: "untrusted_signer",
      statementDomain: "",
      contentHashHex: vectors.artifacts[0].expect.contentHashHex,
      signatureScope: "bundle",
      signedHashHex: "",
      flowNodeAdmissible: false,
    },
    sdkArtifactHex: bytesToHex(new Uint8Array(bundleSigned.wasmBytes)),
  },
  {
    name: "bundle-scope-recorded-digest-tampered",
    why: "the recorded signedHashHex no longer matches the recomputed bundle statement digest: hash_mismatch, and it must be reported against the BUNDLE digest rather than against sha256(portable)",
    portableHex: vectors.portableHex,
    sdkEnvelopeOnly: true,
    signatureEntry: tamperedEntry,
    trustedPublicKeysHex: [signerHex],
    expect: {
      verified: false,
      reason: "hash_mismatch",
      statementDomain: "",
      contentHashHex: vectors.artifacts[0].expect.contentHashHex,
      signatureScope: "bundle",
      signedHashHex: bundleEntry.signedHashHex,
      flowNodeAdmissible: false,
    },
    sdkArtifactHex: bytesToHex(new Uint8Array(tampered.wasmBytes)),
  },
  {
    name: "domain-and-bundle-algorithm-is-ambiguous",
    why: "declares a statement domain AND the bundle hash algorithm: two different preimages, so the artifact has not said what its signature covers. Resolving it either way silently discards the other claim — kubo resolved bundle-first, which would have dropped the cross-domain replay guard",
    portableHex: vectors.portableHex,
    sdkEnvelopeOnly: true,
    signatureEntry: ambiguousEntry,
    trustedPublicKeysHex: [signerHex],
    expect: {
      verified: false,
      reason: "ambiguous_signature_scope",
      statementDomain: "SDN-MODULE-PUBLICATION-V1",
      contentHashHex: vectors.artifacts[0].expect.contentHashHex,
      signatureScope: "",
      signedHashHex: "",
      flowNodeAdmissible: false,
    },
    sdkArtifactHex: bytesToHex(new Uint8Array(ambiguous.wasmBytes)),
  },
  {
    name: "statement-domain-key-case-variant-is-refused",
    why: "spells the key StatementDomain: Go's decoder matched it case-insensitively and took the domain path, while JS read payload.statementDomain, saw nothing and fell to the legacy path — the node verified what the SDK refused",
    portableHex: vectors.portableHex,
    sdkEnvelopeOnly: true,
    signatureEntry: caseVariantEntry,
    trustedPublicKeysHex: [signerHex],
    expect: {
      verified: false,
      reason: "invalid_signature_payload",
      statementDomain: "",
      contentHashHex: vectors.artifacts[0].expect.contentHashHex,
      signatureScope: "",
      signedHashHex: "",
      flowNodeAdmissible: false,
    },
    sdkArtifactHex: bytesToHex(new Uint8Array(caseVariant.wasmBytes)),
  },
];

// Every pre-existing vector gains the new expectation fields, so the scope and
// the admissibility verdict are pinned for the whole set rather than only for
// the vectors that motivated them.
const existing = vectors.artifacts.map((vector) => ({
  ...vector,
  expect: {
    ...vector.expect,
    signatureScope: vector.expect.verified ? "module" : "",
    signedHashHex: vector.expect.verified ? vector.expect.contentHashHex : "",
    // The flow lane admits a whole-bundle signature, or a module signature
    // under SDN-MODULE-PUBLICATION-V1. A bare-digest module signature is
    // verified but NOT admissible for composition: no domain separation means
    // a signature minted over another protocol's digest can be replayed into a
    // lane that compiles what it admits.
    flowNodeAdmissible:
      vector.expect.verified &&
      vector.expect.statementDomain === "SDN-MODULE-PUBLICATION-V1",
  },
}));

const out = {
  ...vectors,
  artifacts: [...existing, ...added],
};

await writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.error(`wrote ${out.artifacts.length} artifact vectors to ${outPath}`);
