// FlatSQL link shim (loop C.7 direct linkage): the deterministic
// memory-crossing component linked flow artifacts use to read/write the live
// engine's linear memory with direct in-wasm calls. These tests pin its
// semantics and its byte identity (sdn-server embeds the identical artifact).

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  ENGINE_BODY_REF_TOKEN_MAGIC,
  ENGINE_REF_ENTRY_SIZE,
  FLATSQL_LINK_SHIM_WASM,
  buildFlatsqlLinkShimWasm,
  isEngineBodyRefToken,
} from "../src/flow/flatsqlLinkShim.js";
import { fnv1a64Hex } from "../src/http/index.js";

async function instantiateShim(memory) {
  const { instance } = await WebAssembly.instantiate(
    FLATSQL_LINK_SHIM_WASM.slice().buffer,
    { flatsql: { memory } },
  );
  return instance.exports;
}

test("shim bytes are deterministic and valid wasm", async () => {
  const again = buildFlatsqlLinkShimWasm();
  assert.deepEqual(again, FLATSQL_LINK_SHIM_WASM, "assembly must be deterministic");
  assert.ok(WebAssembly.validate(FLATSQL_LINK_SHIM_WASM.slice().buffer));
  // Byte identity pin — sdn-server internal/flowrt embeds this exact
  // artifact (flatsql-link-shim.wasm) and asserts the same digest. Update
  // BOTH constants together when the shim changes.
  const sha256 = createHash("sha256").update(FLATSQL_LINK_SHIM_WASM).digest("hex");
  assert.equal(
    sha256,
    "8d83e69b087c5b8c96b4f1377a607c77380f58f9e338073f91b1e43eee1f788b",
    "shim sha256 changed — update the pinned digest here and in sdn-server internal/flowrt",
  );
});

test("shim imports ONLY flatsql.memory (B-iv contract: no memory, no data, no globals of its own)", () => {
  const mod = new WebAssembly.Module(FLATSQL_LINK_SHIM_WASM.slice().buffer);
  const imports = WebAssembly.Module.imports(mod);
  assert.deepEqual(imports, [{ module: "flatsql", name: "memory", kind: "memory" }]);
  const exportNames = WebAssembly.Module.exports(mod).map((e) => e.name).sort();
  assert.deepEqual(exportNames, [
    "count_frames", "fnv1a64", "peek32", "peek64", "peek8", "poke32", "poke8",
  ]);
});

test("peek/poke read and write the engine memory", async () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const shim = await instantiateShim(memory);
  shim.poke8(64, 0xab);
  shim.poke32(72, 0xdeadbeef | 0);
  assert.equal(shim.peek8(64), 0xab);
  assert.equal(shim.peek32(72) >>> 0, 0xdeadbeef);
  assert.equal(shim.peek64(72) & 0xffffffffn, 0xdeadbeefn);
  const heap = new Uint8Array(memory.buffer);
  assert.equal(heap[64], 0xab, "poke8 hit the imported memory");
});

test("fnv1a64 is bit-identical to the canonical word-folded etag hash", async () => {
  const memory = new WebAssembly.Memory({ initial: 4 });
  const shim = await instantiateShim(memory);
  for (const length of [0, 1, 7, 8, 9, 63, 64, 1024, 100001]) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = (i * 131 + 7) & 0xff;
    new Uint8Array(memory.buffer).set(bytes, 4096);
    const got = BigInt.asUintN(64, shim.fnv1a64(4096, length)).toString(16).padStart(16, "0");
    assert.equal(got, fnv1a64Hex(bytes), `fnv parity at length ${length}`);
  }
});

test("count_frames matches the x-sdn-record-count rule", async () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const shim = await instantiateShim(memory);
  const view = new DataView(memory.buffer);
  let offset = 512;
  view.setUint32(offset, 3, true); offset += 4 + 3; // frame 1
  view.setUint32(offset, 0, true); offset += 4;     // zero-length padding
  view.setUint32(offset, 5, true); offset += 4 + 5; // frame 2
  assert.equal(shim.count_frames(512, offset - 512), 2);
  assert.equal(shim.count_frames(512, 0), 0, "empty stream has zero frames");
  view.setUint32(1024, 999, true);
  assert.equal(shim.count_frames(1024, 8), -1, "overrunning frame is malformed");
  assert.equal(shim.count_frames(1024, 2), -1, "truncated prefix is malformed");
});

test("engine body-ref token namespace", () => {
  assert.equal(ENGINE_BODY_REF_TOKEN_MAGIC, 0x53444e45n << 32n);
  assert.equal(isEngineBodyRefToken((0x53444e45n << 32n) | 1n), true);
  assert.equal(isEngineBodyRefToken(1n), false, "bridge counters never carry the magic");
  assert.equal(isEngineBodyRefToken(0n), false);
  assert.equal(ENGINE_REF_ENTRY_SIZE, 40);
});
