import { randomUUID } from "node:crypto";

import { createSharedEmceptionSession } from "../../../src/compiler/emception.js";

export async function compileStandaloneWasiC(options = {}) {
  const sourceCode = String(options.sourceCode ?? "");
  if (!sourceCode.trim()) {
    throw new Error("compileStandaloneWasiC requires sourceCode.");
  }

  const session = createSharedEmceptionSession();
  const workDir = `/working/space-data-module-sdk-runtime-matrix-${randomUUID()}`;
  const sourcePath = `${workDir}/module.c`;
  const outputPath = `${workDir}/module.wasm`;

  return session.withLock((handle) => {
    try {
      handle.mkdirTree(workDir);
      handle.writeFile(sourcePath, sourceCode);
      handle.run(
        [
          "emcc",
          sourcePath,
          "-O2",
          "-s",
          "STANDALONE_WASM=1",
          "-o",
          outputPath,
        ].join(" "),
      );
      return handle.readFile(outputPath);
    } finally {
      handle.removeTree(workDir);
    }
  });
}
