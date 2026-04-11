import { createFlatSqlRuntimeStore } from "./flatsqlRuntimeStore.js";
import { createFlatBufferStreamIngestor } from "./flatbufferStreamIngestor.js";
import { createRuntimeRegionStore } from "./runtimeRegionStore.js";
import { createModuleRegistry } from "./moduleRegistry.js";

function normalizeCapabilityId(capability) {
  const normalized = String(capability ?? "").trim();
  if (!normalized) {
    throw new TypeError("Capability id is required.");
  }
  return normalized;
}

function createCapabilityRegistry(capabilities = {}) {
  const entries =
    capabilities instanceof Map
      ? capabilities.entries()
      : Object.entries(capabilities ?? {});
  const registry = new Map();
  for (const [capability, adapter] of entries) {
    registry.set(normalizeCapabilityId(capability), adapter);
  }
  return registry;
}

export function createRuntimeHost(options = {}) {
  const rows = options.rows ?? createFlatSqlRuntimeStore();
  const regions = options.regions ?? createRuntimeRegionStore();
  const moduleRegistry = options.moduleRegistry ?? createModuleRegistry();
  const capabilities = createCapabilityRegistry(options.capabilities);

  return {
    rows,
    regions,
    moduleRegistry,
    listCapabilities() {
      return Array.from(capabilities.keys()).sort();
    },
    getCapability(capability) {
      return capabilities.get(normalizeCapabilityId(capability)) ?? null;
    },
    registerCapability(capability, adapter) {
      const normalized = normalizeCapabilityId(capability);
      capabilities.set(normalized, adapter);
      return adapter;
    },
    unregisterCapability(capability) {
      return capabilities.delete(normalizeCapabilityId(capability));
    },
    async invokeCapability(operation, params = {}) {
      const normalized = normalizeCapabilityId(operation);
      const separator = normalized.indexOf(".");
      const capabilityId =
        separator >= 0 ? normalized.slice(0, separator) : normalized;
      const methodId =
        separator >= 0 ? normalized.slice(separator + 1) : "invoke";
      const adapter = capabilities.get(capabilityId);
      if (!adapter || typeof adapter !== "object") {
        throw new Error(`Runtime host capability "${capabilityId}" is not registered.`);
      }
      if (typeof adapter[methodId] === "function") {
        return adapter[methodId](params);
      }
      if (typeof adapter.invoke === "function") {
        return adapter.invoke(methodId, params);
      }
      throw new Error(
        `Runtime host capability "${capabilityId}" does not implement "${methodId}" or invoke().`,
      );
    },
  };
}

export {
  createFlatBufferStreamIngestor,
  createFlatSqlRuntimeStore,
  createModuleRegistry,
  createRuntimeRegionStore,
};
