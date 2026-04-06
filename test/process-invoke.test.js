import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildWasmEdgeSpawnEnv,
  createPluginInvokeProcessClient,
  createWasmEdgeStreamProcessClient,
  resolveWasmEdgePluginLaunchPlan,
} from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_SERVER_PATH = path.resolve(
  __dirname,
  "..",
  "fixtures",
  "process-invoke",
  "echo-plugin-server.mjs",
);
const SDK_INDEX_URL = pathToFileURL(
  path.resolve(__dirname, "..", "src", "index.js"),
).href;
const DYNAMIC_HOST_SERVER_SCRIPT = String.raw`
import { Buffer } from "node:buffer";
import process from "node:process";
import {
  createRuntimeHost,
  decodePluginInvokeRequest,
  encodePluginInvokeResponse,
} from "${SDK_INDEX_URL}";

const MAGIC = Buffer.from([0x4f, 0x52, 0x50, 0x57]);
const OPCODES = {
  install: 16,
  list: 17,
  unload: 18,
  invoke: 19,
  appendRow: 20,
  listRows: 21,
  resolveRow: 22,
  allocateRegion: 23,
  describeRegion: 24,
  resolveRecord: 25,
};

const host = createRuntimeHost();
let stdinBuffer = Buffer.alloc(0);

function decodeJson(bytes) {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function writeResponse(bytes) {
  const payload = Buffer.from(bytes);
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([prefix, payload]));
}

function decodeInvokePayload(bytes) {
  const payload = Buffer.from(bytes);
  const moduleIdLength = payload.readUInt32LE(0);
  const moduleIdStart = 4;
  const moduleIdEnd = moduleIdStart + moduleIdLength;
  return {
    moduleId: payload.subarray(moduleIdStart, moduleIdEnd).toString("utf8"),
    requestBytes: new Uint8Array(payload.subarray(moduleIdEnd)),
  };
}

function serializeRecord(record) {
  return record
    ? {
        ...record,
        bytes: Array.from(record.bytes ?? []),
      }
    : null;
}

function installModule(definition) {
  return host.moduleRegistry.installModule({
    moduleId: definition.moduleId,
    metadata: { prefix: definition.prefix ?? definition.moduleId + ":" },
    methods: {
      echo(request) {
        return encodePluginInvokeResponse({
          statusCode: 0,
          outputs: [
            {
              portId: "result",
              payload: new TextEncoder().encode(
                this.metadata.prefix +
                  new TextDecoder().decode(request.inputs?.[0]?.payload ?? new Uint8Array()),
              ),
            },
          ],
        });
      },
    },
  });
}

async function handleHostControl(opcode, payloadBytes) {
  switch (opcode) {
    case OPCODES.install:
      return encodeJson(installModule(decodeJson(payloadBytes)));
    case OPCODES.list:
      return encodeJson(host.moduleRegistry.listModules());
    case OPCODES.unload:
      return encodeJson(host.moduleRegistry.unloadModule(decodeJson(payloadBytes).moduleId));
    case OPCODES.invoke: {
      const { moduleId, requestBytes } = decodeInvokePayload(payloadBytes);
      const request = decodePluginInvokeRequest(requestBytes);
      return host.moduleRegistry.invokeModule(moduleId, request.methodId, request);
    }
    case OPCODES.appendRow:
      return encodeJson(host.rows.appendRow(decodeJson(payloadBytes)));
    case OPCODES.listRows: {
      const request = decodeJson(payloadBytes);
      return encodeJson(host.rows.listRows(request.schemaFileId ?? null));
    }
    case OPCODES.resolveRow:
      return encodeJson(host.rows.resolveRow(decodeJson(payloadBytes)));
    case OPCODES.allocateRegion: {
      const request = decodeJson(payloadBytes);
      return encodeJson(
        host.regions.allocateRegion({
          ...request,
          initialRecords: (request.initialRecords ?? []).map((record) =>
            record === null ? null : Uint8Array.from(record),
          ),
        }),
      );
    }
    case OPCODES.describeRegion:
      return encodeJson(host.regions.describeRegion(decodeJson(payloadBytes).regionId));
    case OPCODES.resolveRecord:
      return encodeJson(serializeRecord(host.regions.resolveRecord(decodeJson(payloadBytes))));
    default:
      throw new Error("unsupported opcode " + opcode);
  }
}

async function drain() {
  while (stdinBuffer.length >= 4) {
    const requestLength = stdinBuffer.readUInt32LE(0);
    if (stdinBuffer.length < 4 + requestLength) {
      return;
    }
    const requestBytes = stdinBuffer.subarray(4, 4 + requestLength);
    stdinBuffer = stdinBuffer.subarray(4 + requestLength);

    if (
      requestBytes.length >= 5 &&
      Buffer.compare(requestBytes.subarray(0, 4), MAGIC) === 0
    ) {
      writeResponse(await handleHostControl(requestBytes[4], requestBytes.subarray(5)));
      continue;
    }
    throw new Error("legacy invoke is not supported in runtime-host mode");
  }
}

process.stdin.on("data", (chunk) => {
  stdinBuffer = Buffer.concat([stdinBuffer, Buffer.from(chunk)]);
  drain().catch((error) => {
    console.error(error);
    process.exit(1);
  });
});
`;

