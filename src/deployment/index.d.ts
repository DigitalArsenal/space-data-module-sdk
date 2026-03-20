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

export interface ResolvedProtocolInstallation {
  protocolId: string;
  wireId: string;
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
  targetPluginId?: string | null;
  targetMethodId: string;
  targetInputPortId: string;
  sourceKind: InputBindingSourceKindName | string;
  topic?: string | null;
  wireId?: string | null;
  nodeInfoUrl?: string | null;
  multiaddrs?: string[];
  allowPeerIds?: string[];
  allowServerKeys?: string[];
  deliveryMode?: string | null;
  description?: string | null;
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

export function normalizeProtocolTransportKindName(
  value: ProtocolTransportKindName | string | null | undefined,
): ProtocolTransportKindName | string | null;

export function normalizeProtocolRoleName(
  value: ProtocolRoleName | string | null | undefined,
): ProtocolRoleName | string | null;

export function normalizeInputBindingSourceKindName(
  value: InputBindingSourceKindName | string | null | undefined,
): InputBindingSourceKindName | string | null;

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
