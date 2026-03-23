// --- Manifest ---

export type PayloadWireFormat = "flatbuffer" | "aligned-binary";
export type InvokeSurface = "direct" | "command";
export type ProtocolTransportKindName =
  | "libp2p"
  | "http"
  | "ws"
  | "wasi-pipe";
export type ProtocolRoleName = "handle" | "dial" | "both";

export interface PayloadTypeRef {
  schemaName?: string;
  fileIdentifier?: string;
  schemaHash?: string | number[] | Uint8Array;
  acceptsAnyFlatbuffer?: boolean;
  wireFormat?: PayloadWireFormat;
  rootTypeName?: string;
  fixedStringLength?: number;
  byteLength?: number;
  requiredAlignment?: number;
}

export function clonePayloadTypeRef(
  value?: PayloadTypeRef | null | Record<string, unknown>,
): PayloadTypeRef;

export function normalizePayloadWireFormatName(
  value?: PayloadWireFormat | string | null,
): PayloadWireFormat | null;

export function getPayloadTypeWireFormat(
  typeRef?: PayloadTypeRef | null,
): PayloadWireFormat;

export function payloadTypeRefsMatch(
  expectedTypeRef?: PayloadTypeRef | null,
  actualTypeRef?: PayloadTypeRef | null,
): boolean;

export function selectPreferredPayloadTypeRef(
  port?: { acceptedTypeSets?: Array<{ allowedTypes?: PayloadTypeRef[] }> } | null,
  options?: { preferredWireFormat?: PayloadWireFormat | string | null },
): PayloadTypeRef;

export type AllowedType = PayloadTypeRef;

export interface AcceptedTypeSet {
  setId: string;
  allowedTypes: PayloadTypeRef[];
}

export interface PortManifest {
  portId: string;
  acceptedTypeSets: AcceptedTypeSet[];
  minStreams: number;
  maxStreams: number;
  required: boolean;
}

export interface MethodManifest {
  methodId: string;
  displayName?: string;
  inputPorts: PortManifest[];
  outputPorts: PortManifest[];
  maxBatch: number;
  drainPolicy: string;
}

export interface ExternalInterface {
  interfaceId: string;
  kind: string;
  direction: string;
  capability?: string;
}

export interface HostCapabilityManifest {
  capability: string;
  scope?: string;
  required?: boolean;
  description?: string;
}

export interface TimerSpec {
  timerId: string;
  methodId: string;
  inputPortId?: string | null;
  defaultIntervalMs?: number | bigint;
  description?: string | null;
}

export interface ProtocolSpec {
  protocolId: string;
  methodId: string;
  inputPortId?: string | null;
  outputPortId?: string | null;
  description?: string | null;
  wireId?: string | null;
  transportKind?: ProtocolTransportKindName | string | null;
  role?: ProtocolRoleName | string | null;
  specUri?: string | null;
  autoInstall?: boolean;
  advertise?: boolean;
  discoveryKey?: string | null;
  defaultPort?: number;
  requireSecureTransport?: boolean;
}

export interface BuildArtifact {
  artifactId: string;
  kind?: string | null;
  path: string;
  target?: string | null;
  entrySymbol?: string | null;
}

export interface PluginManifest {
  pluginId: string;
  name: string;
  version: string;
  pluginFamily: string;
  capabilities?: Array<string | HostCapabilityManifest>;
  invokeSurfaces?: InvokeSurface[];
  runtimeTargets?: string[];
  externalInterfaces?: ExternalInterface[];
  methods: MethodManifest[];
  timers?: TimerSpec[];
  protocols?: ProtocolSpec[];
  schemasUsed?: PayloadTypeRef[];
  buildArtifacts?: BuildArtifact[];
  abiVersion?: number;
}

