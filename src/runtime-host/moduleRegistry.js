function normalizeModuleId(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("moduleId must be a non-empty string");
  }
  return value.trim();
}

function cloneMetadata(value) {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function toPublicModuleRecord(moduleRecord) {
  return {
    moduleId: moduleRecord.moduleId,
    metadata: cloneMetadata(moduleRecord.metadata),
    methodIds: Object.keys(moduleRecord.methods),
  };
}

export function createModuleRegistry() {
  const modules = new Map();

  function installModule(definition) {
    if (!definition || typeof definition !== "object") {
      throw new TypeError("module definition is required");
    }
    const moduleId = normalizeModuleId(definition.moduleId);
    const moduleRecord = {
      moduleId,
      methods: {
        ...(definition.methods ?? {}),
      },
      metadata: cloneMetadata(definition.metadata),
    };
    modules.set(moduleId, moduleRecord);
    return toPublicModuleRecord(moduleRecord);
  }

  function loadModule(moduleId) {
    const moduleRecord = modules.get(normalizeModuleId(moduleId));
    if (!moduleRecord) {
      return null;
    }
    return {
      moduleId: moduleRecord.moduleId,
      methods: {
        ...moduleRecord.methods,
      },
      metadata: cloneMetadata(moduleRecord.metadata),
    };
  }

  function unloadModule(moduleId) {
    return modules.delete(normalizeModuleId(moduleId));
  }

  function listModules() {
    return Array.from(modules.values(), toPublicModuleRecord);
  }

  async function invokeModule(moduleId, methodId, ...args) {
    const moduleRecord = modules.get(normalizeModuleId(moduleId));
    if (!moduleRecord) {
      throw new Error(`Unknown module: ${moduleId}`);
    }
    const method = moduleRecord.methods?.[methodId];
    if (typeof method !== "function") {
      throw new Error(`Unknown module method: ${moduleId}.${methodId}`);
    }
    return method.call(
      {
        moduleId: moduleRecord.moduleId,
        metadata: cloneMetadata(moduleRecord.metadata),
      },
      ...args,
    );
  }

  return {
    installModule,
    invokeModule,
    listModules,
    loadModule,
    unloadModule,
  };
}
