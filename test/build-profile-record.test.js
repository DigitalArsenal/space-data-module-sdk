// SDS $BPF build-profile route through the module SDK.
//
// Every assertion here is a COMPUTABLE OUTCOME: a byte sequence, an exact JSON
// string, a signature verdict, a field set, a count. There are no UI-wiring
// assertions and no source-pattern assertions.
//
// The five acceptance outcomes of obc-01b, in order:
//   1. Round-trip in BOTH forms, IDL capitalization exact.
//   2. Unsigned decodes as unsigned (ATTESTATION absent => attestation null).
//   3. Signed verifies in both forms, independently, against the same literal
//      SIGNING_PUBLIC_KEY.
//   4. One corrupted signature REJECTS the record.
//   5. Containment: exactly one $BPF in a $REC collection.

import test from "node:test";
import assert from "node:assert/strict";

import * as flatbuffers from "flatbuffers/mjs/flatbuffers.js";
import { APPT } from "spacedatastandards.org/lib/js/APP/main.js";
import { BPF, BPFT } from "spacedatastandards.org/lib/js/BPF/BPF.js";
import { BPFAttestationT } from "spacedatastandards.org/lib/js/BPF/BPFAttestation.js";
import { BPFModule, BPFModuleT } from "spacedatastandards.org/lib/js/BPF/BPFModule.js";
import { BPFPartT } from "spacedatastandards.org/lib/js/BPF/BPFPart.js";
import {
  BPFRuntimeLock,
  BPFRuntimeLockT,
} from "spacedatastandards.org/lib/js/BPF/BPFRuntimeLock.js";
import { PLG } from "spacedatastandards.org/lib/js/BPF/PLG.js";
import { REC, RECT } from "spacedatastandards.org/lib/js/REC/REC.js";
import { RecordT } from "spacedatastandards.org/lib/js/REC/Record.js";
import { RecordType } from "spacedatastandards.org/lib/js/REC/RecordType.js";

import {
  BUILD_PROFILE_FILE_IDENTIFIER,
  BUILD_PROFILE_SIGNATURE_LENGTH,
  canonicalBuildProfileJson,
  decodeBuildProfile,
  decodeBuildProfileRecordCollection,
  encodeBuildProfile,
  encodeBuildProfileRecordCollection,
  MAX_RUNTIME_LOCK_TTL_DAYS,
  signBuildProfile,
  validateBuildProfile,
  verifyBuildProfile,
  verifyBuildProfileCanonicalJsonSignature,
  verifyBuildProfileFlatbufferSignature,
  zeroBuildProfileSignaturePayloads,
} from "../src/transport/records.js";
import { bytesToHex, hexToBytes } from "../src/utils/encoding.js";
import { ed25519PublicKey } from "../src/utils/wasmCrypto.js";

const TEMPLATE_SHA256 =
  "3d2f1a0b5c4e6d7889aabbccddeeff00112233445566778899aabbccddeeff00";
const ENGINE_SHA256 =
  "aa11bb22cc33dd44ee55ff6600778899aabbccddeeff00112233445566778899";
const MODULE_SHA256 =
  "0011223344556677889900aabbccddeeff0011223344556677889900aabbccdd";
// A fixed 32-byte Ed25519 seed keeps every signature in this file deterministic.
const SIGNING_SEED = hexToBytes(
  "6f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
);

function sampleProfile(overrides = {}) {
  return {
    profileId: "orbpro-internal-2026-08",
    name: "Internal deployment cut",
    description: "Engine plus the isolation loader, locked to the internal hosts.",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T06:30:00.000Z",
    templateSha256: TEMPLATE_SHA256,
    parts: [
      {
        partId: "engine",
        kind: "ENGINE_BINARY",
        included: true,
        contentSha256: ENGINE_SHA256,
        byteLength: 52_428_800n,
        description: "Compiled engine payload.",
      },
      {
        partId: "coi-loader",
        kind: "ISOLATION_LOADER",
        included: true,
        byteLength: 4096n,
      },
      {
        partId: "source-maps",
        kind: "SOURCE_MAPS",
        included: false,
        byteLength: 0n,
      },
    ],
    modules: [
      {
        moduleId: "propagator-sgp4",
        moduleVersion: "1.4.0",
        included: true,
        protection: "ENCRYPTED",
        contentHash: MODULE_SHA256,
      },
      {
        moduleId: "conjunction-assessment",
        included: false,
        protection: "LICENSED",
      },
    ],
    runtimeLock: {
      allowedDomains: ["ops.example", "console.example"],
      allowedTlds: [".gov", ".mil"],
      devDomains: ["localhost"],
      ttlDays: 180,
      compiledAtMs: 1_756_512_000_000n,
    },
    licenseMode: "BUNDLED_KEY",
    ...overrides,
  };
}

