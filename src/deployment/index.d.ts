import type {
  PluginManifest,
  ProtocolRoleName,
  ProtocolSpec,
  ProtocolTransportKindName,
} from "../index.js";

export type InputBindingSourceKindName =
  | "pubsub"
  | "protocol-stream"
  | "catalog-sync";
export type DeploymentBindingModeName = "local" | "delegated";
export type ScheduleBindingKindName = "interval" | "cron" | "once";

export interface ResolvedProtocolInstallation {
  protocolId: string;
  wireId?: string | null;
  transportKind: ProtocolTransportKindName | string;
  role: ProtocolRoleName | string;
  peerId?: string | null;
  listenMultiaddrs?: string[];
  advertisedMultiaddrs?: string[];
  nodeInfoUrl?: string | null;
  serviceName?: string | null;
  resolvedPort?: number;
  artifactCid?: string | null;
  description?: string | null;
}

export interface InputBinding {
  bindingId: string;
  interfaceId: string;
  targetPluginId?: string | null;
  targetMethodId: string;
  targetInputPortId: string;
  sourceKind: InputBindingSourceKindName | string;
  multiaddrs?: string[];
  allowPeerIds?: string[];
  allowServerKeys?: string[];
  deliveryMode?: string | null;
  description?: string | null;
}

export interface ScheduleBinding {
  scheduleId: string;
  bindingMode: DeploymentBindingModeName | string;
  triggerId?: string | null;
  targetMethodId?: string | null;
  targetInputPortId?: string | null;
  scheduleKind: ScheduleBindingKindName | string;
  cron?: string | null;
  intervalMs?: number;
  runAtStartup?: boolean;
  startupDelayMs?: number;
  timezone?: string | null;
  description?: string | null;
}

export interface ServiceBinding {
  serviceId: string;
  bindingMode: DeploymentBindingModeName | string;
  serviceKind: string;
  triggerId?: string | null;
  protocolId?: string | null;
  routePath?: string | null;
  method?: string | null;
  transportKind?: ProtocolTransportKindName | string | null;
  adapter?: string | null;
  listenHost?: string | null;
  listenPort?: number;
  remoteUrl?: string | null;
  allowTransports?: string[];
  authPolicyId?: string | null;
  description?: string | null;
  properties?: Record<string, unknown>;
}

export interface AuthPolicy {
  policyId: string;
  bindingMode: DeploymentBindingModeName | string;
  targetKind: string;
  targetId?: string | null;
  adapter?: string | null;
  walletProfileId?: string | null;
  trustMapId?: string | null;
  allowPeerIds?: string[];
  allowServerKeys?: string[];
  allowEntityIds?: string[];
  requireSignedRequests?: boolean;
  requireEncryptedTransport?: boolean;
  description?: string | null;
  properties?: Record<string, unknown>;
}

export interface PublicationBinding {
  publicationId: string;
  interfaceId: string;
  bindingMode: DeploymentBindingModeName | string;
  sourceKind: string;
  sourceMethodId?: string | null;
  sourceOutputPortId?: string | null;
  sourceNodeId?: string | null;
  sourceTriggerId?: string | null;
  schemaName?: string | null;
  mediaType?: string | null;
  archivePath?: string | null;
  queryInterfaceId?: string | null;
  emitPnm?: boolean;
  emitFlatbufferArchive?: boolean;
  pinPolicy?: string | null;
  maxRecords?: number;
  maxBytes?: number;
  minLivelinessSeconds?: number;
  recordRangeStartField?: string | null;
  recordRangeStopField?: string | null;
  description?: string | null;
  properties?: Record<string, unknown>;
}

export interface ModuleDeploymentPlan {
  formatVersion?: number;
  pluginId?: string | null;
  version?: string | null;
  artifactCid?: string | null;
  bundleCid?: string | null;
  environmentId?: string | null;
  protocolInstallations?: ResolvedProtocolInstallation[];
  inputBindings?: InputBinding[];
  scheduleBindings?: ScheduleBinding[];
  serviceBindings?: ServiceBinding[];
  authPolicies?: AuthPolicy[];
  publicationBindings?: PublicationBinding[];
}

export interface DeploymentPlanIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  location?: string;
}

export interface DeploymentPlanValidationReport {
  ok: boolean;
  plan: ModuleDeploymentPlan;
  issues: DeploymentPlanIssue[];
  errors: DeploymentPlanIssue[];
  warnings: DeploymentPlanIssue[];
}

export const DEPLOYMENT_PLAN_FORMAT_VERSION: number;

export const InputBindingSourceKind: {
  PUBSUB: InputBindingSourceKindName;
  PROTOCOL_STREAM: InputBindingSourceKindName;
  CATALOG_SYNC: InputBindingSourceKindName;
};

export const DeploymentBindingMode: {
  LOCAL: DeploymentBindingModeName;
  DELEGATED: DeploymentBindingModeName;
};

export const ScheduleBindingKind: {
  INTERVAL: ScheduleBindingKindName;
  CRON: ScheduleBindingKindName;
  ONCE: ScheduleBindingKindName;
};

export function normalizeProtocolTransportKindName(
  value: ProtocolTransportKindName | string | null | undefined,
): ProtocolTransportKindName | string | null;

export function normalizeProtocolRoleName(
  value: ProtocolRoleName | string | null | undefined,
): ProtocolRoleName | string | null;

export function normalizeInputBindingSourceKindName(
  value: InputBindingSourceKindName | string | null | undefined,
): InputBindingSourceKindName | string | null;

export function normalizeDeploymentBindingModeName(
  value: DeploymentBindingModeName | string | null | undefined,
): DeploymentBindingModeName | string | null;

export function normalizeScheduleBindingKindName(
  value: ScheduleBindingKindName | string | null | undefined,
): ScheduleBindingKindName | string | null;

export function normalizeDeploymentPlan(
  plan: ModuleDeploymentPlan | null | undefined,
): ModuleDeploymentPlan;

export function validateDeploymentPlan(
  plan: ModuleDeploymentPlan | null | undefined,
  options?: { manifest?: PluginManifest | null },
): DeploymentPlanValidationReport;

export function createDeploymentPlanBundleEntry(
  plan: ModuleDeploymentPlan | null | undefined,
  options?: {
    entryId?: string;
    role?: string;
    sectionName?: string;
    mediaType?: string;
    description?: string;
  },
): {
  entryId: string;
  role: string;
  sectionName: string;
  payloadEncoding: "json-utf8";
  mediaType: string;
  payload: ModuleDeploymentPlan;
  description: string;
};

export function findDeploymentPlanEntry(bundleLike: unknown): unknown | null;

export function readDeploymentPlanFromBundle(
  bundleLike: unknown,
): ModuleDeploymentPlan | null;
