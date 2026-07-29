import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendWasmCustomSection,
  encodeUnsignedLeb128,
} from "../src/bundle/wasm.js";
import {
  FLATSQL_LINKED_STORE_SECTION_NAME,
  assertFlatsqlLinkedStoreDescriptorForWasm,
  encodeFlatsqlLinkedStoreDescriptor,
  hashFlatsqlLinkedStoreDescriptor,
  parseFlatsqlLinkedStoreDescriptor,
  readFlatsqlLinkedStoreDescriptor,
} from "../src/flow/index.js";
import {
  checkFlowProgram,
  compileFlowProgram,
} from "../src/flow/flowCompiler.js";

const textEncoder = new TextEncoder();

function concatBytes(...chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function wasmSection(id, payload) {
  return concatBytes(Uint8Array.of(id), encodeUnsignedLeb128(payload.length), payload);
}

function wasmString(value) {
  const bytes = textEncoder.encode(value);
  return concatBytes(encodeUnsignedLeb128(bytes.length), bytes);
}

function minimalWasm({ flatsqlImport = null } = {}) {
  const header = Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00);
  if (!flatsqlImport) return header;

  const typeSection = wasmSection(
    1,
    Uint8Array.of(0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e),
  );
  const importEntry = concatBytes(
    wasmString("flatsql"),
    wasmString(flatsqlImport),
    Uint8Array.of(0x00, 0x00),
  );
  const importSection = wasmSection(
    2,
    concatBytes(Uint8Array.of(0x01), importEntry),
  );
  return concatBytes(header, typeSection, importSection);
}

function descriptor(overrides = {}) {
  return {
    schema:
      "table alpha { cid:string (key); provider:string; source_name:string; batch_id:string; data:[ubyte]; pulled_at:long; }",
    database: "neutral_results",
    version: 1,
    fileIdentifiers: [{ table: "alpha", id: "ALPH" }],
    engine: "flatsql",
    ...overrides,
  };
}

function hostOnlyFlow(linkedStore) {
  return {
    programId: "test.host-store-flow",
    name: "Host store flow",
    version: "0.1.0",
    nodes: [
      {
        nodeId: "store",
        pluginId: "test.host-store",
        methodId: "store",
        kind: "sink",
      },
    ],
    edges: [],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [
      {
        triggerId: "manual",
        targetNodeId: "store",
        targetPortId: "records",
      },
    ],
    requiredPlugins: [],
    ...(linkedStore === undefined ? {} : { linkedStore }),
  };
}

test("linked-store descriptors encode as canonical UTF-8 JSON", async () => {
  const input = descriptor({
    fileIdentifiers: [
      { table: "beta", id: "BETA" },
      { table: "alpha", id: "ALPH" },
    ],
  });
  const bytes = encodeFlatsqlLinkedStoreDescriptor(input);

  assert.equal(
    new TextDecoder().decode(bytes),
    '{"database":"neutral_results","engine":"flatsql","fileIdentifiers":[{"id":"BETA","table":"beta"},{"id":"ALPH","table":"alpha"}],"schema":"table alpha { cid:string (key); provider:string; source_name:string; batch_id:string; data:[ubyte]; pulled_at:long; }","version":1}',
  );
  assert.deepEqual(parseFlatsqlLinkedStoreDescriptor(bytes), {
    database: "neutral_results",
    engine: "flatsql",
    fileIdentifiers: [
      { id: "BETA", table: "beta" },
      { id: "ALPH", table: "alpha" },
    ],
    schema: input.schema,
    version: 1,
  });
  assert.match(await hashFlatsqlLinkedStoreDescriptor(input), /^[a-f0-9]{64}$/);
});

test("linked-store record views bind generic read parameters to descriptor-owned columns", () => {
  const value = descriptor({
    recordViews: [
      {
        id: "latest-alpha",
        fileIdentifier: "ALPH",
        table: "alpha",
        recordColumn: "data",
        filters: [{ parameter: "provider", column: "provider", type: "text" }],
        latestOrderBy: "pulled_at",
      },
    ],
  });

  const decoded = parseFlatsqlLinkedStoreDescriptor(
    encodeFlatsqlLinkedStoreDescriptor(value),
  );
  assert.deepEqual(decoded.recordViews, value.recordViews);
});

