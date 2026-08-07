import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserModuleHarness } from "../src/host/browserModuleHarness.js";
import { createWorkerModuleHarness } from "../src/host/workerModuleHarness.js";

const WORKER_HOSTCALL_MODULE_BYTES = new Uint8Array(
  Buffer.from(
    "AGFzbQEAAAABFwRgAX8Bf2AEf39/fwF/YAABf2ACf38AAkIDA2VudgZtZW1vcnkCAwEBBHdhc2kMdGhyZWFkLXNwYXduAAAWc3BhY2VfZGF0YV9tb2R1bGVfaG9zdARjYWxsAAEDAwICAwcrAhNydW5fd29ya2VyX2hvc3RjYWxsAAIRd2FzaV90aHJlYWRfc3RhcnQAAwpDAiEAQQBBAP4XAgBB+wAQABpBAEEAQn/+AQIAGkEA/hACAAsfAEEAQcAAQQtBAEEAEAFBAWr+FwIAQQBBAf4AAgAaCwsSAQBBwAALC3Rlc3Qud29ya2Vy",
    "base64",
  ),
);

const THREADED_HOSTCALL_MODULE_BYTES = new Uint8Array([
  // (module
  //   (import "env" "memory" (memory 1 1 shared))
  //   (import "wasi" "thread-spawn" (func (param i32) (result i32)))
  //   (import "space_data_module_host" "call"
  //     (func (param i32 i32 i32 i32) (result i32)))
  //   (func (export "attempt_spawn") (result i32)
  //     i32.const 123
  //     call 0)
  //   (func (export "wasi_thread_start") (param i32 i32)))
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x17, 0x04, 0x60,
  0x01, 0x7f, 0x01, 0x7f, 0x60, 0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x01, 0x7f,
  0x60, 0x00, 0x01, 0x7f, 0x60, 0x02, 0x7f, 0x7f, 0x00, 0x02, 0x42, 0x03,
  0x03, 0x65, 0x6e, 0x76, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02,
  0x03, 0x01, 0x01, 0x04, 0x77, 0x61, 0x73, 0x69, 0x0c, 0x74, 0x68, 0x72,
  0x65, 0x61, 0x64, 0x2d, 0x73, 0x70, 0x61, 0x77, 0x6e, 0x00, 0x00, 0x16,
  0x73, 0x70, 0x61, 0x63, 0x65, 0x5f, 0x64, 0x61, 0x74, 0x61, 0x5f, 0x6d,
  0x6f, 0x64, 0x75, 0x6c, 0x65, 0x5f, 0x68, 0x6f, 0x73, 0x74, 0x04, 0x63,
  0x61, 0x6c, 0x6c, 0x00, 0x01, 0x03, 0x03, 0x02, 0x02, 0x03, 0x07, 0x25,
  0x02, 0x0d, 0x61, 0x74, 0x74, 0x65, 0x6d, 0x70, 0x74, 0x5f, 0x73, 0x70,
  0x61, 0x77, 0x6e, 0x00, 0x02, 0x11, 0x77, 0x61, 0x73, 0x69, 0x5f, 0x74,
  0x68, 0x72, 0x65, 0x61, 0x64, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00,
  0x03, 0x0a, 0x0c, 0x02, 0x07, 0x00, 0x41, 0xfb, 0x00, 0x10, 0x00, 0x0b,
  0x02, 0x00, 0x0b,
]);

