export {
  DefaultInvokeExports,
  DefaultManifestExports,
  DrainPolicy,
  ExternalInterfaceDirection,
  ExternalInterfaceKind,
  InvokeSurface,
  RuntimeTarget,
} from "../index.js";

export function isArrayBufferLike(value: unknown): boolean;
export function hasByteAddressableBuffer(value: unknown): boolean;
export function toUint8Array(value: unknown): Uint8Array | null;
