import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

async function commandAvailable(command, args = ["--version"]) {
  try {
    await execFile(command, args);
    return true;
  } catch {
    return false;
  }
}

async function threadedRunnerAvailable() {
  const runnerBinary = process.env.WASMEDGE_RUNNER_BINARY;
  if (!runnerBinary) {
    return false;
  }
  try {
    await access(runnerBinary);
    return true;
  } catch {
    return false;
  }
}

async function buildMinimalThreadedWasm() {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "space-data-module-sdk-wasmedge-pthread-"),
  );
  const sourcePath = path.join(tempDir, "with_thread.c");
  const wasmPath = path.join(tempDir, "with_thread.wasm");
  const source = `
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>

static int value = 0;

static void *thread_main(void *arg) {
  (void)arg;
  value = 42;
  return (void *)(intptr_t)7;
}

int main(void) {
  pthread_t thread;
  void *result = 0;
  int rc = pthread_create(&thread, NULL, thread_main, NULL);
  if (rc != 0) {
    fprintf(stderr, "pthread_create rc=%d\\n", rc);
    return rc;
  }
  rc = pthread_join(thread, &result);
  if (rc != 0) {
    fprintf(stderr, "pthread_join rc=%d\\n", rc);
    return rc;
  }
  printf("value=%d result=%ld\\n", value, (long)(intptr_t)result);
  return value == 42 && (intptr_t)result == 7 ? 0 : 99;
}
`.trimStart();
  await writeFile(sourcePath, source, "utf8");
  await execFile("emcc", [
    sourcePath,
    "-O2",
    "-pthread",
    "-sSTANDALONE_WASM=1",
    "-sPURE_WASI=1",
    "-o",
    wasmPath,
  ]);
  return { tempDir, wasmPath };
}

test("threaded WasmEdge runner executes a real guest pthread_create flow", async (t) => {
  if (!(await threadedRunnerAvailable())) {
    t.skip("Set WASMEDGE_RUNNER_BINARY to verify real guest pthread creation.");
    return;
  }
  if (!(await commandAvailable("emcc"))) {
    t.skip("System emcc is not installed on this machine.");
    return;
  }

  const { tempDir, wasmPath } = await buildMinimalThreadedWasm();
  t.after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const { stdout, stderr } = await execFile(
    process.env.WASMEDGE_RUNNER_BINARY,
    [wasmPath],
    {
      env: {
        ...process.env,
        DYLD_LIBRARY_PATH: "",
        DYLD_FALLBACK_LIBRARY_PATH: "",
        DYLD_FRAMEWORK_PATH: "",
        DYLD_FALLBACK_FRAMEWORK_PATH: "",
        LIBRARY_PATH: "",
      },
    },
  );

  assert.equal(stderr.trim(), "");
  assert.equal(stdout.trim(), "value=42 result=7");
});
