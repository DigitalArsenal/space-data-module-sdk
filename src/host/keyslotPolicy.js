/**
 * Key-slot purpose binding for keyslot.sign / keyslot.unwrap (security audit
 * 2026-10-15, SEC-024).
 *
 * keyslot.sign signs guest-chosen bytes with a host-held key. Granting
 * `wallet_sign` used to let a guest name ANY slot and sign ANY bytes, which
 * makes every slot a raw signing oracle: a guest could have a publisher slot
 * sign `SDN-MODULE-PUBLICATION-V1 || 0x00 || sha256(evil.wasm)`, a bare
 * 32-byte canonical module hash, or a canonical deployment authorization.
 *
 * The embedder now states, per slot, what a module may do with it:
 *
 *   allowedKeySlots: ["session-key"]                      // sign + unwrap
 *   allowedKeySlots: {
 *     "provider-signing": { operations: ["sign"], fileIdentifiers: ["$LGR"] },
 *     "inbox": { operations: ["unwrap"] },
 *   }
 *
 * No list means no slot (fail closed). And whatever the list says, keyslot.sign
 * never signs a preimage this stack reserves for its own signatures:
 *   - anything starting with a registered statement-domain label and NUL;
 *   - a bare 32-byte payload (the legacy bare-digest module signature form);
 *   - a canonical deployment authorization (`{"action":"deploy-flow"...`).
 * A slot bound to `fileIdentifiers` signs only FlatBuffers carrying one of
 * those 4-byte file identifiers.
 */

import { domains } from "../bundle/sigdomain.js";

const OPERATIONS = ["sign", "unwrap"];
const textEncoder = new TextEncoder();
const RESERVED_PREFIXES = [
  ...domains().map((domain) => {
    const label = textEncoder.encode(domain);
    const out = new Uint8Array(label.length + 1);
    out.set(label, 0);
    return out;
  }),
  textEncoder.encode('{"action":"deploy-flow"'),
];

function denied(message) {
  return Object.assign(new Error(message), {
    name: "KeySlotPolicyError",
    hostcallCode: "not-authorized",
  });
}

function normalizeOperations(value, slotId) {
  if (value === true) return new Set(OPERATIONS);
  const list = Array.isArray(value) ? value : value?.operations;
  if (!Array.isArray(list) || list.length === 0) {
    throw new TypeError(`allowedKeySlots["${slotId}"] must list operations (sign, unwrap).`);
  }
  const ops = new Set();
  for (const op of list) {
    if (!OPERATIONS.includes(op)) {
      throw new TypeError(`allowedKeySlots["${slotId}"] has unknown operation "${op}".`);
    }
    ops.add(op);
  }
  return ops;
}

function normalizeFileIdentifiers(value, slotId) {
  const list = value && !Array.isArray(value) && typeof value === "object" ? value.fileIdentifiers : undefined;
  if (list === undefined || list === null) return null;
  if (!Array.isArray(list) || list.length === 0) {
    throw new TypeError(`allowedKeySlots["${slotId}"].fileIdentifiers must be a non-empty array.`);
  }
  return list.map((id) => {
    const bytes = textEncoder.encode(String(id));
    if (bytes.length !== 4) {
      throw new TypeError(`allowedKeySlots["${slotId}"] file identifier "${id}" must be 4 bytes.`);
    }
    return bytes;
  });
}

/**
 * @param {string[]|Object<string, true|string[]|{operations: string[], fileIdentifiers?: string[]}>} value
 * @returns {Map<string, {operations: Set<string>, fileIdentifiers: Uint8Array[]|null}>}
 */
export function normalizeKeySlotPolicy(value) {
  const policy = new Map();
  if (value === undefined || value === null) return policy;
  if (Array.isArray(value)) {
    for (const slotId of value) {
      const id = String(slotId ?? "").trim();
      if (!id) throw new TypeError("allowedKeySlots entries must be non-empty slot ids.");
      policy.set(id, { operations: new Set(OPERATIONS), fileIdentifiers: null });
    }
    return policy;
  }
  if (typeof value !== "object") {
    throw new TypeError("allowedKeySlots must be an array of slot ids or an object keyed by slot id.");
  }
  for (const [slotId, rule] of Object.entries(value)) {
    const id = String(slotId).trim();
    if (!id) throw new TypeError("allowedKeySlots keys must be non-empty slot ids.");
    policy.set(id, {
      operations: normalizeOperations(rule, id),
      fileIdentifiers: normalizeFileIdentifiers(rule, id),
    });
  }
  return policy;
}

function startsWith(bytes, prefix) {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) if (bytes[i] !== prefix[i]) return false;
  return true;
}

/** Throw unless `slotId` may be used for `operation` under `policy`. */
export function assertKeySlotOperation(policy, slotId, operation) {
  const rule = policy?.get?.(String(slotId ?? "").trim());
  if (!rule || !rule.operations.has(operation)) {
    throw denied(`keyslot.${operation} on slot "${slotId}" is not permitted by this host.`);
  }
  return rule;
}

/**
 * Throw unless keyslot.sign may sign `payload` with `slotId`. The bare 32-byte
 * refusal applies to Ed25519, the algorithm module signatures use; secp256k1
 * keyslot signatures are ECDSA over sha256(payload), which no bare-digest
 * statement shares.
 */
export function assertKeySlotSignPayload(policy, slotId, payload, algorithm = "ed25519") {
  const rule = assertKeySlotOperation(policy, slotId, "sign");
  if (algorithm === "ed25519" && payload.length === 32) {
    throw denied("keyslot.sign refuses a bare 32-byte payload: it is indistinguishable from a signed digest.");
  }
  for (const prefix of RESERVED_PREFIXES) {
    if (startsWith(payload, prefix)) {
      throw denied("keyslot.sign refuses a payload in a reserved signature domain.");
    }
  }
  if (rule.fileIdentifiers) {
    const id = payload.length >= 8 ? payload.subarray(4, 8) : null;
    if (!id || !rule.fileIdentifiers.some((allowed) => startsWith(id, allowed))) {
      throw denied(`keyslot.sign on slot "${slotId}" signs only its bound FlatBuffer file identifiers.`);
    }
  }
  return rule;
}
