// Regression tests for the 2026-10-15 security audit, flows:
//   SEC-008 the isomorphic flow host needs a trust policy and a verified parent
//   SEC-021 per-node CONFIG is read only from the manifest the parent's
//           signature covers; a swapped MBL trailer is refused
//   SEC-026 linked-direct object code comes from a verified, bundle-signed
//           artifact, never from unsigned dist/guest-link files
// Signing keys are random per run.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { cleanupCompilation, compileModuleFromSource } from "../src/compiler/compileModule.js";
import { signModuleArtifact } from "../src/bundle/signing.js";
import { createSingleFileBundle, parseSingleFileBundle } from "../src/bundle/wasm.js";
import {
  SDS_GUEST_LINK_METADATA_ENTRY_ID,
  SDS_GUEST_LINK_OBJECT_ENTRY_ID,
  SDS_GUEST_LINK_SECTION_NAME,
} from "../src/bundle/constants.js";
import { DOMAIN_MODULE_PUBLICATION_V1, statement } from "../src/bundle/sigdomain.js";
import { decodePlgManifest, encodePlgManifest } from "../src/manifest/plgCodec.js";
import { compileFlowProgram, resolveFlowDependencies } from "../src/flow/flowCompiler.js";
import { createFlowRuntimeHost } from "../src/flow/flowRuntimeHost.js";
import { createIsomorphicFlowRuntimeHost } from "../src/flow/isomorphicFlowHost.js";
import { normalizeManifestForSdnFlow } from "../src/flow/normalize.js";
import { extractPublicationRecordCollection } from "../src/transport/records.js";
import { locateEmbeddedPlgManifest } from "../src/compliance/index.js";
import { ed25519PublicKey, ed25519Sign } from "../src/utils/wasmCrypto.js";

const TYPE_IDENTITY = { schemaName: "Blob.fbs", fileIdentifier: "$BLB", schemaVersion: "1.0.0", schemaHash: [0x10, 0x20, 0x30, 0x40], rootTypeName: "Blob" };
const dualPort = (portId, required) => ({
  portId,
  required,
  minStreams: required ? 1 : 0,
  maxStreams: 1,
  acceptedTypeSets: [{
    setId: `${portId}-dual`,
    allowedTypes: [
      { ...TYPE_IDENTITY, wireFormat: "flatbuffer" },
      { ...TYPE_IDENTITY, wireFormat: "aligned-binary", byteLength: 64, requiredAlignment: 8 },
    ],
  }],
});
const ECHO_MANIFEST = {
  pluginId: "test.security.echo",
  name: "Security Echo",
  version: "1.0.0",
  pluginFamily: "foundation",
  capabilities: [],
  externalInterfaces: [],
  invokeSurfaces: ["direct"],
  runtimeTargets: ["browser", "wasmedge"],
  methods: [{
    methodId: "echo",
    displayName: "Echo",
    inputPorts: [dualPort("request", true), dualPort("config", false)],
    outputPorts: [dualPort("response", false)],
    maxBatch: 1,
    drainPolicy: "single-shot",
  }],
  schemasUsed: [],
  abiVersion: 1,
};
const BLB_CATALOG = [{ schemaCode: "BLB", schemaName: "Blob.fbs", fileIdentifier: "$BLB", rootTypeName: "Blob", version: "1.0.0", hash: "10203040", idl: "", files: [] }];

const seedHex = () => randomBytes(32).toString("hex");

// ATTACKER (no key): rebuild the MBL trailer with an edited manifest, keeping
// the signature entry verbatim (the audit's flow-config-swap repro).
async function tamperTrailerManifest(signedBytes, edit) {
  const parsed = await parseSingleFileBundle(signedBytes);
  let signature;
  let manifest;
  const others = [];
  for (const entry of parsed.bundle.entries) {
    if (entry.entryId === "signature") signature = JSON.parse(new TextDecoder().decode(new Uint8Array(entry.payload)));
    else if (entry.entryId === "manifest") manifest = decodePlgManifest(new Uint8Array(entry.payload));
    else others.push({ ...entry, payload: new Uint8Array(entry.payload) });
  }
  edit(manifest);
  return (await createSingleFileBundle({ wasmBytes: signedBytes, manifestBytes: encodePlgManifest(manifest), signature, entries: others })).wasmBytes;
}