/* ---------------------------------------------------------------- *
 * Acceptance 1 — round-trip in both forms, IDL capitalization exact.
 * ---------------------------------------------------------------- */

test("acceptance 1: a profile round-trips to an identical field set through the FlatBuffer form", () => {
  const profile = sampleProfile();
  const bytes = encodeBuildProfile(profile);
  const decoded = decodeBuildProfile(bytes);
  assert.deepEqual(decoded, validateBuildProfile(profile));
});

test("acceptance 1: the encoded buffer is size-prefixed and carries the $BPF file identifier", () => {
  const bytes = encodeBuildProfile(sampleProfile());
  assert.equal(BUILD_PROFILE_FILE_IDENTIFIER, "$BPF");
  const declaredLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    4,
  ).getUint32(0, true);
  assert.equal(declaredLength, bytes.length - 4);
  assert.equal(
    new TextDecoder().decode(bytes.subarray(8, 12)),
    BUILD_PROFILE_FILE_IDENTIFIER,
  );
});

test("acceptance 1: encoding is deterministic — one field set is one byte sequence", () => {
  const first = encodeBuildProfile(sampleProfile());
  // Same field set, parts and modules supplied in a different order.
  const shuffled = sampleProfile();
  shuffled.parts = [shuffled.parts[2], shuffled.parts[0], shuffled.parts[1]];
  shuffled.modules = [shuffled.modules[1], shuffled.modules[0]];
  const second = encodeBuildProfile(shuffled);
  assert.deepEqual(Array.from(first), Array.from(second));
});

test("acceptance 1: the canonical-JSON form carries the IDL keys in IDL order, uint64 as decimal strings", () => {
  const json = canonicalBuildProfileJson(sampleProfile());
  assert.equal(
    json,
    '{"PROFILE_ID":"orbpro-internal-2026-08"' +
      ',"NAME":"Internal deployment cut"' +
      ',"DESCRIPTION":"Engine plus the isolation loader, locked to the internal hosts."' +
      ',"CREATED_AT":"2026-08-30T00:00:00.000Z"' +
      ',"UPDATED_AT":"2026-08-30T06:30:00.000Z"' +
      `,"TEMPLATE_SHA256":"${TEMPLATE_SHA256}"` +
      ',"PARTS":[' +
      '{"PART_ID":"coi-loader","KIND":"ISOLATION_LOADER","INCLUDED":true,"BYTE_LENGTH":"4096"}' +
      `,{"PART_ID":"engine","KIND":"ENGINE_BINARY","INCLUDED":true,"CONTENT_SHA256":"${ENGINE_SHA256}","BYTE_LENGTH":"52428800","DESCRIPTION":"Compiled engine payload."}` +
      ',{"PART_ID":"source-maps","KIND":"SOURCE_MAPS","INCLUDED":false,"BYTE_LENGTH":"0"}' +
      ']' +
      ',"MODULES":[' +
      '{"MODULE_ID":"conjunction-assessment","INCLUDED":false,"PROTECTION":"LICENSED"}' +
      `,{"MODULE_ID":"propagator-sgp4","MODULE_VERSION":"1.4.0","INCLUDED":true,"PROTECTION":"ENCRYPTED","CONTENT_HASH":"${MODULE_SHA256}"}` +
      ']' +
      ',"RUNTIME_LOCK":{"ALLOWED_DOMAINS":["ops.example","console.example"],"ALLOWED_TLDS":[".gov",".mil"],"DEV_DOMAINS":["localhost"],"TTL_DAYS":180,"COMPILED_AT_MS":"1756512000000"}' +
      ',"LICENSE_MODE":"BUNDLED_KEY"}',
  );
  // No insignificant whitespace anywhere outside string literals.
  assert.equal(/[\n\t]/.test(json), false);
});

