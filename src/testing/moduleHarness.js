import {
  createPluginInvokeProcessClient,
  createWasmEdgeStreamProcessClient,
  resolveWasmEdgePluginLaunchPlan,
} from "./processInvoke.js";

function normalizeRuntimeDescriptor(options = {}) {
  if (options.runtime && typeof options.runtime === "object") {
    return options.runtime;
  }
  return options;
}

function isRuntimeHostProfile(runtime = {}) {
  return (
    String(runtime.hostProfile ?? "").trim().toLowerCase() === "runtime-host" ||
    Array.isArray(runtime.modules) ||
    (typeof runtime.defaultModuleId === "string" &&
      runtime.defaultModuleId.trim().length > 0)
  );
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
  const runtimeHost = isRuntimeHostProfile(runtime);
  const processClient =
    kind === "wasmedge"
      ? await createWasmEdgeStreamProcessClient({ launchPlan })
      : await createPluginInvokeProcessClient({ launchPlan });
  const configuredModules = Array.isArray(runtime.modules) ? [...runtime.modules] : [];
  if (
    kind === "wasmedge" &&
    runtimeHost &&
    configuredModules.length === 0 &&
    typeof runtime.wasmPath === "string" &&
    runtime.wasmPath.trim().length > 0
  ) {
    configuredModules.push({
      moduleId:
        typeof runtime.defaultModuleId === "string" &&
        runtime.defaultModuleId.trim().length > 0
          ? runtime.defaultModuleId.trim()
          : "default",
      wasmPath: runtime.wasmPath,
      metadata: runtime.metadata ?? null,
    });
  }

  for (const moduleDefinition of configuredModules) {
    await processClient.installModule(moduleDefinition);
  }

  let defaultModuleId =
    typeof runtime.defaultModuleId === "string" && runtime.defaultModuleId.trim().length > 0
      ? runtime.defaultModuleId.trim()
      : configuredModules[0]?.moduleId ?? null;

  return {
    runtime: {
      ...runtime,
      kind,
      hostProfile: runtimeHost ? "runtime-host" : runtime.hostProfile,
    },
    launchPlan,
    invokeRaw(requestBytes) {
      return processClient.invokeRaw(requestBytes);
    },
    invoke(request) {
      if (runtimeHost) {
        if (!defaultModuleId) {
          throw new Error(
            "Runtime-host invoke() requires an installed defaultModuleId.",
          );
        }
        return processClient.invokeModule(defaultModuleId, request);
      }
      return processClient.invoke(request);
    },
    async installModule(definition) {
      const installed = await processClient.installModule(definition);
      if (
        runtimeHost &&
        (!defaultModuleId || defaultModuleId.trim().length === 0) &&
        typeof installed?.moduleId === "string" &&
        installed.moduleId.trim().length > 0
      ) {
        defaultModuleId = installed.moduleId.trim();
      }
      return installed;
    },
    listModules() {
      return processClient.listModules();
    },
    async unloadModule(moduleId) {
      const unloaded = await processClient.unloadModule(moduleId);
      if (unloaded && moduleId === defaultModuleId) {
        if (runtimeHost) {
          const remainingModules = await processClient.listModules();
          defaultModuleId = remainingModules[0]?.moduleId ?? null;
        } else {
          defaultModuleId = null;
        }
      }
      return unloaded;
    },
    invokeModule(moduleId, request) {
      return processClient.invokeModule(moduleId, request);
    },
    appendRow(options) {
      return processClient.appendRow(options);
    },
    listRows(schemaFileId = null) {
      return processClient.listRows(schemaFileId);
    },
    resolveRow(handle) {
      return processClient.resolveRow(handle);
    },
    queryRows(sql) {
      return processClient.queryRows(sql);
    },
    allocateRegion(options) {
      return processClient.allocateRegion(options);
    },
    describeRegion(regionId) {
      return processClient.describeRegion(regionId);
    },
    resolveRecord(query) {
      return processClient.resolveRecord(query);
    },
    destroy() {
      return processClient.destroy();
    },
  };
}
