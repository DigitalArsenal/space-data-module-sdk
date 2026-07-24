export {
  FLOW_INVALID_INDEX,
  createFlowRuntimeHost,
  createIsomorphicFlowRuntimeHost,
} from "../index.js";

export type {
  FlowDependencyDescriptor,
  FlowDrainOptions,
  FlowDrainResult,
  FlowEdgeDescriptor,
  FlowEngineBodyReference,
  FlowFrameData,
  FlowFrameMutability,
  FlowFrameOwnership,
  FlowHandler,
  FlowHandlerInvocation,
  FlowHandlerMap,
  FlowHandlerResult,
  FlowIngressState,
  FlowNodeDispatchDescriptor,
  FlowNodeState,
  FlowOutputFrame,
  FlowRoutingState,
  FlowRuntimeHost,
  FlowRuntimeHostOptions,
  FlowTriggerFrameOptions,
  IsomorphicFlowChildOptions,
  IsomorphicFlowChildRecord,
  IsomorphicFlowDrainOptions,
  IsomorphicFlowRuntimeHost,
  IsomorphicFlowRuntimeHostOptions,
  ModuleSignatureVerificationPolicy,
} from "../index.js";

export interface JavaScriptFlowRuntimeOptions {
  registry?: {
    getMethod(pluginId: string, methodId: string): unknown;
    invoke(request: Record<string, unknown>): Promise<Record<string, unknown>>;
  } | null;
  maxInvocationsPerDrain?: number;
  onSinkOutput?: (context: Record<string, unknown>) => unknown;
}

export class FlowRuntime {
  constructor(options?: JavaScriptFlowRuntimeOptions);
  loadProgram<T = unknown>(program: T): T;
  getProgram(): unknown;
  inspectQueues(): Record<string, Record<string, number>>;
  enqueueTriggerFrames(
    triggerId: string,
    frames: Array<Record<string, unknown>>,
  ): void;
  enqueueNodeFrames(
    nodeId: string,
    portId: string,
    frames: Array<Record<string, unknown>>,
    backpressurePolicy?: string,
    queueDepth?: number,
  ): void;
  isIdle(): boolean;
  drain(options?: {
    maxInvocationsPerDrain?: number;
    outputStreamCap?: number;
  }): Promise<{
    invocations: number;
    idle: boolean;
    queues: Record<string, Record<string, number>>;
  }>;
}

export function decodeFlowProgram(
  data: Uint8Array | ArrayBuffer | ArrayBufferView,
): unknown;
export function encodeFlowProgram(program: unknown): Uint8Array;
export function decodePluginManifestPman(
  data: Uint8Array | ArrayBuffer | ArrayBufferView,
): unknown;
export function encodePluginManifestPman(manifest: unknown): Uint8Array;
export function decodeStreamInvokeRequest(
  data: Uint8Array | ArrayBuffer | ArrayBufferView,
): unknown;
export function encodeStreamInvokeRequest(request: unknown): Uint8Array;
export function decodeStreamInvokeResponse(
  data: Uint8Array | ArrayBuffer | ArrayBufferView,
): unknown;
export function encodeStreamInvokeResponse(response: unknown): Uint8Array;

export function createDependencyStreamBridge(options?: {
  drainPolicy?: string | number;
  releaseOutputs?: boolean;
}): (request?: Record<string, unknown>) => Record<string, unknown>;

export const FLATSQL_LINK_SHIM_WASM: Uint8Array;
export const FLATSQL_ENGINE_IMPORT_MODULE: string;
export const FLATSQL_LINK_IMPORT_MODULE: string;
export const ENGINE_BODY_REF_TOKEN_MAGIC: bigint;
export const ENGINE_REF_ENTRY_SIZE: number;
export function buildFlatsqlLinkShimWasm(): Uint8Array;
export function instantiateFlatsqlLinkShim(
  engineExports: WebAssembly.Exports & { memory: WebAssembly.Memory },
): Promise<WebAssembly.Instance>;
export function isEngineBodyRefToken(
  token: bigint | number | string,
): boolean;
export function readEngineRefEntry(
  view: DataView,
  base: number,
): {
  token: bigint;
  generation: bigint;
  fnv1a64: bigint;
  enginePtr: number;
  size: number;
  frames: number;
  used: number;
};
