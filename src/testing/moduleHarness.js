import {
  createPluginInvokeProcessClient,
  createWasmEdgeStreamProcessClient,
  resolveWasmEdgePluginLaunchPlan,
} from "./processInvoke.js";
import {
  isStagedModuleArtifact,
  stageModuleArtifact,
} from "../bundle/stageModuleArtifact.js";

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

function hasWasmPath(definition) {
  return (
    typeof definition?.wasmPath === "string" &&
    definition.wasmPath.trim().length > 0
  );
}

/**
 * The module harness hands WasmEdge FILE PATHS, so every path it launches or
 * installs is first staged through the one load path
 * (`stageModuleArtifact` -> `openModuleArtifact`): read once, signature
 * checked, trailer stripped, written to a private file the engine reads
 * instead of the artifact as delivered. A caller may pass a `stagedArtifact`
 * it staged itself (it must be a genuine `stageModuleArtifact` result); the
 * harness owns and disposes every stage it launches from.
 *
 * An explicit `launchPlan` is the caller's own command line and is launched as
 * given — the caller has taken responsibility for what it points at.
 */
export async function createModuleHarness(options = {}) {
  let runtime = normalizeRuntimeDescriptor(options);
  const kind = String(runtime.kind ?? "process").trim().toLowerCase();
  const stages = new Set();
  const stagesByModuleId = new Map();
  const disposeStages = async (list = [...stages]) => {
    for (const staged of list) {
      stages.delete(staged);
      await staged.dispose();
    }
  };
  const stageFor = async (definition) => {
    let staged;
    if (definition.stagedArtifact !== undefined) {
      if (!isStagedModuleArtifact(definition.stagedArtifact)) {
        throw new TypeError(
          "stagedArtifact must be the result of stageModuleArtifact().",
        );
      }
      staged = definition.stagedArtifact;
    } else {
      staged = await stageModuleArtifact(definition.wasmPath, {
        verifySignature: definition.verifySignature ?? runtime.verifySignature,
      });
    }
    stages.add(staged);
    return staged;
  };
  const stagedDefinition = async (definition) => {
    if (
      kind !== "wasmedge" ||
      (definition.stagedArtifact === undefined && !hasWasmPath(definition))
    ) {
      return { definition, staged: null };
    }
    const staged = await stageFor(definition);
    const { stagedArtifact: _staged, verifySignature: _policy, ...rest } = definition;
    return { definition: { ...rest, wasmPath: staged.path }, staged };
  };

  let defaultStage = null;
  if (
    kind === "wasmedge" &&
    !(runtime.launchPlan && typeof runtime.launchPlan === "object") &&
    (runtime.stagedArtifact !== undefined || hasWasmPath(runtime))
  ) {
    defaultStage = await stageFor(runtime);
    const { stagedArtifact: _staged, ...rest } = runtime;
    runtime = { ...rest, wasmPath: defaultStage.path };
  }

  let processClient;
  let launchPlan;
  const runtimeHost = isRuntimeHostProfile(runtime);
  try {
    launchPlan = resolveModuleHarnessLaunchPlan({ runtime });
    processClient =
      kind === "wasmedge"
        ? await createWasmEdgeStreamProcessClient({ launchPlan })
        : await createPluginInvokeProcessClient({ launchPlan });
  } catch (error) {
    await disposeStages();
    throw error;
  }
  const installStaged = async (definition) => {
    const { definition: launchable, staged } = await stagedDefinition(definition);
    let installed;
    try {
      installed = await processClient.installModule(launchable);
    } catch (error) {
      if (staged) await disposeStages([staged]);
      throw error;
    }
    const moduleId = installed?.moduleId ?? launchable.moduleId;
    if (staged && typeof moduleId === "string") {
      const previous = stagesByModuleId.get(moduleId);
      if (previous && previous !== staged) await disposeStages([previous]);
      stagesByModuleId.set(moduleId, staged);
    }
    return installed;
  };

  const configuredModules = Array.isArray(runtime.modules) ? [...runtime.modules] : [];
  if (
    kind === "wasmedge" &&
    runtimeHost &&
    configuredModules.length === 0 &&
    defaultStage
  ) {
    configuredModules.push({
      moduleId:
        typeof runtime.defaultModuleId === "string" &&
        runtime.defaultModuleId.trim().length > 0
          ? runtime.defaultModuleId.trim()
          : "default",
      stagedArtifact: defaultStage,
      metadata: runtime.metadata ?? null,
    });
  }

  try {
    for (const moduleDefinition of configuredModules) {
      await installStaged(moduleDefinition);
    }
  } catch (error) {
    await processClient.destroy();
    await disposeStages();
    throw error;
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
      const installed = await installStaged(definition);
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
      if (unloaded && stagesByModuleId.has(moduleId)) {
        await disposeStages([stagesByModuleId.get(moduleId)]);
        stagesByModuleId.delete(moduleId);
      }
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
    async destroy() {
      try {
        return await processClient.destroy();
      } finally {
        await disposeStages();
      }
    },
  };
}