test("acceptance 1: every canonical-JSON key matches the IDL spelling generated by flatc", () => {
  // The generated *T constructors assign their properties in IDL field order,
  // so their own key order IS the schema's order at this pin. Comparing the
  // projection's key set against them turns "JSON keys match the IDL" into a
  // mechanical check that also catches a future SDS field append.
  const keysOf = (value) => Object.keys(value);
  const json = JSON.parse(canonicalBuildProfileJson(sampleProfile()));

  const bpfKeys = keysOf(new BPFT());
  assert.deepEqual(
    bpfKeys,
    [
      "PROFILE_ID",
      "NAME",
      "DESCRIPTION",
      "CREATED_AT",
      "UPDATED_AT",
      "TEMPLATE_SHA256",
      "PARTS",
      "MODULES",
      "RUNTIME_LOCK",
      "LICENSE_MODE",
      "ATTESTATION",
    ],
    "SDS $BPF field order moved; the canonical-JSON projection must move with it.",
  );
  // The projection emits its keys in IDL order, skipping absent optionals.
  assert.deepEqual(
    keysOf(json),
    bpfKeys.filter((key) => key !== "ATTESTATION"),
  );
  assert.deepEqual(keysOf(json.PARTS[1]), keysOf(new BPFPartT()));
  assert.deepEqual(
    keysOf(json.MODULES[1]),
    keysOf(new BPFModuleT()).filter((key) => key !== "MODULE_DESCRIPTOR"),
  );
  assert.deepEqual(keysOf(json.RUNTIME_LOCK), keysOf(new BPFRuntimeLockT()));
});

test("acceptance 1: the canonical-JSON attestation omits ONLY the two signature payloads", async () => {
  const { profile } = await signBuildProfile(sampleProfile(), {
    signingSeed: SIGNING_SEED,
    signedAt: "2026-08-30T06:45:00.000Z",
  });
  const json = JSON.parse(canonicalBuildProfileJson(profile));
  assert.deepEqual(Object.keys(json.ATTESTATION), ["SIGNING_PUBLIC_KEY", "SIGNED_AT"]);
  assert.equal(json.ATTESTATION.SIGNED_AT, "2026-08-30T06:45:00.000Z");
  assert.equal(json.ATTESTATION.SIGNING_PUBLIC_KEY, profile.attestation.signingPublicKey);
});

test("acceptance 1: an out-of-range lifetime is rejected, never clamped", () => {
  for (const ttlDays of [0, -1, MAX_RUNTIME_LOCK_TTL_DAYS + 1, 4096]) {
    assert.throws(
      () => validateBuildProfile(sampleProfile({ runtimeLock: { ttlDays } })),
      /ttlDays must be an integer 1 through 365/,
      `ttlDays ${ttlDays} must be rejected`,
    );
  }
  // Unstated means 180, and 1 and 365 are both admitted.
  assert.equal(
    validateBuildProfile(sampleProfile({ runtimeLock: {} })).runtimeLock.ttlDays,
    180,
  );
  for (const ttlDays of [1, 365]) {
    assert.equal(
      validateBuildProfile(sampleProfile({ runtimeLock: { ttlDays } })).runtimeLock
        .ttlDays,
      ttlDays,
    );
  }
});

test("acceptance 1: a suffix rule must be written dot-anchored", () => {
  assert.throws(
    () =>
      validateBuildProfile(
        sampleProfile({ runtimeLock: { allowedTlds: ["mil"], ttlDays: 30 } }),
      ),
    /dot-anchored suffix rule/,
  );
});

/* ---------------------------------------------------------- *
 * Acceptance 2 — unsigned decodes as unsigned.
 * ---------------------------------------------------------- */

test("acceptance 2: ATTESTATION absent => attestation is null, and no SIGNED boolean is synthesized", () => {
  const bytes = encodeBuildProfile(sampleProfile());
  const decoded = decodeBuildProfile(bytes);
  assert.equal(decoded.attestation, null);
  assert.equal(Object.hasOwn(decoded, "signed"), false);
  assert.equal(Object.hasOwn(decoded, "SIGNED"), false);
  // The mark is derived structurally, by the same absence.
  const root = BPF.getSizePrefixedRootAsBPF(new flatbuffers.ByteBuffer(bytes));
  assert.equal(root.ATTESTATION(), null);
});

test("acceptance 2: an unsigned profile verifies as unsigned rather than throwing", async () => {
  const bytes = encodeBuildProfile(sampleProfile());
  const result = await verifyBuildProfile(bytes);
  assert.equal(result.signed, false);
  assert.equal(result.profile.attestation, null);
  assert.equal(await verifyBuildProfileFlatbufferSignature(bytes), false);
  assert.equal(await verifyBuildProfileCanonicalJsonSignature(result.profile), false);
});

