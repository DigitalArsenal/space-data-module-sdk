import path from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadModule } from "../../src/index.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const artifactPath = path.join(currentDir, "generated", "isomorphic-echo.wasm");

await access(artifactPath);

const harness = await loadModule({
  wasmSource: artifactPath,
  runtimeKind: "wasmedge",
  enableThreads: false,
});

try {
  const response = await harness.invoke({
    methodId: "echo",
    inputs: [
      {
        portId: "request",
        typeRef: {
          schemaName: "Blob.fbs",
          fileIdentifier: "BLOB",
        },
        payload: new TextEncoder().encode("hello from WasmEdge"),
      },
    ],
  });

  console.log(
    JSON.stringify(
      {
        artifactPath,
        runtime: harness.runtime,
        responseStatusCode: response.statusCode,
        echoedText: new TextDecoder().decode(response.outputs[0].payload),
      },
      null,
      2,
    ),
  );
} finally {
  await harness.destroy();
}
