export const DrainPolicy = Object.freeze({
  SINGLE_SHOT: "single-shot",
  DRAIN_UNTIL_YIELD: "drain-until-yield",
  DRAIN_TO_EMPTY: "drain-to-empty",
});

export const ExternalInterfaceDirection = Object.freeze({
  INPUT: "input",
  OUTPUT: "output",
  BIDIRECTIONAL: "bidirectional",
});

export const ExternalInterfaceKind = Object.freeze({
  CLOCK: "clock",
  RANDOM: "random",
  TIMER: "timer",
  PUBSUB: "pubsub",
  PROTOCOL: "protocol",
  HTTP: "http",
  FILESYSTEM: "filesystem",
  PIPE: "pipe",
  NETWORK: "network",
  DATABASE: "database",
  LOCAL_RUNTIME: "local-runtime",
  HOST_SERVICE: "host-service",
});

export const DefaultManifestExports = Object.freeze({
  pluginBytesSymbol: "plugin_get_manifest_flatbuffer",
  pluginSizeSymbol: "plugin_get_manifest_flatbuffer_size",
  flowBytesSymbol: "flow_get_manifest_flatbuffer",
  flowSizeSymbol: "flow_get_manifest_flatbuffer_size",
});

