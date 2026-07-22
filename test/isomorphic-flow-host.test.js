import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  cleanupCompilation,
  compileModuleFromSource,
} from "../src/compiler/compileModule.js";
import { signModuleArtifact } from "../src/bundle/signing.js";
import { compileFlowProgram } from "../src/flow/flowCompiler.js";
import { createIsomorphicFlowRuntimeHost } from "../src/flow/isomorphicFlowHost.js";
import { normalizeManifestForSdnFlow } from "../src/flow/normalize.js";

const TYPE_IDENTITY = {
  schemaName: "Blob.fbs",
  fileIdentifier: "$BLB",
  schemaVersion: "1.0.0",
  schemaHash: [0x10, 0x20, 0x30, 0x40],
  rootTypeName: "Blob",
};

function dualPort(portId, required) {
  return {
    portId,
    required,
    minStreams: required ? 1 : 0,
    maxStreams: 1,
    acceptedTypeSets: [
      {
        setId: `${portId}-dual`,
        allowedTypes: [
          { ...TYPE_IDENTITY, wireFormat: "flatbuffer" },
          {
            ...TYPE_IDENTITY,
            wireFormat: "aligned-binary",
            byteLength: 64,
            requiredAlignment: 8,
          },
        ],
      },
    ],
  };
}

