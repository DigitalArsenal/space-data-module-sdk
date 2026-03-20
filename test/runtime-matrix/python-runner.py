#!/usr/bin/env python3

import base64
import json
import os
import shutil
import sys
import tempfile

import wasmtime


def main() -> None:
    if len(sys.argv) < 2:
        raise RuntimeError("Expected spec path.")

    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        spec = json.load(handle)

    temp_root = tempfile.mkdtemp(prefix="space-data-module-sdk-python-runner-")
    stdin_path = os.path.join(temp_root, "stdin.bin")
    stdout_path = os.path.join(temp_root, "stdout.bin")
    stderr_path = os.path.join(temp_root, "stderr.bin")

    try:
        with open(stdin_path, "wb") as handle:
            handle.write(base64.b64decode(spec.get("stdinBase64", "")))
        open(stdout_path, "wb").close()
        open(stderr_path, "wb").close()

        engine = wasmtime.Engine()
        linker = wasmtime.Linker(engine)
        linker.define_wasi()
        module = wasmtime.Module.from_file(engine, spec["wasmPath"])

        wasi = wasmtime.WasiConfig()
        wasi.argv = list(spec.get("args", []))
        wasi.env = list((spec.get("env", {}) or {}).items())
        wasi.stdin_file = stdin_path
        wasi.stdout_file = stdout_path
        wasi.stderr_file = stderr_path
        for entry in spec.get("preopens", []) or []:
            wasi.preopen_dir(entry["hostPath"], entry["guestPath"])

        store = wasmtime.Store(engine)
        store.set_wasi(wasi)

        instance = linker.instantiate(store, module)
        exit_code = 0
        try:
            instance.exports(store)["_start"](store)
        except wasmtime.ExitTrap as exc:
            exit_code = exc.code

        with open(stdout_path, "rb") as handle:
            stdout_b64 = base64.b64encode(handle.read()).decode("ascii")
        with open(stderr_path, "rb") as handle:
            stderr_b64 = base64.b64encode(handle.read()).decode("ascii")

        sys.stdout.write(
            json.dumps(
                {
                    "ok": True,
                    "exitCode": int(exit_code),
                    "stdoutBase64": stdout_b64,
                    "stderrBase64": stderr_b64,
                }
            )
        )
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == "__main__":
    main()
