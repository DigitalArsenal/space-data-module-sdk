import test from "node:test";
import assert from "node:assert/strict";
import * as flatbuffers from "../src/vendor/flatbuffers/flatbuffers.js";
import { PIV } from "spacedatastandards.org/lib/js/PIV/PIV.js";
import { BufferMutability } from "../src/generated/orbpro/stream/buffer-mutability.js";
import { BufferOwnership } from "../src/generated/orbpro/stream/buffer-ownership.js";

import {
  INVOKE_ARENA_ALIGNMENT,
  cleanupCompilation,
  compileModuleFromSource,
  decodePluginInvokeRequest,
  decodePluginInvokeResponse,
  encodePluginInvokeRequest,
  encodePluginInvokeResponse,
} from "../src/index.js";
import { createBrowserModuleHarness } from "../src/testing/index.js";

const GRV_IDENTITY = Object.freeze({
  schemaName: "GRV.fbs",
  fileIdentifier: "$GRV",
  rootTypeName: "GRV",
});

function createPort(portId, required = true) {
  return {
    portId,
    acceptedTypeSets: [
      {
        setId: `${portId}-grv`,
        allowedTypes: [
          {
            ...GRV_IDENTITY,
            wireFormat: "flatbuffer",
          },
          {
            ...GRV_IDENTITY,
            wireFormat: "aligned-binary",
            byteLength: 72,
            requiredAlignment: 8,
          },
        ],
      },
    ],
    minStreams: required ? 1 : 0,
    maxStreams: 1,
    required,
  };
}

function createManifest(methodId, inputPortIds, outputPortIds) {
  return {
    pluginId: `com.digitalarsenal.examples.${methodId.replace(/_/g, "-")}`,
    name: "Arena Alignment Module",
    version: "0.1.0",
    pluginFamily: "analysis",
    capabilities: [],
    externalInterfaces: [],
    invokeSurfaces: ["direct"],
    methods: [
      {
        methodId,
        displayName: methodId,
        inputPorts: inputPortIds.map((portId) => createPort(portId, true)),
        outputPorts: outputPortIds.map((portId) => createPort(portId, false)),
        maxBatch: 1,
        drainPolicy: "single-shot",
      },
    ],
  };
}

function absoluteFrameOffset(arena, frame) {
  return arena.byteOffset + frame.offset;
}

function alignedGrvType(overrides = {}) {
  return {
    ...GRV_IDENTITY,
    schemaVersion: "0.0.4",
    schemaHash:
      "2f8585994747b20a6f52a3a5875be763dbfa12de9de6b5979e305296081f1033",
    wireFormat: "aligned-binary",
    fixedStringLength: 24,
    byteLength: 72,
    requiredAlignment: 8,
    ...overrides,
  };
}

function mutateFirstTabUint32(bytes, kind, vtableField, value) {
  const bb = new flatbuffers.ByteBuffer(bytes);
  const root = PIV.getRootAsPIV(bb);
  const tab =
    kind === "request"
      ? root.REQUEST()?.INPUTS(0)
      : root.RESPONSE()?.OUTPUTS(0);
  assert.ok(tab, `expected first ${kind} TAB`);
  const fieldOffset = tab.bb.__offset(tab.bb_pos, vtableField);
  assert.notEqual(fieldOffset, 0, `TAB field ${vtableField} must be present`);
  tab.bb.writeInt32(tab.bb_pos + fieldOffset, value);
  return bytes;
}

test("PIV/TAB round-trip preserves exact schema hash and aligned layout metadata", () => {
  const frameId = 0xfedcba9876543210n;
  const bytes = encodePluginInvokeRequest({
    methodId: "metadata",
    inputs: [
      {
        portId: "gravity",
        alignment: 8,
        typeRef: alignedGrvType(),
        ownership: "producer-owned",
        mutability: "append-only",
        frameId,
        // An explicit opaque frame id must win over legacy stream fields.
        sequence: 9n,
        endOfStream: true,
        payload: new Uint8Array(72),
      },
    ],
  });

  const [frame] = decodePluginInvokeRequest(bytes).inputs;
  assert.deepEqual(
    Array.from(frame.typeRef.schemaHash),
    Array.from(Buffer.from(alignedGrvType().schemaHash, "hex")),
  );
  assert.equal(frame.typeRef.schemaVersion, "0.0.4");
  assert.equal(frame.typeRef.fixedStringLength, 24);
  assert.equal(frame.typeRef.byteLength, 72);
  assert.equal(frame.typeRef.requiredAlignment, 8);
  assert.equal(frame.ownership, BufferOwnership.PRODUCER_OWNED);
  assert.equal(frame.mutability, BufferMutability.APPEND_ONLY);
  assert.equal(frame.frameId, frameId);
});

