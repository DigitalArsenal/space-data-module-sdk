const WORK = process.env.SDM_TOOLCHAIN_WORK ?? "/private/tmp/claude-501/-Users-tj-software-spacedatanetwork-stack/73be8596-0028-4954-bb1c-8441229ac779/scratchpad";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { makeBox } from "./boxcc.mjs";
const SCR=WORK;
const sha=b=>createHash("sha256").update(b).digest("hex");
const FLAGS=["-O3","-mbulk-memory","-DNDEBUG","-matomics","-fno-exceptions","-pthread","-std=c++17"];
const T="--target=wasm32-wasip1-threads";
const box=await makeBox({mountSysroot:true,cIncludeOnly:false});
const mk=g=>{let c="";for(const p of g.split("/").filter(Boolean)){c+="/"+p;try{box.M.FS.mkdir(c);}catch{}}};
const put=(h,g)=>{const walk=(hh,gg)=>{mk(gg);for(const e of fs.readdirSync(hh,{withFileTypes:true})){const hp=hh+"/"+e.name,gp=gg+"/"+e.name;
 if(e.isDirectory())walk(hp,gp);else try{box.M.FS.writeFile(gp,fs.readFileSync(hp));}catch{}}};walk(h,g);};
put(`${SCR}/clang18inc/include`,"/lib/clang/16.0.0/include");   // the MISSING builtin headers
put(`${SCR}/tu/fbinc`,"/inc");
for(const f of fs.readdirSync(`${SCR}/tu`)) { const hp=`${SCR}/tu/${f}`; if(fs.statSync(hp).isFile()&&/\.(h|hpp)$/.test(f)) box.M.FS.writeFile("/work/"+f,fs.readFileSync(hp)); }
box.M.FS.writeFile("/work/orbits_module.cpp",fs.readFileSync(`${SCR}/tu/orbits_module.cpp`));
const before=box.memBytes();
const r=box.exec(["clang","clang++",T,"--sysroot=/sysroot","-c","/work/orbits_module.cpp","-I/work","-I/inc",...FLAGS,"-o","/work/orbits.o"]);
const rec={lane:"box-node",rc:r.rc,ms:Math.round(r.ms),heapBeforeMB:+(before/1048576).toFixed(1),heapPeakMB:+(box.memBytes()/1048576).toFixed(1)};
if(r.rc===0){const o=Buffer.from(box.M.FS.readFile("/work/orbits.o"));rec.obj=o.length;rec.sha=sha(o);
 const r2=box.exec(["clang","clang++",T,"--sysroot=/sysroot","-c","/work/orbits_module.cpp","-I/work","-I/inc",...FLAGS,"-o","/work/orbits.o"]);
 rec.warmMs=Math.round(r2.ms); rec.deterministic=sha(Buffer.from(box.M.FS.readFile("/work/orbits.o")))===rec.sha;
} else rec.stderr=(r.stderr||"").split("\n").slice(0,10).join(" | ");
console.log(JSON.stringify(rec,null,1));
const out=`${SCR}/out/orbits_native22.o`;const t=performance.now();
try{execFileSync("wasm32-wasi-clang++",[T,"--sysroot=/opt/homebrew/share/wasi-sysroot","-resource-dir=/opt/homebrew/share/wasi-runtimes","-c",`${SCR}/tu/orbits_module.cpp`,`-I${SCR}/tu`,`-I${SCR}/tu/fbinc`,...FLAGS,"-o",out],{stdio:["ignore","pipe","pipe"]});
 const o=fs.readFileSync(out);console.log(JSON.stringify({lane:"native22",ms:Math.round(performance.now()-t),obj:o.length,sha:sha(o)},null,1));
}catch(e){console.log("native err:",String(e.stderr||e.message).split("\n").slice(0,6).join(" | "));}
