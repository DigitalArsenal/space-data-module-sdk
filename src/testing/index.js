import { Buffer } from "node:buffer";

import { encodePluginInvokeRequest } from "../invoke/codec.js";
import { normalizeInvokeSurfaces } from "../invoke/index.js";
import { selectPreferredPayloadTypeRef } from "../manifest/typeRefs.js";
export {
  createPublicationProtectionDemoManifest,
  createPublicationProtectionDemoSummary,
} from "./publicationProtectionDemo.js";
export {
  createBrowserModuleHarness,
  detectArtifactProfile,
} from "./browserModuleHarness.js";
export {
  buildWasmEdgeSpawnEnv,
  createPluginInvokeProcessClient,
  createWasmEdgeStreamProcessClient,
  resolveWasmEdgePluginLaunchPlan,
} from "./processInvoke.js";
export {
  buildWasmEdgeEmscriptenPthreadRunner,
  resolveWasmEdgeRunnerBuildPlan,
  resolveWasmEdgeRunnerSourcePath,
} from "./buildWasmEdgeRunner.js";
export {
  createModuleHarness,
  resolveModuleHarnessLaunchPlan,
} from "./moduleHarness.js";

const CapabilitySurfaceMatrix = Object.freeze({
  logging: Object.freeze({
    capability: "logging",
    wasi: true,
    standaloneWasi: true,
    wasmedge: true,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "Portable guests can emit diagnostics through stdout/stderr.",
      "The current sync hostcall ABI does not expose a structured logging API.",
    ],
  }),
  clock: Object.freeze({
    capability: "clock",
    wasi: true,
    standaloneWasi: true,
    wasmedge: true,
    syncHostcall: true,
    nodeHostApi: true,
    notes: [
      "WASI runtimes can expose clock/time directly to standalone guests.",
      "The SDK sync hostcall bridge also exposes clock.now/clock.nowIso/clock.monotonicNow.",
    ],
  }),
  random: Object.freeze({
    capability: "random",
    wasi: true,
    standaloneWasi: true,
    wasmedge: true,
    syncHostcall: true,
    nodeHostApi: true,
    notes: [
      "WASI random_get is available to standalone guests.",
      "The sync hostcall ABI exposes random.bytes through a canonical base64 byte envelope.",
    ],
  }),
  timers: Object.freeze({
    capability: "timers",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "Timers are async host services today.",
      "They are not reachable through the current sync JSON hostcall ABI.",
    ],
  }),
  schedule_cron: Object.freeze({
    capability: "schedule_cron",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: true,
    nodeHostApi: true,
    notes: [
      "Schedule parsing/matching is available through sync hostcalls.",
    ],
  }),
  filesystem: Object.freeze({
    capability: "filesystem",
    wasi: true,
    standaloneWasi: true,
    wasmedge: true,
    syncHostcall: true,
    nodeHostApi: true,
    notes: [
      "WASI preopens are the preferred cross-runtime filesystem surface.",
      "The sync hostcall ABI currently exposes filesystem.resolvePath only.",
    ],
  }),
  pipe: Object.freeze({
    capability: "pipe",
    wasi: true,
    standaloneWasi: true,
    wasmedge: true,
    syncHostcall: false,
    nodeHostApi: false,
    notes: [
      "Portable WASI guests can rely on stdio descriptors as the current pipe surface.",
      "Named or ad hoc pipe services are not exposed through the current host APIs.",
    ],
  }),
  network: Object.freeze({
    capability: "network",
    wasi: false,
    standaloneWasi: false,
    wasmedge: true,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "The coarse network capability maps to host-side HTTP/TCP/UDP/TLS/WebSocket services today.",
      "Pure WASI guests cannot reach that surface through the current sync hostcall ABI.",
      "WasmEdge provides non-blocking socket-oriented extensions that can serve as the standard server-side max-WASI target.",
    ],
  }),
  http: Object.freeze({
    capability: "http",
    wasi: false,
    standaloneWasi: false,
    wasmedge: true,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "HTTP is currently available from the Node host API only.",
      "Pure WASM guests cannot reach it through the current sync hostcall ABI.",
      "Treat WasmEdge socket and TLS extensions as the no-wrapper server-side target for guest HTTP implementations.",
    ],
  }),
  websocket: Object.freeze({
    capability: "websocket",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "WebSocket exchange is async and host-only today.",
      "For no-wrapper parity, target guest WebSocket libraries built on WasmEdge sockets/TLS instead of a host API.",
    ],
  }),
  mqtt: Object.freeze({
    capability: "mqtt",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "MQTT publish/subscribe is async and host-only today.",
      "For no-wrapper parity, target guest MQTT libraries built on WasmEdge sockets/TLS instead of a host API.",
    ],
  }),
  tcp: Object.freeze({
    capability: "tcp",
    wasi: false,
    standaloneWasi: false,
    wasmedge: true,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "TCP request support exists in the Node host API only today.",
      "WasmEdge socket extensions provide a viable no-wrapper server-side target for guest TCP logic.",
    ],
  }),
  udp: Object.freeze({
    capability: "udp",
    wasi: false,
    standaloneWasi: false,
    wasmedge: true,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "UDP request support exists in the Node host API only today.",
      "WasmEdge socket extensions provide a viable no-wrapper server-side target for guest UDP logic.",
    ],
  }),
  tls: Object.freeze({
    capability: "tls",
    wasi: false,
    standaloneWasi: false,
    wasmedge: true,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "TLS request support exists in the Node host API only today.",
      "WasmEdge TLS support provides a practical no-wrapper server-side target for guest HTTPS/TLS logic.",
    ],
  }),
  context_read: Object.freeze({
    capability: "context_read",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "Context storage is not exposed through the sync hostcall ABI today.",
    ],
  }),
  context_write: Object.freeze({
    capability: "context_write",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "Context storage is not exposed through the sync hostcall ABI today.",
    ],
  }),
  crypto_hash: Object.freeze({
    capability: "crypto_hash",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "Hashing exists in the Node host API, but not the sync hostcall ABI.",
    ],
  }),
  crypto_sign: Object.freeze({
    capability: "crypto_sign",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "Signing exists in the Node host API, but not the sync hostcall ABI.",
    ],
  }),
  crypto_verify: Object.freeze({
    capability: "crypto_verify",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "Verification exists in the Node host API, but not the sync hostcall ABI.",
    ],
  }),
  crypto_encrypt: Object.freeze({
    capability: "crypto_encrypt",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "Encryption exists in the Node host API, but not the sync hostcall ABI.",
    ],
  }),
  crypto_decrypt: Object.freeze({
    capability: "crypto_decrypt",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "Decryption exists in the Node host API, but not the sync hostcall ABI.",
    ],
  }),
  crypto_key_agreement: Object.freeze({
    capability: "crypto_key_agreement",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "Key agreement exists in the Node host API, but not the sync hostcall ABI.",
    ],
  }),
  crypto_kdf: Object.freeze({
    capability: "crypto_kdf",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "KDF support exists in the Node host API, but not the sync hostcall ABI.",
    ],
  }),
  process_exec: Object.freeze({
    capability: "process_exec",
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: true,
    notes: [
      "Process execution is host-only today.",
    ],
  }),
});

