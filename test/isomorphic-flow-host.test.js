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
        inputPorts: [dualPort("request", true)],
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

test("browser flow host verifies and invokes an exact separately signed isomorphic child", async (t) => {
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
extern "C" int echo(void) {
  static const char operation[] = "test.observe";
  if (space_data_module_host_call(
        operation,
        (int)(sizeof(operation) - 1),
        nullptr,
        0
      ) != 0) return 4;
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) return 2;
  return plugin_push_output(
    "response",
    frame->schema_name,
    frame->file_identifier,
    frame->payload,
    frame->payload_length
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
        nodeId: "echo",
        pluginId: manifest.pluginId,
        methodId: "echo",
        kind: "transform",
        dispatchModel: "isomorphic",
        artifact: {
          path: "nodes/echo/module.wasm",
          sha256: childSha256,
          publisher: "nodes/echo/publisher.json",
        },
      },
      {
        nodeId: "sink",
        pluginId: "test.host.sink",
        methodId: "collect",
        kind: "sink",
      },
    ],
    edges: [
      {
        fromNodeId: "echo",
        fromPortId: "response",
        toNodeId: "sink",
        toPortId: "response",
      },
    ],
    triggers: [{ triggerId: "startup", kind: "manual" }],
    triggerBindings: [
      {
        triggerId: "startup",
        targetNodeId: "echo",
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

  const host = await createIsomorphicFlowRuntimeHost({
    wasmSource: compiledFlow.wasmBytes,
    children: [
      {
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
      },
    ],
  });
  t.after(() => host.destroy());

  const payload = new TextEncoder().encode("separate signed child");
  host.enqueueTriggerFrame(0, { portId: "request", bytes: payload });
  const sinkFrames = [];
  await host.drain({
    handlers: {
      "test.host.sink:collect": ({ frames }) => {
        sinkFrames.push(...frames);
        return { statusCode: 0 };
      },
    },
  });

  assert.equal(host.children.get(manifest.pluginId).sha256, childSha256);
  assert.deepEqual(childHostcalls, [{ operation: "test.observe", params: null }]);
  assert.equal(sinkFrames.length, 1);
  assert.deepEqual(sinkFrames[0].bytes, payload);
});