export function encodePluginManifest(manifest: PluginManifest): Uint8Array;
export function decodePluginManifest(
  data: Uint8Array | ArrayBuffer | ArrayBufferView,
): PluginManifest;
export function toEmbeddedPluginManifest(manifest: PluginManifest): {
  manifest: unknown;
  warnings: string[];
};
export function generateEmbeddedManifestSource(options: {
  manifest: unknown;
}): string;
export function writeEmbeddedManifestArtifacts(options: {
  manifest: unknown;
  outputDir: string;
}): Promise<{ sourcePath: string; headerPath: string }>;

// --- Invoke ---

export interface InvokeFrame {
  portId?: string | null;
  typeRef?: PayloadTypeRef | null;
  alignment?: number;
  offset?: number;
  size?: number;
  ownership?: number | string;
  generation?: number;
  mutability?: number | string;
  traceId?: bigint | number | string;
  streamId?: number;
  sequence?: bigint | number | string;
  endOfStream?: boolean;
  payload?: Uint8Array | ArrayBuffer | ArrayBufferView | null;
}

export interface PluginInvokeRequestEnvelope {
  methodId: string;
  inputs?: InvokeFrame[];
  inputFrames?: InvokeFrame[];
  payloadArena?: Uint8Array;
}

export interface PluginInvokeResponseEnvelope {
  statusCode?: number;
  yielded?: boolean;
  backlogRemaining?: number;
  outputs?: InvokeFrame[];
  outputFrames?: InvokeFrame[];
  payloadArena?: Uint8Array;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export function encodePluginInvokeRequest(
  request: PluginInvokeRequestEnvelope,
): Uint8Array;
export function decodePluginInvokeRequest(
  data: Uint8Array | ArrayBuffer | ArrayBufferView,
): PluginInvokeRequestEnvelope;
export function encodePluginInvokeResponse(
  response: PluginInvokeResponseEnvelope,
): Uint8Array;
export function decodePluginInvokeResponse(
  data: Uint8Array | ArrayBuffer | ArrayBufferView,
): PluginInvokeResponseEnvelope;
export function normalizeInvokeSurfaceName(
  value: InvokeSurface | number | string | null | undefined,
): InvokeSurface | null;
export function normalizeInvokeSurfaces(
  value: Array<InvokeSurface | number | string> | null | undefined,
): InvokeSurface[];

// --- Compliance ---

export interface ComplianceIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  location?: string;
}

export interface ComplianceReport {
  ok: boolean;
  sourceName: string;
  manifest: PluginManifest;
  issues: ComplianceIssue[];
  errors: ComplianceIssue[];
  warnings: ComplianceIssue[];
  checkedArtifact: boolean;
  exportNames: string[];
}

export const RecommendedCapabilityIds: readonly string[];

export function validatePluginManifest(
  manifest: unknown,
  options?: { sourceName?: string },
): ComplianceReport;

export function validatePluginArtifact(options: {
  manifest: PluginManifest;
  manifestPath?: string;
  wasmPath?: string;
  exportNames?: string[];
  sourceName?: string;
}): Promise<ComplianceReport>;

export function validateManifestWithStandards(
  manifest: PluginManifest,
  options?: { sourceName?: string },
): Promise<ComplianceReport>;

export function validateArtifactWithStandards(options: {
  manifest: PluginManifest;
  manifestPath?: string;
  wasmPath?: string;
  exportNames?: string[];
  sourceName?: string;
}): Promise<ComplianceReport>;

export function loadManifestFromFile(manifestPath: string): Promise<PluginManifest>;
export function findManifestFiles(rootDirectory: string): Promise<string[]>;
export function resolveManifestFiles(rootDirectory: string): Promise<string[]>;
export function loadComplianceConfig(
  rootDirectory: string,
): Promise<{ path: string; config: Record<string, unknown> } | null>;
export function getWasmExportNames(wasmBytes: Uint8Array): string[];
export function getWasmExportNamesFromFile(wasmPath: string): Promise<string[]>;

// --- Auth ---

export interface DeploymentTarget {
  kind?: string;
  id?: string | null;
  audience?: string | null;
  url?: string | null;
}