function findDefaultTypeRef(port = {}, options = {}) {
  return selectPreferredPayloadTypeRef(port, {
    preferredWireFormat: options.preferredWireFormat,
  });
}

function normalizePayloadBytes(value) {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return new Uint8Array();
}

function buildDefaultInputs(method = {}, options = {}) {
  const inputs = [];
  for (const port of Array.isArray(method.inputPorts) ? method.inputPorts : []) {
    const required = port.required !== false;
    if (!required && options.includeOptionalInputs !== true) {
      continue;
    }
    const typeRef = findDefaultTypeRef(port, options);
    const payload = options.payloadForPort
      ? options.payloadForPort({
          methodId: method.methodId ?? null,
          portId: port.portId ?? null,
          port,
          required,
          typeRef,
        })
      : null;
    inputs.push({
      portId: port.portId ?? null,
      typeRef,
      payload: normalizePayloadBytes(payload),
    });
  }
  return inputs;
}

function buildMethodCase(method = {}, surface, options = {}) {
  const methodId = String(method.methodId ?? "").trim();
  return {
    id: `${surface}:${methodId}`,
    kind: "invoke",
    surface,
    methodId,
    displayName: method.displayName ?? methodId,
    inputs: buildDefaultInputs(method, options),
    requiredPortIds: (Array.isArray(method.inputPorts) ? method.inputPorts : [])
      .filter((port) => port.required !== false)
      .map((port) => port.portId ?? null)
      .filter(Boolean),
    expectedStatusCode:
      Number.isInteger(options.expectedStatusCode) ? options.expectedStatusCode : 0,
    notes: [
      `Generated smoke case for ${surface} surface.`,
      "Semantic assertions still require scenario-specific validators.",
    ],
  };
}

