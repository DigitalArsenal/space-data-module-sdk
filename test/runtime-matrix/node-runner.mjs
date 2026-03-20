import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WASI } from "node:wasi";

function readSpec(specPath) {
  return JSON.parse(fs.readFileSync(specPath, "utf8"));
}

function main() {
  const specPath = process.argv[2];
  if (!specPath) {
    return;
  }

  const spec = readSpec(specPath);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "space-data-module-sdk-node-runner-"));
  const stdinPath = path.join(tempRoot, "stdin.bin");
  const stdoutPath = path.join(tempRoot, "stdout.bin");
  const stderrPath = path.join(tempRoot, "stderr.bin");
  fs.writeFileSync(stdinPath, Buffer.from(spec.stdinBase64 ?? "", "base64"));
  fs.writeFileSync(stdoutPath, new Uint8Array());
  fs.writeFileSync(stderrPath, new Uint8Array());

  const stdin = fs.openSync(stdinPath, "r");
  const stdout = fs.openSync(stdoutPath, "w+");
  const stderr = fs.openSync(stderrPath, "w+");

  try {
    const env = { ...(spec.env ?? {}) };
    const args = Array.isArray(spec.args) ? spec.args : [];
    const preopens = {};
    for (const entry of Array.isArray(spec.preopens) ? spec.preopens : []) {
      preopens[entry.guestPath] = entry.hostPath;
    }

    const wasi = new WASI({
      version: "preview1",
      args,
      env,
      preopens,
      stdin,
      stdout,
      stderr,
      returnOnExit: true,
    });

    const module = new WebAssembly.Module(fs.readFileSync(spec.wasmPath));
    const instance = new WebAssembly.Instance(module, wasi.getImportObject());
    const exitCode = wasi.start(instance);

    fs.closeSync(stdin);
    fs.closeSync(stdout);
    fs.closeSync(stderr);

    process.stdout.write(
      JSON.stringify({
        ok: true,
        exitCode,
        stdoutBase64: fs.readFileSync(stdoutPath).toString("base64"),
        stderrBase64: fs.readFileSync(stderrPath).toString("base64"),
      }),
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
