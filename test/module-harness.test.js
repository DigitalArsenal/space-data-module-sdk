import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createModuleHarness,
  resolveModuleHarnessLaunchPlan,
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
const inbox = { buffer: Buffer.alloc(0) };

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

function decodeJson(bytes) {
  return JSON.parse(Buffer.from(bytes).toString("utf8"));
}

function encodeLengthPrefixed(bytes) {
  const payload = Buffer.from(bytes);
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32LE(payload.length, 0);
  return Buffer.concat([prefix, payload]);
}

function encodeRecord(record) {
  if (!record) {
    return encodeJson(null);
  }
  return encodeJson({
    ...record,
    bytes: Array.from(record.bytes ?? []),
  });
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

host.moduleRegistry.installModule({
  moduleId: "__bootstrap__",
  metadata: { bootstrap: true },
  methods: {
    echo(request) {
      return encodePluginInvokeResponse({
        statusCode: 0,
        outputs: [
          {
            portId: "result",
            payload: new TextEncoder().encode(
              "bootstrap:" +
                new TextDecoder().decode(request.inputs?.[0]?.payload ?? new Uint8Array()),
            ),
          },
        ],
      });
    },
  },
});
host.moduleRegistry.unloadModule("__bootstrap__");

function installDynamicModule(definition) {
  return host.moduleRegistry.installModule({
    moduleId: definition.moduleId,
    metadata: { ...definition.metadata, prefix: definition.prefix ?? definition.moduleId + ":" },
    methods: {
      echo(request) {
        const payload = request.inputs?.[0]?.payload ?? new Uint8Array();
        const prefix = this.metadata?.prefix ?? "";
        return encodePluginInvokeResponse({
          statusCode: 0,
          outputs: [
            {
              portId: "result",
              payload: new TextEncoder().encode(prefix + new TextDecoder().decode(payload)),
            },
          ],
        });
      },
    },
  });
}

function dispatchHostControl(opcode, payloadBytes) {
  switch (opcode) {
    case OPCODES.install:
      return encodeJson(installDynamicModule(decodeJson(payloadBytes)));
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
      const { schemaFileId = null } = decodeJson(payloadBytes);
      return encodeJson(host.rows.listRows(schemaFileId));
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
      return encodeRecord(host.regions.resolveRecord(decodeJson(payloadBytes)));
    default:
      throw new Error("Unsupported opcode " + opcode);
  }
}

async function drainRequests() {
  while (inbox.buffer.length >= 4) {
    const requestLength = inbox.buffer.readUInt32LE(0);
    if (inbox.buffer.length < 4 + requestLength) {
      return;
    }
    const requestBytes = inbox.buffer.subarray(4, 4 + requestLength);
    inbox.buffer = inbox.buffer.subarray(4 + requestLength);

    let responseBytes;
    if (
      requestBytes.length >= 5 &&
      Buffer.compare(requestBytes.subarray(0, 4), MAGIC) === 0
    ) {
      responseBytes = await dispatchHostControl(
        requestBytes[4],
        new Uint8Array(requestBytes.subarray(5)),
      );
    } else {
      throw new Error("legacy invoke is not supported in runtime-host mode");
    }
    process.stdout.write(encodeLengthPrefixed(responseBytes));
  }
}

process.stdin.on("data", (chunk) => {
  inbox.buffer = Buffer.concat([inbox.buffer, Buffer.from(chunk)]);
  Promise.resolve().then(drainRequests).catch((error) => {
    console.error(error);
    process.exit(1);
  });
});
`;

test("createModuleHarness wraps a generic process command runtime", async () => {
  const harness = await createModuleHarness({
    runtime: {
      kind: "process",
      command: process.execPath,
      args: [FIXTURE_SERVER_PATH],
    },
  });

  try {
    const response = await harness.invoke({
      methodId: "echo",
      inputs: [
        {
          portId: "request",
          payload: new TextEncoder().encode("hello module harness"),
        },
      ],
    });

    assert.equal(response.statusCode, 0);
    assert.equal(
      new TextDecoder().decode(response.outputs[0].payload),
      "echo:hello module harness",
    );
    assert.equal(harness.runtime.kind, "process");
  } finally {
    await harness.destroy();
  }
});

test("resolveModuleHarnessLaunchPlan delegates wasmedge profiles to the shared WasmEdge launch planner", () => {
  const plan = resolveModuleHarnessLaunchPlan({
    runtime: {
      kind: "wasmedge",
      wasmPath: "/tmp/module-harness.wasm",
      wasmEdgeRunnerBinary: "/tmp/wasmedge-runner",
    },
  });

  assert.equal(plan.command, "/tmp/wasmedge-runner");
  assert.deepEqual(plan.args, [
    path.resolve("/tmp/module-harness.wasm"),
    "--serve-plugin-invoke",
  ]);
});

test("createModuleHarness manages a multi-module runtime host and keeps invoke as a default-module compatibility path", async () => {
  const harness = await createModuleHarness({
    runtime: {
      kind: "process",
      hostProfile: "runtime-host",
      command: process.execPath,
      args: ["--input-type=module", "--eval", DYNAMIC_HOST_SERVER_SCRIPT],
      modules: [
        {
          moduleId: "alpha",
          prefix: "alpha:",
          metadata: { family: "echo" },
        },
        {
          moduleId: "beta",
          prefix: "beta:",
          metadata: { family: "echo" },
        },
      ],
      defaultModuleId: "alpha",
    },
  });

  try {
    assert.deepEqual(
      (await harness.listModules()).map((moduleRecord) => moduleRecord.moduleId),
      ["alpha", "beta"],
    );

    const defaultResponse = await harness.invoke({
      methodId: "echo",
      inputs: [
        {
          portId: "request",
          payload: new TextEncoder().encode("through default"),
        },
      ],
    });
    assert.equal(
      new TextDecoder().decode(defaultResponse.outputs[0].payload),
      "alpha:through default",
    );

    const betaResponse = await harness.invokeModule("beta", {
      methodId: "echo",
      inputs: [
        {
          portId: "request",
          payload: new TextEncoder().encode("through beta"),
        },
      ],
    });
    assert.equal(
      new TextDecoder().decode(betaResponse.outputs[0].payload),
      "beta:through beta",
    );

    const rowHandle = await harness.appendRow({
      schemaFileId: "SATL",
      payload: { name: "Explorer-1" },
    });
    assert.deepEqual(await harness.resolveRow(rowHandle), {
      handle: rowHandle,
      payload: { name: "Explorer-1" },
    });
    assert.deepEqual(await harness.listRows("SATL"), [
      {
        handle: rowHandle,
        payload: { name: "Explorer-1" },
      },
    ]);

    const region = await harness.allocateRegion({
      layoutId: "orbit-state",
      recordByteLength: 4,
      alignment: 4,
      initialRecords: [Uint8Array.from([1, 2, 3, 4])],
    });
    assert.deepEqual(await harness.describeRegion(region.regionId), region);
    assert.deepEqual(await harness.resolveRecord({ regionId: region.regionId, recordIndex: 0 }), {
      regionId: region.regionId,
      recordIndex: 0,
      layoutId: "orbit-state",
      recordByteLength: 4,
      alignment: 4,
      byteLength: 4,
      bytes: Uint8Array.from([1, 2, 3, 4]),
    });

    assert.equal(await harness.unloadModule("beta"), true);
    await assert.rejects(
      harness.invokeModule("beta", {
        methodId: "echo",
        inputs: [],
      }),
      /Unknown module: beta/,
    );
  } finally {
    await harness.destroy();
  }
});

test("createModuleHarness adopts the first dynamically installed module as the runtime-host default", async () => {
  const harness = await createModuleHarness({
    runtime: {
      kind: "process",
      hostProfile: "runtime-host",
      command: process.execPath,
      args: ["--input-type=module", "--eval", DYNAMIC_HOST_SERVER_SCRIPT],
    },
  });

  try {
    await harness.installModule({
      moduleId: "alpha",
      prefix: "alpha:",
      metadata: { family: "echo" },
    });

    const response = await harness.invoke({
      methodId: "echo",
      inputs: [
        {
          portId: "request",
          payload: new TextEncoder().encode("dynamic default"),
        },
      ],
    });

    assert.equal(
      new TextDecoder().decode(response.outputs[0].payload),
      "alpha:dynamic default",
    );
  } finally {
    await harness.destroy();
  }
});
