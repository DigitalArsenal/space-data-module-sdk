import type {
  InvokeSurface,
  PayloadTypeRef,
  PayloadWireFormat,
  PluginManifest,
} from "../index.js";

export interface HarnessInputFrame {
  portId?: string | null;
  typeRef?: PayloadTypeRef | null;
  alignment?: number;
  offset?: number;
  size?: number;
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
  standaloneWasi: boolean;
  wasmedge: boolean;
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

export interface PublicationProtectionDemoAlignedType {
  methodId: string | null;
  portId: string | null;
  setId: string | null;
  schemaName: string | null;
  fileIdentifier: string | null;
  rootTypeName: string | null;
  byteLength: number | null;
  requiredAlignment: number | null;
  hasFlatbufferFallback: boolean;
}

export interface PublicationProtectionDemoSummary {
  manifest: PluginManifest;
  recTrailer: {
    fileIdentifier: string;
    version: string | null;
    recordCount: number;
    recordStandards: Array<string | null>;
    usesStandardsFlatbuffers: boolean;
    records: Array<Record<string, unknown>>;
  };
  alignedBinaryContract: PublicationProtectionDemoAlignedType[];
  signedOnly: {
    artifactId: string;
    encrypted: boolean;
    trailer: PublicationProtectionDemoSummary["recTrailer"];
    recordStandards: Array<string | null>;
    pnm: {
      fileName: string | null;
      fileId: string | null;
      cid: string | null;
      hasSignature: boolean;
      signatureType: string | null;
      publishTimestamp: string | null;
    } | null;
    enc: null;
    envelope: null;
  };
  encryptedDelivery: {
    artifactId: string;
    encrypted: boolean;
    trailer: PublicationProtectionDemoSummary["recTrailer"];
    recordStandards: Array<string | null>;
    pnm: {
      fileName: string | null;
      fileId: string | null;
      cid: string | null;
      hasSignature: boolean;
      signatureType: string | null;
      publishTimestamp: string | null;
    } | null;
    enc: {
      context: string | null;
      rootType: string | null;
      keyExchange: string | null;
      symmetric: string | null;
      keyDerivation: string | null;
      nonceLength: number;
      ephemeralPublicKeyLength: number;
    } | null;
    envelope: {
      scheme: string | null;
      hasEncRecord: boolean;
      hasPnmRecord: boolean;
    } | null;
  };
}

export interface PluginInvokeProcessLaunchPlan {
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  wasmPath?: string | null;
  hostProfile?: "runtime-host";
}

export interface RuntimeHostTestModuleDefinition {
  moduleId: string;
  wasmPath?: string | null;
  metadata?: unknown;
  [key: string]: unknown;
}

export interface RuntimeHostInstalledModule {
  moduleId: string;
  metadata: unknown;
  methodIds: string[];
}

export interface RuntimeHostRowHandle {
  schemaFileId: string;
  rowId: number;
}

export interface RuntimeHostRowView {
  handle: RuntimeHostRowHandle;
  payload: unknown;
}

export interface RuntimeHostRowQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
}

export interface RuntimeHostRegionDescriptor {
  regionId: number;
  layoutId: string;
  recordByteLength: number;
  alignment: number;
  recordCount: number;
}

export interface RuntimeHostRegionRecord {
  regionId: number;
  recordIndex: number;
  layoutId: string;
  recordByteLength: number;
  alignment: number;
  byteLength: number;
  bytes: Uint8Array;
}

