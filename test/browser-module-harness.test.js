import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanupCompilation,
  compileModuleFromSource,
} from "../src/index.js";
import {
  createBrowserModuleHarness,
  detectArtifactProfile,
  isSharedArrayBufferLike,
} from "../src/testing/browserModuleHarness.js";

const IMPORTED_SHARED_MEMORY_WASM_BYTES = new Uint8Array([
  // (module
  //   (import "env" "memory" (memory 1 1 shared))
  //   (func (export "write_sentinel")
  //     i32.const 16
  //     i32.const 0x5a17c0de
  //     i32.store)
  //   (func (export "read_sentinel") (result i32)
  //     i32.const 16
  //     i32.load))
  0, 97, 115, 109, 1, 0, 0, 0, 1, 8, 2, 96, 0, 0, 96, 0, 1, 127, 2,
  16, 1, 3, 101, 110, 118, 6, 109, 101, 109, 111, 114, 121, 2, 3, 1,
  1, 3, 3, 2, 0, 1, 7, 34, 2, 14, 119, 114, 105, 116, 101, 95, 115,
  101, 110, 116, 105, 110, 101, 108, 0, 0, 13, 114, 101, 97, 100, 95,
  115, 101, 110, 116, 105, 110, 101, 108, 0, 1, 10, 23, 2, 13, 0, 65,
  16, 65, 222, 129, 223, 208, 5, 54, 2, 0, 11, 7, 0, 65, 16, 40, 2,
  0, 11,
]);

const IMPORTED_SHARED_MEMORY_WITH_RUNTIME_STUBS_WASM_BYTES = new Uint8Array([
  // (module
  //   (import "env" "memory" (memory 1 1 shared))
  //   (import "env" "pthread_mutex_lock" (func (param i32) (result i32)))
  //   (import "env" "pthread_mutex_unlock" (func (param i32) (result i32)))
  //   (import "env" "pthread_cond_broadcast" (func (param i32) (result i32)))
  //   (import "env" "pthread_cond_wait" (func (param i32 i32) (result i32)))
  //   (import "env" "emscripten_thread_sleep" (func (param i32)))
  //   (import "env" "__do_set_thread_state" (func (param i32)))
  //   (func (export "call_shared_memory_runtime_imports") (result i32)
  //     i32.const 0
  //     call 0
  //     drop
  //     i32.const 0
  //     call 1
  //     drop
  //     i32.const 0
  //     call 2
  //     i32.const 0
  //     call 3
  //     drop
  //     i32.const 0
  //     call 4
  //     i32.const 0
  //     call 5
  //     i32.const 7))
  0, 97, 115, 109, 1, 0, 0, 0, 1, 20, 4, 96, 1, 127, 1, 127, 96,
  2, 127, 127, 1, 127, 96, 1, 127, 0, 96, 0, 1, 127, 2, 179, 1,
  7, 3, 101, 110, 118, 6, 109, 101, 109, 111, 114, 121, 2, 3, 1, 1,
  3, 101, 110, 118, 18, 112, 116, 104, 114, 101, 97, 100, 95, 109, 117,
  116, 101, 120, 95, 108, 111, 99, 107, 0, 0, 3, 101, 110, 118, 20,
  112, 116, 104, 114, 101, 97, 100, 95, 109, 117, 116, 101, 120, 95,
  117, 110, 108, 111, 99, 107, 0, 0, 3, 101, 110, 118, 22, 112, 116,
  104, 114, 101, 97, 100, 95, 99, 111, 110, 100, 95, 98, 114, 111, 97,
  100, 99, 97, 115, 116, 0, 0, 3, 101, 110, 118, 17, 112, 116, 104,
  114, 101, 97, 100, 95, 99, 111, 110, 100, 95, 119, 97, 105, 116, 0,
  1, 3, 101, 110, 118, 23, 101, 109, 115, 99, 114, 105, 112, 116, 101,
  110, 95, 116, 104, 114, 101, 97, 100, 95, 115, 108, 101, 101, 112, 0,
  2, 3, 101, 110, 118, 21, 95, 95, 100, 111, 95, 115, 101, 116, 95,
  116, 104, 114, 101, 97, 100, 95, 115, 116, 97, 116, 101, 0, 2, 3,
  2, 1, 3, 7, 38, 1, 34, 99, 97, 108, 108, 95, 115, 104, 97, 114,
  101, 100, 95, 109, 101, 109, 111, 114, 121, 95, 114, 117, 110, 116,
  105, 109, 101, 95, 105, 109, 112, 111, 114, 116, 115, 0, 6, 10, 36,
  1, 34, 0, 65, 0, 16, 0, 26, 65, 0, 16, 1, 26, 65, 0, 16,
  2, 26, 65, 0, 65, 0, 16, 3, 26, 65, 0, 16, 4, 65, 0, 16,
  5, 65, 7, 11,
]);