test("SEC-008/SEC-021: the isomorphic flow host needs a trusted signature and reads CONFIG only from the signed manifest", { timeout: 600_000 }, async (t) => {
  const compilation = await compileModuleFromSource({
    threadModel: "single-thread",
    manifest: ECHO_MANIFEST,
    language: "c++",
    catalog: BLB_CATALOG,
    allowUndefinedImports: true,
    sourceCode: `
#include <stdint.h>
#include "space_data_module_invoke.h"
extern "C" int echo(void) {
  const int32_t ci = plugin_find_input_index("config", 0);
  const plugin_input_frame_t *c = ci < 0 ? nullptr : plugin_get_input_frame((uint32_t)ci);
  if (!c || !c->payload || c->payload_length != 1) return 2;
  const uint8_t r[1] = {c->payload[0]};
  return plugin_push_output("response", "Blob.fbs", "$BLB", r, 1) < 0 ? 3 : 0;
}`,
  });
  t.after(() => cleanupCompilation(compilation));
  const child = await signModuleArtifact(compilation.wasmBytes, { privateKeySeedHex: seedHex(), signatureScope: "bundle" });
  const childSha256 = createHash("sha256").update(child.wasmBytes).digest("hex");
  const flow = {
    programId: "test.security.flow",
    name: "Security flow",
    version: "1.0.0",
    nodes: [
      {
        nodeId: "echo-a", pluginId: ECHO_MANIFEST.pluginId, methodId: "echo", kind: "transform", dispatchModel: "isomorphic",
        config: Uint8Array.of(0xa1),
        artifact: { path: "nodes/echo-a/module.wasm", sha256: childSha256, publisher: "nodes/echo-a/publisher.json" },
      },
      { nodeId: "sink-a", pluginId: "test.host.sink-a", methodId: "collect", kind: "sink" },
    ],
    edges: [{ fromNodeId: "echo-a", fromPortId: "response", toNodeId: "sink-a", toPortId: "response" }],
    triggers: [{ triggerId: "startup", kind: "manual" }],
    triggerBindings: [{ triggerId: "startup", targetNodeId: "echo-a", targetPortId: "request" }],
    requiredPlugins: [ECHO_MANIFEST.pluginId],
  };
  const compiled = await compileFlowProgram({
    flow,
    catalog: BLB_CATALOG,
    dependencies: new Map([[ECHO_MANIFEST.pluginId, {
      pluginId: ECHO_MANIFEST.pluginId,
      manifest: ECHO_MANIFEST,
      normalized: normalizeManifestForSdnFlow(ECHO_MANIFEST),
      guestLink: null,
      wasmPath: "/not-linked/module.wasm",
      artifactBytes: child.wasmBytes,
      publisherRecord: { algorithm: "ed25519", publicKeyHex: child.signature.publicKeyHex, developmentOnly: false },
    }]]),
  });
  // ROUND 2 (SEC-026 for isomorphic nodes): an unsigned dependency manifest
  // that asks for more than the child's signed one adds nothing to the flow
  const ESCALATED = { ...ECHO_MANIFEST, capabilities: ["http", "secrets"], runtimeTargets: ["browser", "wasmedge"] };
  const escalated = await compileFlowProgram({
    flow,
    catalog: BLB_CATALOG,
    dependencies: new Map([[ECHO_MANIFEST.pluginId, {
      pluginId: ECHO_MANIFEST.pluginId,
      manifest: ESCALATED,
      normalized: normalizeManifestForSdnFlow(ESCALATED),
      guestLink: null,
      wasmPath: "/not-linked/module.wasm",
      artifactBytes: child.wasmBytes,
      publisherRecord: { algorithm: "ed25519", publicKeyHex: child.signature.publicKeyHex, developmentOnly: false },
    }]]),
  });
  assert.deepEqual(escalated.check.capabilities, [], "the isomorphic node's capabilities come from its signed manifest");
  const childSpec = {
    pluginId: ECHO_MANIFEST.pluginId,
    wasmSource: child.wasmBytes,
    manifest: ECHO_MANIFEST,
    verifySignature: { trustedPublicKeys: [child.signature.publicKeyHex], requireSignature: true },
  };
  const seed = seedHex();
  const publisher = Buffer.from(await ed25519PublicKey(Buffer.from(seed, "hex"))).toString("hex");
  const policy = { trustedPublicKeys: [publisher], requireSignature: true };

  async function sinkBytes(bytes, options = {}) {
    const host = await createIsomorphicFlowRuntimeHost({ wasmSource: bytes, verifySignature: policy, children: [childSpec], ...options });
    try {
      host.enqueueTriggerFrame(0, { portId: "request", bytes: Uint8Array.of(1) });
      let out;
      await host.drain({ handlers: { "test.host.sink-a:collect": ({ frames }) => { out = frames[0]?.bytes; return { statusCode: 0 }; } } });
      return Buffer.from(out ?? []).toString("hex");
    } finally {
      host.destroy?.();
    }
  }
  const editConfig = (manifest) => {
    manifest.flowNodes.find((node) => node.nodeId === "echo-a").config = Uint8Array.of(0xee);
  };

  // SEC-008: no policy anywhere, or a trust set with an unsigned parent: refused
  const savedEnv = process.env.SDM_TRUSTED_MODULE_SIGNERS;
  delete process.env.SDM_TRUSTED_MODULE_SIGNERS;
  try {
    await assert.rejects(
      createIsomorphicFlowRuntimeHost({ wasmSource: compiled.wasmBytes, children: [childSpec] }),
      (error) => error.code === "no_trust_policy",
    );
  } finally {
    if (savedEnv !== undefined) process.env.SDM_TRUSTED_MODULE_SIGNERS = savedEnv;
  }
  await assert.rejects(
    createIsomorphicFlowRuntimeHost({ wasmSource: compiled.wasmBytes, verifySignature: { trustedPublicKeys: [publisher] }, children: [childSpec] }),
    (error) => error.code === "missing_signature",
  );

  // bundle scope: honest CONFIG arrives; a swapped trailer is refused
  const bundleSigned = await signModuleArtifact(compiled.wasmBytes, { privateKeySeedHex: seed, signatureScope: "bundle" });
  assert.equal(await sinkBytes(bundleSigned.wasmBytes), "a1");
  await assert.rejects(sinkBytes(await tamperTrailerManifest(bundleSigned.wasmBytes, editConfig)), /hash/i);

  // legacy bare-digest module scope covers no manifest: refused even when honest
  const moduleSigned = await signModuleArtifact(compiled.wasmBytes, { privateKeySeedHex: seed });
  await assert.rejects(sinkBytes(moduleSigned.wasmBytes), /bare-digest module-scope signature/);
  await assert.rejects(sinkBytes(await tamperTrailerManifest(moduleSigned.wasmBytes, editConfig)), /bare-digest module-scope signature/);

  // node-signed form: the signature covers the payload, not the trailer, so a
  // trailer manifest is never the CONFIG source
  const portable = extractPublicationRecordCollection(moduleSigned.wasmBytes).payloadBytes;
  const contentHash = createHash("sha256").update(portable).digest();
  const nodeSignature = {
    algorithm: "ed25519",
    keyId: "node",
    publicKeyHex: publisher,
    signatureHex: Buffer.from(await ed25519Sign(statement(DOMAIN_MODULE_PUBLICATION_V1, new Uint8Array(contentHash)), Buffer.from(seed, "hex"))).toString("hex"),
    signedHashHex: contentHash.toString("hex"),
    statementDomain: DOMAIN_MODULE_PUBLICATION_V1,
  };
  const parsedModule = await parseSingleFileBundle(moduleSigned.wasmBytes);
  const trailerManifest = new Uint8Array(parsedModule.bundle.entries.find((entry) => entry.entryId === "manifest").payload);
  const nodeSigned = (await createSingleFileBundle({ wasmBytes: moduleSigned.wasmBytes, manifestBytes: trailerManifest, signature: nodeSignature })).wasmBytes;
  await assert.rejects(sinkBytes(await tamperTrailerManifest(nodeSigned, editConfig)), /no signed sds\.manifest|two different PLG manifests/);
});