export interface PluginInvokeProcessClient {
  launchPlan: PluginInvokeProcessLaunchPlan;
  invokeRaw(requestBytes: Uint8Array | ArrayBuffer | ArrayBufferView): Promise<Uint8Array>;
  invoke(request: {
    methodId?: string | null;
    /**
     * Browser direct invoke requires this to be a full view of the active
     * SharedArrayBuffer-backed module memory; foreign arenas and
     * payload-bearing frames are rejected.
     */
    externalArena?: Uint8Array | ArrayBuffer | ArrayBufferView;
    inputs?: HarnessInputFrame[];
  }): Promise<{
      statusCode: number;
      errorCode?: string | null;
      errorMessage?: string | null;
      outputs: HarnessInputFrame[];
  }>;
  installModule(definition: RuntimeHostTestModuleDefinition): Promise<RuntimeHostInstalledModule>;
  listModules(): Promise<RuntimeHostInstalledModule[]>;
  unloadModule(moduleId: string): Promise<boolean>;
  invokeModule(requestModuleId: string, request: {
    methodId?: string | null;
    inputs?: HarnessInputFrame[];
  }): Promise<{
    statusCode: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    outputs: HarnessInputFrame[];
  }>;
  appendRow(options: {
    schemaFileId: string;
    payload?: unknown;
  }): Promise<RuntimeHostRowHandle>;
  listRows(schemaFileId?: string | null): Promise<RuntimeHostRowView[]>;
  resolveRow(handle: RuntimeHostRowHandle): Promise<RuntimeHostRowView | null>;
  queryRows(sql: string): Promise<RuntimeHostRowQueryResult>;
  allocateRegion(options: {
    layoutId: string;
    recordByteLength: number;
    alignment?: number;
    initialRecords?: Array<Uint8Array | ArrayBuffer | ArrayBufferView | null | undefined>;
  }): Promise<RuntimeHostRegionDescriptor>;
  describeRegion(regionId: number): Promise<RuntimeHostRegionDescriptor | null>;
  resolveRecord(query: {
    regionId: number;
    recordIndex: number;
  }): Promise<RuntimeHostRegionRecord | null>;
  destroy(): Promise<void>;
}

export interface ModuleHarnessRuntimeDescriptor {
  kind?: "process" | "wasmedge";
  launchPlan?: PluginInvokeProcessLaunchPlan;
  command?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  wasmPath?: string;
  wasmEdgeBinary?: string;
  wasmEdgeRunnerBinary?: string;
  enableThreads?: boolean;
  hostProfile?: "runtime-host";
  modules?: RuntimeHostTestModuleDefinition[];
  defaultModuleId?: string;
  metadata?: unknown;
}

export interface ModuleHarness {
  runtime: ModuleHarnessRuntimeDescriptor & { kind: "process" | "wasmedge" };
  launchPlan: PluginInvokeProcessLaunchPlan;
  invokeRaw(requestBytes: Uint8Array | ArrayBuffer | ArrayBufferView): Promise<Uint8Array>;
  invoke(request: {
    methodId?: string | null;
    externalArena?: Uint8Array | ArrayBuffer | ArrayBufferView;
    inputs?: HarnessInputFrame[];
  }): Promise<{
      statusCode: number;
      errorCode?: string | null;
      errorMessage?: string | null;
      outputs: HarnessInputFrame[];
  }>;
  installModule(definition: RuntimeHostTestModuleDefinition): Promise<RuntimeHostInstalledModule>;
  listModules(): Promise<RuntimeHostInstalledModule[]>;
  unloadModule(moduleId: string): Promise<boolean>;
  invokeModule(moduleId: string, request: {
    methodId?: string | null;
    inputs?: HarnessInputFrame[];
  }): Promise<{
    statusCode: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    outputs: HarnessInputFrame[];
  }>;
  appendRow(options: {
    schemaFileId: string;
    payload?: unknown;
  }): Promise<RuntimeHostRowHandle>;
  listRows(schemaFileId?: string | null): Promise<RuntimeHostRowView[]>;
  resolveRow(handle: RuntimeHostRowHandle): Promise<RuntimeHostRowView | null>;
  queryRows(sql: string): Promise<RuntimeHostRowQueryResult>;
  allocateRegion(options: {
    layoutId: string;
    recordByteLength: number;
    alignment?: number;
    initialRecords?: Array<Uint8Array | ArrayBuffer | ArrayBufferView | null | undefined>;
  }): Promise<RuntimeHostRegionDescriptor>;
  describeRegion(regionId: number): Promise<RuntimeHostRegionDescriptor | null>;
  resolveRecord(query: {
    regionId: number;
    recordIndex: number;
  }): Promise<RuntimeHostRegionRecord | null>;
  destroy(): Promise<void>;
}

export interface WasmEdgeRunnerBuildPlan {
  runnerSourcePath: string;
  requestedIncludeDir: string;
  wasmedgeIncludeDir: string;
  wasmedgeLibDir: string;
  wasmedgeSharedLibraryPath: string;
  outputPath: string;
  compilerCommand: string;
  compilerArgs: string[];
}

export function describeCapabilityRuntimeSurface(
  capability: string,
): CapabilityRuntimeSurface;

export function createPublicationProtectionDemoManifest(): PluginManifest;