function exactManifest() {
  return {
    pluginId: "test.isomorphic.echo",
    name: "Isomorphic Echo",
    version: "1.0.0",
    pluginFamily: "foundation",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    runtimeTargets: ["browser", "wasmedge"],
    methods: [
      {
        methodId: "echo",
        displayName: "Echo",
        inputPorts: [dualPort("request", true), dualPort("config", false)],
        outputPorts: [dualPort("response", false)],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    schemasUsed: [],
    abiVersion: 1,
  };
}

function catalog() {
  return [
    {
      schemaCode: "BLB",
      schemaName: TYPE_IDENTITY.schemaName,
      fileIdentifier: TYPE_IDENTITY.fileIdentifier,
      rootTypeName: TYPE_IDENTITY.rootTypeName,
      version: TYPE_IDENTITY.schemaVersion,
      hash: TYPE_IDENTITY.schemaHash
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(""),
      idl: "",
      files: [],
    },
  ];
}

test("browser flow host creates isolated per-node instances and delivers signed opaque node config", async (t) => {
  const manifest = exactManifest();
  const childHostcalls = [];
  const compilation = await compileModuleFromSource({
    manifest,
    language: "c++",
    catalog: catalog(),
    allowUndefinedImports: true,
    sourceCode: `
#include <stdint.h>
#include "space_data_module_invoke.h"
__attribute__((import_module("space_data_module_host"), import_name("call")))
extern int space_data_module_host_call(
  const char *operation_ptr,
  int operation_len,
  const char *payload_ptr,
  int payload_len
);
static uint8_t invocation_count = 0;
extern "C" int echo(void) {
  static const char operation[] = "test.observe";
  if (space_data_module_host_call(
        operation,
        (int)(sizeof(operation) - 1),
        nullptr,
        0
      ) != 0) return 4;
  const int32_t config_index = plugin_find_input_index("config", 0);
  const plugin_input_frame_t *config =
    config_index < 0 ? nullptr : plugin_get_input_frame((uint32_t)config_index);
  if (!config || !config->payload || config->payload_length != 1) return 2;
  invocation_count += 1;
  const uint8_t response[2] = {config->payload[0], invocation_count};
  return plugin_push_output(
    "response",
    "Blob.fbs",
    "$BLB",
    response,
    sizeof(response)
  ) < 0 ? 3 : 0;
}
`,
  });
  t.after(() => cleanupCompilation(compilation));

  const signed = await signModuleArtifact(compilation.wasmBytes, {
    privateKeySeedHex: "31".repeat(32),
    keyId: "isomorphic-flow-host-test",
    signatureScope: "bundle",
  });
  const childSha256 = createHash("sha256")
    .update(signed.wasmBytes)
    .digest("hex");
  const dependency = {
    pluginId: manifest.pluginId,
    manifest,
    normalized: normalizeManifestForSdnFlow(manifest),
    guestLink: null,
    wasmPath: "/not-linked/module.wasm",
    artifactBytes: signed.wasmBytes,
    publisherRecord: {
      algorithm: "ed25519",
      keyId: "isomorphic-flow-host-test",
      publicKeyHex: signed.signature.publicKeyHex,
      developmentOnly: false,
    },
  };
  const flow = {
    programId: "test.isomorphic.echo.flow",
    name: "Isomorphic echo flow",
    version: "1.0.0",
    nodes: [
      {
        nodeId: "echo-a",
        pluginId: manifest.pluginId,
        methodId: "echo",
        kind: "transform",
        dispatchModel: "isomorphic",
        config: Uint8Array.of(0xa1),
        artifact: {
          path: "nodes/echo-a/module.wasm",
          sha256: childSha256,
          publisher: "nodes/echo-a/publisher.json",
        },
      },
      {
        nodeId: "echo-b",
        pluginId: manifest.pluginId,
        methodId: "echo",
        kind: "transform",
        dispatchModel: "isomorphic",
        config: Uint8Array.of(0xb2),
        artifact: {
          path: "nodes/echo-b/module.wasm",
          sha256: childSha256,
          publisher: "nodes/echo-b/publisher.json",
        },
      },
      {
        nodeId: "sink-a",
        pluginId: "test.host.sink-a",
        methodId: "collect",
        kind: "sink",
      },
      {
        nodeId: "sink-b",
        pluginId: "test.host.sink-b",
        methodId: "collect",
        kind: "sink",
      },
    ],
    edges: [
      {
        fromNodeId: "echo-a",
        fromPortId: "response",
        toNodeId: "sink-a",
        toPortId: "response",
      },
      {
        fromNodeId: "echo-a",
        fromPortId: "response",
        toNodeId: "echo-b",
        toPortId: "request",
      },
      {
        fromNodeId: "echo-b",
        fromPortId: "response",
        toNodeId: "sink-b",
        toPortId: "response",
      },
    ],
    triggers: [{ triggerId: "startup", kind: "manual" }],
    triggerBindings: [
      {
        triggerId: "startup",
        targetNodeId: "echo-a",
        targetPortId: "request",
      },
    ],
    requiredPlugins: [manifest.pluginId],
  };
  const compiledFlow = await compileFlowProgram({
    flow,
    dependencies: new Map([[manifest.pluginId, dependency]]),
    catalog: catalog(),
  });
  const signedFlow = await signModuleArtifact(compiledFlow.wasmBytes, {
    privateKeySeedHex: "32".repeat(32),
    keyId: "isomorphic-parent-flow-test",
    signatureScope: "bundle",
  });

  let extraImportReads = 0;
  const extraImports = {};
  Object.defineProperty(extraImports, "test_probe", {
    enumerable: true,
    get() {
      extraImportReads += 1;
      return {};
    },
  });

  const child = {
    pluginId: manifest.pluginId,
    wasmSource: signed.wasmBytes,
    manifest,
    verifySignature: {
      trustedPublicKeys: [signed.signature.publicKeyHex],
      requireSignature: true,
    },
    hostcallDispatch(operation, params) {
      childHostcalls.push({ operation, params });
      return { accepted: true };
    },
  };
  const precompiledParent = await WebAssembly.compile(compiledFlow.wasmBytes);
  await assert.rejects(
    createIsomorphicFlowRuntimeHost({
      wasmSource: signedFlow.wasmBytes,
      wasmModule: precompiledParent,
      children: [child],
    }).then((unexpectedHost) => unexpectedHost.destroy()),
    /precompiled WebAssembly\.Module/i,
  );
  await assert.rejects(
    createIsomorphicFlowRuntimeHost({
      wasmSource: signedFlow.wasmBytes,
      verifySignature: {
        trustedPublicKeys: ["00".repeat(32)],
        requireSignature: true,
      },
      children: [child],
    }).then((unexpectedHost) => unexpectedHost.destroy()),
    /trusted signer set/i,
  );

  const host = await createIsomorphicFlowRuntimeHost({
    wasmSource: signedFlow.wasmBytes,
    verifySignature: {
      trustedPublicKeys: [signedFlow.signature.publicKeyHex],
      requireSignature: true,
    },
    extraImports,
    children: [child],
  });
  t.after(() => host.destroy());

  await assert.rejects(
    host.drain({
      handlers: {
        [`${manifest.pluginId}:echo`]: () => ({ statusCode: 0 }),
      },
    }),
    /cannot override node-scoped isomorphic dispatch/i,
  );

  const payload = new TextEncoder().encode("separate signed child");
  host.enqueueTriggerFrame(0, { portId: "request", bytes: payload });
  const sinkFrames = new Map();
  await host.drain({
    handlers: {
      "test.host.sink-a:collect": ({ frames }) => {
        sinkFrames.set("sink-a", frames);
        return { statusCode: 0 };
      },
      "test.host.sink-b:collect": ({ frames }) => {
        sinkFrames.set("sink-b", frames);
        return { statusCode: 0 };
      },
    },
  });

  const first = host.children.get("echo-a");
  const second = host.children.get("echo-b");
  assert.equal(first.sha256, childSha256);
  assert.equal(second.sha256, childSha256);
  assert.notEqual(first.harness, second.harness);
  assert.deepEqual(first.config, Uint8Array.of(0xa1));
  assert.deepEqual(second.config, Uint8Array.of(0xb2));
  assert.equal(extraImportReads, 1);
  assert.deepEqual(childHostcalls, [
    { operation: "test.observe", params: null },
    { operation: "test.observe", params: null },
  ]);
  assert.deepEqual(sinkFrames.get("sink-a")?.[0]?.bytes, Uint8Array.of(0xa1, 1));
  assert.deepEqual(sinkFrames.get("sink-b")?.[0]?.bytes, Uint8Array.of(0xb2, 1));
});
