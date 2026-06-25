import * as flatbuffers from "flatbuffers";

import { FSP } from "spacedatastandards.org/lib/js/FSP/main.js";
import { FSM } from "spacedatastandards.org/lib/js/FSM/main.js";

const PROVIDER_SIGNATURE_LENGTH = 64;

export function encodeUnsignedFieldStreamPolicyForProviderSignature(policy) {
  const root = fieldStreamPolicyRoot(policy);
  const unsignedPolicy = root.unpack();
  unsignedPolicy.PROVIDER_SIGNATURE = [];
  const builder = new flatbuffers.Builder(1024);
  const offset = unsignedPolicy.pack(builder);
  FSP.finishFSPBuffer(builder, offset);
  return builder.asUint8Array();
}

export async function verifyFieldStreamPolicyProviderSignature(policy, options = {}) {
  const root = fieldStreamPolicyRoot(policy);
  const providerSignature = readProviderSignature(root.providerSignatureArray?.(), "field stream policy");
  const providerPublicKey = cloneBytes(options.providerPublicKey);
  if (providerPublicKey.length === 0) {
    throw new TypeError("verifyFieldStreamPolicyProviderSignature requires providerPublicKey.");
  }
  if (typeof options.verify !== "function") {
    throw new TypeError("verifyFieldStreamPolicyProviderSignature requires verify.");
  }
  const payload = encodeUnsignedFieldStreamPolicyForProviderSignature(root);
  const verified = await options.verify(providerPublicKey, payload, providerSignature);
  if (!verified) {
    throw new Error("field stream policy provider signature verification failed");
  }
  return root;
}

export function encodeUnsignedFieldStreamMessageForProviderSignature(message) {
  const root = fieldStreamMessageRoot(message);
  const unsignedMessage = root.unpack();
  unsignedMessage.PROVIDER_SIGNATURE = [];
  const builder = new flatbuffers.Builder(1024);
  const offset = unsignedMessage.pack(builder);
  FSM.finishFSMBuffer(builder, offset);
  return builder.asUint8Array();
}

export async function verifyFieldStreamMessageProviderSignature(message, options = {}) {
  const root = fieldStreamMessageRoot(message);
  const providerSignature = readProviderSignature(root.providerSignatureArray?.(), "field stream message");
  const providerPublicKey = cloneBytes(options.providerPublicKey);
  if (providerPublicKey.length === 0) {
    throw new TypeError("verifyFieldStreamMessageProviderSignature requires providerPublicKey.");
  }
  if (typeof options.verify !== "function") {
    throw new TypeError("verifyFieldStreamMessageProviderSignature requires verify.");
  }
  const payload = encodeUnsignedFieldStreamMessageForProviderSignature(root);
  const verified = await options.verify(providerPublicKey, payload, providerSignature);
  if (!verified) {
    throw new Error("field stream message provider signature verification failed");
  }
  return root;
}

function fieldStreamPolicyRoot(policy) {
  if (policy && typeof policy.POLICY_ID === "function" && typeof policy.unpack === "function") {
    return policy;
  }
  const bytes = cloneBytes(policy);
  if (bytes.length === 0) {
    throw new TypeError("field stream policy is required");
  }
  const buffer = new flatbuffers.ByteBuffer(bytes);
  if (!FSP.bufferHasIdentifier(buffer)) {
    throw new Error("field stream policy identifier mismatch");
  }
  return FSP.getRootAsFSP(buffer);
}

function fieldStreamMessageRoot(message) {
  if (message && typeof message.MESSAGE_ID === "function" && typeof message.unpack === "function") {
    return message;
  }
  const bytes = cloneBytes(message);
  if (bytes.length === 0) {
    throw new TypeError("field stream message is required");
  }
  const buffer = new flatbuffers.ByteBuffer(bytes);
  if (!FSM.bufferHasIdentifier(buffer)) {
    throw new Error("field stream message identifier mismatch");
  }
  return FSM.getRootAsFSM(buffer);
}

function readProviderSignature(signature, label) {
  const bytes = cloneBytes(signature);
  if (bytes.length !== PROVIDER_SIGNATURE_LENGTH) {
    throw new Error(`${label} provider signature must be ${PROVIDER_SIGNATURE_LENGTH} bytes`);
  }
  if (bytes.every((byte) => byte === 0)) {
    throw new Error(`${label} provider signature must not be all zeroes`);
  }
  return bytes;
}

function cloneBytes(bytes) {
  if (!bytes) {
    return new Uint8Array();
  }
  if (bytes instanceof Uint8Array) {
    return new Uint8Array(bytes);
  }
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
  }
  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes).slice();
  }
  return new Uint8Array(bytes);
}
