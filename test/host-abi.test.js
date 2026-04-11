import test from "node:test";
import assert from "node:assert/strict";
import { WASI } from "node:wasi";

import {
  cleanupCompilation,
  compileModuleFromSource,
  createAsyncHostDispatcher,
  createNodeHost,
  createNodeHostSyncDispatcher,
  createNodeHostSyncHostcallBridge,
  createRuntimeHost,
} from "../src/index.js";

const ABI_GUEST_SOURCE = `
__attribute__((import_module("sdn_host"), import_name("call_json")))
extern int sdn_host_call_json(const char *operation_ptr, int operation_len, const char *payload_ptr, int payload_len);

__attribute__((import_module("sdn_host"), import_name("response_len")))
extern int sdn_host_response_len(void);

__attribute__((import_module("sdn_host"), import_name("read_response")))
extern int sdn_host_read_response(char *dst_ptr, int dst_len);

static const char OP_CLOCK_NOW[] = "clock.now";
static const char OP_RANDOM_BYTES[] = "random.bytes";
static const char OP_SCHEDULE_MATCHES[] = "schedule.matches";
static const char OP_FILESYSTEM_RESOLVE[] = "filesystem.resolvePath";
static const char EMPTY_JSON[] = "{}";
static const char RANDOM_BYTES_JSON[] = "{\\"length\\":16}";
static const char SCHEDULE_MATCHES_JSON[] = "{\\"expression\\":\\"*/15 9-17 * * MON-FRI\\",\\"date\\":\\"2026-03-16T09:15:00\\"}";
static const char FILESYSTEM_JSON[] = "{\\"path\\":\\"demo.txt\\"}";

static char response_buffer[2048];
static int response_length = 0;

static int copy_last_response(void) {
  int len = sdn_host_response_len();
  if (len < 0) {
    return len;
  }
  if (len > (int)(sizeof(response_buffer) - 1)) {
    len = (int)(sizeof(response_buffer) - 1);
  }
  int copied = sdn_host_read_response(response_buffer, len);
  if (copied < 0) {
    return copied;
  }
  response_buffer[copied] = '\\0';
  response_length = copied;
  return copied;
}

int guest_call_clock_now(void) {
  int status = sdn_host_call_json(
    OP_CLOCK_NOW,
    (int)(sizeof(OP_CLOCK_NOW) - 1),
    EMPTY_JSON,
    (int)(sizeof(EMPTY_JSON) - 1)
  );
  copy_last_response();
  return status;
}

int guest_call_schedule_matches(void) {
  int status = sdn_host_call_json(
    OP_SCHEDULE_MATCHES,
    (int)(sizeof(OP_SCHEDULE_MATCHES) - 1),
    SCHEDULE_MATCHES_JSON,
    (int)(sizeof(SCHEDULE_MATCHES_JSON) - 1)
  );
  copy_last_response();
  return status;
}

int guest_call_random_bytes(void) {
  int status = sdn_host_call_json(
    OP_RANDOM_BYTES,
    (int)(sizeof(OP_RANDOM_BYTES) - 1),
    RANDOM_BYTES_JSON,
    (int)(sizeof(RANDOM_BYTES_JSON) - 1)
  );
  copy_last_response();
  return status;
}

int guest_call_denied_filesystem(void) {
  int status = sdn_host_call_json(
    OP_FILESYSTEM_RESOLVE,
    (int)(sizeof(OP_FILESYSTEM_RESOLVE) - 1),
    FILESYSTEM_JSON,
    (int)(sizeof(FILESYSTEM_JSON) - 1)
  );
  copy_last_response();
  return status;
}

int guest_response_ptr(void) {
  return (int)response_buffer;
}

int guest_response_len(void) {
  return response_length;
}
`;