test("PIV/TAB encoder rejects explicit zero and non-power-of-two descriptor alignment", () => {
  const makeRequest = (alignment) => ({
    methodId: "invalid_alignment",
    inputs: [
      {
        portId: "gravity",
        alignment,
        typeRef: alignedGrvType(),
        payload: new Uint8Array(72),
      },
    ],
  });

  assert.throws(
    () => encodePluginInvokeRequest(makeRequest(0)),
    /alignment.*positive power of two/i,
  );
  assert.throws(
    () => encodePluginInvokeRequest(makeRequest(3)),
    /alignment.*positive power of two/i,
  );
});

test("PIV/TAB encoder rejects descriptor alignment below the type requirement", () => {
  assert.throws(
    () =>
      encodePluginInvokeRequest({
        methodId: "weak_alignment",
        inputs: [
          {
            portId: "gravity",
            alignment: 4,
            typeRef: alignedGrvType(),
            payload: new Uint8Array(72),
          },
        ],
      }),
    /alignment 4.*required alignment 8/i,
  );
});

test("PIV/TAB encoder rejects an aligned payload whose size differs from its declared layout", () => {
  assert.throws(
    () =>
      encodePluginInvokeResponse({
        outputs: [
          {
            portId: "gravity",
            typeRef: alignedGrvType(),
            payload: new Uint8Array(71),
          },
        ],
      }),
    /aligned.*size 71.*byteLength 72/i,
  );
});

test("PIV/TAB external arena encoder rejects uint32 range overflow before arena slicing", () => {
  assert.throws(
    () =>
      encodePluginInvokeRequest({
        methodId: "overflow",
        externalArena: new Uint8Array(16),
        inputs: [
          {
            portId: "gravity",
            offset: 0xffffffff,
            size: 2,
            alignment: 8,
            typeRef: {
              ...GRV_IDENTITY,
              wireFormat: "flatbuffer",
            },
          },
        ],
      }),
    /offset \+ size.*uint32/i,
  );
});

test("encoded request arenas are absolutely aligned across size permutations", () => {
  for (let trial = 0; trial < 128; trial += 1) {
    const frameCount = 1 + (trial % 4);
    const inputs = [];
    for (let index = 0; index < frameCount; index += 1) {
      const size = 1 + ((trial * 13 + index * 7) % 67);
      inputs.push({
        portId: `port-${index}`,
        typeRef:
          index % 2 === 0
            ? {
                wireFormat: "aligned-binary",
                requiredAlignment: index % 4 === 0 ? 8 : 16,
                byteLength: size,
              }
            : {},
        payload: new Uint8Array(size).fill((index + 1) & 0xff),
      });
    }

    const bytes = encodePluginInvokeRequest({ methodId: "fuzz", inputs });
    assert.equal(
      bytes.byteOffset % INVOKE_ARENA_ALIGNMENT,
      0,
      `trial ${trial}: request buffer base misaligned`,
    );

    const decoded = decodePluginInvokeRequest(bytes);
    assert.equal(
      decoded.payloadArena.byteOffset % INVOKE_ARENA_ALIGNMENT,
      0,
      `trial ${trial}: request arena base misaligned`,
    );
    for (const frame of decoded.inputs) {
      const alignment = Math.max(1, frame.alignment ?? 1);
      assert.equal(
        absoluteFrameOffset(decoded.payloadArena, frame) % alignment,
        0,
        `trial ${trial}: frame ${frame.portId} misaligned`,
      );
      // Payload views must be byte-identical to what was packed.
      const original = inputs[decoded.inputs.indexOf(frame)];
      assert.deepEqual(Array.from(frame.payload), Array.from(original.payload));
    }
  }
});

test("encoded response arenas are absolutely aligned across size permutations", () => {
  for (let trial = 0; trial < 128; trial += 1) {
    const frameCount = 1 + (trial % 3);
    const outputs = [];
    for (let index = 0; index < frameCount; index += 1) {
      const size = 8 * (1 + ((trial + index) % 16));
      outputs.push({
        portId: `out-${index}`,
        typeRef: {
          wireFormat: "aligned-binary",
          requiredAlignment: 8,
          byteLength: size,
        },
        payload: new Uint8Array(size).fill((index + 3) & 0xff),
      });
    }

    const bytes = encodePluginInvokeResponse({ statusCode: 0, outputs });
    const decoded = decodePluginInvokeResponse(bytes);
    assert.equal(decoded.payloadArena.byteOffset % INVOKE_ARENA_ALIGNMENT, 0);
    for (const frame of decoded.outputs) {
      assert.equal(
        absoluteFrameOffset(decoded.payloadArena, frame) %
          Math.max(1, frame.typeRef?.requiredAlignment ?? 1),
        0,
      );
    }
  }
});