function encodeValue(value) {
  if (value instanceof Uint8Array) {
    return {
      type: "bytes",
      base64: Buffer.from(value).toString("base64"),
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => encodeValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, encodeValue(entry)]),
    );
  }
  return value;
}

export function describeCapabilityRuntimeSurface(capability) {
  const normalized = String(capability ?? "").trim();
  const known = CapabilitySurfaceMatrix[normalized];
  if (known) {
    return {
      capability: known.capability,
      wasi: known.wasi,
      standaloneWasi: known.standaloneWasi,
      wasmedge: known.wasmedge,
      syncHostcall: known.syncHostcall,
      nodeHostApi: known.nodeHostApi,
      notes: [...known.notes],
    };
  }
  return {
    capability: normalized,
    wasi: false,
    standaloneWasi: false,
    wasmedge: false,
    syncHostcall: false,
    nodeHostApi: false,
    notes: [
      "Capability is unknown to the SDK testing matrix.",
    ],
  };
}

export function generateManifestHarnessPlan(options = {}) {
  const manifest = options.manifest ?? {};
  const methods = Array.isArray(manifest.methods) ? manifest.methods : [];
  const invokeSurfaces = normalizeInvokeSurfaces(manifest.invokeSurfaces ?? ["direct"]);
  const generatedCases = [];
  for (const method of methods) {
    if (!method?.methodId) {
      continue;
    }
    for (const surface of invokeSurfaces) {
      generatedCases.push(buildMethodCase(method, surface, options));
    }
  }

  const customCases = Array.isArray(options.scenarios) ? options.scenarios : [];
  return {
    moduleKind:
      String(manifest.pluginFamily ?? "").trim().toLowerCase() === "flow"
        ? "flow"
        : "module",
    pluginId: manifest.pluginId ?? null,
    name: manifest.name ?? null,
    version: manifest.version ?? null,
    invokeSurfaces,
    methods: methods.map((method) => ({
      methodId: method.methodId ?? null,
      displayName: method.displayName ?? null,
      inputPorts: Array.isArray(method.inputPorts) ? method.inputPorts.length : 0,
      outputPorts: Array.isArray(method.outputPorts) ? method.outputPorts.length : 0,
    })),
    capabilities: (Array.isArray(manifest.capabilities) ? manifest.capabilities : []).map(
      (capability) => describeCapabilityRuntimeSurface(capability),
    ),
    generatedCases,
    scenarios: [...generatedCases, ...customCases],
  };
}

export function materializeHarnessScenario(scenario = {}) {
  if (scenario?.kind !== "invoke") {
    return {
      ...scenario,
      stdinBytes: normalizePayloadBytes(scenario.stdinBytes ?? scenario.stdin ?? null),
    };
  }

  const requestBytes = encodePluginInvokeRequest({
    methodId: scenario.methodId,
    inputs: (Array.isArray(scenario.inputs) ? scenario.inputs : []).map((input) => ({
      portId: input.portId ?? null,
      typeRef: input.typeRef ?? null,
      payload: normalizePayloadBytes(input.payload),
    })),
  });

  if (scenario.surface === "command") {
    return {
      ...scenario,
      stdinBytes: requestBytes,
      requestBytes,
    };
  }

  return {
    ...scenario,
    requestBytes,
  };
}

export function serializeHarnessPlan(plan = {}) {
  return encodeValue(plan);
}
