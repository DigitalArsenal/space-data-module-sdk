import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupCompilation,
  compileModuleFromSource,
} from "../src/index.js";
import { createBrowserModuleHarness } from "../src/testing/browserModuleHarness.js";

function createPort(portId, required = true) {
  return {
    portId,
    acceptedTypeSets: [
      {
        setId: `${portId}-any`,
        allowedTypes: [{ acceptsAnyFlatbuffer: true }],
      },
    ],
    minStreams: required ? 1 : 0,
    maxStreams: 1,
    required,
  };
}

function createManifest() {
  return {
    pluginId: "com.digitalarsenal.examples.browser-module-harness",
    name: "Browser Module Harness Host Access Test",
    version: "0.1.0",
    pluginFamily: "analysis",
    runtimeTargets: ["browser", "wasmedge"],
    invokeSurfaces: ["command"],
    methods: [
      {
        methodId: "echo",
        displayName: "echo",
        inputPorts: [createPort("request", true)],
        outputPorts: [createPort("response", false)],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
}

function createEchoSource() {
  return `#include <stdint.h>
#include "space_data_module_invoke.h"

int echo(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "No input frame was provided.");
    return 3;
  }
  plugin_push_output(
    "response",
    frame->schema_name,
    frame->file_identifier,
    frame->payload,
    frame->payload_length
  );
  return 0;
}
`;
}

test("browser module harness exposes awaited host dispatch alongside module invoke", async (t) => {
  const compilation = await compileModuleFromSource({
    manifest: createManifest(),
    sourceCode: createEchoSource(),
    language: "c",
  });
  t.after(async () => {
    await cleanupCompilation(compilation);
  });

  const harness = await createBrowserModuleHarness({
    wasmSource: compilation.wasmBytes,
    hostOptions: {
      capabilities: [
        "filesystem",
        "network",
        "ipfs",
        "protocol_handle",
        "protocol_dial",
      ],
      fetch: async (url) =>
        new Response(
          JSON.stringify({
            url,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          },
        ),
      ipfs: {
        async resolve(params) {
          return {
            path: params.path,
            cid: "bafyharnesscid",
          };
        },
      },
      protocolHandle: {
        async register(params) {
          return {
            registered: params.protocolId,
          };
        },
      },
      protocolDial: {
        async dial(params) {
          return {
            dialed: params.protocolId,
            peerId: params.peerId,
          };
        },
      },
    },
  });
  t.after(() => {
    harness.destroy();
  });

  const invokeResponse = await harness.invoke({
    methodId: "echo",
    inputs: [
      {
        portId: "request",
        typeRef: {
          schemaName: "Blob.fbs",
          fileIdentifier: "BLOB",
        },
        payload: new TextEncoder().encode("hello from harness"),
      },
    ],
  });
  await harness.callHost("filesystem.mkdir", {
    path: "cache",
    recursive: true,
  });
  await harness.callHost("filesystem.writeFile", {
    path: "cache/host.txt",
    value: "from host dispatch",
    encoding: "utf8",
  });
  const filesystemResponse = await harness.callHost("filesystem.readFile", {
    path: "cache/host.txt",
    encoding: "utf8",
  });
  const networkResponse = await harness.callHost("network.request", {
    transport: "http",
    url: "https://example.test/harness",
    responseType: "json",
  });
  const ipfsResponse = await harness.callHost("ipfs.invoke", {
    operation: "resolve",
    path: "/ipns/harness-demo",
  });
  const registerResponse = await harness.callHost("protocol_handle.register", {
    protocolId: "/space-data-network/module-delivery/1.0.0",
  });
  const dialResponse = await harness.callHost("protocol_dial.dial", {
    protocolId: "/space-data-network/module-delivery/1.0.0",
    peerId: "12D3KooWHarnessPeer",
  });

  assert.equal(invokeResponse.statusCode, 0);
  assert.equal(
    new TextDecoder().decode(invokeResponse.outputs[0].payload),
    "hello from harness",
  );
  assert.equal(filesystemResponse, "from host dispatch");
  assert.deepEqual(networkResponse.body, {
    url: "https://example.test/harness",
  });
  assert.deepEqual(ipfsResponse, {
    path: "/ipns/harness-demo",
    cid: "bafyharnesscid",
  });
  assert.deepEqual(registerResponse, {
    registered: "/space-data-network/module-delivery/1.0.0",
  });
  assert.deepEqual(dialResponse, {
    dialed: "/space-data-network/module-delivery/1.0.0",
    peerId: "12D3KooWHarnessPeer",
  });
});