test("linked-store descriptor validation rejects malformed, duplicate, and oversized fields", () => {
  const invalid = [
    [null, /object/i],
    [descriptor({ version: 2 }), /version/i],
    [descriptor({ engine: "sqlite" }), /engine/i],
    [descriptor({ database: "" }), /database/i],
    [descriptor({ database: "unsafe-name" }), /database/i],
    [descriptor({ database: `d${"x".repeat(63)}` }), /database/i],
    [descriptor({ schema: "" }), /schema/i],
    [descriptor({ schema: "x".repeat(131_073) }), /schema/i],
    [descriptor({ fileIdentifiers: [] }), /fileIdentifiers/i],
    [descriptor({ fileIdentifiers: [{ id: "ABC", table: "alpha" }] }), /4-byte ASCII/i],
    [descriptor({ fileIdentifiers: [{ id: "ÉABC", table: "alpha" }] }), /4-byte ASCII/i],
    [
      descriptor({
        fileIdentifiers: [
          { id: "ALPH", table: "alpha" },
          { id: "ALPH", table: "beta" },
        ],
      }),
      /duplicate.*id/i,
    ],
    [descriptor({ fileIdentifiers: [{ id: "ALPH", table: "unsafe-name" }] }), /table/i],
    [
      descriptor({
        fileIdentifiers: [
          { id: "ALPH", table: "alpha" },
          { id: "BETA", table: "alpha" },
        ],
      }),
      /duplicate.*table/i,
    ],
    [
      descriptor({
        fileIdentifiers: Array.from({ length: 257 }, (_, index) => ({
          id: String(index).padStart(4, "0").slice(-4),
          table: `table_${index}`,
        })),
      }),
      /fileIdentifiers/i,
    ],
    [descriptor({ extra: true }), /unknown field/i],
    [descriptor({ recordViews: [] }), /recordViews/i],
    [
      descriptor({
        recordViews: [
          {
            id: "unsafe/view",
            fileIdentifier: "ALPH",
            table: "alpha",
            recordColumn: "data",
            filters: [],
            latestOrderBy: "pulled_at",
          },
        ],
      }),
      /recordViews.*id/i,
    ],
    [
      descriptor({
        recordViews: [
          {
            id: "latest-alpha",
            fileIdentifier: "MISS",
            table: "alpha",
            recordColumn: "data",
            filters: [],
            latestOrderBy: "pulled_at",
          },
        ],
      }),
      /fileIdentifier/i,
    ],
    [
      descriptor({
        recordViews: [
          {
            id: "latest-alpha",
            fileIdentifier: "ALPH",
            table: "other_table",
            recordColumn: "data",
            filters: [],
            latestOrderBy: "pulled_at",
          },
        ],
      }),
      /table.*mapping/i,
    ],
    [
      descriptor({
        recordViews: [
          {
            id: "latest-alpha",
            fileIdentifier: "ALPH",
            table: "alpha",
            recordColumn: "data",
            filters: [
              { parameter: "provider", column: "provider", type: "text" },
              { parameter: "provider", column: "source_name", type: "text" },
            ],
            latestOrderBy: "pulled_at",
          },
        ],
      }),
      /duplicate.*parameter/i,
    ],
    [
      descriptor({
        recordViews: [
          {
            id: "latest-alpha",
            fileIdentifier: "ALPH",
            table: "alpha",
            recordColumn: "data",
            filters: [{ parameter: "provider", column: "provider", type: "json" }],
            latestOrderBy: "pulled_at",
          },
        ],
      }),
      /type/i,
    ],
  ];

  for (const [value, expected] of invalid) {
    assert.throws(() => encodeFlatsqlLinkedStoreDescriptor(value), expected);
  }
  assert.throws(
    () => parseFlatsqlLinkedStoreDescriptor(new Uint8Array(262_145)),
    /descriptor exceeds/i,
  );
});

test("descriptor custom-section parsing rejects malformed, duplicate, noncanonical, and tampered data", async () => {
  const value = descriptor();
  const canonical = encodeFlatsqlLinkedStoreDescriptor(value);
  const hash = await hashFlatsqlLinkedStoreDescriptor(value);
  const wasm = appendWasmCustomSection(
    minimalWasm(),
    FLATSQL_LINKED_STORE_SECTION_NAME,
    canonical,
  );

  await assert.rejects(
    () =>
      readFlatsqlLinkedStoreDescriptor(minimalWasm(), {
        expectedSha256: hash,
      }),
    /missing/i,
  );

  assert.deepEqual(
    await readFlatsqlLinkedStoreDescriptor(wasm, { expectedSha256: hash }),
    value,
  );
  await assert.rejects(
    () => readFlatsqlLinkedStoreDescriptor(wasm, { expectedSha256: "0".repeat(64) }),
    /hash mismatch/i,
  );

  const duplicate = appendWasmCustomSection(
    wasm,
    FLATSQL_LINKED_STORE_SECTION_NAME,
    canonical,
  );
  await assert.rejects(() => readFlatsqlLinkedStoreDescriptor(duplicate), /exactly one/i);

  const malformed = appendWasmCustomSection(
    minimalWasm(),
    FLATSQL_LINKED_STORE_SECTION_NAME,
    textEncoder.encode("{not-json}"),
  );
  await assert.rejects(() => readFlatsqlLinkedStoreDescriptor(malformed), /JSON/i);

  const noncanonical = appendWasmCustomSection(
    minimalWasm(),
    FLATSQL_LINKED_STORE_SECTION_NAME,
    textEncoder.encode(JSON.stringify(value, null, 2)),
  );
  await assert.rejects(() => readFlatsqlLinkedStoreDescriptor(noncanonical), /canonical/i);
});

