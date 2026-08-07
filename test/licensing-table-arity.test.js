// Regression guard for the class of defect that broke browser module delivery
// (sdn-js 2.0.14 / module-sdk 0.8.5): a hand-written FlatBuffers table builder
// that passes FEWER arguments than the generated `create<Table>` accepts.
//
// The missing trailing argument arrives as `undefined`. flatbuffers-js
// `addFieldOffset(voffset, undefined, 0)` takes the "value differs from the
// default" branch (undefined != 0), so it emits a PRESENT vtable slot whose
// stored uoffset is `NaN | 0` === 0. FlatBuffers forbids a zero offset inside a
// table, so the C++ `VerifyLCHBuffer` the licensing/core key_server module runs
// rejects the whole buffer and the provider answers with 0 bytes -- the
// challenge dies upstream of the grant exchange, in the browser, silently.
//
// These tests are deliberately STRUCTURAL: they read the arity and the field
// layout out of the generated SDS bindings, so the next field appended to $LCH
// or $LPF fails the BUILD instead of the browser.
//
// Evidence for the original defect: the exact 17-argument buffer this file
// reconstructs as a negative control is rejected by the real C++
// VerifyLCHBuffer (336 bytes, VERIFY_FAIL) while the SDK's current 18-argument
// output verifies (328 bytes, VERIFY_OK).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import * as flatbuffers from "flatbuffers";

import {
  LCH,
  licensingChallengeMessageType,
  licensingChallengeRole,
} from "spacedatastandards.org/lib/js/LCH/main.js";
import { LPF, licensingProofMessageType } from "spacedatastandards.org/lib/js/LPF/main.js";

import {
  decodeLicensingChallengeMessage,
  decodeLicensingProofMessage,
  encodeLicensingChallengeRequest,
  encodeLicensingProof,
} from "../src/licensing/index.js";

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));

const CHALLENGE_OPTIONS = Object.freeze({
  reqId: "req-123",
  moduleId: "com.space-data-network.rf-empirical",
  moduleVersion: "0.5.22",
  requesterPeerId: "requester-peer-id",
  requesterXpub: "xpub-requester",
  requesterSigningPublicKey: new Uint8Array(32).fill(6),
  requesterEphemeralPublicKey: new Uint8Array(32).fill(8),
  requesterDomain: "app.example.com",
  requestedTimeoutMs: 300_000,
  requestedAtMs: 1_700_000_000_000,
  providerPeerId: "provider-peer-id",
});

const PROOF_OPTIONS = Object.freeze({
  reqId: "req-123",
  moduleId: "com.space-data-network.rf-empirical",
  moduleVersion: "0.5.22",
  requesterPeerId: "requester-peer-id",
  requesterXpub: "xpub-requester",
  requesterDomain: "app.example.com",
  requestedTimeoutMs: 300_000,
  requesterEphemeralPublicKey: new Uint8Array(32).fill(8),
  challengeNonce: new Uint8Array([1, 2, 3, 4]),
  challengeExpiresAtMs: 1_700_000_900_000,
  providerPeerId: "provider-peer-id",
  signature: new Uint8Array(64).fill(0xab),
  requesterSigningPublicKey: new Uint8Array(32).fill(6),
  timestampMs: 1_700_000_123_456,
});

/**
 * Calls `encode` while spying on `Table.create<Name>` and returns the argument
 * list the SDK actually handed the generated builder.
 */
function captureBuilderArgs(Table, methodName, encode) {
  const original = Table[methodName];
  let captured = null;
  Table[methodName] = function spy(...args) {
    captured = args;
    return original.apply(this, args);
  };
  try {
    encode();
  } finally {
    Table[methodName] = original;
  }
  assert.ok(captured, `${methodName} was never called`);
  return { args: captured, arity: original.length };
}

/**
 * Discovers, structurally, which vtable slots the generated builder writes as
 * OFFSETS (string/vector/table) rather than inline scalars, by replaying the
 * generated `create<Name>` against a recording Builder. Nothing is assumed
 * about the schema; the generated code itself is the source of truth.
 */
