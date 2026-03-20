import type { InvokeSurface, PayloadTypeRef, PluginManifest } from "../index.js";

export interface HarnessInputFrame {
  portId?: string | null;
  typeRef?: PayloadTypeRef | null;
  payload?: Uint8Array | ArrayBuffer | ArrayBufferView | string | null;
}

export interface HarnessInvokeScenario {
  id: string;
  kind: "invoke";
  surface: InvokeSurface;
  methodId: string;
  displayName?: string | null;
  inputs?: HarnessInputFrame[];
  requiredPortIds?: string[];
  expectedStatusCode?: number;
  notes?: string[];
}

export interface HarnessRawScenario {
  id: string;
  kind: string;
  stdinBytes?: Uint8Array | ArrayBuffer | ArrayBufferView | string | null;
  notes?: string[];
}

export interface CapabilityRuntimeSurface {
  capability: string;
  wasi: boolean;
  syncHostcall: boolean;
  nodeHostApi: boolean;
  notes: string[];
}

export interface ManifestHarnessPlan {
  moduleKind: "module" | "flow";
  pluginId: string | null;
  name: string | null;
  version: string | null;
  invokeSurfaces: InvokeSurface[];
  methods: Array<{
    methodId: string | null;
    displayName: string | null;
    inputPorts: number;
    outputPorts: number;
  }>;
  capabilities: CapabilityRuntimeSurface[];
  generatedCases: HarnessInvokeScenario[];
  scenarios: Array<HarnessInvokeScenario | HarnessRawScenario>;
}

export function describeCapabilityRuntimeSurface(
  capability: string,
): CapabilityRuntimeSurface;

export function generateManifestHarnessPlan(options: {
  manifest: PluginManifest;
  includeOptionalInputs?: boolean;
  expectedStatusCode?: number;
  payloadForPort?: (context: {
    methodId: string | null;
    portId: string | null;
    port: unknown;
    required: boolean;
  }) => Uint8Array | ArrayBuffer | ArrayBufferView | string | null | undefined;
  scenarios?: Array<HarnessInvokeScenario | HarnessRawScenario>;
}): ManifestHarnessPlan;

export function materializeHarnessScenario(
  scenario: HarnessInvokeScenario | HarnessRawScenario,
): (HarnessInvokeScenario | HarnessRawScenario) & {
  stdinBytes?: Uint8Array;
  requestBytes?: Uint8Array;
};

export function serializeHarnessPlan(plan: ManifestHarnessPlan): unknown;