export function createPublicationProtectionDemoSummary(options?: {
  manifest?: PluginManifest;
  wasmBytes?: Uint8Array;
  mnemonic?: string | null;
  recipient?: {
    publicKeyHex: string;
    privateKeyHex: string;
  };
}): Promise<PublicationProtectionDemoSummary>;

export interface BrowserModuleHarness {
  runtime: {
    kind: "browser";
    profile: string;
    surface: string;
  };
  instance: WebAssembly.Instance;
  module: WebAssembly.Module;
  host: unknown;
  bridge: unknown;
  wasi: {
    imports: Record<string, Record<string, (...args: number[]) => number>>;
    setMemory(mem: { buffer: ArrayBuffer | SharedArrayBuffer }): void;
    getMemory(): { buffer: ArrayBuffer | SharedArrayBuffer } | null;
    flushOutput(): void;
    stdout: Uint8Array;
    stderr: Uint8Array;
  };
  callHost(operation: string, params?: Record<string, any>): Promise<unknown>;
  invokeRaw(
    requestBytes: Uint8Array | ArrayBuffer | ArrayBufferView,
  ): Promise<Uint8Array>;
  invokeDirect(request: {
    methodId?: string | null;
    /**
     * Browser direct invoke requires this to be a full view of the active
     * SharedArrayBuffer-backed module memory; foreign arenas and
     * payload-bearing frames are rejected.
     */
    externalArena?: Uint8Array | ArrayBuffer | ArrayBufferView;
    inputs?: HarnessInputFrame[];
  }): Promise<{
    statusCode: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    outputs: HarnessInputFrame[];
  }>;
  invoke(request: {
    methodId?: string | null;
    externalArena?: Uint8Array | ArrayBuffer | ArrayBufferView;
    inputs?: HarnessInputFrame[];
  }): Promise<{
    statusCode: number;
    errorCode?: string | null;
    errorMessage?: string | null;
    outputs: HarnessInputFrame[];
  }>;
  readManifest(): Uint8Array | null;
  destroy(): void;
}