function offsetSlots(Table, methodName, args) {
  const recorder = new flatbuffers.Builder(1024);
  const slots = new Set();
  const addFieldOffset = recorder.addFieldOffset.bind(recorder);
  recorder.addFieldOffset = (voffset, value, defaultValue) => {
    slots.add(voffset);
    addFieldOffset(voffset, value, defaultValue);
  };
  Table[methodName](recorder, ...args.slice(1));
  return slots;
}

/**
 * Mirrors flatbuffers' C++ `Verifier::VerifyOffset`: every offset field that is
 * PRESENT in the vtable must carry a non-zero uoffset that lands inside the
 * buffer. This is the exact check the 0.8.5 challenge buffer failed.
 */
function assertOffsetFieldsVerify(bytes, offsetFieldIndexes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rootPos = view.getUint32(0, true);
  assert.ok(rootPos > 0 && rootPos < bytes.byteLength, "root uoffset out of range");

  const vtablePos = rootPos - view.getInt32(rootPos, true);
  assert.ok(vtablePos >= 0 && vtablePos < bytes.byteLength, "vtable out of range");

  const vtableBytes = view.getUint16(vtablePos, true);
  const failures = [];

  for (const fieldIndex of offsetFieldIndexes) {
    // flatbuffers-js `slot(i)` indexes fields; the vtable stores
    // [vtable bytes][table bytes][field 0]...[field n].
    const slotPos = vtablePos + 4 + fieldIndex * 2;
    if (4 + fieldIndex * 2 + 2 > vtableBytes) continue; // trimmed => absent, fine
    const slot = view.getUint16(slotPos, true);
    if (slot === 0) continue; // absent, fine
    const fieldPos = rootPos + slot;
    if (fieldPos + 4 > bytes.byteLength) {
      failures.push(`field ${fieldIndex} lies outside the buffer`);
      continue;
    }
    const uoffset = view.getUint32(fieldPos, true);
    if (uoffset === 0) {
      failures.push(`field ${fieldIndex} is present but stores a ZERO uoffset`);
      continue;
    }
    if (fieldPos + uoffset >= bytes.byteLength) {
      failures.push(`field ${fieldIndex} points past the end of the buffer`);
    }
  }

  return failures;
}

test("challenge encoder passes one argument per $LCH table field", () => {
  const { args, arity } = captureBuilderArgs(LCH, "createLCH", () =>
    encodeLicensingChallengeRequest({ ...CHALLENGE_OPTIONS }),
  );

  // Structural: `createLCH.length` is builder + one parameter per table field.
  // Appending a field to $LCH raises it and breaks this test at build time.
  assert.equal(
    args.length,
    arity,
    `encodeLicensingChallengeRequest passed ${args.length} args to a ${arity}-parameter LCH.createLCH ` +
      `(missing trailing field(s) become undefined -> zero-uoffset vtable slot -> VerifyLCHBuffer rejects)`,
  );

  for (const [index, value] of args.entries()) {
    assert.notEqual(value, undefined, `LCH.createLCH argument ${index} is undefined`);
    assert.ok(
      typeof value !== "number" || Number.isFinite(value),
      `LCH.createLCH argument ${index} is not finite`,
    );
  }
});

test("proof encoder passes one argument per $LPF table field", () => {
  const { args, arity } = captureBuilderArgs(LPF, "createLPF", () =>
    encodeLicensingProof({ ...PROOF_OPTIONS }),
  );

  assert.equal(
    args.length,
    arity,
    `encodeLicensingProof passed ${args.length} args to a ${arity}-parameter LPF.createLPF`,
  );

  for (const [index, value] of args.entries()) {
    assert.notEqual(value, undefined, `LPF.createLPF argument ${index} is undefined`);
  }
});

test("encoded challenge request has no zero-uoffset offset fields", () => {
  const { args } = captureBuilderArgs(LCH, "createLCH", () =>
    encodeLicensingChallengeRequest({ ...CHALLENGE_OPTIONS }),
  );
  const bytes = encodeLicensingChallengeRequest({ ...CHALLENGE_OPTIONS });

  assert.ok(LCH.bufferHasIdentifier(new flatbuffers.ByteBuffer(bytes)));
  assert.deepEqual(
    assertOffsetFieldsVerify(bytes, offsetSlots(LCH, "createLCH", args)),
    [],
  );
});