function createAbiMethod(methodId) {
  return {
    methodId,
    displayName: methodId,
    inputPorts: [
      {
        portId: "request",
        acceptedTypeSets: [
          {
            setId: "any-input",
            allowedTypes: [{ acceptsAnyFlatbuffer: true }],
          },
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
          {
            setId: "any-output",
            allowedTypes: [{ acceptsAnyFlatbuffer: true }],
          },
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

function createAbiManifest() {
  return {
    pluginId: "com.digitalarsenal.examples.hostcall-abi",
    name: "Hostcall ABI Guest",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: ["clock", "random", "schedule_cron"],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    methods: [
      createAbiMethod("guest_call_clock_now"),
      createAbiMethod("guest_call_random_bytes"),
      createAbiMethod("guest_call_schedule_matches"),
      createAbiMethod("guest_call_denied_filesystem"),
      createAbiMethod("guest_response_ptr"),
      createAbiMethod("guest_response_len"),
    ],
  };
}

function decodeGuestResponse(instance) {
  const memory = instance.exports.memory;
  const responsePtr = instance.exports.guest_response_ptr();
  const responseLen = instance.exports.guest_response_len();
  const bytes = new Uint8Array(memory.buffer, responsePtr, responseLen);
  return JSON.parse(new TextDecoder().decode(bytes));
}

test("sync hostcall ABI bridges a wasm guest into the reference Node host", async () => {
  const host = createNodeHost({
    capabilities: ["clock", "random", "schedule_cron"],
  });

  const compilation = await compileModuleFromSource({
    manifest: createAbiManifest(),
    sourceCode: ABI_GUEST_SOURCE,
    language: "c",
    allowUndefinedImports: true,
  });

  let instanceExports = null;
  const wasi = new WASI({
    version: "preview1",
    args: ["host-abi"],
    env: {},
    preopens: {},
    returnOnExit: true,
  });
  const bridge = createNodeHostSyncHostcallBridge({
    host,
    getMemory: () => instanceExports.memory,
  });

  try {
    const { instance } = await WebAssembly.instantiate(
      compilation.wasmBytes,
      {
        ...wasi.getImportObject(),
        ...bridge.imports,
      },
    );
    instanceExports = instance.exports;

    assert.equal(instance.exports.guest_call_clock_now(), 0);
    const clockEnvelope = decodeGuestResponse(instance);
    assert.equal(clockEnvelope.ok, true);
    assert.equal(typeof clockEnvelope.result, "number");

    assert.equal(instance.exports.guest_call_random_bytes(), 0);
    const randomEnvelope = decodeGuestResponse(instance);
    assert.equal(randomEnvelope.ok, true);
    assert.equal(randomEnvelope.result.__type, "bytes");
    assert.equal(
      Buffer.from(randomEnvelope.result.base64, "base64").length,
      16,
    );

    assert.equal(instance.exports.guest_call_schedule_matches(), 0);
    const scheduleEnvelope = decodeGuestResponse(instance);
    assert.equal(scheduleEnvelope.ok, true);
    assert.equal(scheduleEnvelope.result, true);

    assert.equal(instance.exports.guest_call_denied_filesystem(), 1);
    const deniedEnvelope = decodeGuestResponse(instance);
    assert.equal(deniedEnvelope.ok, false);
    assert.equal(deniedEnvelope.error.code, "host-capability-denied");
    assert.equal(deniedEnvelope.error.capability, "filesystem");

    assert.deepEqual(
      bridge.getLastResponseJson(),
      deniedEnvelope,
    );
  } finally {
    await cleanupCompilation(compilation);
  }
});

test("sync hostcall dispatcher rejects async-only operations", () => {
  const host = createNodeHost({
    capabilities: ["timers"],
  });
  const dispatch = createNodeHostSyncDispatcher(host);

  assert.throws(
    () => dispatch("timers.delay", { ms: 1 }),
    /not available in the synchronous hostcall ABI/,
  );
});

test("async host dispatcher awaits host invoke operations", async () => {
  const host = createNodeHost({
    capabilities: ["timers", "ipfs"],
    ipfs: {
      async resolve(params) {
        return {
          path: params.path,
          cid: "bafyasyncdispatcher",
        };
      },
    },
  });
  const dispatch = createAsyncHostDispatcher(host);

  await dispatch("timers.delay", { ms: 5 });
  const response = await dispatch("ipfs.invoke", {
    operation: "resolve",
    path: "/ipns/demo",
  });

  assert.deepEqual(response, {
    path: "/ipns/demo",
    cid: "bafyasyncdispatcher",
  });
});

test("async host dispatcher routes generic runtime-host capability adapters", async () => {
  const host = createRuntimeHost({
    capabilities: {
      filesystem: {
        async readFile(params) {
          return `runtime:${params.path}`;
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
            cid: "bafyruntimecid",
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
  });
  const dispatch = createAsyncHostDispatcher(host);

  const fileText = await dispatch("filesystem.readFile", {
    path: "demo.txt",
  });
  const networkResponse = await dispatch("network.request", {
    transport: "http",
    url: "https://example.test/runtime-host",
  });
  const ipfsResponse = await dispatch("ipfs.resolve", {
    path: "/ipns/runtime-host",
  });
  const registerResponse = await dispatch("protocol_handle.register", {
    protocolId: "/space-data-network/module-delivery/1.0.0",
  });
  const dialResponse = await dispatch("protocol_dial.dial", {
    protocolId: "/space-data-network/module-delivery/1.0.0",
    peerId: "12D3KooWRuntimeHostPeer",
  });

  assert.equal(fileText, "runtime:demo.txt");
  assert.deepEqual(networkResponse, {
    transport: "http",
    url: "https://example.test/runtime-host",
  });
  assert.deepEqual(ipfsResponse, {
    path: "/ipns/runtime-host",
    cid: "bafyruntimecid",
  });
  assert.deepEqual(registerResponse, {
    registered: "/space-data-network/module-delivery/1.0.0",
  });
  assert.deepEqual(dialResponse, {
    dialed: "/space-data-network/module-delivery/1.0.0",
    peerId: "12D3KooWRuntimeHostPeer",
  });
});
