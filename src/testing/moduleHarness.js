import {
  createPluginInvokeProcessClient,
  resolveWasmEdgePluginLaunchPlan,
} from "./processInvoke.js";

function normalizeRuntimeDescriptor(options = {}) {
  if (options.runtime && typeof options.runtime === "object") {
    return options.runtime;
  }
  return options;
}

export function resolveModuleHarnessLaunchPlan(options = {}) {
  const runtime = normalizeRuntimeDescriptor(options);
  if (runtime.launchPlan && typeof runtime.launchPlan === "object") {
    return runtime.launchPlan;
  }

  const kind = String(runtime.kind ?? "process").trim().toLowerCase();
  if (kind === "wasmedge") {
    return resolveWasmEdgePluginLaunchPlan(runtime);
  }
  if (kind === "process") {
    if (typeof runtime.command !== "string" || runtime.command.trim().length === 0) {
      throw new Error(
        "resolveModuleHarnessLaunchPlan requires runtime.command for process runtimes.",
      );
    }
    return {
      command: runtime.command,
      args: Array.isArray(runtime.args) ? runtime.args : [],
      env: runtime.env,
      cwd: runtime.cwd,
    };
  }

  throw new Error(`Unsupported module harness runtime kind: ${kind}`);
}

export async function createModuleHarness(options = {}) {
  const runtime = normalizeRuntimeDescriptor(options);
  const kind = String(runtime.kind ?? "process").trim().toLowerCase();
  const launchPlan = resolveModuleHarnessLaunchPlan(options);
  const processClient = await createPluginInvokeProcessClient({ launchPlan });

  return {
    runtime: {
      ...runtime,
      kind,
    },
    launchPlan,
    invokeRaw(requestBytes) {
      return processClient.invokeRaw(requestBytes);
    },
    invoke(request) {
      return processClient.invoke(request);
    },
    destroy() {
      return processClient.destroy();
    },
  };
}