function createSharedMemoryOrSkip(t) {
  if (typeof SharedArrayBuffer !== "function") {
    t.skip("SharedArrayBuffer is not available in this runtime.");
    return null;
  }
  try {
    return new WebAssembly.Memory({
      initial: 1,
      maximum: 1,
      shared: true,
    });
  } catch {
    t.skip("Shared WebAssembly.Memory is not available in this runtime.");
    return null;
  }
}

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

function createManifest({ invokeSurfaces = ["command"] } = {}) {
  return {
    pluginId: "com.digitalarsenal.examples.browser-module-harness",
    name: "Browser Module Harness Host Access Test",
    version: "0.1.0",
    pluginFamily: "analysis",
    runtimeTargets: ["browser", "wasmedge"],
    invokeSurfaces,
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

test("browser module harness accepts shared buffers by intrinsic tag", () => {
  const taggedSharedBuffer = {
    get [Symbol.toStringTag]() {
      return "SharedArrayBuffer";
    },
  };

  assert.equal(
    Object.prototype.toString.call(taggedSharedBuffer),
    "[object SharedArrayBuffer]",
  );
  assert.equal(isSharedArrayBufferLike(taggedSharedBuffer), true);
  assert.equal(isSharedArrayBufferLike(new ArrayBuffer(1)), false);
});

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

function createEnvMemoryImportModuleBytes() {
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f,
    0x02, 0x10, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x06, 0x6d, 0x65, 0x6d,
    0x6f, 0x72, 0x79, 0x02, 0x03, 0x01, 0x01,
    0x03, 0x02, 0x01, 0x00,
    0x07, 0x12, 0x01, 0x0e, 0x72, 0x65, 0x61, 0x64, 0x5f, 0x66, 0x69,
    0x72, 0x73, 0x74, 0x5f, 0x69, 0x33, 0x32, 0x00, 0x00,
    0x0a, 0x09, 0x01, 0x07, 0x00, 0x41, 0x00, 0x28, 0x02, 0x00, 0x0b,
  ]);
}