test("createPluginInvokeProcessClient exchanges length-prefixed invoke envelopes over stdio", async () => {
  const client = await createPluginInvokeProcessClient({
    command: process.execPath,
    args: [FIXTURE_SERVER_PATH],
  });

  try {
    const response = await client.invoke({
      methodId: "echo",
      inputs: [
        {
          portId: "request",
          payload: new TextEncoder().encode("hello harness"),
        },
      ],
    });

    assert.equal(response.statusCode, 0);
    assert.equal(response.errorCode, null);
    assert.equal(response.outputs.length, 1);
    assert.equal(response.outputs[0].portId, "result");
    assert.equal(
      new TextDecoder().decode(response.outputs[0].payload),
      "echo:hello harness",
    );
  } finally {
    await client.destroy();
  }
});

test("resolveWasmEdgePluginLaunchPlan uses the bare WasmEdge CLI by default", () => {
  const plan = resolveWasmEdgePluginLaunchPlan({
    wasmPath: "/tmp/plugin.wasm",
  });

  assert.equal(plan.command, "wasmedge");
  assert.equal(plan.wasmPath, path.resolve("/tmp/plugin.wasm"));
  assert.deepEqual(plan.args, [
    "--enable-threads",
    path.resolve("/tmp/plugin.wasm"),
    "--serve-plugin-invoke",
  ]);
});

test("resolveWasmEdgePluginLaunchPlan uses an explicit host runner when provided", () => {
  const plan = resolveWasmEdgePluginLaunchPlan({
    wasmPath: "/tmp/plugin.wasm",
    wasmEdgeRunnerBinary: "/tmp/wasmedge-runner",
  });

  assert.equal(plan.command, "/tmp/wasmedge-runner");
  assert.deepEqual(plan.args, [
    path.resolve("/tmp/plugin.wasm"),
    "--serve-plugin-invoke",
  ]);
});

