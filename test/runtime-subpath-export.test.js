import test from "node:test";
import assert from "node:assert/strict";

import {
  DefaultInvokeExports,
  DefaultManifestExports,
  DrainPolicy,
  InvokeSurface,
  RuntimeTarget,
  isArrayBufferLike,
  toUint8Array,
} from "space-data-module-sdk/runtime";

test("runtime subpath exports canonical SDK constants", () => {
  assert.equal(DefaultInvokeExports.invokeSymbol, "plugin_invoke_stream");
  assert.equal(DefaultManifestExports.pluginBytesSymbol, "plugin_get_manifest_flatbuffer");
  assert.equal(DrainPolicy.DRAIN_TO_EMPTY, "drain-to-empty");
  assert.equal(InvokeSurface.DIRECT, "direct");
  assert.equal(RuntimeTarget.WASI, "wasi");
  assert.equal(RuntimeTarget.WASMEDGE, "wasmedge");
});

test("runtime subpath exports buffer helpers", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  assert.equal(isArrayBufferLike(bytes.buffer), true);
  assert.deepEqual(toUint8Array(bytes), bytes);
  assert.equal(toUint8Array(null), null);
});