/* ------------------------------------------------------------------ *
 * Acceptance 3 — signed verifies in BOTH forms, independently.
 * ------------------------------------------------------------------ */

test("acceptance 3: both signatures verify independently against the same literal SIGNING_PUBLIC_KEY", async () => {
  const { profile, bytes, canonicalJson } = await signBuildProfile(sampleProfile(), {
    signingSeed: SIGNING_SEED,
    signedAt: "2026-08-30T06:45:00.000Z",
  });

  const expectedPublicKey = bytesToHex(await ed25519PublicKey(SIGNING_SEED));
  assert.equal(profile.attestation.signingPublicKey, expectedPublicKey);
  assert.match(profile.attestation.signingPublicKey, /^[a-f0-9]{64}$/);
  assert.equal(profile.attestation.signature.length, BUILD_PROFILE_SIGNATURE_LENGTH);
  assert.equal(
    profile.attestation.canonicalJsonSignature.length,
    BUILD_PROFILE_SIGNATURE_LENGTH,
  );
  assert.notDeepEqual(
    Array.from(profile.attestation.signature),
    Array.from(profile.attestation.canonicalJsonSignature),
  );

  assert.equal(await verifyBuildProfileFlatbufferSignature(bytes), true);
  assert.equal(await verifyBuildProfileCanonicalJsonSignature(profile), true);
  const combined = await verifyBuildProfile(bytes);
  assert.equal(combined.signed, true);

  // The JSON form is verifiable on its own: the projection recomputed from the
  // decoded record is byte-identical to what was signed.
  assert.equal(canonicalBuildProfileJson(profile), canonicalJson);
});

test("acceptance 3: the SIGNATURE preimage is the buffer with both payloads zeroed, offsets preserved", async () => {
  const { bytes } = await signBuildProfile(sampleProfile(), {
    signingSeed: SIGNING_SEED,
    signedAt: "2026-08-30T06:45:00.000Z",
  });
  const preimage = zeroBuildProfileSignaturePayloads(bytes);
  assert.equal(preimage.length, bytes.length, "zeroing must preserve the layout");

  const root = BPF.getSizePrefixedRootAsBPF(new flatbuffers.ByteBuffer(preimage));
  const attestation = root.ATTESTATION();
  assert.deepEqual(
    Array.from(attestation.signatureArray()),
    Array.from(new Uint8Array(BUILD_PROFILE_SIGNATURE_LENGTH)),
  );
  assert.deepEqual(
    Array.from(attestation.canonicalJsonSignatureArray()),
    Array.from(new Uint8Array(BUILD_PROFILE_SIGNATURE_LENGTH)),
  );
  // SIGNING_PUBLIC_KEY and SIGNED_AT stay covered by the preimage.
  assert.match(attestation.SIGNING_PUBLIC_KEY(), /^[a-f0-9]{64}$/);
  assert.equal(attestation.SIGNED_AT(), "2026-08-30T06:45:00.000Z");
  // Exactly 128 bytes differ between the signed buffer and its preimage.
  let differing = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== preimage[index]) differing += 1;
  }
  assert.equal(differing <= 2 * BUILD_PROFILE_SIGNATURE_LENGTH, true);
  assert.equal(differing > 0, true);
});

test("acceptance 3: signing is deterministic and re-encoding a signed profile reproduces its bytes", async () => {
  const options = { signingSeed: SIGNING_SEED, signedAt: "2026-08-30T06:45:00.000Z" };
  const first = await signBuildProfile(sampleProfile(), options);
  const second = await signBuildProfile(sampleProfile(), options);
  assert.deepEqual(Array.from(first.bytes), Array.from(second.bytes));
  // Re-encoding the DECODED profile reproduces the signed bytes exactly, which
  // is what lets a $REC-contained profile be verified after extraction.
  assert.deepEqual(
    Array.from(encodeBuildProfile(first.profile)),
    Array.from(first.bytes),
  );
});

/* ------------------------------------------------------------------ *
 * Acceptance 4 — one corrupted signature REJECTS the record.
 * ------------------------------------------------------------------ */