export interface DeploymentAuthorization {
  version: number;
  action: string;
  artifactId: string;
  programId: string;
  graphHash: string | null;
  manifestHash: string | null;
  target: DeploymentTarget;
  capabilities: string[];
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  constraints: unknown;
}

export interface SignedEnvelope {
  protected: {
    algorithm: string;
    curve: string | null;
    publicKeyHex: string | null;
    derivationPath: string | null;
    keyId: string | null;
  };
  payload: DeploymentAuthorization;
  signatureHex: string;
}

export interface Signer {
  algorithm: string;
  curve: string;
  publicKeyHex: string;
  derivationPath: string | null;
  keyId: string | null;
  sign(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface Verifier {
  verify(
    bytes: Uint8Array,
    signature: Uint8Array,
    header: Record<string, unknown>,
    payload: DeploymentAuthorization,
  ): Promise<boolean>;
}

export function createDeploymentAuthorization(options?: {
  artifactId?: string;
  programId?: string;
  graphHash?: string;
  manifestHash?: string;
  target?: string | DeploymentTarget;
  capabilities?: string[];
  issuedAt?: number;
  ttlMs?: number;
  nonce?: string;
  constraints?: unknown;
}): Promise<DeploymentAuthorization>;

export function signAuthorization(options: {
  authorization: DeploymentAuthorization;
  signer: Signer;
}): Promise<SignedEnvelope>;

export function verifyAuthorization(options: {
  envelope: SignedEnvelope;
  verifier: Verifier;
  now?: number;
}): Promise<boolean>;

export function assertDeploymentAuthorization(options: {
  envelope: SignedEnvelope;
  artifact?: {
    artifactId?: string;
    programId?: string;
    graphHash?: string;
    manifestHash?: string;
  };
  target?: string | DeploymentTarget;
  requiredCapabilities?: string[];
  now?: number;
}): boolean;

export function createHdWalletSigner(options: {
  signDigest: (digest: Uint8Array) => Promise<Uint8Array>;
  publicKeyHex: string;
  derivationPath?: string;
  keyId?: string;
  algorithm?: string;
  curve?: string;
}): Signer;

export function createHdWalletVerifier(options: {
  verifyDigest: (
    digest: Uint8Array,
    signature: Uint8Array,
    header: Record<string, unknown>,
    payload: DeploymentAuthorization,
  ) => Promise<boolean>;
}): Verifier;

export function stableStringify(value: unknown): string;
export function canonicalBytes(value: unknown): Uint8Array;
export function hashCanonicalValue(value: unknown): Promise<Uint8Array>;

// --- Transport ---

export interface X25519Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface EncryptedEnvelope {
  version: number;
  scheme: string;
  context: string;
  senderPublicKeyBase64: string;
  saltBase64: string;
  ivBase64: string;
  ciphertextBase64: string;
}

export function generateX25519Keypair(): Promise<X25519Keypair>;

export function encryptBytesForRecipient(options: {
  plaintext: Uint8Array | ArrayBuffer;
  recipientPublicKey: Uint8Array | string;
  context?: string;
  senderKeyPair?: X25519Keypair;
}): Promise<EncryptedEnvelope>;

export function decryptBytesFromEnvelope(options: {
  envelope: EncryptedEnvelope;
  recipientPrivateKey: Uint8Array | string;
}): Promise<Uint8Array>;

export function encryptJsonForRecipient(options: {
  payload: unknown;
  recipientPublicKey: Uint8Array | string;
  context?: string;
  senderKeyPair?: X25519Keypair;
}): Promise<EncryptedEnvelope>;

export function decryptJsonFromEnvelope(options: {
  envelope: EncryptedEnvelope;
  recipientPrivateKey: Uint8Array | string;
}): Promise<unknown>;

// --- Compiler ---

export interface CompilationResult {
  compiler: string;
  language: string;
  outputPath: string | null;
  tempDir: string | null;
  wasmBytes: Uint8Array;
  manifestWarnings: string[];
  report: ComplianceReport;
}

export interface ProtectedArtifact {
  mnemonic: string;
  signingPublicKeyHex: string;
  signingPath: string;
  payload: {
    version: number;
    format: string;
    artifactId: string;
    programId: string;
    manifest: PluginManifest;
    manifestBase64: string;
    wasmBase64: string;
    wasmHashHex: string;
    manifestHashHex: string;
    authorization: SignedEnvelope;
  };
  encrypted: boolean;
  encryptedEnvelope: EncryptedEnvelope | null;
  singleFileBundle: { wasmBytes: Uint8Array } | null;
  bundledWasmBytes: Uint8Array | null;
}

export function compileModuleFromSource(options: {
  manifest: PluginManifest;
  sourceCode: string;
  language?: string;
  outputPath?: string;
  allowUndefinedImports?: boolean;
}): Promise<CompilationResult>;

export function cleanupCompilation(
  result: CompilationResult,
): Promise<void>;

export function protectModuleArtifact(options: {
  manifest: PluginManifest;
  wasmBytes?: Uint8Array;
  wasmBase64?: string;
  artifactId?: string;
  recipientPublicKeyHex?: string;
  mnemonic?: string;
  target?: string | DeploymentTarget;
  targetUrl?: string;
  capabilities?: string[];
  singleFileBundle?: boolean;
  bundleEntries?: Record<string, unknown>;
}): Promise<ProtectedArtifact>;

export function createRecipientKeypairHex(): Promise<{
  publicKeyHex: string;
  privateKeyHex: string;
}>;

export type {
  EmceptionCommandResult,
  SharedEmceptionFileContent,
  SharedEmceptionHandle,
  SharedEmceptionSession,
} from "./compiler/emception.js";

export {
  createSharedEmceptionSession,
  loadSharedEmception,
  withSharedEmception,
} from "./compiler/emception.js";

export type {
  CapabilityRuntimeSurface,
  HarnessInputFrame,
  HarnessInvokeScenario,
  HarnessRawScenario,
  ManifestHarnessPlan,
} from "./testing/index.js";

export {
  describeCapabilityRuntimeSurface,
  generateManifestHarnessPlan,
  materializeHarnessScenario,
  serializeHarnessPlan,
} from "./testing/index.js";

export type {
  AuthPolicy,
  DeploymentPlanIssue,
  DeploymentPlanValidationReport,
  DeploymentBindingModeName,
  InputBinding,
  InputBindingSourceKindName,
  ModuleDeploymentPlan,
  PublicationBinding,
  ResolvedProtocolInstallation,
  ScheduleBinding,
  ScheduleBindingKindName,
  ServiceBinding,
} from "./deployment/index.js";

export {
  DEPLOYMENT_PLAN_FORMAT_VERSION,
  DeploymentBindingMode,
  InputBindingSourceKind,
  ScheduleBindingKind,
  createDeploymentPlanBundleEntry,
  findDeploymentPlanEntry,
  normalizeDeploymentBindingModeName,
  normalizeDeploymentPlan,
  normalizeInputBindingSourceKindName,
  normalizeProtocolRoleName,
  normalizeProtocolTransportKindName,
  normalizeScheduleBindingKindName,
  readDeploymentPlanFromBundle,
  validateDeploymentPlan,
} from "./deployment/index.js";

// --- Standards ---

export interface StandardsEntry {
  schemaCode: string;
  schemaName: string;
  fileIdentifier: string | null;
  hash: string | null;
  version: string | null;
  files: string[];
}

export function loadStandardsCatalog(): Promise<StandardsEntry[]>;
export function loadKnownTypeCatalog(): Promise<StandardsEntry[]>;
export function resolveStandardsTypeRef(
  typeRef: PayloadTypeRef,
  catalog?: StandardsEntry[],
): StandardsEntry | null;
export function validateManifestAgainstStandardsCatalog(
  manifest: PluginManifest,
  options?: { sourceName?: string; catalog?: StandardsEntry[] },
): Promise<{ catalog: StandardsEntry[]; issues: ComplianceIssue[] }>;

// --- Bundle ---

export const SDS_BUNDLE_SECTION_NAME: string;
export const DEFAULT_HASH_ALGORITHM: string;

export function createSingleFileBundle(options: {
  wasmBytes: Uint8Array;
  manifest: PluginManifest;
  authorization?: SignedEnvelope | unknown;
  transportEnvelope?: EncryptedEnvelope | null;
  deploymentPlan?: ModuleDeploymentPlan;
  entries?: Array<Record<string, unknown>>;
}): Promise<{ wasmBytes: Uint8Array }>;

export function parseSingleFileBundle(
  wasmBytes: Uint8Array,
): unknown;

export function parseWasmModuleSections(
  bytes: Uint8Array,
): { id: number; payload: Uint8Array }[];

export function encodeUnsignedLeb128(value: number): Uint8Array;
export function decodeUnsignedLeb128(
  bytes: Uint8Array,
  offset?: number,
): { value: number; bytesRead: number };

// --- Host ---

export interface CronField {
  source: string;
  values: number[];
  hasWildcard: boolean;
}

export interface CronSchedule {
  expression: string;
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

export interface NodeHostContextStore {
  get(scope: string, key: string): Promise<unknown>;
  set(scope: string, key: string, value: unknown): Promise<void>;
  delete(scope: string, key: string): Promise<boolean>;
  listKeys(scope: string): Promise<string[]>;
  listScopes(): Promise<string[]>;
}

export interface NodeHostHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: Uint8Array | ArrayBuffer | ArrayBufferView | string | null;
  responseType?: "bytes" | "text" | "json";
  timeoutMs?: number;
  signal?: unknown;
}

export interface NodeHostHttpResponse<TBody = unknown> {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  headers: Record<string, string>;
  body: TBody;
}

export interface NodeHostFilesystemEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface NodeHostFilesystemStat {
  path: string;
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  ctimeMs: number;
  mtimeMs: number;
}

export interface NodeHostSocketResponse<TBody = Uint8Array | string> {
  host: string;
  port: number;
  localAddress: string | null;
  localPort: number | null;
  remoteAddress: string;
  remotePort: number;
  body: TBody;
}

export interface NodeHostTlsResponse<TBody = Uint8Array | string>
  extends NodeHostSocketResponse<TBody> {
  authorized: boolean;
  authorizationError: string | null;
}

export interface NodeHostWebSocketResponse<TBody = Uint8Array | string | unknown> {
  url: string;
  protocol: string;
  extensions: string;
  closeCode: number | null;
  closeReason: string;
  body: TBody | null;
}

export interface NodeHostMqttPublishResult {
  host: string;
  port: number;
  clientId: string;
  topic: string;
  payloadBytes: number;
}

export interface NodeHostMqttMessage<TBody = Uint8Array | string | unknown> {
  host: string;
  port: number;
  clientId: string;
  topic: string;
  body: TBody;
}

export interface HostcallBridge {
  moduleName: string;
  imports: Record<string, Record<string, (...args: number[]) => number>>;
  getLastEnvelope(): unknown;
  getLastResponseBytes(): Uint8Array;
  getLastResponseText(): string;
  getLastResponseJson(): unknown;
}

export interface NodeHostOptions {
  manifest?: PluginManifest;
  grantedCapabilities?: string[];
  capabilities?: string[];
  filesystemRoot?: string;
  fsRoot?: string;
  allowedHttpOrigins?: string[];
  allowedWebSocketOrigins?: string[];
  allowedCommands?: string[];
  allowedMqttHosts?: string[];
  allowedMqttPorts?: number[];
  allowedTcpHosts?: string[];
  allowedTcpPorts?: number[];
  allowedUdpHosts?: string[];
  allowedUdpPorts?: number[];
  allowedTlsHosts?: string[];
  allowedTlsPorts?: number[];
  contextFilePath?: string;
  contextStore?: NodeHostContextStore;
  fetch?: (...args: any[]) => Promise<any>;
  WebSocket?: any;
}

export class HostCapabilityError extends Error {
  code: string;
  capability: string | null;
  operation: string | null;
}

export class HostFilesystemScopeError extends Error {
  code: string;
  requestedPath: string | null;
  filesystemRoot: string | null;
}

export class NodeHost {
  runtimeTarget: string;
  filesystemRoot: string;
  allowedHttpOrigins: Set<string> | null;
  allowedWebSocketOrigins: Set<string> | null;
  allowedCommands: Set<string> | null;
  allowedMqttHosts: Set<string> | null;
  allowedMqttPorts: Set<number> | null;
  allowedTcpHosts: Set<string> | null;
  allowedTcpPorts: Set<number> | null;
  allowedUdpHosts: Set<string> | null;
  allowedUdpPorts: Set<number> | null;
  allowedTlsHosts: Set<string> | null;
  allowedTlsPorts: Set<number> | null;
  WebSocket: any;
  clock: {
    now(): number;
    monotonicNow(): number;
    nowIso(): string;
  };
  random: {
    bytes(length: number): Promise<Uint8Array>;
  };
  timers: {
    delay(ms: number, options?: { signal?: unknown }): Promise<void>;
    setTimeout(callback: (...args: any[]) => void, ms: number, ...args: any[]): unknown;
    clearTimeout(handle: unknown): void;
    setInterval(callback: (...args: any[]) => void, ms: number, ...args: any[]): unknown;
    clearInterval(handle: unknown): void;
  };
  schedule: {
    parse(expression: string): CronSchedule;
    matches(expression: string | CronSchedule, date?: Date | number | string): boolean;
    next(expression: string | CronSchedule, from?: Date | number | string): Date;
  };
  http: {
    request<TBody = unknown>(
      options: NodeHostHttpRequest,
    ): Promise<NodeHostHttpResponse<TBody>>;
  };
  websocket: {
    exchange<TBody = unknown>(options: {
      url: string;
      protocols?: string | string[];
      message?: Uint8Array | ArrayBuffer | ArrayBufferView | string | null;
      responseType?: "bytes" | "utf8" | "json";
      timeoutMs?: number;
      expectResponse?: boolean;
      WebSocketImpl?: any;
    }): Promise<NodeHostWebSocketResponse<TBody>>;
  };
  mqtt: {
    publish(options: {
      host: string;
      port: number;
      clientId?: string;
      topic: string;
      payload?: Uint8Array | ArrayBuffer | ArrayBufferView | string | null;
      username?: string;
      password?: string;
      keepAliveSeconds?: number;
      timeoutMs?: number;
    }): Promise<NodeHostMqttPublishResult>;
    subscribeOnce<TBody = unknown>(options: {
      host: string;
      port: number;
      clientId?: string;
      topic: string;
      username?: string;
      password?: string;
      keepAliveSeconds?: number;
      timeoutMs?: number;
      responseType?: "bytes" | "utf8" | "json";
      packetId?: number;
    }): Promise<NodeHostMqttMessage<TBody>>;
  };
  filesystem: {
    resolvePath(path: string): string;
    readFile(
      path: string,
      options?: { encoding?: string | null },
    ): Promise<string | Uint8Array>;
    writeFile(
      path: string,
      value: Uint8Array | ArrayBuffer | ArrayBufferView | string,
      options?: { encoding?: string | null },
    ): Promise<{ path: string }>;
    appendFile(
      path: string,
      value: Uint8Array | ArrayBuffer | ArrayBufferView | string,
      options?: { encoding?: string | null },
    ): Promise<{ path: string }>;
    deleteFile(path: string): Promise<{ path: string }>;
    mkdir(
      path: string,
      options?: { recursive?: boolean },
    ): Promise<{ path: string }>;
    readdir(path?: string): Promise<NodeHostFilesystemEntry[]>;
    stat(path: string): Promise<NodeHostFilesystemStat>;
    rename(
      fromPath: string,
      toPath: string,
    ): Promise<{ from: string; to: string }>;
  };
  tcp: {
    request(options: {
      host: string;
      port: number;
      data?: Uint8Array | ArrayBuffer | ArrayBufferView | string | null;
      timeoutMs?: number;
      responseEncoding?: "utf8" | "bytes";
    }): Promise<NodeHostSocketResponse<string | Uint8Array>>;
  };
  udp: {
    request(options: {
      host: string;
      port: number;
      data: Uint8Array | ArrayBuffer | ArrayBufferView | string;
      timeoutMs?: number;
      responseEncoding?: "utf8" | "bytes";
      bindAddress?: string;
      bindPort?: number;
      type?: "udp4" | "udp6";
      expectResponse?: boolean;
    }): Promise<NodeHostSocketResponse<string | Uint8Array>>;
  };
  tls: {
    request(options: {
      host: string;
      port: number;
      data?: Uint8Array | ArrayBuffer | ArrayBufferView | string | null;
      timeoutMs?: number;
      responseEncoding?: "utf8" | "bytes";
      ca?:
        | string
        | Uint8Array
        | ArrayBuffer
        | ArrayBufferView
        | Array<string | Uint8Array | ArrayBuffer | ArrayBufferView>;
      cert?: string | Uint8Array | ArrayBuffer | ArrayBufferView;
      key?: string | Uint8Array | ArrayBuffer | ArrayBufferView;
      rejectUnauthorized?: boolean;
      servername?: string;
    }): Promise<NodeHostTlsResponse<string | Uint8Array>>;
  };
  exec: {
    execFile(options: {
      file: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      input?: Uint8Array | ArrayBuffer | ArrayBufferView | string | null;
      timeoutMs?: number;
      encoding?: "utf8" | "bytes";
    }): Promise<{
      exitCode: number | null;
      signal: string | null;
      stdout: string | Uint8Array;
      stderr: string | Uint8Array;
    }>;
  };
  context: {
    get(scope: string, key: string): Promise<unknown>;
    set(scope: string, key: string, value: unknown): Promise<void>;
    delete(scope: string, key: string): Promise<boolean>;
    listKeys(scope?: string): Promise<string[]>;
    listScopes(): Promise<string[]>;
  };
  crypto: {
    sha256(
      value: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
    ): Promise<Uint8Array>;
    sha512(
      value: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
    ): Promise<Uint8Array>;
    hkdf(options: {
      ikm: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      salt: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      info?: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      length: number;
    }): Promise<Uint8Array>;
    aesGcmEncrypt(options: {
      key: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      plaintext: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      iv: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      aad?: Uint8Array | ArrayBuffer | ArrayBufferView | number[] | null;
    }): Promise<{ ciphertext: Uint8Array; tag: Uint8Array }>;
    aesGcmDecrypt(options: {
      key: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      ciphertext: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      tag: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      iv: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      aad?: Uint8Array | ArrayBuffer | ArrayBufferView | number[] | null;
    }): Promise<Uint8Array>;
    generateX25519Keypair(): Promise<X25519Keypair>;
    x25519PublicKey(
      privateKey: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
    ): Promise<Uint8Array>;
    x25519SharedSecret(
      privateKey: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
      publicKey: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
    ): Promise<Uint8Array>;
    encryptForRecipient(options: {
      plaintext: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      recipientPublicKey: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
      context?: string;
      senderKeyPair?: X25519Keypair;
    }): Promise<EncryptedEnvelope>;
    decryptFromEnvelope(options: {
      envelope: EncryptedEnvelope;
      recipientPrivateKey: Uint8Array | ArrayBuffer | ArrayBufferView | number[];
    }): Promise<Uint8Array>;
    secp256k1: {
      publicKeyFromPrivate(
        privateKey: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
      ): Promise<Uint8Array>;
      signDigest(
        digest: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
        privateKey: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
      ): Promise<Uint8Array>;
      verifyDigest(
        digest: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
        signature: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
        publicKey: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
      ): Promise<boolean>;
    };
    ed25519: {
      publicKeyFromSeed(
        seed: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
      ): Promise<Uint8Array>;
      sign(
        message: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
        seed: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
      ): Promise<Uint8Array>;
      verify(
        message: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
        signature: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
        publicKey: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
      ): Promise<boolean>;
    };
  };
  constructor(options?: NodeHostOptions);
  listCapabilities(): string[];
  listSupportedCapabilities(): string[];
  listOperations(): string[];
  hasCapability(capability: string): boolean;
  assertCapability(capability: string, operation?: string | null): string;
  invoke(operation: string, params?: Record<string, any>): Promise<any>;
}

export const NodeHostSupportedCapabilities: readonly string[];
export const NodeHostSupportedOperations: readonly string[];
export const DEFAULT_HOSTCALL_IMPORT_MODULE: string;
export const HOSTCALL_STATUS_OK: number;
export const HOSTCALL_STATUS_ERROR: number;
export const NodeHostSyncHostcallOperations: readonly string[];

export function createNodeHost(options?: NodeHostOptions): NodeHost;
export function parseCronExpression(expression: string): CronSchedule;
export function matchesCronExpression(
  expression: string | CronSchedule,
  date?: Date | number | string,
): boolean;
export function nextCronOccurrence(
  expression: string | CronSchedule,
  from?: Date | number | string,
): Date;
export function dispatchNodeHostSyncOperation(
  host: NodeHost,
  operation: string,
  params?: unknown,
): unknown;
export function createNodeHostSyncDispatcher(
  host: NodeHost,
): (operation: string, params?: unknown) => unknown;
export function createJsonHostcallBridge(options: {
  dispatch: (operation: string, params?: unknown) => unknown;
  getMemory: () => { buffer: ArrayBuffer | SharedArrayBuffer };
  moduleName?: string;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}): HostcallBridge;
export function createNodeHostSyncHostcallBridge(options: {
  host: NodeHost;
  getMemory: () => { buffer: ArrayBuffer | SharedArrayBuffer };
  moduleName?: string;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}): HostcallBridge;

// --- Runtime constants ---

export const DefaultManifestExports: {
  pluginBytesSymbol: string;
  pluginSizeSymbol: string;
  flowBytesSymbol: string;
  flowSizeSymbol: string;
};

export const DefaultInvokeExports: {
  invokeSymbol: string;
  allocSymbol: string;
  freeSymbol: string;
  commandSymbol: string;
};

export const DrainPolicy: {
  SINGLE_SHOT: string;
  DRAIN_UNTIL_YIELD: string;
  DRAIN_TO_EMPTY: string;
};

export const ExternalInterfaceDirection: {
  INPUT: string;
  OUTPUT: string;
  BIDIRECTIONAL: string;
};

export const ExternalInterfaceKind: {
  CLOCK: string;
  RANDOM: string;
  TIMER: string;
  SCHEDULE: string;
  PUBSUB: string;
  PROTOCOL: string;
  HTTP: string;
  WEBSOCKET: string;
  MQTT: string;
  TCP: string;
  UDP: string;
  TLS: string;
  FILESYSTEM: string;
  PIPE: string;
  NETWORK: string;
  DATABASE: string;
  EXEC: string;
  CRYPTO: string;
  CONTEXT: string;
  LOCAL_RUNTIME: string;
  HOST_SERVICE: string;
};

export const InvokeSurface: {
  DIRECT: string;
  COMMAND: string;
};

export const ProtocolTransportKind: {
  LIBP2P: ProtocolTransportKindName;
  HTTP: ProtocolTransportKindName;
  WS: ProtocolTransportKindName;
  WASI_PIPE: ProtocolTransportKindName;
};

export const ProtocolRole: {
  HANDLE: ProtocolRoleName;
  DIAL: ProtocolRoleName;
  BOTH: ProtocolRoleName;
};

export const RuntimeTarget: {
  NODE: string;
  BROWSER: string;
  WASI: string;
  SERVER: string;
  DESKTOP: string;
  EDGE: string;
};
