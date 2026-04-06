import { createFlatSqlRuntimeStore } from "./flatsqlRuntimeStore.js";
import { createRuntimeRegionStore } from "./runtimeRegionStore.js";
import { createModuleRegistry } from "./moduleRegistry.js";

export function createRuntimeHost(options = {}) {
  const rows = options.rows ?? createFlatSqlRuntimeStore();
  const regions = options.regions ?? createRuntimeRegionStore();
  const moduleRegistry = options.moduleRegistry ?? createModuleRegistry();

  return {
    rows,
    regions,
    moduleRegistry,
  };
}

export {
  createFlatSqlRuntimeStore,
  createModuleRegistry,
  createRuntimeRegionStore,
};