test("buildWasmEdgeSpawnEnv removes stale dynamic loader overrides", () => {
  const env = buildWasmEdgeSpawnEnv({
    PATH: process.env.PATH,
    LIBRARY_PATH: "/tmp/wasmedge/lib",
    DYLD_LIBRARY_PATH: "/tmp/wasmedge/lib",
    DYLD_FALLBACK_LIBRARY_PATH: "/tmp/wasmedge/lib",
    DYLD_FRAMEWORK_PATH: "/tmp/wasmedge/lib",
    DYLD_FALLBACK_FRAMEWORK_PATH: "/tmp/wasmedge/lib",
    WASMEDGE_LIB_DIR: "/tmp/wasmedge/lib",
  });

  assert.equal(env.PATH, process.env.PATH);
  assert.equal(env.WASMEDGE_LIB_DIR, "/tmp/wasmedge/lib");
  assert.equal("LIBRARY_PATH" in env, false);
  assert.equal("DYLD_LIBRARY_PATH" in env, false);
  assert.equal("DYLD_FALLBACK_LIBRARY_PATH" in env, false);
  assert.equal("DYLD_FRAMEWORK_PATH" in env, false);
  assert.equal("DYLD_FALLBACK_FRAMEWORK_PATH" in env, false);
});

test("createPluginInvokeProcessClient exposes runtime-host module and storage controls when the child process supports them", async () => {
  const client = await createPluginInvokeProcessClient({
    command: process.execPath,
    args: ["--input-type=module", "--eval", DYNAMIC_HOST_SERVER_SCRIPT],
  });

  try {
    await client.installModule({ moduleId: "alpha", prefix: "alpha:" });
    await client.installModule({ moduleId: "beta", prefix: "beta:" });
    assert.deepEqual(
      (await client.listModules()).map((moduleRecord) => moduleRecord.moduleId),
      ["alpha", "beta"],
    );

    const response = await client.invokeModule("beta", {
      methodId: "echo",
      inputs: [
        {
          portId: "request",
          payload: new TextEncoder().encode("through client"),
        },
      ],
    });
    assert.equal(
      new TextDecoder().decode(response.outputs[0].payload),
      "beta:through client",
    );

    const rowHandle = await client.appendRow({
      schemaFileId: "SATL",
      payload: { noradId: 5 },
    });
    assert.deepEqual(await client.listRows("SATL"), [
      {
        handle: rowHandle,
        payload: { noradId: 5 },
      },
    ]);

    const region = await client.allocateRegion({
      layoutId: "state-vector",
      recordByteLength: 4,
      initialRecords: [Uint8Array.from([9, 8, 7, 6])],
    });
    assert.deepEqual(await client.resolveRecord({ regionId: region.regionId, recordIndex: 0 }), {
      regionId: region.regionId,
      recordIndex: 0,
      layoutId: "state-vector",
      recordByteLength: 4,
      alignment: 1,
      byteLength: 4,
      bytes: Uint8Array.from([9, 8, 7, 6]),
    });

    assert.equal(await client.unloadModule("alpha"), true);
    assert.deepEqual(
      (await client.listModules()).map((moduleRecord) => moduleRecord.moduleId),
      ["beta"],
    );
  } finally {
    await client.destroy();
  }
});

test("createWasmEdgeStreamProcessClient uses canonical plugin invoke envelopes", async () => {
  const client = await createWasmEdgeStreamProcessClient({
    launchPlan: {
      command: process.execPath,
      args: [FIXTURE_SERVER_PATH],
      env: process.env,
      cwd: process.cwd(),
    },
  });

  try {
    const response = await client.invoke({
      methodId: "echo",
      inputs: [
        {
          portId: "request",
          payload: new TextEncoder().encode("hello wasmedge client"),
        },
      ],
    });

    assert.equal(response.statusCode, 0);
    assert.equal(
      new TextDecoder().decode(response.outputs[0].payload),
      "echo:hello wasmedge client",
    );
  } finally {
    await client.destroy();
  }
});

test("resolveWasmEdgePluginLaunchPlan can start the standalone runtime-host runner without a preloaded module", () => {
  const plan = resolveWasmEdgePluginLaunchPlan({
    hostProfile: "runtime-host",
    wasmEdgeRunnerBinary: "/tmp/wasmedge-runner",
  });

  assert.equal(plan.command, "/tmp/wasmedge-runner");
  assert.deepEqual(plan.args, ["--serve-runtime-host"]);
});
