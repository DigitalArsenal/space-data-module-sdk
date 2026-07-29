const WORK = process.env.SDM_TOOLCHAIN_WORK ?? "/private/tmp/claude-501/-Users-tj-software-spacedatanetwork-stack/73be8596-0028-4954-bb1c-8441229ac779/scratchpad";
// boxcc.mjs — minimal driver for emception's llvm-box.wasm under Node,
// mounting the content-addressed wasm32-wasip1-threads sysroot into MEMFS.
// Mirrors kubo/sdn/flowcc Run(): argv[0] selects the tool ("clang" | "lld").
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const BOX_DIR = `${WORK}/tc/flowcc-toolchain`;
const EMCEPTION = "/Users/tj/software/emception/build/emception";

const LlvmBoxModule = (await import(`${WORK}/box/llvm-box.patched.mjs`)).default;

function mkdirp(M, g) {
  const parts = g.split("/").filter(Boolean);
  let cur = "";
  for (const p of parts) {
    cur += "/" + p;
    try { M.FS.mkdir(cur); } catch {}
  }
}

function mirror(M, hostDir, guestDir, filter) {
  let files = 0, bytes = 0;
  const walk = (h, g) => {
    let ents;
    try { ents = fs.readdirSync(h, { withFileTypes: true }); } catch { return; }
    mkdirp(M, g);
    for (const e of ents) {
      const hp = path.join(h, e.name), gp = g + "/" + e.name;
      let st;
      try { st = fs.statSync(hp); } catch { continue; }
      if (st.isDirectory()) walk(hp, gp);
      else if (st.isFile()) {
        if (filter && !filter(hp)) continue;
        const b = fs.readFileSync(hp);
        try { M.FS.writeFile(gp, b); } catch { continue; }
        files++; bytes += b.length;
      }
    }
  };
  walk(hostDir, guestDir);
  return { files, bytes };
}

export async function makeBox({ mountSysroot = true, cIncludeOnly = true } = {}) {
  const wasmBinary = fs.readFileSync(path.join(BOX_DIR, "llvm-box.wasm"));
  const t0 = performance.now();
  const M = await LlvmBoxModule({
    wasmBinary,
    noInitialRun: true,
    noExitRuntime: true,
    print: (...a) => outBuf.push(a.join(" ")),
    printErr: (...a) => errBuf.push(a.join(" ")),
  });
  const bootMs = performance.now() - t0;

  let outBuf = [], errBuf = [];
  M.print = (...a) => outBuf.push(a.join(" "));
  M.printErr = (...a) => errBuf.push(a.join(" "));

  let mounted = { files: 0, bytes: 0 };
  if (mountSysroot) {
    const S = path.join(BOX_DIR, "sysroot-wasi-threads");
    try { M.FS.mkdir("/sysroot"); } catch {}
    try { M.FS.mkdir("/sysroot/include"); } catch {}
    // top-level grafted clang builtin headers
    for (const f of fs.readdirSync(path.join(S, "include"))) {
      const hp = path.join(S, "include", f);
      if (fs.statSync(hp).isFile()) {
        M.FS.writeFile("/sysroot/include/" + f, fs.readFileSync(hp));
        mounted.files++;
      }
    }
    const a = mirror(M, path.join(S, "include", "wasm32-wasip1-threads"), "/sysroot/include/wasm32-wasip1-threads");
    mounted.files += a.files; mounted.bytes += a.bytes;
    if (!cIncludeOnly) {
      const b = mirror(M, path.join(S, "include", "c++"), "/sysroot/include/c++");
      mounted.files += b.files; mounted.bytes += b.bytes;
    }
    const l = mirror(M, path.join(S, "lib", "wasm32-wasip1-threads"), "/sysroot/lib/wasm32-wasip1-threads");
    mounted.files += l.files; mounted.bytes += l.bytes;
  }
  try { M.FS.mkdir("/work"); } catch {}

  // snapshot heap for per-exec reset (clang driver has global state)
  const snapshot = M.HEAPU8 ? M.HEAPU8.slice() : null;

  function exec(argv, { reset = true } = {}) {
    outBuf = []; errBuf = [];
    if (reset && snapshot) {
      const h = M.HEAPU8;
      h.fill(0);
      h.set(snapshot);
    }
    const argc = argv.length;
    const argvPtr = M._malloc((argc + 1) * 4);
    const H32 = () => new Int32Array(M.HEAPU8.buffer);
    for (let i = 0; i < argc; i++) {
      const s = argv[i];
      const len = Buffer.byteLength(s) + 1;
      const p = M._malloc(len);
      Buffer.from(s + "\0").copy(Buffer.from(M.HEAPU8.buffer, p, len));
      H32()[(argvPtr >> 2) + i] = p;
    }
    H32()[(argvPtr >> 2) + argc] = 0;
    const t = performance.now();
    let rc = 0;
    try { rc = M._main(argc, argvPtr); }
    catch (e) { rc = (e && typeof e === "object" && "status" in e) ? e.status : -42; if (e?.message) errBuf.push(String(e.message)); }
    return { rc, ms: performance.now() - t, stdout: outBuf.join("\n"), stderr: errBuf.join("\n") };
  }

  return { M, exec, bootMs, mounted, memBytes: () => M.HEAPU8.buffer.byteLength };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const box = await makeBox({ mountSysroot: false });
  console.log(`boot ${box.bootMs.toFixed(0)}ms  mem ${(box.memBytes() / 1048576).toFixed(1)}MB`);
  const r = box.exec(["clang", "clang", "--version"]);
  console.log("rc", r.rc, "ms", r.ms.toFixed(0));
  console.log(r.stdout || r.stderr);
  const t = box.exec(["clang", "clang", "-print-targets"]);
  console.log((t.stdout || t.stderr).split("\n").filter(l => /wasm/.test(l)).join("\n"));
  const l = box.exec(["lld", "wasm-ld", "--version"]);
  console.log("lld:", l.stdout || l.stderr);
}