test("aligned-binary frame views support direct 64-bit typed array access", () => {
  const doubles = Float64Array.from([1.5, -2.25, 3.75, 1e300, -0.5, 42.0]);
  const payload = new Uint8Array(
    doubles.buffer.slice(0),
    0,
    doubles.byteLength,
  );

  const bytes = encodePluginInvokeRequest({
    methodId: "typed_view",
    inputs: [
      // A deliberately odd-sized text frame first, to push the second frame
      // off any "naturally aligned" offset unless packing realigns it.
      { portId: "label", payload: new Uint8Array([1, 2, 3]) },
      {
        portId: "state",
        typeRef: {
          wireFormat: "aligned-binary",
          requiredAlignment: 8,
          byteLength: payload.length,
        },
        payload,
      },
    ],
  });

  const decoded = decodePluginInvokeRequest(bytes);
  const frame = decoded.inputs.find((entry) => entry.portId === "state");
  assert.ok(frame);

  // Constructing a Float64Array over the raw view throws on misalignment —
  // this is the misaligned 64-bit read the alignment guarantee eliminates.
  const view = new Float64Array(
    frame.payload.buffer,
    frame.payload.byteOffset,
    doubles.length,
  );
  assert.deepEqual(Array.from(view), Array.from(doubles));
});

test("decoder rejects frames that violate their declared required alignment", () => {
  const bytes = mutateFirstTabUint32(encodePluginInvokeResponse({
    statusCode: 0,
    outputs: [
      {
        portId: "state",
        alignment: 16,
        typeRef: alignedGrvType({ requiredAlignment: 16 }),
        payload: new Uint8Array(72),
      },
    ],
  }), "response", 8, 8);

  assert.throws(
    () => decodePluginInvokeResponse(bytes),
    /alignment 8.*required alignment 16/i,
  );
});

test("decoder rejects zero alignment, aligned size mismatch, overflow, and out-of-arena ranges", () => {
  const validAligned = () =>
    encodePluginInvokeResponse({
      outputs: [
        {
          portId: "gravity",
          alignment: 8,
          typeRef: alignedGrvType(),
          payload: new Uint8Array(72),
        },
      ],
    });

  assert.throws(
    () =>
      decodePluginInvokeResponse(
        mutateFirstTabUint32(validAligned(), "response", 8, 0),
      ),
    /alignment.*positive power of two/i,
  );
  assert.throws(
    () =>
      decodePluginInvokeResponse(
        mutateFirstTabUint32(validAligned(), "response", 6, 71),
      ),
    /aligned.*size 71.*byteLength 72/i,
  );

  const externalArena = new Uint8Array(32);
  const validExternal = () =>
    encodePluginInvokeRequest({
      methodId: "external",
      externalArena,
      inputs: [
        {
          portId: "gravity",
          offset: 8,
          size: 8,
          alignment: 8,
          typeRef: { ...GRV_IDENTITY, wireFormat: "flatbuffer" },
        },
      ],
    });
  assert.throws(
    () =>
      decodePluginInvokeRequest(
        mutateFirstTabUint32(validExternal(), "request", 4, 0xffffffff),
        { externalArena },
      ),
    /offset \+ size.*uint32/i,
  );
  assert.throws(
    () =>
      decodePluginInvokeRequest(
        mutateFirstTabUint32(validExternal(), "request", 6, 32),
        { externalArena },
      ),
    /payload range exceeds external arena/i,
  );
});

const ALIGNMENT_PROBE_SOURCE = `#include <stdint.h>
#include "space_data_module_invoke.h"

int probe_alignment(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "No input frame was provided.");
    return 3;
  }
  if (((uintptr_t)frame->payload % 8u) != 0u) {
    plugin_set_error(
      "guest-misaligned-input",
      "Input payload view is not 8-byte aligned inside guest memory."
    );
    return 4;
  }
  plugin_push_output_typed(
    "state",
    frame->schema_name,
    frame->file_identifier,
    frame->wire_format,
    frame->root_type_name,
    frame->fixed_string_length,
    frame->byte_length,
    8,
    frame->payload,
    frame->payload_length
  );
  return 0;
}
`;

test("compiled module sees aligned input views and returns aligned response arenas", async () => {
  const compilation = await compileModuleFromSource({
    manifest: createManifest("probe_alignment", ["state"], ["state"]),
    sourceCode: ALIGNMENT_PROBE_SOURCE,
    language: "c",
  });

  try {
    const harness = await createBrowserModuleHarness({
      wasmSource: compilation.wasmBytes,
      surface: "direct",
    });
    const payload = new Uint8Array(72);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = (index * 5 + 1) & 0xff;
    }
    const response = await harness.invoke({
      methodId: "probe_alignment",
      inputs: [
        {
          portId: "state",
          typeRef: {
            ...GRV_IDENTITY,
            wireFormat: "aligned-binary",
            requiredAlignment: 8,
            byteLength: payload.length,
          },
          payload,
        },
      ],
    });

    assert.equal(response.statusCode, 0, response.errorMessage ?? "");
    assert.equal(response.outputs.length, 1);
    const frame = response.outputs[0];
    assert.equal(frame.typeRef?.requiredAlignment, 8);
    assert.equal(
      (response.payloadArena.byteOffset + frame.offset) % 8,
      0,
      "response frame must be absolutely 8-byte aligned",
    );
    assert.deepEqual(Array.from(frame.payload), Array.from(payload));
    harness.destroy();
  } finally {
    await cleanupCompilation(compilation);
  }
});
