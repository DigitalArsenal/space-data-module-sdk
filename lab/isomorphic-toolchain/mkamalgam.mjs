const WORK = process.env.SDM_TOOLCHAIN_WORK ?? "/private/tmp/claude-501/-Users-tj-software-spacedatanetwork-stack/73be8596-0028-4954-bb1c-8441229ac779/scratchpad";
// Reproduce codec/ccsds124-pocketplus/build.mjs's single guest TU verbatim.
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = `${WORK}/wt-codec/codec/ccsds124-pocketplus`;
const vendorRoot = path.join(ROOT, "vendor", "ccsds124");
const VENDOR_SOURCES = ["src/bitvector.c", "src/bitbuffer.c", "src/mask.c", "src/encode.c", "src/compress.c", "src/decompress.c"];
const LOCAL_INCLUDE = /^\s*#\s*include\s+"ccsds124\.h"\s*$/gm;
const strip = (s, label) => s.replace(LOCAL_INCLUDE, `/* amalgamated: ${label} */`);

const header = await fs.readFile(path.join(vendorRoot, "include", "ccsds124.h"), "utf8");
const parts = await Promise.all(VENDOR_SOURCES.map(async (r) =>
  strip(await fs.readFile(path.join(vendorRoot, r), "utf8"), `ccsds124/${r}`)));
const glue = await fs.readFile(path.join(ROOT, "src", "module.c"), "utf8");
const src = [strip(header, "ccsds124/include/ccsds124.h"), ...parts, strip(glue, "src/module.c (SDN invoke glue)")].join("\n\n");
const out = `${WORK}/tu/pocketplus.c`;
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, src);
console.log(out, src.length, "bytes", src.split("\n").length, "lines");