// --- SEC-026 -----------------------------------------------------------------

const OMM = (setId) => {
  const identity = { schemaName: "OMM.fbs", fileIdentifier: "$OMM", schemaVersion: null, schemaHash: null, rootTypeName: "OMM" };
  return { setId, allowedTypes: [{ ...identity, wireFormat: "flatbuffer" }, { ...identity, wireFormat: "aligned-binary", byteLength: 64, requiredAlignment: 8 }] };
};
const RELAY_MANIFEST = {
  pluginId: "test.security.relay",
  name: "Relay",
  version: "1.0.0",
  pluginFamily: "foundation",
  capabilities: [],
  externalInterfaces: [],
  invokeSurfaces: ["direct"],
  runtimeTargets: ["browser"],
  methods: [{
    methodId: "relay",
    displayName: "Relay",
    inputPorts: [{ portId: "start", acceptedTypeSets: [OMM("in")], minStreams: 1, maxStreams: 1, required: true }],
    outputPorts: [{ portId: "out", acceptedTypeSets: [OMM("out")], minStreams: 1, maxStreams: 1, required: true }],
    maxBatch: 1,
    drainPolicy: "single-shot",
  }],
  schemasUsed: [],
  abiVersion: 1,
};
const OMM_CATALOG = [{ schemaCode: "TEST_0", schemaName: "OMM.fbs", fileIdentifier: "$OMM", rootTypeName: "OMM", version: null, hash: null, idl: "", files: [] }];
const relaySource = (text) => `
#include <stdint.h>
#include "space_data_module_invoke.h"
extern "C" int relay(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) { plugin_set_error("no-input", "x"); return 400; }
  static const char msg[] = "${text}";
  plugin_push_output("out", 0, 0, (const uint8_t*)msg, sizeof(msg) - 1);
  return 0;
}
`;