test("storage-trampoline imports require an embedded linked-store descriptor", async () => {
  const noStore = minimalWasm();
  assert.equal(await readFlatsqlLinkedStoreDescriptor(noStore), null);
  assert.doesNotThrow(() =>
    assertFlatsqlLinkedStoreDescriptorForWasm(noStore, null),
  );

  const readOnly = minimalWasm({ flatsqlImport: "exec_envelope" });
  assert.doesNotThrow(() =>
    assertFlatsqlLinkedStoreDescriptorForWasm(readOnly, null),
  );

  const persistent = minimalWasm({ flatsqlImport: "ingest_record" });
  assert.throws(
    () => assertFlatsqlLinkedStoreDescriptorForWasm(persistent, null),
    /ingest_record.*linkedStore/i,
  );
  assert.throws(
    () => assertFlatsqlLinkedStoreDescriptorForWasm(persistent, descriptor()),
    /custom section/i,
  );
  const persistentWithDescriptor = appendWasmCustomSection(
    persistent,
    FLATSQL_LINKED_STORE_SECTION_NAME,
    encodeFlatsqlLinkedStoreDescriptor(descriptor()),
  );
  assert.doesNotThrow(() =>
    assertFlatsqlLinkedStoreDescriptorForWasm(
      persistentWithDescriptor,
      descriptor(),
    ),
  );
});

test("flow check rejects an ingest guest object before linking when linkedStore is absent", () => {
  const manifest = {
    pluginId: "test.persistence-writer",
    name: "Persistence writer",
    version: "1.0.0",
    pluginFamily: "foundation",
    capabilities: [],
    externalInterfaces: [],
    runtimeTargets: ["browser"],
    methods: [
      {
        methodId: "write",
        inputPorts: [],
        outputPorts: [],
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
    schemasUsed: [],
    abiVersion: 1,
  };
  const dependency = {
    pluginId: manifest.pluginId,
    manifest,
    normalized: manifest,
    guestLink: {
      objectBytes: minimalWasm({ flatsqlImport: "ingest_record" }),
      metadata: {
        symbolPrefix: "neutral_",
        methodSymbols: { write: "neutral_write" },
      },
    },
  };
  const flow = {
    programId: "test.persistence-flow",
    name: "Persistence flow",
    version: "0.1.0",
    nodes: [
      {
        nodeId: "writer",
        pluginId: manifest.pluginId,
        methodId: "write",
        kind: "transform",
      },
    ],
    edges: [],
    triggers: [{ triggerId: "manual", kind: "manual" }],
    triggerBindings: [],
    requiredPlugins: [manifest.pluginId],
  };

  const missing = checkFlowProgram({
    flow,
    dependencies: new Map([[manifest.pluginId, dependency]]),
  });
  assert.equal(missing.ok, false);
  assert.ok(
    missing.errors.some((issue) => issue.code === "missing-linked-store"),
  );

  const present = checkFlowProgram({
    flow: { ...flow, linkedStore: descriptor() },
    dependencies: new Map([[manifest.pluginId, dependency]]),
  });
  assert.equal(present.ok, true, JSON.stringify(present.issues));
});

test("flow validation normalizes valid linkedStore metadata and fails invalid metadata before writing", async (t) => {
  const valid = checkFlowProgram({ flow: hostOnlyFlow(descriptor()) });
  assert.equal(valid.ok, true, JSON.stringify(valid.issues));
  assert.deepEqual(valid.linkedStore, descriptor());

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "flow-linked-store-invalid-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const outDir = path.join(tempRoot, "dist");
  await assert.rejects(
    () =>
      compileFlowProgram({
        flow: hostOnlyFlow(descriptor({ database: "unsafe-name" })),
        dependencies: new Map(),
        outDir,
      }),
    /linkedStore/i,
  );
  assert.equal(existsSync(outDir), false);
});
