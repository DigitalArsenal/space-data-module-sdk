const WORK = process.env.SDM_TOOLCHAIN_WORK ?? "/private/tmp/claude-501/-Users-tj-software-spacedatanetwork-stack/73be8596-0028-4954-bb1c-8441229ac779/scratchpad";
// spike.mjs — Phase 1 proof: compile the POCKET+ guest TU through the BOXED
// toolchain (llvm-box.wasm + content-addressed wasm32-wasip1-threads sysroot)
// under Node, and byte-diff against the native toolchain at identical flags.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { makeBox } from "./boxcc.mjs";

const SCR = WORK;
const TU = `${SCR}/tu/pocketplus.c`;
const HDR = `${SCR}/tu/space_data_module_invoke.h`;
const sha = (b) => createHash("sha256").update(b).digest("hex");

// The SDK's canonical wasi-threads guest-TU compile flags
// (compileModule.js buildSourceCompilerArgs + toolchain.toolchainArgs).
const FLAGS = ["-O3", "-mbulk-memory", "-DNDEBUG", "-matomics", "-fno-exceptions", "-pthread"];
const TARGET = "--target=wasm32-wasip1-threads";

const results = {};

// ---------- BOXED (Node lane) ----------
{
  const t0 = performance.now();
  const box = await makeBox({ mountSysroot: true, cIncludeOnly: true });
  const mountMs = performance.now() - t0;
  box.M.FS.writeFile("/work/pocketplus.c", fs.readFileSync(TU));
  box.M.FS.writeFile("/work/space_data_module_invoke.h", fs.readFileSync(HDR));
  const argv = ["clang", "clang", TARGET, "--sysroot=/sysroot", "-c", "/work/pocketplus.c",
    "-I/work", ...FLAGS, "-o", "/work/out.o"];
  const r = box.exec(argv);
  console.log(`[box] boot+mount ${mountMs.toFixed(0)}ms (mounted ${box.mounted.files} files) compile rc=${r.rc} ${r.ms.toFixed(0)}ms mem=${(box.memBytes() / 1048576).toFixed(1)}MB`);
  if (r.stderr) console.log("[box stderr]\n" + r.stderr.slice(0, 4000));
  if (r.rc === 0) {
    const o = Buffer.from(box.M.FS.readFile("/work/out.o"));
    fs.writeFileSync(`${SCR}/out/box16.o`, o);
    results.box16 = { bytes: o.length, sha: sha(o), ms: r.ms, memMB: box.memBytes() / 1048576, mountMs };
  } else {
    results.box16 = { rc: r.rc, stderr: r.stderr.slice(0, 2000) };
  }
  // second run for warm timing
  if (r.rc === 0) {
    const r2 = box.exec(argv);
    const o2 = Buffer.from(box.M.FS.readFile("/work/out.o"));
    results.box16.warmMs = r2.ms;
    results.box16.deterministic = sha(o2) === results.box16.sha;
    results.box16.peakMemMB = box.memBytes() / 1048576;
  }
}

// ---------- NATIVE homebrew clang 22.1.2 (the SDK's SDN_WASI_CLANG path) ----------
{
  const out = `${SCR}/out/native22.o`;
  const args = [TARGET, "--sysroot=/opt/homebrew/share/wasi-sysroot",
    "-resource-dir=/opt/homebrew/share/wasi-runtimes",
    "-c", TU, `-I${SCR}/tu`, ...FLAGS, "-o", out];
  const t = performance.now();
  try {
    execFileSync("wasm32-wasi-clang", args, { stdio: ["ignore", "pipe", "pipe"] });
    const ms = performance.now() - t;
    const o = fs.readFileSync(out);
    results.native22 = { bytes: o.length, sha: sha(o), ms };
  } catch (e) {
    results.native22 = { err: String(e.stderr || e.message).slice(0, 2000) };
  }
}

// ---------- NATIVE against the PACKAGED sysroot (isolates sysroot from codegen) ----------
{
  const S = `${SCR}/tc/flowcc-toolchain/sysroot-wasi-threads`;
  const out = `${SCR}/out/native22_pkgsysroot.o`;
  const args = [TARGET, `--sysroot=${S}`, "-resource-dir=/opt/homebrew/share/wasi-runtimes",
    "-c", TU, `-I${SCR}/tu`, ...FLAGS, "-o", out];
  try {
    execFileSync("wasm32-wasi-clang", args, { stdio: ["ignore", "pipe", "pipe"] });
    const o = fs.readFileSync(out);
    results.native22_pkgSysroot = { bytes: o.length, sha: sha(o) };
  } catch (e) {
    results.native22_pkgSysroot = { err: String(e.stderr || e.message).slice(0, 1200) };
  }
}

fs.mkdirSync(`${SCR}/out`, { recursive: true });
console.log(JSON.stringify(results, null, 2));
