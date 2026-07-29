const WORK = process.env.SDM_TOOLCHAIN_WORK ?? "/private/tmp/claude-501/-Users-tj-software-spacedatanetwork-stack/73be8596-0028-4954-bb1c-8441229ac779/scratchpad";
// browserlane.mjs — third lane: compile the POCKET+ TU through the SAME
// llvm-box.wasm + SAME packaged wasi-threads sysroot inside real headless
// Chrome (never jsdom), and report the object's sha256.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";

const SCR = WORK;
const TC = `${SCR}/tc/flowcc-toolchain`;
const SYS = `${TC}/sysroot-wasi-threads`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// ---- build the include pack (index + one blob) ----
const entries = [];
const chunks = [];
let off = 0;
const add = (hostPath, guestPath) => {
  const b = fs.readFileSync(hostPath);
  entries.push([guestPath, off, b.length]);
  chunks.push(b);
  off += b.length;
};
for (const f of fs.readdirSync(`${SYS}/include`)) {
  const hp = `${SYS}/include/${f}`;
  if (fs.statSync(hp).isFile()) add(hp, `/sysroot/include/${f}`);
}
const walk = (h, g) => {
  for (const e of fs.readdirSync(h, { withFileTypes: true })) {
    const hp = path.join(h, e.name), gp = `${g}/${e.name}`;
    let st; try { st = fs.statSync(hp); } catch { continue; }
    if (st.isDirectory()) walk(hp, gp);
    else if (st.isFile()) add(hp, gp);
  }
};
walk(`${SYS}/include/wasm32-wasip1-threads`, "/sysroot/include/wasm32-wasip1-threads");
const blob = Buffer.concat(chunks);
console.log(`[pack] ${entries.length} files ${(blob.length / 1048576).toFixed(1)}MB`);

const boxWasm = fs.readFileSync(`${TC}/llvm-box.wasm`);
const boxGlue = fs.readFileSync(`${SCR}/box/llvm-box.patched.mjs`);
const tu = fs.readFileSync(`${SCR}/tu/pocketplus.c`);
const hdr = fs.readFileSync(`${SCR}/tu/space_data_module_invoke.h`);

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body><pre id=s>booting</pre>
<script type="module">
const S = document.getElementById("s");
const log = (m) => { S.textContent += "\\n" + m; };
const post = (o) => fetch("/done", { method: "POST", body: JSON.stringify(o) });
try {
  const t0 = performance.now();
  const [boxWasm, packIndex, packBlob, tu, hdr] = await Promise.all([
    fetch("/box.wasm").then(r => r.arrayBuffer()),
    fetch("/pack.json").then(r => r.json()),
    fetch("/pack.bin").then(r => r.arrayBuffer()),
    fetch("/tu.c").then(r => r.arrayBuffer()),
    fetch("/hdr.h").then(r => r.arrayBuffer()),
  ]);
  const fetchMs = performance.now() - t0;
  log("fetched " + fetchMs.toFixed(0) + "ms");
  const mod = await import("/glue.mjs");
  const t1 = performance.now();
  const M = await mod.default({ wasmBinary: new Uint8Array(boxWasm), noInitialRun: true, noExitRuntime: true,
    print: () => {}, printErr: (...a) => errBuf.push(a.join(" ")) });
  let errBuf = [];
  M.printErr = (...a) => errBuf.push(a.join(" "));
  const bootMs = performance.now() - t1;
  const mkdirp = (g) => { let c = ""; for (const p of g.split("/").filter(Boolean)) { c += "/" + p; try { M.FS.mkdir(c); } catch {} } };
  const blobU8 = new Uint8Array(packBlob);
  const t2 = performance.now();
  for (const [p, o, n] of packIndex) { mkdirp(p.slice(0, p.lastIndexOf("/"))); M.FS.writeFile(p, blobU8.subarray(o, o + n)); }
  mkdirp("/work");
  M.FS.writeFile("/work/pocketplus.c", new Uint8Array(tu));
  M.FS.writeFile("/work/space_data_module_invoke.h", new Uint8Array(hdr));
  const mountMs = performance.now() - t2;
  const argv = ["clang","clang","--target=wasm32-wasip1-threads","--sysroot=/sysroot","-c","/work/pocketplus.c",
    "-I/work","-O3","-mbulk-memory","-DNDEBUG","-matomics","-fno-exceptions","-pthread","-o","/work/out.o"];
  const argc = argv.length;
  const argvPtr = M._malloc((argc + 1) * 4);
  const enc = new TextEncoder();
  for (let i = 0; i < argc; i++) {
    const bytes = enc.encode(argv[i] + "\\0");
    const p = M._malloc(bytes.length);
    new Uint8Array(M.HEAPU8.buffer).set(bytes, p);
    new Int32Array(M.HEAPU8.buffer)[(argvPtr >> 2) + i] = p;
  }
  new Int32Array(M.HEAPU8.buffer)[(argvPtr >> 2) + argc] = 0;
  const t3 = performance.now();
  let rc = 0;
  try { rc = M._main(argc, argvPtr); } catch (e) { rc = (e && "status" in e) ? e.status : -42; errBuf.push(String(e && e.message || e)); }
  const compileMs = performance.now() - t3;
  let sha = null, bytes = 0;
  if (rc === 0) {
    const o = M.FS.readFile("/work/out.o");
    bytes = o.length;
    const d = await crypto.subtle.digest("SHA-256", o);
    sha = [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  await post({ ok: true, rc, bytes, sha, fetchMs, bootMs, mountMs, compileMs,
    heapMB: M.HEAPU8.buffer.byteLength / 1048576,
    jsHeapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
    stderr: errBuf.join("\\n").slice(0, 2000), ua: navigator.userAgent });
} catch (e) { await post({ ok: false, error: String(e && e.stack || e) }); }
</script></body></html>`;

let resolveDone;
const done = new Promise((r) => { resolveDone = r; });
const H = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cache-Control": "no-store" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1");
  if (req.method === "POST" && u.pathname === "/done") {
    const c = []; req.on("data", (d) => c.push(d));
    req.on("end", () => { res.writeHead(200, H); res.end("ok"); resolveDone(JSON.parse(Buffer.concat(c).toString())); });
    return;
  }
  const send = (body, type) => { res.writeHead(200, { ...H, "Content-Type": type }); res.end(body); };
  switch (u.pathname) {
    case "/": return send(PAGE, "text/html");
    case "/glue.mjs": return send(boxGlue, "text/javascript");
    case "/box.wasm": return send(boxWasm, "application/wasm");
    case "/pack.json": return send(JSON.stringify(entries), "application/json");
    case "/pack.bin": return send(blob, "application/octet-stream");
    case "/tu.c": return send(tu, "text/plain");
    case "/hdr.h": return send(hdr, "text/plain");
    default: res.writeHead(404, H); res.end("nope");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const profile = mkdtempSync(path.join(os.tmpdir(), "boxlane-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
  `--user-data-dir=${profile}`, "--js-flags=--max-old-space-size=8192", `http://127.0.0.1:${port}/`],
  { stdio: ["ignore", "pipe", "pipe"] });
let killed = false;
const timer = setTimeout(() => { killed = true; chrome.kill("SIGKILL"); resolveDone({ ok: false, error: "timeout" }); }, 300000);
const result = await done;
clearTimeout(timer);
if (!killed) chrome.kill("SIGKILL");
server.close();
console.log(JSON.stringify(result, null, 2));
try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
process.exit(0);
