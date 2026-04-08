import {
  createBrowserEdgeShims,
  createBrowserHost,
  loadModule,
} from "../../src/browser.js";

const output = document.querySelector("[data-output]");
const runButton = document.querySelector("[data-run]");
const artifactUrl = new URL("./generated/isomorphic-echo.wasm", import.meta.url);

function render(value) {
  output.textContent = JSON.stringify(value, null, 2);
}

async function runDemo() {
  const edgeShims = createBrowserEdgeShims();
  const host = createBrowserHost({
    capabilities: [
      "clock",
      "random",
      "timers",
      "schedule_cron",
      "filesystem",
      "http",
      "websocket",
      "context_read",
      "context_write",
      "crypto_hash",
      "crypto_encrypt",
      "crypto_decrypt",
      "logging",
    ],
    edgeShims,
  });
  const harness = await loadModule({
    wasmSource: artifactUrl.href,
    host,
    surface: "command",
  });

  try {
    await host.filesystem.mkdir("demo", { recursive: true });
    await host.filesystem.writeFile("demo/request.txt", "hello from the browser shim");
    const requestText = await host.filesystem.readFile("demo/request.txt", {
      encoding: "utf8",
    });

    const response = await harness.invoke({
      methodId: "echo",
      inputs: [
        {
          portId: "request",
          typeRef: {
            schemaName: "Blob.fbs",
            fileIdentifier: "BLOB",
          },
          payload: new TextEncoder().encode(requestText),
        },
      ],
    });

    const echoedText = new TextDecoder().decode(response.outputs[0].payload);
    await host.filesystem.writeFile("demo/response.txt", echoedText);

    render({
      artifactUrl: artifactUrl.href,
      runtime: harness.runtime,
      edgeShimCapabilities: host.listCapabilities(),
      edgeShimOperations: host
        .listOperations()
        .filter(
          (name) =>
            name.startsWith("filesystem.") ||
            name === "http.request" ||
            name === "websocket.exchange",
        ),
      requestPath: host.filesystem.resolvePath("demo/request.txt"),
      responsePath: host.filesystem.resolvePath("demo/response.txt"),
      responseStatusCode: response.statusCode,
      echoedText,
    });
  } catch (error) {
    render({
      error: error?.message ?? String(error),
    });
  } finally {
    harness.destroy();
  }
}

runButton?.addEventListener("click", () => {
  render({ status: "running" });
  runDemo();
});

render({
  status: "ready",
  artifactUrl: artifactUrl.href,
});