test("acceptance 4: a corrupted FlatBuffer signature REJECTS — never downgraded to unsigned", async () => {
  const { bytes } = await signBuildProfile(sampleProfile(), {
    signingSeed: SIGNING_SEED,
    signedAt: "2026-08-30T06:45:00.000Z",
  });
  const tampered = new Uint8Array(bytes);
  const attestation = BPF.getSizePrefixedRootAsBPF(
    new flatbuffers.ByteBuffer(tampered),
  ).ATTESTATION();
  attestation.signatureArray()[0] ^= 0xff;

  assert.equal(await verifyBuildProfileFlatbufferSignature(tampered), false);
  await assert.rejects(
    () => verifyBuildProfile(tampered),
    /SIGNATURE failed to verify/,
  );
  // The canonical-JSON half still verifies: that is exactly why stripping one
  // signature must not launder the record.
  assert.equal(
    await verifyBuildProfileCanonicalJsonSignature(decodeBuildProfile(tampered)),
    true,
  );
});

test("acceptance 4: a corrupted canonical-JSON signature REJECTS — never downgraded to unsigned", async () => {
  const { bytes } = await signBuildProfile(sampleProfile(), {
    signingSeed: SIGNING_SEED,
    signedAt: "2026-08-30T06:45:00.000Z",
  });
  const tampered = new Uint8Array(bytes);
  const attestation = BPF.getSizePrefixedRootAsBPF(
    new flatbuffers.ByteBuffer(tampered),
  ).ATTESTATION();
  attestation.canonicalJsonSignatureArray()[63] ^= 0xff;

  assert.equal(await verifyBuildProfileFlatbufferSignature(tampered), true);
  assert.equal(
    await verifyBuildProfileCanonicalJsonSignature(decodeBuildProfile(tampered)),
    false,
  );
  await assert.rejects(
    () => verifyBuildProfile(tampered),
    /CANONICAL_JSON_SIGNATURE failed to verify/,
  );
});

test("acceptance 4: tampering with a covered field breaks both signatures", async () => {
  const { profile } = await signBuildProfile(sampleProfile(), {
    signingSeed: SIGNING_SEED,
    signedAt: "2026-08-30T06:45:00.000Z",
  });
  // Re-encode the same attestation over a changed lock: both forms must fail.
  const tampered = encodeBuildProfile({
    ...profile,
    runtimeLock: { ...profile.runtimeLock, ttlDays: 365 },
  });
  assert.equal(await verifyBuildProfileFlatbufferSignature(tampered), false);
  assert.equal(
    await verifyBuildProfileCanonicalJsonSignature(decodeBuildProfile(tampered)),
    false,
  );
  await assert.rejects(() => verifyBuildProfile(tampered));
});

test("acceptance 4: an attestation signed by another key REJECTS", async () => {
  const otherSeed = hexToBytes(
    "1111111111111111111111111111111111111111111111111111111111111111",
  );
  const { bytes } = await signBuildProfile(sampleProfile(), {
    signingSeed: otherSeed,
    // The published key claims to be someone else's: fail closed.
    signingPublicKey: bytesToHex(await ed25519PublicKey(SIGNING_SEED)),
    signedAt: "2026-08-30T06:45:00.000Z",
  });
  await assert.rejects(() => verifyBuildProfile(bytes), /failed to verify/);
});

test("acceptance 4: a short signature payload is refused at decode", () => {
  const truncated = new BPFT(
    "p",
    "n",
    null,
    null,
    null,
    TEMPLATE_SHA256,
    [],
    [],
    new BPFRuntimeLockT([], [], [], 180, 0n),
    0,
    new BPFAttestationT(
      "aa11bb22cc33dd44ee55ff6600778899aabbccddeeff00112233445566778899",
      null,
      Array.from(new Uint8Array(32)),
      Array.from(new Uint8Array(BUILD_PROFILE_SIGNATURE_LENGTH)),
    ),
  );
  const builder = new flatbuffers.Builder(1024);
  BPF.finishSizePrefixedBPFBuffer(builder, truncated.pack(builder));
  assert.throws(
    () => decodeBuildProfile(builder.asUint8Array()),
    /must be exactly 64 bytes/,
  );
});

/* -------------------------------------------------- *
 * Acceptance 5 — containment.
 * -------------------------------------------------- */

function recordCollection(records) {
  const builder = new flatbuffers.Builder(2048);
  REC.finishRECBuffer(builder, new RECT("1.0.0", records).pack(builder));
  return builder.asUint8Array();
}

