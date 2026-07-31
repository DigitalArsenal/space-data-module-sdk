#!/usr/bin/env node
// Stage 2 of the shared statement-domain vector generation (graph task
// sdn-sdk-statement-domain-parity, Janus 2026-07-30).
//
// Stage 1 (Go, AUTHORITATIVE for everything signed) emits the signature
// entries:
//
//   cd space-data-network/sdn-server && \
//   SDN_STATEMENT_DOMAIN_MATERIAL=/tmp/material.json \
//     go test ./internal/modulert -run TestWriteStatementDomainSignatureMaterial
//
// Stage 2 (here) wraps each entry in a REAL publication trailer using the
// production SDK writer, so the resulting `sdkArtifactHex` is bytes the SDK
// actually emits — not a Go lookalike. The Go verifier is then asserted against
// those exact bytes (publication_signature_vectors_test.go), which is what
// makes this a cross-runtime vector set rather than two parallel fixtures.
//
//   node test/support/statement-domain-vectors.mjs /tmp/material.json out.json
//
// The output must be copied, byte-identical, to BOTH
//   space-data-module-sdk/test/support/statement-domain-vectors.json
//   space-data-network/sdn-server/internal/modulert/testdata/statement-domain-vectors.json
// and its sha256 pinned in both suites. Identical bytes on both sides is the
// only arrangement in which drift is loud.

import { readFile, writeFile } from "node:fs/promises";
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

const [, , materialPath, outPath] = process.argv;
if (!materialPath || !outPath) {
  console.error(
    "usage: node test/support/statement-domain-vectors.mjs <material.json> <out.json>",
  );
  process.exit(2);
}

const material = JSON.parse(await readFile(materialPath, "utf8"));

const artifacts = [];
for (const vector of material.artifacts) {
  // The SDK writer is handed the signature entry VERBATIM — including
  // statementDomain, which it has no opinion about. A producer that had to
  // teach the writer about a new field would be a producer that could silently
  // drop it.
  const built = await createSingleFileBundle({
    wasmBytes: hexToBytes(vector.portableHex),
    signature: vector.signatureEntry,
  });
  artifacts.push({
    ...vector,
    sdkArtifactHex: bytesToHex(new Uint8Array(built.wasmBytes)),
  });
}

const out = {
  schemaVersion: material.schemaVersion,
  note: material.note,
  portableHex: material.portableHex,
  signerSeedHex: material.signerSeedHex,
  signerPublicKeyHex: material.signerPublicKeyHex,
  registry: material.registry,
  statements: material.statements,
  artifacts,
};

await writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.error(`wrote ${artifacts.length} artifact vectors to ${outPath}`);