const STANDALONE_THREADED_MODULE_BYTES = new Uint8Array([
  // Same thread-spawn probe without guest hostcall imports. The default Node
  // worker can instantiate it and must retain real pthread behavior.
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x0f, 0x03, 0x60,
  0x01, 0x7f, 0x01, 0x7f, 0x60, 0x00, 0x01, 0x7f, 0x60, 0x02, 0x7f, 0x7f,
  0x00, 0x02, 0x24, 0x02, 0x03, 0x65, 0x6e, 0x76, 0x06, 0x6d, 0x65, 0x6d,
  0x6f, 0x72, 0x79, 0x02, 0x03, 0x01, 0x01, 0x04, 0x77, 0x61, 0x73, 0x69,
  0x0c, 0x74, 0x68, 0x72, 0x65, 0x61, 0x64, 0x2d, 0x73, 0x70, 0x61, 0x77,
  0x6e, 0x00, 0x00, 0x03, 0x03, 0x02, 0x01, 0x02, 0x07, 0x25, 0x02, 0x0d,
  0x61, 0x74, 0x74, 0x65, 0x6d, 0x70, 0x74, 0x5f, 0x73, 0x70, 0x61, 0x77,
  0x6e, 0x00, 0x01, 0x11, 0x77, 0x61, 0x73, 0x69, 0x5f, 0x74, 0x68, 0x72,
  0x65, 0x61, 0x64, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x02, 0x0a,
  0x0c, 0x02, 0x07, 0x00, 0x41, 0xfb, 0x00, 0x10, 0x00, 0x0b, 0x02, 0x00,
  0x0b,
]);

test("a direct harness declines hostcall-importing pthreads without an owning broker", async (t) => {
  const originalInstantiate = WebAssembly.instantiate;
  let instantiateCount = 0;
  let hostcallCount = 0;
  // Count instantiations OF THE GUEST, not every instantiation in the process.
  // WebAssembly.instantiate is global and Node instantiates its own wasm on it:
  // undici brings up the llhttp parser lazily (`lazyllhttp`), and on Node 20/22
  // that lands inside this mock's window, so an unfiltered counter reported 2
  // and blamed the SDK for the runtime's HTTP stack. Compiling the guest here
  // gives an identity to match on — and passing a Module rather than bytes is
  // the hygiene rule anyway: compile once, hand the Module across.
  const guestModule = await WebAssembly.compile(THREADED_HOSTCALL_MODULE_BYTES);
  t.mock.method(WebAssembly, "instantiate", function (...args) {
    if (args[0] === guestModule) {
      instantiateCount += 1;
    }
    return Reflect.apply(originalInstantiate, this, args);
  });

	const harness = await createBrowserModuleHarness({
		wasmSource: guestModule,
		initialMemoryBytes: 65_536,
		maximumMemoryBytes: 65_536,
		hostcallDispatch() {
			hostcallCount += 1;
			throw new Error("the hostcall fixture must not be invoked");
		},
	});
	t.after(() => harness.destroy());

	assert.equal(instantiateCount, 1, "the main guest was instantiated once");
	assert.equal(harness.instance.exports.attempt_spawn(), -1);
	assert.equal(harness.threadHost.spawnCount(), 0);
	assert.equal(
		hostcallCount,
		0,
		"no worker executes without a live request-isolated hostcall broker",
	);
});

test("wasi-thread host retains worker spawning for standalone threaded modules", async (t) => {
  const harness = await createBrowserModuleHarness({
    wasmSource: STANDALONE_THREADED_MODULE_BYTES,
    initialMemoryBytes: 65_536,
    maximumMemoryBytes: 65_536,
  });
  t.after(() => harness.destroy());

  assert.ok(harness.instance.exports.attempt_spawn() > 0);
  assert.equal(harness.threadHost.spawnCount(), 1);
});

test("nested pthread hostcalls reach the owning application-blind dispatcher", async (t) => {
  const calls = [];
  const harness = await createWorkerModuleHarness({
    wasmSource: WORKER_HOSTCALL_MODULE_BYTES,
    dispatchHost: async (operation, params) => {
      calls.push({ operation, params });
      return { accepted: true };
    },
    harnessOptions: {
      initialMemoryBytes: 65_536,
      maximumMemoryBytes: 65_536,
    },
  });
  t.after(() => harness.destroy());

  assert.equal(
    await harness.callExport("run_worker_hostcall"),
    1,
    "the worker sees a successful generic hostcall status",
  );
  assert.deepEqual(calls, [{ operation: "test.worker", params: null }]);
});