test("encoded proof has no zero-uoffset offset fields", () => {
  const { args } = captureBuilderArgs(LPF, "createLPF", () =>
    encodeLicensingProof({ ...PROOF_OPTIONS }),
  );
  const bytes = encodeLicensingProof({ ...PROOF_OPTIONS });

  assert.deepEqual(
    assertOffsetFieldsVerify(bytes, offsetSlots(LPF, "createLPF", args)),
    [],
  );
});

test("the zero-uoffset verifier has teeth: a short-by-one challenge is rejected", () => {
  // Negative control: reconstruct exactly what module-sdk 0.8.5 emitted --
  // createLCH invoked with one argument fewer than the table has fields.
  const builder = new flatbuffers.Builder(512);
  const reqId = builder.createString(CHALLENGE_OPTIONS.reqId);
  const moduleId = builder.createString(CHALLENGE_OPTIONS.moduleId);
  const moduleVersion = builder.createString(CHALLENGE_OPTIONS.moduleVersion);
  const peerId = builder.createString(CHALLENGE_OPTIONS.requesterPeerId);
  const xpub = builder.createString(CHALLENGE_OPTIONS.requesterXpub);
  const signingPubkey = LCH.createRequesterSigningPubkeyVector(
    builder,
    CHALLENGE_OPTIONS.requesterSigningPublicKey,
  );
  const ephemeralPubkey = LCH.createRequesterEphemeralPubkeyVector(
    builder,
    CHALLENGE_OPTIONS.requesterEphemeralPublicKey,
  );
  const domain = builder.createString(CHALLENGE_OPTIONS.requesterDomain);
  const providerPeerId = builder.createString(CHALLENGE_OPTIONS.providerPeerId);

  const full = [
    licensingChallengeMessageType.Request,
    licensingChallengeRole.Requester,
    reqId,
    moduleId,
    moduleVersion,
    peerId,
    xpub,
    signingPubkey,
    ephemeralPubkey,
    domain,
    BigInt(CHALLENGE_OPTIONS.requestedTimeoutMs),
    BigInt(CHALLENGE_OPTIONS.requestedAtMs),
    0,
    0n,
    providerPeerId,
    0,
    0,
    0,
  ];
  assert.equal(full.length + 1, LCH.createLCH.length, "negative control is stale");

  const short = full.slice(0, -1); // drop the trailing field, as 0.8.5 did
  const root = LCH.createLCH(builder, ...short);
  LCH.finishLCHBuffer(builder, root);
  const bytes = builder.asUint8Array();

  const slots = offsetSlots(LCH, "createLCH", [null, ...full]);
  const failures = assertOffsetFieldsVerify(bytes, slots);
  assert.ok(
    failures.some((message) => message.includes("ZERO uoffset")),
    `expected the short-by-one buffer to expose a zero uoffset, got ${JSON.stringify(failures)}`,
  );
});

test("challenge request round-trips through decodeLicensingChallengeMessage", () => {
  const decoded = decodeLicensingChallengeMessage(
    encodeLicensingChallengeRequest({ ...CHALLENGE_OPTIONS }),
  );

  assert.equal(decoded.messageType, "request");
  assert.equal(decoded.role, "requester");
  assert.equal(decoded.reqId, CHALLENGE_OPTIONS.reqId);
  assert.equal(decoded.moduleId, CHALLENGE_OPTIONS.moduleId);
  assert.equal(decoded.moduleVersion, CHALLENGE_OPTIONS.moduleVersion);
  assert.equal(decoded.requesterPeerId, CHALLENGE_OPTIONS.requesterPeerId);
  assert.equal(decoded.requesterXpub, CHALLENGE_OPTIONS.requesterXpub);
  assert.deepEqual(
    decoded.requesterSigningPublicKey,
    CHALLENGE_OPTIONS.requesterSigningPublicKey,
  );
  assert.deepEqual(
    decoded.requesterEphemeralPublicKey,
    CHALLENGE_OPTIONS.requesterEphemeralPublicKey,
  );
  assert.equal(decoded.requestedDomain, CHALLENGE_OPTIONS.requesterDomain);
  assert.equal(decoded.requestedTimeoutMs, CHALLENGE_OPTIONS.requestedTimeoutMs);
  assert.equal(decoded.requestedAtMs, CHALLENGE_OPTIONS.requestedAtMs);
  assert.equal(decoded.providerPeerId, CHALLENGE_OPTIONS.providerPeerId);
});