function createExportedMemoryModuleBytes() {
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x05, 0x03, 0x01, 0x00, 0x01,
    0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02,
    0x00,
  ]);
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
      capabilityAdapters: {
        filesystem: {
          resolvePath(path) {
            return `/virtual/${path}`;
          },
          async mkdir(path) {
            return {
              path: `/virtual/${path}`,
            };
          },
          async writeFile(path, value, options) {
            return {
              path: `/virtual/${path}`,
              value,
              encoding: options?.encoding ?? null,
            };
          },
          async readFile(path, options) {
            return `harness:${path}:${options?.encoding ?? "bytes"}`;
          },
        },
        network: {
          async request(params) {
            return {
              transport: params.transport,
              url: params.url,
            };
          },
        },
        ipfs: {
          async resolve(params) {
            return {
              path: params.path,
              cid: "bafyharnesscid",
            };
          },
        },
        protocol_handle: {
          async register(params) {
            return {
              registered: params.protocolId,
            };
          },
        },
        protocol_dial: {
          async dial(params) {
            return {
              dialed: params.protocolId,
              peerId: params.peerId,
            };
          },
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
  const mkdirResponse = await harness.callHost("filesystem.mkdir", {
    path: "cache",
    recursive: true,
  });
  const writeResponse = await harness.callHost("filesystem.writeFile", {
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
  assert.deepEqual(mkdirResponse, {
    path: "/virtual/cache",
  });
  assert.deepEqual(writeResponse, {
    path: "/virtual/cache/host.txt",
    value: "from host dispatch",
    encoding: "utf8",
  });
  assert.equal(filesystemResponse, "harness:cache/host.txt:utf8");
  assert.deepEqual(networkResponse, {
    transport: "http",
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

test("browser module harness direct invoke passes SharedArrayBuffer external arenas through allocated guest memory", async (t) => {
  if (typeof SharedArrayBuffer !== "function") {
    t.skip("SharedArrayBuffer is not available in this runtime.");
    return;
  }
  const compilation = await compileModuleFromSource({
    manifest: createManifest({ invokeSurfaces: ["direct"] }),
    sourceCode: createEchoSource(),
    language: "c",
  });
  t.after(async () => {
    await cleanupCompilation(compilation);
  });

  const harness = await createBrowserModuleHarness({
    wasmSource: compilation.wasmBytes,
    surface: "direct",
  });
  t.after(() => {
    harness.destroy();
  });

  const externalArena = new Uint8Array(new SharedArrayBuffer(64));
  externalArena.set(new TextEncoder().encode("hello from external arena"), 16);

  const invokeResponse = await harness.invoke({
    methodId: "echo",
    externalArena,
    inputs: [
      {
        portId: "request",
        offset: 16,
        size: "hello from external arena".length,
        alignment: 8,
        typeRef: {
          schemaName: "Blob.fbs",
          fileIdentifier: "BLOB",
        },
      },
    ],
  });

  assert.equal(invokeResponse.statusCode, 0);
  assert.equal(
    new TextDecoder().decode(invokeResponse.outputs[0].payload),
    "hello from external arena",
  );
});

test("browser module harness passes explicit shared imported memory to the module", async (t) => {
  const memory = createSharedMemoryOrSkip(t);
  if (!memory) return;

  const harness = await createBrowserModuleHarness({
    wasmSource: IMPORTED_SHARED_MEMORY_WASM_BYTES,
    memory,
  });
  t.after(() => {
    harness.destroy();
  });

  const view = new DataView(memory.buffer);
  view.setUint32(16, 0, true);

  harness.instance.exports.write_sentinel();

  assert.equal(harness.wasi.getMemory(), memory);
  assert.equal(memory.buffer instanceof SharedArrayBuffer, true);
  assert.equal(view.getUint32(16, true), 0x5a17c0de);

  view.setUint32(16, 0x13579bdf, true);
  assert.equal(harness.instance.exports.read_sentinel(), 0x13579bdf);
});

test("browser module harness accepts shared imported memory for standalone modules", async (t) => {
  if (typeof SharedArrayBuffer !== "function") {
    t.skip("SharedArrayBuffer is not available in this runtime.");
    return;
  }
  const wasmSource = createEnvMemoryImportModuleBytes();
  const wasmModule = new WebAssembly.Module(wasmSource);
  const memory = new WebAssembly.Memory({
    initial: 1,
    maximum: 1,
    shared: true,
  });
  new DataView(memory.buffer).setInt32(0, 0x12345678, true);

  assert.equal(detectArtifactProfile(wasmModule), "standalone");

  const harness = await createBrowserModuleHarness({
    wasmSource,
    memory,
  });
  t.after(() => {
    harness.destroy();
  });

  assert.equal(harness.memory, memory);
  assert.equal(harness.instance.exports.read_first_i32(), 0x12345678);
});

test("browser module harness fails early when shared memory is requested but the module exports non-shared memory", async () => {
  await assert.rejects(
    createBrowserModuleHarness({
      wasmSource: createExportedMemoryModuleBytes(),
      sharedMemory: true,
    }),
    /shared WebAssembly\.Memory/i,
  );
});

test("browser module harness accepts wasmMemory as the imported memory option", async (t) => {
  const wasmMemory = createSharedMemoryOrSkip(t);
  if (!wasmMemory) return;

  const harness = await createBrowserModuleHarness({
    wasmSource: IMPORTED_SHARED_MEMORY_WASM_BYTES,
    wasmMemory,
  });
  t.after(() => {
    harness.destroy();
  });

  const view = new DataView(wasmMemory.buffer);
  view.setUint32(16, 0, true);

  harness.instance.exports.write_sentinel();

  assert.equal(harness.memory, wasmMemory);
  assert.equal(harness.wasi.getMemory(), wasmMemory);
  assert.equal(view.getUint32(16, true), 0x5a17c0de);
});

test("browser module harness creates shared imported memory from memory sizing options", async (t) => {
  if (typeof SharedArrayBuffer !== "function") {
    t.skip("SharedArrayBuffer is not available in this runtime.");
    return;
  }

  const harness = await createBrowserModuleHarness({
    wasmSource: IMPORTED_SHARED_MEMORY_WASM_BYTES,
    sharedMemory: true,
    initialMemoryBytes: 65536,
    maximumMemoryBytes: 65536,
  });
  t.after(() => {
    harness.destroy();
  });

  harness.instance.exports.write_sentinel();

  assert.ok(harness.memory instanceof WebAssembly.Memory);
  assert.equal(harness.memory.buffer instanceof SharedArrayBuffer, true);
  assert.equal(harness.memory.buffer.byteLength, 65536);
  assert.equal(harness.wasi.getMemory(), harness.memory);
  assert.equal(
    new DataView(harness.memory.buffer).getUint32(16, true),
    0x5a17c0de,
  );
});

test("browser module harness stubs Emscripten shared-memory runtime imports", async (t) => {
  if (typeof SharedArrayBuffer !== "function") {
    t.skip("SharedArrayBuffer is not available in this runtime.");
    return;
  }

  const harness = await createBrowserModuleHarness({
    wasmSource: IMPORTED_SHARED_MEMORY_WITH_RUNTIME_STUBS_WASM_BYTES,
    sharedMemory: true,
    initialMemoryBytes: 65536,
    maximumMemoryBytes: 65536,
  });
  t.after(() => {
    harness.destroy();
  });

  assert.equal(harness.runtime.profile, "standalone");
  assert.equal(harness.memory.buffer instanceof SharedArrayBuffer, true);
  assert.equal(
    harness.instance.exports.call_shared_memory_runtime_imports(),
    7,
  );
});