function bpfRecord(profile) {
  const normalized = validateBuildProfile(profile);
  return new RecordT(
    RecordType.BPF,
    new BPFT(
      normalized.profileId,
      normalized.name,
      normalized.description,
      normalized.createdAt,
      normalized.updatedAt,
      normalized.templateSha256,
      normalized.parts.map(
        (part) =>
          new BPFPartT(
            part.partId,
            0,
            part.included,
            part.contentSha256,
            part.byteLength,
            part.description,
          ),
      ),
      [],
      new BPFRuntimeLockT(
        normalized.runtimeLock.allowedDomains,
        normalized.runtimeLock.allowedTlds,
        normalized.runtimeLock.devDomains,
        normalized.runtimeLock.ttlDays,
        normalized.runtimeLock.compiledAtMs,
      ),
      0,
      null,
    ),
    "BPF",
  );
}

function appRecord() {
  return new RecordT(
    RecordType.APP,
    new APPT("launcher", "Launcher", "1.0.0", null, [], [], [], [], null, null, []),
    "APP",
  );
}

test("acceptance 5: a $REC collection carrying exactly one $BPF imports", () => {
  const profile = sampleProfile();
  const bytes = encodeBuildProfileRecordCollection(profile);
  const decoded = decodeBuildProfileRecordCollection(bytes);
  assert.deepEqual(decoded.profile, validateBuildProfile(profile));
  assert.equal(decoded.records.length, 1);
  assert.equal(decoded.records[0].standard, "BPF");
  assert.equal(decoded.records[0].recordType, RecordType.BPF);
  assert.equal(RecordType.BPF, 227);
  // The extracted bare buffer is the same complete export.
  assert.deepEqual(
    Array.from(decoded.profileBytes),
    Array.from(encodeBuildProfile(profile)),
  );
});

test("acceptance 5: zero $BPF records is a REJECT", () => {
  assert.throws(
    () => decodeBuildProfileRecordCollection(recordCollection([appRecord()])),
    /contains no BPF record/,
  );
});

test("acceptance 5: two or more $BPF records is a REJECT", () => {
  const two = recordCollection([
    bpfRecord(sampleProfile()),
    bpfRecord(sampleProfile({ profileId: "second" })),
  ]);
  assert.throws(
    () => decodeBuildProfileRecordCollection(two),
    /more than one BPF record/,
  );
});

test("acceptance 5: an accompanying $APP record is advisory — present or absent, the profile imports", () => {
  const withApp = decodeBuildProfileRecordCollection(
    recordCollection([bpfRecord(sampleProfile()), appRecord()]),
  );
  assert.equal(withApp.profile.profileId, "orbpro-internal-2026-08");
  assert.deepEqual(
    withApp.records.map((record) => record.standard),
    ["BPF", "APP"],
  );

  const withoutApp = decodeBuildProfileRecordCollection(
    recordCollection([bpfRecord(sampleProfile())]),
  );
  assert.equal(withoutApp.profile.profileId, "orbpro-internal-2026-08");
  assert.deepEqual(
    withoutApp.records.map((record) => record.standard),
    ["BPF"],
  );
});

test("acceptance 5: a bare size-prefixed $BPF buffer is a complete, valid export", async () => {
  const { bytes, profile } = await signBuildProfile(sampleProfile(), {
    signingSeed: SIGNING_SEED,
    signedAt: "2026-08-30T06:45:00.000Z",
  });
  // No trailer, no collection, no envelope: the buffer alone decodes and verifies.
  const verified = await verifyBuildProfile(bytes);
  assert.equal(verified.signed, true);
  assert.deepEqual(verified.profile, profile);
});

test("acceptance 5: a signed profile survives $REC containment and still verifies in both forms", async () => {
  const { profile, bytes } = await signBuildProfile(sampleProfile(), {
    signingSeed: SIGNING_SEED,
    signedAt: "2026-08-30T06:45:00.000Z",
  });
  const collection = encodeBuildProfileRecordCollection(profile);
  const decoded = decodeBuildProfileRecordCollection(collection);
  assert.deepEqual(Array.from(decoded.profileBytes), Array.from(bytes));
  const verified = await verifyBuildProfile(decoded.profileBytes);
  assert.equal(verified.signed, true);
});

/* -------------------------------------------------- *
 * Structural refusals.
 * -------------------------------------------------- */