test("proof round-trips through decodeLicensingProofMessage", () => {
  const decoded = decodeLicensingProofMessage(encodeLicensingProof({ ...PROOF_OPTIONS }));

  assert.equal(decoded.messageType, "proof-request");
  assert.equal(decoded.reqId, PROOF_OPTIONS.reqId);
  assert.equal(decoded.moduleId, PROOF_OPTIONS.moduleId);
  assert.deepEqual(decoded.challengeNonce, PROOF_OPTIONS.challengeNonce);
  assert.deepEqual(decoded.signature, PROOF_OPTIONS.signature);
  assert.equal(decoded.providerPeerId, PROOF_OPTIONS.providerPeerId);
  assert.equal(decoded.timestampMs, PROOF_OPTIONS.timestampMs);
});

// ---------------------------------------------------------------------------
// Whole-surface guard: every hand-written `<Table>.create<Table>(builder, ...)`
// in src/ must match its generated arity, including builders no test exercises
// directly (e.g. the KMF content-key builder in src/transport/pki.js).
// ---------------------------------------------------------------------------

function collectSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "generated" || entry === "node_modules") continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Splits a `create...(` argument list into top-level arguments. */
function splitTopLevelArgs(source, openParenIndex) {
  const args = [];
  let depth = 0;
  let current = "";
  let quote = null;
  for (let i = openParenIndex + 1; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") {
        current += ch + source[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") {
      if (ch === ")" && depth === 0) {
        if (current.trim()) args.push(current.trim());
        return args;
      }
      depth -= 1;
    }
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  throw new Error("unterminated argument list");
}

function resolveImportSpecifier(source, symbol) {
  const pattern = new RegExp(
    String.raw`import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']`,
    "g",
  );
  for (const match of source.matchAll(pattern)) {
    const names = match[1].split(",").map((name) => name.trim().split(/\s+as\s+/).pop());
    if (names.includes(symbol)) return match[2];
  }
  return null;
}

test("every hand-written SDS table builder in src/ matches its generated arity", async () => {
  const callPattern = /\b([A-Z][A-Z0-9]{1,7})\.create([A-Z][A-Za-z0-9]*)\s*\(/g;
  const checked = [];

  for (const file of collectSourceFiles(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(callPattern)) {
      const [, symbol, tableName] = match;
      if (tableName.endsWith("Vector")) continue; // vectors take (builder, data)
      const specifier = resolveImportSpecifier(source, symbol);
      if (!specifier || !specifier.startsWith("spacedatastandards.org/")) continue;

      const namespace = await import(specifier);
      const table = namespace[symbol];
      const method = table?.[`create${tableName}`];
      assert.ok(
        typeof method === "function",
        `${symbol}.create${tableName} is not exported by ${specifier}`,
      );

      const openParen = match.index + match[0].length - 1;
      const args = splitTopLevelArgs(source, openParen);
      const relative = path.relative(SRC_DIR, file);
      assert.equal(
        args.length,
        method.length,
        `${relative}: ${symbol}.create${tableName} called with ${args.length} args but the ` +
          `generated builder takes ${method.length} (builder + one per table field). ` +
          `A field was added to $${symbol}; update the call site.`,
      );
      checked.push(`${relative}:${symbol}.create${tableName}`);
    }
  }

  // The scan must actually find the licensing + PKI builders; a silent zero
  // here would make this guard useless.
  assert.ok(
    checked.some((entry) => entry.endsWith("LCH.createLCH")),
    `scan did not reach LCH.createLCH (found: ${JSON.stringify(checked)})`,
  );
  assert.ok(
    checked.some((entry) => entry.endsWith("LPF.createLPF")),
    `scan did not reach LPF.createLPF (found: ${JSON.stringify(checked)})`,
  );
  assert.ok(
    checked.some((entry) => entry.endsWith("KMF.createKMF")),
    `scan did not reach KMF.createKMF (found: ${JSON.stringify(checked)})`,
  );
});