test("SEC-026: linked-direct nodes link the guest object from a verified bundle, never unsigned dist/ files", { timeout: 900_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sdm-sec026-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const build = (text) => compileModuleFromSource({
    manifest: RELAY_MANIFEST,
    threadModel: "single-thread",
    sourceCode: relaySource(text),
    language: "c++",
    outputPath: path.join(root, `${text}.wasm`),
    catalog: OMM_CATALOG,
  });
  const legit = await build("LEGIT-OUTPUT");
  t.after(() => cleanupCompilation(legit));
  const evil = await build("EVIL-INJECTED");
  t.after(() => cleanupCompilation(evil));

  // the dependency directory as resolveFlowDependencies scans it, with the
  // guest-link files swapped for the attacker's build
  const dep = path.join(root, "relay");
  await mkdir(path.join(dep, "dist", "isomorphic"), { recursive: true });
  await mkdir(path.join(dep, "dist", "guest-link"), { recursive: true });
  await writeFile(path.join(dep, "plugin-manifest.json"), JSON.stringify(RELAY_MANIFEST, null, 2));
  await copyFile(legit.outputPath, path.join(dep, "dist", "isomorphic", "module.wasm"));
  await writeFile(path.join(dep, "dist", "guest-link", "module-link.o"), evil.guestLink.objectBytes);
  await writeFile(path.join(dep, "dist", "guest-link", "metadata.json"), JSON.stringify({
    symbolPrefix: evil.guestLink.symbolPrefix,
    methodSymbols: evil.guestLink.methodSymbols,
  }));

  // the publisher's signed bundle carries the LEGIT guest-link object
  const seed = seedHex();
  const unsignedBundle = await createSingleFileBundle({
    wasmBytes: legit.wasmBytes,
    manifest: RELAY_MANIFEST,
    entries: [
      {
        entryId: SDS_GUEST_LINK_OBJECT_ENTRY_ID, role: "auxiliary", sectionName: SDS_GUEST_LINK_SECTION_NAME,
        payloadEncoding: "raw-bytes", mediaType: "application/wasm", payload: legit.guestLink.objectBytes,
      },
      {
        entryId: SDS_GUEST_LINK_METADATA_ENTRY_ID, role: "auxiliary", sectionName: SDS_GUEST_LINK_SECTION_NAME,
        payloadEncoding: "json-utf8", mediaType: "application/json",
        payload: { version: 1, format: "wasm-object", symbolPrefix: legit.guestLink.symbolPrefix, methodSymbols: legit.guestLink.methodSymbols, methodIds: Object.keys(legit.guestLink.methodSymbols) },
      },
    ],
  });
  const signed = await signModuleArtifact(unsignedBundle.wasmBytes, { privateKeySeedHex: seed, signatureScope: "bundle" });
  await writeFile(path.join(dep, "relay.signed.wasm"), signed.wasmBytes);
  await writeFile(path.join(dep, "publisher.json"), JSON.stringify({ algorithm: "ed25519", publicKeyHex: signed.signature.publicKeyHex, developmentOnly: false }));
  const signedSha256 = createHash("sha256").update(signed.wasmBytes).digest("hex");

  const flowFor = (relayNode) => ({
    programId: "test.security.linked",
    name: "Linked flow",
    version: "0.1.0",
    nodes: [relayNode, { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" }],
    edges: [{ fromNodeId: "relay", fromPortId: "out", toNodeId: "sink", toPortId: "result" }],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [{ triggerId: "manual", targetNodeId: "relay", targetPortId: "start" }],
    requiredPlugins: [RELAY_MANIFEST.pluginId],
  });
  const relayNode = { nodeId: "relay", pluginId: RELAY_MANIFEST.pluginId, methodId: "relay", kind: "transform" };
  const flowPath = path.join(root, "linked.flow.json");
  const dependencies = await resolveFlowDependencies({ depsPath: root });

  // no artifact lock: refused (the unverified dist/ object is not linked)
  await assert.rejects(
    compileFlowProgram({ flow: flowFor(relayNode), dependencies, catalog: OMM_CATALOG, flowSourcePath: flowPath }),
    /must bind artifact\.path/,
  );
  // a lock on the wrong bytes: refused
  await assert.rejects(
    compileFlowProgram({
      flow: flowFor({ ...relayNode, artifact: { path: "relay/relay.signed.wasm", publisher: "relay/publisher.json", sha256: "00".repeat(32) } }),
      dependencies, catalog: OMM_CATALOG, flowSourcePath: flowPath,
    }),
    /hash mismatch/,
  );

  const locked = { ...relayNode, artifact: { path: "relay/relay.signed.wasm", publisher: "relay/publisher.json", sha256: signedSha256 } };
  const result = await compileFlowProgram({ flow: flowFor(locked), dependencies, catalog: OMM_CATALOG, flowSourcePath: flowPath });
  const record = result.artifact.dependencies.find((entry) => entry.kind === "node");
  assert.equal(record.sha256, signedSha256);
  assert.equal(record.guestLinkObjectSha256, createHash("sha256").update(legit.guestLink.objectBytes).digest("hex"));
  assert.equal(result.artifact.developmentOnly, false);

  const host = await createFlowRuntimeHost({ wasmSource: result.wasmBytes });
  host.enqueueTriggerFrame(0, { portId: "start", bytes: new TextEncoder().encode("hello") });
  const outputs = [];
  await host.drain({ "test.sink:collect": ({ frames }) => { outputs.push(...frames.map((f) => new TextDecoder().decode(f.bytes))); return { statusCode: 0 }; } }, { maxIterations: 20 });
  assert.deepEqual(outputs, ["LEGIT-OUTPUT"]);

  // the development escape hatch is explicit and stamps the artifact
  const dev = await compileFlowProgram({ flow: flowFor(relayNode), dependencies, catalog: OMM_CATALOG, flowSourcePath: flowPath, allowUnverifiedLocalDeps: true });
  assert.equal(dev.artifact.developmentOnly, true);

  // ROUND 2 (the verifier's variant): the unsigned dist/ plugin-manifest.json
  // asks for http and secrets while the lock still pins the signed bundle.
  // The capability slice and the flow's PLG come from the signed manifest.
  await writeFile(path.join(dep, "plugin-manifest.json"), JSON.stringify({ ...RELAY_MANIFEST, capabilities: ["http", "secrets"] }, null, 2));
  const escalatedDeps = await resolveFlowDependencies({ depsPath: root });
  const escalated = await compileFlowProgram({ flow: flowFor(locked), dependencies: escalatedDeps, catalog: OMM_CATALOG, flowSourcePath: flowPath });
  assert.deepEqual(escalated.check.capabilities, [], "no capability from the unsigned manifest");
  const embedded = locateEmbeddedPlgManifest(escalated.wasmBytes);
  assert.deepEqual((embedded?.decoded?.capabilities ?? []).map((c) => c?.name ?? c), [], "the flow PLG declares none either");
  assert.equal(escalated.artifact.developmentOnly, false);
});

test("SEC-026 (round 2): component dependencies with only an unsigned manifest add no capabilities to a verified flow", { timeout: 900_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sdm-sec026c-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const SIGNED_MANIFEST = { ...RELAY_MANIFEST, dependencies: [{ pluginId: "test.security.component", minVersion: "1.0.0" }] };
  const legit = await compileModuleFromSource({
    manifest: SIGNED_MANIFEST,
    threadModel: "single-thread",
    sourceCode: relaySource("LEGIT-OUTPUT"),
    language: "c++",
    outputPath: path.join(root, "legit.wasm"),
    catalog: OMM_CATALOG,
  });
  t.after(() => cleanupCompilation(legit));
  const dep = path.join(root, "relay");
  await mkdir(dep, { recursive: true });
  await writeFile(path.join(dep, "plugin-manifest.json"), JSON.stringify(SIGNED_MANIFEST, null, 2));
  // ATTACKER: a component directory the signed manifest names, asking for secrets
  const component = path.join(root, "component");
  await mkdir(component, { recursive: true });
  await writeFile(path.join(component, "plugin-manifest.json"), JSON.stringify({
    ...RELAY_MANIFEST, pluginId: "test.security.component", capabilities: ["secrets", "http"], runtimeTargets: ["browser", "wasmedge"],
  }, null, 2));

  const unsignedBundle = await createSingleFileBundle({
    wasmBytes: legit.wasmBytes,
    manifest: SIGNED_MANIFEST,
    entries: [
      { entryId: SDS_GUEST_LINK_OBJECT_ENTRY_ID, role: "auxiliary", sectionName: SDS_GUEST_LINK_SECTION_NAME, payloadEncoding: "raw-bytes", mediaType: "application/wasm", payload: legit.guestLink.objectBytes },
      { entryId: SDS_GUEST_LINK_METADATA_ENTRY_ID, role: "auxiliary", sectionName: SDS_GUEST_LINK_SECTION_NAME, payloadEncoding: "json-utf8", mediaType: "application/json",
        payload: { version: 1, format: "wasm-object", symbolPrefix: legit.guestLink.symbolPrefix, methodSymbols: legit.guestLink.methodSymbols, methodIds: Object.keys(legit.guestLink.methodSymbols) } },
    ],
  });
  const signed = await signModuleArtifact(unsignedBundle.wasmBytes, { privateKeySeedHex: seedHex(), signatureScope: "bundle" });
  await writeFile(path.join(dep, "relay.signed.wasm"), signed.wasmBytes);
  await writeFile(path.join(dep, "publisher.json"), JSON.stringify({ algorithm: "ed25519", publicKeyHex: signed.signature.publicKeyHex, developmentOnly: false }));
  const flow = {
    programId: "test.security.linked.component",
    name: "Linked flow with component",
    version: "0.1.0",
    nodes: [
      { nodeId: "relay", pluginId: RELAY_MANIFEST.pluginId, methodId: "relay", kind: "transform",
        artifact: { path: "relay/relay.signed.wasm", publisher: "relay/publisher.json", sha256: createHash("sha256").update(signed.wasmBytes).digest("hex") } },
      { nodeId: "sink", pluginId: "test.sink", methodId: "collect", kind: "sink" },
    ],
    edges: [{ fromNodeId: "relay", fromPortId: "out", toNodeId: "sink", toPortId: "result" }],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [{ triggerId: "manual", targetNodeId: "relay", targetPortId: "start" }],
    requiredPlugins: [RELAY_MANIFEST.pluginId],
  };
  const dependencies = await resolveFlowDependencies({ depsPath: root });
  assert.ok(dependencies.has("test.security.component"), "the component is in the dependency set");
  const result = await compileFlowProgram({ flow, dependencies, catalog: OMM_CATALOG, flowSourcePath: path.join(root, "flow.json") });
  assert.deepEqual(result.check.capabilities, [], "the unsigned component manifest added nothing");
  assert.ok(result.check.warnings.some((issue) => issue.code === "unverified-component-dependency"));
  assert.deepEqual(result.check.runtimeTargets, ["browser"]);
});