test("a truncated or mis-identified buffer is refused", () => {
  const bytes = encodeBuildProfile(sampleProfile());
  assert.throws(() => decodeBuildProfile(bytes.subarray(0, 8)), /non-truncated/);
  const wrongIdentifier = new Uint8Array(bytes);
  wrongIdentifier[8] = "X".charCodeAt(0);
  assert.throws(() => decodeBuildProfile(wrongIdentifier), /\$BPF file identifier/);
  const wrongPrefix = new Uint8Array(bytes);
  wrongPrefix[0] ^= 0xff;
  assert.throws(() => decodeBuildProfile(wrongPrefix), /size prefix/);
});

test("an embedded MODULE_DESCRIPTOR is refused rather than silently dropped", () => {
  const builder = new flatbuffers.Builder(1024);
  const pluginId = builder.createString("propagator-sgp4");
  const name = builder.createString("SGP4");
  const version = builder.createString("1.4.0");
  PLG.startPLG(builder);
  PLG.addPluginId(builder, pluginId);
  PLG.addName(builder, name);
  PLG.addVersion(builder, version);
  const descriptor = PLG.endPLG(builder);
  const moduleId = builder.createString("propagator-sgp4");
  BPFModule.startBPFModule(builder);
  BPFModule.addModuleId(builder, moduleId);
  BPFModule.addModuleDescriptor(builder, descriptor);
  const moduleOffset = BPFModule.endBPFModule(builder);
  const modules = BPF.createModulesVector(builder, [moduleOffset]);
  BPFRuntimeLock.startBPFRuntimeLock(builder);
  const lock = BPFRuntimeLock.endBPFRuntimeLock(builder);
  const profileId = builder.createString("p");
  const profileName = builder.createString("n");
  const templateSha256 = builder.createString(TEMPLATE_SHA256);
  BPF.startBPF(builder);
  BPF.addProfileId(builder, profileId);
  BPF.addName(builder, profileName);
  BPF.addTemplateSha256(builder, templateSha256);
  BPF.addModules(builder, modules);
  BPF.addRuntimeLock(builder, lock);
  BPF.finishSizePrefixedBPFBuffer(builder, BPF.endBPF(builder));
  assert.throws(
    () => decodeBuildProfile(builder.asUint8Array()),
    /carries an embedded MODULE_DESCRIPTOR/,
  );
});

test("the encoder never writes a MODULE_DESCRIPTOR: a module reference is the identity triple", () => {
  const withoutDescriptor = new BPFT(
    "p",
    "n",
    null,
    null,
    null,
    TEMPLATE_SHA256,
    [],
    [new BPFModuleT("m", null, true, 1, MODULE_SHA256, null)],
    new BPFRuntimeLockT([], [], [], 180, 0n),
    0,
    null,
  );
  const encodeBuilder = new flatbuffers.Builder(1024);
  BPF.finishSizePrefixedBPFBuffer(encodeBuilder, withoutDescriptor.pack(encodeBuilder));
  const decoded = decodeBuildProfile(encodeBuilder.asUint8Array());
  assert.equal(decoded.modules.length, 1);
  assert.equal(decoded.modules[0].moduleId, "m");
  const root = BPF.getSizePrefixedRootAsBPF(
    new flatbuffers.ByteBuffer(encodeBuildProfile(decoded)),
  );
  assert.equal(root.MODULES(0).MODULE_DESCRIPTOR(), null);
});

test("the runtime lock is required: an absent lock is never read as an unlocked one", () => {
  assert.throws(
    () => validateBuildProfile(sampleProfile({ runtimeLock: undefined })),
    /runtimeLock is required/,
  );
  // An explicitly empty lock IS a stated unlocked configuration.
  const unlocked = validateBuildProfile(
    sampleProfile({ runtimeLock: { allowedDomains: [], allowedTlds: [] } }),
  );
  assert.deepEqual(unlocked.runtimeLock.allowedDomains, []);
  assert.deepEqual(unlocked.runtimeLock.allowedTlds, []);
  assert.equal(unlocked.runtimeLock.ttlDays, 180);
});

test("an unknown enum name is refused with the admitted vocabulary", () => {
  assert.throws(
    () => validateBuildProfile(sampleProfile({ licenseMode: "FREE_TRIAL" })),
    /must be one of UNSPECIFIED, NONE, BUNDLED_KEY, LICENSE_KEY/,
  );
});
