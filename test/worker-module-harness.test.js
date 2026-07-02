import test from "node:test";
import assert from "node:assert/strict";

import { cleanupCompilation, compileModuleFromSource } from "../src/index.js";
import { createWorkerModuleHarness } from "../src/testing/workerModuleHarness.js";
import { decodeHostcallValueEnvelope } from "../src/host/hostcallWire.js";

// WS6.1 — async in-WASM host bridge. The guest makes SYNCHRONOUS
// space_data_module_host.call invocations of operations whose host
// implementations are async (timers/http/binary echo). Under the worker
// harness the guest thread blocks on the SAB channel (Atomics.wait) while the
// controlling thread awaits the host op — exactly what the main-thread sync
// bridge cannot do (it throws "not available in the synchronous hostcall
// ABI" / "returned a Promise").
const GUEST_SOURCE = `
#include <string.h>

__attribute__((import_module("space_data_module_host"), import_name("call")))
extern int space_data_module_host_call(const char *operation_ptr, int operation_len, const char *payload_ptr, int payload_len);

__attribute__((import_module("space_data_module_host"), import_name("response_len")))
extern int space_data_module_host_response_len(void);

__attribute__((import_module("space_data_module_host"), import_name("read_response")))
extern int space_data_module_host_read_response(char *dst_ptr, int dst_len);

static const char OP_TIMER[] = "timers.delay";
static const char OP_HTTP[] = "http.request";
static const char OP_ECHO[] = "echo.bytes";
static const char OP_UNSUPPORTED[] = "storage.write";
static const char TIMER_JSON[] = "{\\"ms\\":3}";
static const char HTTP_JSON[] = "{\\"url\\":\\"https://sdn.test/listing\\",\\"method\\":\\"GET\\"}";
static const char EMPTY_JSON[] = "{}";

static char request_buffer[512];
static char response_buffer[65536];
static int response_length = 0;

static void write_u32_le(char *dst, unsigned int value) {
  dst[0] = (char)(value & 0xffu);
  dst[1] = (char)((value >> 8) & 0xffu);
  dst[2] = (char)((value >> 16) & 0xffu);
  dst[3] = (char)((value >> 24) & 0xffu);
}

/* Binary hostcall envelope: [u32 metaLen][meta JSON][u32 segmentCount = 0]. */
static int build_request_envelope(const char *meta_json, int meta_len) {
  write_u32_le(request_buffer, (unsigned int)meta_len);
  memcpy(request_buffer + 4, meta_json, (unsigned int)meta_len);
  write_u32_le(request_buffer + 4 + meta_len, 0u);
  return 4 + meta_len + 4;
}

static int copy_last_response(void) {
  int len = space_data_module_host_response_len();
  if (len < 0) return len;
  if (len > (int)sizeof(response_buffer)) len = (int)sizeof(response_buffer);
  int copied = space_data_module_host_read_response(response_buffer, len);
  if (copied < 0) return copied;
  response_length = copied;
  return copied;
}

static int call_with_meta(const char *operation, int operation_len, const char *meta_json, int meta_len) {
  const int envelope_len = build_request_envelope(meta_json, meta_len);
  int status = space_data_module_host_call(operation, operation_len, request_buffer, envelope_len);
  copy_last_response();
  return status;
}

int guest_call_timer_delay(void) {
  return call_with_meta(OP_TIMER, (int)(sizeof(OP_TIMER) - 1), TIMER_JSON, (int)(sizeof(TIMER_JSON) - 1));
}

int guest_call_http(void) {
  return call_with_meta(OP_HTTP, (int)(sizeof(OP_HTTP) - 1), HTTP_JSON, (int)(sizeof(HTTP_JSON) - 1));
}

int guest_call_echo_bytes(void) {
  return call_with_meta(OP_ECHO, (int)(sizeof(OP_ECHO) - 1), EMPTY_JSON, (int)(sizeof(EMPTY_JSON) - 1));
}

int guest_call_unsupported(void) {
  return call_with_meta(OP_UNSUPPORTED, (int)(sizeof(OP_UNSUPPORTED) - 1), EMPTY_JSON, (int)(sizeof(EMPTY_JSON) - 1));
}

int guest_response_ptr(void) {
  return (int)response_buffer;
}

int guest_response_len(void) {
  return response_length;
}
`;

