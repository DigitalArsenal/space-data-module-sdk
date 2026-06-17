import test from "node:test";
import assert from "node:assert/strict";

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
  // Hand-build a response whose frame metadata lies about alignment: the
  // frame claims requiredAlignment 16 but sits at an 8-only offset.
  const bytes = encodePluginInvokeResponse({
    statusCode: 0,
    outputs: [
      { portId: "pad", payload: new Uint8Array(8) },
      {
        portId: "state",
        alignment: 8,
        typeRef: { requiredAlignment: 16, wireFormat: "aligned-binary" },
        payload: new Uint8Array(16),
      },
    ],
  });

  // The encoder packs frames to their declared frame alignment (8 here), so
  // the 16-byte requiredAlignment contract is violated either directly or
  // after shifting the buffer base off the 16-byte boundary.
  let threw = false;
  try {
    decodePluginInvokeResponse(bytes);
  } catch (error) {
    assert.match(String(error.message), /misaligned/);
    threw = true;
  }
  if (!threw) {
    const shifted = new Uint8Array(bytes.length + 8);
    shifted.set(bytes, 8);
    assert.throws(
      () => decodePluginInvokeResponse(shifted.subarray(8)),
      /misaligned|not 8-byte aligned/,
    );
  }
});

const ALIGNMENT_PROBE_SOURCE = `#include <stdint.h>
#include "space_data_module_invoke.h"

int probe_alignment(void) {
  const plugin_input_frame_t *frame = plugin_get_input_frame(0);
  if (!frame) {
    plugin_set_error("missing-frame", "No input frame was provided.");
    return 3;
  }
  if (((uintptr_t)frame->payload % 16u) != 0u) {
    plugin_set_error(
      "guest-misaligned-input",
      "Input payload view is not 16-byte aligned inside guest memory."
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
    16,
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
    const payload = new Uint8Array(64);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] = (index * 5 + 1) & 0xff;
    }
    const response = await harness.invoke({
      methodId: "probe_alignment",
      inputs: [
        {
          portId: "state",
          typeRef: {
            wireFormat: "aligned-binary",
            requiredAlignment: 16,
            byteLength: payload.length,
          },
          payload,
        },
      ],
    });

    assert.equal(response.statusCode, 0, response.errorMessage ?? "");
    assert.equal(response.outputs.length, 1);
    const frame = response.outputs[0];
    assert.equal(frame.typeRef?.requiredAlignment, 16);
    assert.equal(
      (response.payloadArena.byteOffset + frame.offset) % 16,
      0,
      "response frame must be absolutely 16-byte aligned",
    );
    assert.deepEqual(Array.from(frame.payload), Array.from(payload));
    harness.destroy();
  } finally {
    await cleanupCompilation(compilation);
  }
});
