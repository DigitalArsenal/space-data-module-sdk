import assert from "node:assert/strict";
import test from "node:test";
import {
  SDN_GPU_ABI_VERSION,
  SDN_GPU_BACKEND,
  SDN_GPU_BUFFER_ROLE,
  SDN_GPU_CAPABILITY_ID,
  SDN_GPU_CAPABILITY_SCOPE_V2,
  SDN_GPU_SCALAR_FORMAT,
  SDN_GPU_STATUS,
  createGpuCapabilityAdapter,
  createRuntimeHost,
  createSharedGpuContext,
  detectWebGpu,
  f64ArrayToU32Pairs,
  packF64Bits,
  u32PairsToF64Array,
  unpackF64Bits,
} from "../src/runtime-host/index.js";
import { validatePluginManifest } from "../src/compliance/index.js";
import fs from "node:fs";

function makeFakeDevice() {
  const buffers = new Map();
  let nextBuf = 1;
  return {
    limits: {
      maxStorageBufferBindingSize: 134217728,
      maxBufferSize: 268435456,
      maxComputeWorkgroupSizeX: 256,
      maxComputeInvocationsPerWorkgroup: 256,
    },
    createBuffer({ size, usage, label }) {
      const data = new Uint8Array(size);
      const id = nextBuf++;
      let destroyed = false;
      const buf = {
        id,
        size,
        usage,
        label,
        _data: data,
        get destroyed() { return destroyed; },
        async mapAsync() {},
        getMappedRange(off = 0, len = size) { return data.buffer.slice(off, off + len); },
        unmap() {},
        destroy() { destroyed = true; },
      };
      buffers.set(id, buf);
      return buf;
    },
    queue: {
      writeBuffer(buf, off, src) {
        const bytes = ArrayBuffer.isView(src)
          ? new Uint8Array(src.buffer, src.byteOffset, src.byteLength)
          : new Uint8Array(src);
        buf._data.set(bytes, off);
      },
      submit(cmds) {
        for (const cmd of cmds) cmd();
      },
    },
    createCommandEncoder() {
      const ops = [];
      return {
        copyBufferToBuffer(src, srcOff, dst, dstOff, size) {
          ops.push(() => dst._data.set(src._data.subarray(srcOff, srcOff + size), dstOff));
        },
        finish() {
          return () => { for (const op of ops) op(); };
        },
      };
    },
  };
}

test("GPU ABI v2: exact f64 bit packing, GPU detection fallback, shared device buffer handles & manifest compliance", async () => {
  assert.equal(SDN_GPU_ABI_VERSION, 2);

  // Exact IEEE-754 f64 round-trip (normal, negative, zero, subnormal, extreme)
  const samples = [0, -0, 1, -1, Math.PI, 6378.1363, -7.668123456789012, 5e-324, 2.2250738585072014e-308, 1.7976931348623157e308];
  const f64In = Float64Array.from(samples);
  const u32Pairs = f64ArrayToU32Pairs(f64In);
  const f64Out = u32PairsToF64Array(u32Pairs);
  for (let i = 0; i < samples.length; i++) {
    const packed = packF64Bits(samples[i]);
    assert.equal(Object.is(unpackF64Bits(packed.lo, packed.hi), samples[i]), true);
    assert.equal(Object.is(f64Out[i], samples[i]), true);
  }

  // Graceful unavailable detection when no navigator.gpu exists
  const probe = await detectWebGpu({ gpu: null });
  assert.equal(probe.available, false);
  assert.equal(probe.backendKind, "cpu-fallback");
  assert.equal(probe.backendCode, SDN_GPU_BACKEND.CPU_FALLBACK);
  assert.equal(probe.context, null);

  // Shared device context & cross-module buffer handle exchange
  const ctxA = createSharedGpuContext({ device: makeFakeDevice(), adapterLabel: "FakeGPU-A" });
  const ctxB = createSharedGpuContext({ device: makeFakeDevice(), adapterLabel: "FakeGPU-B" });
  const host = createRuntimeHost({
    capabilities: { [SDN_GPU_CAPABILITY_ID]: createGpuCapabilityAdapter(ctxA) },
  });

  const info = await host.invokeCapability("gpu_compute.device.info.v1");
  assert.equal(info.available, true);
  assert.equal(info.abiVersion, 2);
  assert.equal(info.deviceId, ctxA.deviceId);

  // Producer (AP) creates shared exact-f64 buffer on host device; consumer (CA) resolves same GPUBuffer
  const handle = await host.invokeCapability("gpu_compute.buffer.create.v1", {
    byteLength: f64In.byteLength,
    role: SDN_GPU_BUFFER_ROLE.STORAGE_READ | SDN_GPU_BUFFER_ROLE.SHARED_EXCHANGE,
    scalarFormat: SDN_GPU_SCALAR_FORMAT.IEEE754_F64_U32X2,
    recordStride: 48,
    layout: "sdn.ap.states.f64.v1",
    owner: "com.spacedatanetwork.sdn-ap-propagator",
    initialData: f64In,
  });
  assert.equal(handle.deviceId, ctxA.deviceId);
  assert.equal(handle.scalarFormat, SDN_GPU_SCALAR_FORMAT.IEEE754_F64_U32X2);

  // Same-device consumer gets the exact same GPUBuffer object (zero CPU copy)
  const buf = ctxA.getBuffer(handle);
  assert.equal(buf.size, f64In.byteLength);

  // Wrong device rejects with DEVICE_MISMATCH
  assert.throws(() => ctxB.getBuffer(handle), (err) => err.gpuStatus === SDN_GPU_STATUS.DEVICE_MISMATCH);

  // Readback verifies bit-exact bytes
  const bytes = await host.invokeCapability("gpu_compute.buffer.read.v1", { handle });
  const back = u32PairsToF64Array(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4));
  for (let i = 0; i < samples.length; i++) {
    assert.equal(Object.is(back[i], samples[i]), true);
  }

  // Release destroys buffer and rejects subsequent lookup
  const rel = await host.invokeCapability("gpu_compute.buffer.release.v1", { handle });
  assert.equal(rel.released, true);
  assert.equal(buf.destroyed, true);
  assert.throws(() => ctxA.getBuffer(handle), (err) => err.gpuStatus === SDN_GPU_STATUS.UNKNOWN_HANDLE);

  // Template manifest with scope webgpu.v2 validates cleanly
  const tmpl = JSON.parse(fs.readFileSync(new URL("../templates/gpu-module/manifest.json", import.meta.url), "utf8"));
  assert.equal(tmpl.capabilities[1].scope, SDN_GPU_CAPABILITY_SCOPE_V2);
  const report = validatePluginManifest(tmpl);
  assert.equal(report.ok, true, JSON.stringify(report.errors));

  ctxA.destroy();
  ctxB.destroy();
});
