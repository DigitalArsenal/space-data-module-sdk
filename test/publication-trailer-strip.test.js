import test from "node:test";
import assert from "node:assert/strict";

import { stripPublicationTrailer } from "../src/flow/flowRuntimeHost.js";

// Publication layout (docs/module-publication-standard.md):
//   payload || REC bytes || uint32le(REC length) || "$REC"
function appendTrailer(payload, recBytes) {
  const out = new Uint8Array(payload.length + recBytes.length + 8);
  out.set(payload, 0);
  out.set(recBytes, payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(payload.length + recBytes.length, recBytes.length, true);
  out.set([0x24, 0x52, 0x45, 0x43], payload.length + recBytes.length + 4);
  return out;
}

const WASM_HEADER = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

test("stripPublicationTrailer removes a $REC trailer", () => {
  const rec = new Uint8Array(64).fill(0xab);
  const protectedBytes = appendTrailer(WASM_HEADER, rec);
  const stripped = stripPublicationTrailer(protectedBytes);
  assert.deepEqual(Array.from(stripped), Array.from(WASM_HEADER));
});

test("stripPublicationTrailer leaves plain wasm untouched", () => {
  const bytes = new Uint8Array([...WASM_HEADER, 1, 2, 3, 4]);
  assert.equal(stripPublicationTrailer(bytes), bytes);
});

test("stripPublicationTrailer rejects an inconsistent footer length", () => {
  // Footer claims a REC longer than everything before it.
  const bogus = new Uint8Array(16);
  bogus.set(WASM_HEADER, 0);
  const view = new DataView(bogus.buffer);
  view.setUint32(8, 4096, true);
  bogus.set([0x24, 0x52, 0x45, 0x43], 12);
  assert.equal(stripPublicationTrailer(bogus), bogus);
});

test("stripPublicationTrailer handles short buffers", () => {
  const tiny = new Uint8Array([0x24, 0x52, 0x45]);
  assert.equal(stripPublicationTrailer(tiny), tiny);
});
