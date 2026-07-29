const WORK = process.env.SDM_TOOLCHAIN_WORK ?? "/private/tmp/claude-501/-Users-tj-software-spacedatanetwork-stack/73be8596-0028-4954-bb1c-8441229ac779/scratchpad";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { makeBox } from "./boxcc.mjs";
const SCR = WORK;
const sha = b => createHash("sha256").update(b).digest("hex");
const box = await makeBox({ mountSysroot: true, cIncludeOnly: false });
// graft the REAL clang builtin headers at the box's resource-dir position
const mk = g => { let c=""; for (const p of g.split("/").filter(Boolean)) { c+="/"+p; try{box.M.FS.mkdir(c);}catch{} } };
mk("/lib/clang/16.0.0/include");
let n=0;
const walk=(h,g)=>{for(const e of fs.readdirSync(h,{withFileTypes:true})){const hp=h+"/"+e.name,gp=g+"/"+e.name;
 if(e.isDirectory()){mk(gp);walk(hp,gp);}else{try{box.M.FS.writeFile(gp,fs.readFileSync(hp));n++;}catch{}}}};
walk(`${SCR}/clang18inc/include`,"/lib/clang/16.0.0/include");
console.log("grafted", n, "clang builtin headers");
const FLAGS=["-O3","-mbulk-memory","-DNDEBUG","-matomics","-fno-exceptions","-pthread","-std=c++17"];
box.M.FS.writeFile("/work/cxxprobe.cpp", fs.readFileSync(`${SCR}/tu/cxxprobe.cpp`));
const r = box.exec(["clang","clang++","--target=wasm32-wasip1-threads","--sysroot=/sysroot","-c","/work/cxxprobe.cpp",...FLAGS,"-o","/work/cxx.o"]);
console.log("rc=",r.rc,"ms=",r.ms.toFixed(0),"mem=",(box.memBytes()/1048576).toFixed(1)+"MB");
if(r.rc!==0) console.log((r.stderr||"").split("\n").slice(0,14).join("\n"));
else { const o=Buffer.from(box.M.FS.readFile("/work/cxx.o")); console.log("obj",o.length,"sha",sha(o)); }