function createMethod(methodId) {
  return {
    methodId,
    displayName: methodId,
    inputPorts: [
      {
        portId: "request",
        acceptedTypeSets: [
          { setId: "any-input", allowedTypes: [{ acceptsAnyFlatbuffer: true }] },
        ],
        minStreams: 1,
        maxStreams: 1,
        required: true,
      },
    ],
    outputPorts: [
      {
        portId: "response",
        acceptedTypeSets: [
          { setId: "any-output", allowedTypes: [{ acceptsAnyFlatbuffer: true }] },
        ],
        minStreams: 0,
        maxStreams: 1,
        required: false,
      },
    ],
    maxBatch: 1,
    drainPolicy: "single-shot",
  };
}

function createGuestManifest() {
  return {
    pluginId: "com.digitalarsenal.examples.worker-hostcall-abi",
    name: "Async Hostcall Guest",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: ["timers", "http"],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    methods: [
      createMethod("guest_call_timer_delay"),
      createMethod("guest_call_http"),
      createMethod("guest_call_echo_bytes"),
      createMethod("guest_call_unsupported"),
      createMethod("guest_response_ptr"),
      createMethod("guest_response_len"),
    ],
  };
}

async function readGuestEnvelope(harness) {
  const ptr = await harness.callExport("guest_response_ptr");
  const len = await harness.callExport("guest_response_len");
  const bytes = await harness.readMemory(ptr, len);
  return decodeHostcallValueEnvelope(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  );
}

test(
  "worker harness bridges blocking guest hostcalls to async host operations",
  { timeout: 300_000 },
  async (t) => {
    if (typeof SharedArrayBuffer !== "function" || typeof Atomics !== "object") {
      t.skip("SharedArrayBuffer/Atomics unavailable");
      return;
    }

    const compilation = await compileModuleFromSource({
      manifest: createGuestManifest(),
      sourceCode: GUEST_SOURCE,
      language: "c",
      allowUndefinedImports: true,
    });

    const echoBytes = Uint8Array.from([7, 13, 42, 251, 0, 99]);
    const servicedOps = [];
    // Every handler is genuinely async — resolved on the controlling thread
    // while the guest's worker thread blocks inside Atomics.wait.
    const host = {
      async invoke(operation, params) {
        servicedOps.push(operation);
        await new Promise((resolve) => setTimeout(resolve, 2));
        switch (operation) {
          case "timers.delay":
            await new Promise((resolve) => setTimeout(resolve, params?.ms ?? 0));
            return null;
          case "http.request":
            return {
              status: 209,
              url: params?.url ?? null,
              body: "async-host-body",
            };
          case "echo.bytes":
            return { bytes: echoBytes };
          default: {
            const error = new Error(`operation ${operation} not supported`);
            error.code = "unsupported-operation";
            throw error;
          }
        }
      },
    };

    const harness = await createWorkerModuleHarness({
      wasmSource: compilation.wasmBytes,
      host,
    });

    try {
      assert.equal(await harness.callExport("guest_call_timer_delay"), 0);
      const timerEnvelope = await readGuestEnvelope(harness);
      assert.equal(timerEnvelope.ok, true);

      assert.equal(await harness.callExport("guest_call_http"), 0);
      const httpEnvelope = await readGuestEnvelope(harness);
      assert.equal(httpEnvelope.ok, true);
      assert.equal(httpEnvelope.result.status, 209);
      assert.equal(httpEnvelope.result.url, "https://sdn.test/listing");
      assert.equal(httpEnvelope.result.body, "async-host-body");

      // Binary leaves cross the SAB channel as envelope segments, not JSON.
      assert.equal(await harness.callExport("guest_call_echo_bytes"), 0);
      const echoEnvelope = await readGuestEnvelope(harness);
      assert.equal(echoEnvelope.ok, true);
      assert.ok(echoEnvelope.result.bytes instanceof Uint8Array);
      assert.deepEqual([...echoEnvelope.result.bytes], [...echoBytes]);

      // Host-side rejection surfaces as the standard error envelope.
      assert.equal(await harness.callExport("guest_call_unsupported"), 1);
      const errorEnvelope = await readGuestEnvelope(harness);
      assert.equal(errorEnvelope.ok, false);
      assert.equal(errorEnvelope.error.code, "unsupported-operation");
      assert.match(errorEnvelope.error.message, /storage\.write/);

      assert.deepEqual(servicedOps, [
        "timers.delay",
        "http.request",
        "echo.bytes",
        "storage.write",
      ]);
    } finally {
      await harness.destroy();
      await cleanupCompilation(compilation);
    }
  },
);