export function generateManifestHarnessPlan(options: {
  manifest: PluginManifest;
  includeOptionalInputs?: boolean;
  expectedStatusCode?: number;
  preferredWireFormat?: PayloadWireFormat;
  payloadForPort?: (context: {
    methodId: string | null;
    portId: string | null;
    port: unknown;
    required: boolean;
    typeRef: PayloadTypeRef;
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

export function buildWasmEdgeSpawnEnv(
  baseEnv?: Record<string, string | undefined>,
): Record<string, string | undefined>;

export function resolveWasmEdgePluginLaunchPlan(options: {
  wasmPath?: string;
  wasmEdgeBinary?: string;
  wasmEdgeRunnerBinary?: string;
  enableThreads?: boolean;
  invokeArgs?: string[];
  env?: Record<string, string | undefined>;
  hostProfile?: "runtime-host";
}): PluginInvokeProcessLaunchPlan;

export function createPluginInvokeProcessClient(options: {
  launchPlan?: PluginInvokeProcessLaunchPlan;
  command?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
}): Promise<PluginInvokeProcessClient>;

export function createWasmEdgeStreamProcessClient(options: {
  launchPlan?: PluginInvokeProcessLaunchPlan;
  command?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
}): Promise<PluginInvokeProcessClient>;

export function resolveModuleHarnessLaunchPlan(options: {
  runtime?: ModuleHarnessRuntimeDescriptor;
} | ModuleHarnessRuntimeDescriptor): PluginInvokeProcessLaunchPlan;

export function detectArtifactProfile(wasmModule: WebAssembly.Module): string;

export function createBrowserModuleHarness(options?: {
  wasmSource: Uint8Array | ArrayBuffer | string | WebAssembly.Module | unknown;
  host?: unknown;
  hostOptions?: unknown;
  args?: string[];
  env?: Record<string, string>;
  manifest?: Record<string, unknown>;
  surface?: "direct" | "command";
  performance?: {
    now(): number;
    timeOrigin: number;
  };
  wasmMemory?: WebAssembly.Memory;
  memory?: WebAssembly.Memory;
  sharedMemory?: boolean;
  allowRawInvoke?: boolean;
  initialMemoryBytes?: number;
  maximumMemoryBytes?: number;
  logOutput?: boolean;
}): Promise<BrowserModuleHarness>;

export function createModuleHarness(options: {
  runtime?: ModuleHarnessRuntimeDescriptor;
} | ModuleHarnessRuntimeDescriptor): Promise<ModuleHarness>;

export function resolveWasmEdgeRunnerSourcePath(): string;

export function resolveWasmEdgeRunnerBuildPlan(options: {
  outputPath: string;
  wasmedgeIncludeDir?: string;
  wasmedgeLibDir?: string;
  output?: string;
}): WasmEdgeRunnerBuildPlan;

export function buildWasmEdgeEmscriptenPthreadRunner(options: {
  outputPath: string;
  wasmedgeIncludeDir?: string;
  wasmedgeLibDir?: string;
  output?: string;
  cwd?: string;
}): Promise<string>;

// --- Tri-runtime parity harness (browser / WasmEdge / Docker WasmEdge) -------

export declare const PARITY_LANES: readonly ["browser", "wasmedge", "docker-wasmedge"];
export type ParityLaneName = (typeof PARITY_LANES)[number];

export declare const ParityExitClass: Readonly<{
  Ok: "ok";
  GuestError: "guest-error";
  Trap: "trap";
  HarnessFailure: "harness-failure";
}>;

export interface WasmEdgePin {
  wasmedgeVersion: string;
  dockerImageRepository: string;
  dockerImage: string;
  dockerfilePath: string;
  dockerfileContextDir: string;
  pinPath: string;
}

export interface ParityPlanCase {
  id: string;
  stdinBytes: Uint8Array;
  env: Record<string, string>;
  args: readonly string[];
  expect: "ok" | "guest-error" | "trap" | null;
  threadCounts: readonly number[];
}

export interface ParityPlan {
  name: string;
  threadEnvVar: string;
  cases: readonly ParityPlanCase[];
}

export interface ParityRunResult {
  lane?: ParityLaneName;
  caseId: string;
  threadCount: number;
  exitClass: string;
  exitDetail?: string | null;
  stdout: Uint8Array;
  stderr?: Uint8Array;
  stateFiles?: Record<string, string> | null;
}

export interface ParityFailure {
  caseId?: string;
  kind: string;
  message: string;
}

export interface ParityReport {
  ok: boolean;
  fixture: string;
  wasmPath: string;
  artifactSha256: string;
  moduleSha256: string;
  pin: string;
  lanes: Array<{ lane: string; runs: number; durationMs: number }>;
  cases: string[];
  comparisons: number;
  failures: ParityFailure[];
  runs: Array<{
    lane: string;
    caseId: string;
    threadCount: number;
    exitClass: string;
    exitDetail: string | null;
    stdoutSha256: string;
    stdoutLength: number;
  }>;
}

export declare function loadWasmEdgePin(): WasmEdgePin;
export declare function assertWasmEdgeVersionMatchesPin(
  versionOutput: string,
  pin: WasmEdgePin,
  context: string,
): string;
export declare function normalizeParityFixture(
  fixture: unknown,
  options?: { fixtureDir?: string },
): Promise<ParityPlan>;
export declare function loadParityFixture(fixturePath: string): Promise<ParityPlan>;
export declare function diffParityRuns(
  plan: ParityPlan,
  runs: ParityRunResult[],
): { ok: boolean; failures: ParityFailure[]; comparisons: number };
export declare function formatParityReport(report: ParityReport): string;
export declare function runParityHarness(options: {
  wasmPath: string;
  plan?: ParityPlan;
  fixturePath?: string;
  lanes?: string[];
  laneRunners?: Record<string, (context: unknown) => Promise<ParityRunResult[]>>;
  injectDivergence?: string;
  chromeBinary?: string;
  wasmedgeBinary?: string;
  dockerBinary?: string;
  dockerPlatform?: string;
  autoBuildDockerImage?: boolean;
  allowSingleLane?: boolean;
  timeoutMs?: number;
  log?: (line: string) => void;
}): Promise<ParityReport>;

export declare const defaultParityLaneRunners: Readonly<
  Record<ParityLaneName, (context: unknown) => Promise<ParityRunResult[]>>
>;
export declare function ensureDockerParityImage(context: unknown): Promise<string>;
export declare function resolveChromeBinary(context?: unknown): Promise<string>;
export declare function resolveWasmEdgeBinary(context?: unknown): Promise<string>;
export declare function runBrowserLane(context: unknown): Promise<ParityRunResult[]>;
export declare function runDockerWasmEdgeLane(context: unknown): Promise<ParityRunResult[]>;
export declare function runNativeWasmEdgeLane(context: unknown): Promise<ParityRunResult[]>;
