/**
 * LEGACY WILDCARD PORT LEDGER — frozen 2026-07-29.
 *
 * These (pluginId -> "methodId:in|out:portId") entries are the wildcard
 * (`acceptsAnyFlatbuffer`) ports that were ALREADY SHIPPED, signed and deployed
 * when the wildcard-port boundary landed (P1 `upstream-module-sdk-1`). They
 * predate the boundary, they cannot be retyped without changing the manifests
 * that are baked into live, capability-approved artifact hashes, and so they
 * downgrade `wildcard-port-type` from an ERROR to a `legacy-wildcard-port-type`
 * WARNING instead of being permitted outright.
 *
 * THE LEDGER IS SHRINK-ONLY. Nothing may be added. Every entry is debt with two
 * exits:
 *
 *   1. declare the concrete SDS identity on the port (the CCSDS 124 codec route,
 *      `mod-ccsds124-typed-cps-ports`), or
 *   2. declare `acceptedTypeSet.wildcardJustification` when the payload has no
 *      SDS identity to declare (see WildcardJustificationKind).
 *
 * A plugin that is application-blind at the HOST boundary — it declares an
 * `externalInterfaces[]` entry of kind `host-service` whose capability it also
 * declares in `capabilities` — needs no ledger entry and no justification; that
 * is checked mechanically and is why no hostcap node and no compiled flow
 * appears below.
 *
 * `test/wildcard-port-boundary.test.js` asserts the frozen totals as an upper
 * bound: shrinking passes untouched, growing fails loudly.
 */
export const LEGACY_WILDCARD_LEDGER_FROZEN_ON = "2026-07-29";

/** @type {Readonly<Record<string, readonly string[]>>} */
export const LegacyWildcardPortLedger = Object.freeze({
  "atmosphere-model": ["invoke:in:request", "invoke:out:response"],
  "cislunar-propagator": ["invoke:in:request", "invoke:out:response"],
  "com.digitalarsenal.basilisk.runtime": [
    "run_pointing_power_scenario:in:scenario",
    "run_pointing_power_scenario:out:telemetry",
  ],
  "com.digitalarsenal.data-source.celestrak-parser": [
    "parse_gp:in:job",
    "parse_gp:in:response",
    "parse_gp:out:mpe_meta",
    "parse_gp:out:mpe_records",
    "parse_gp:out:omm_meta",
    "parse_gp:out:omm_records",
    "parse_gp:out:raw",
    "parse_satcat:in:job",
    "parse_satcat:in:response",
    "parse_satcat:out:cat_meta",
    "parse_satcat:out:cat_records",
    "parse_satcat:out:raw",
    "parse_spw:in:job",
    "parse_spw:in:response",
    "parse_spw:out:raw",
    "parse_spw:out:spw_meta",
    "parse_spw:out:spw_records",
  ],
  "com.digitalarsenal.data-source.celestrak-request": [
    "gp:in:tick",
    "gp:out:job",
    "gp:out:request",
    "publish_request:in:meta",
    "publish_request:in:result",
    "publish_request:out:request",
    "satcat:in:tick",
    "satcat:out:job_csv",
    "satcat:out:job_txt",
    "satcat:out:request_csv",
    "satcat:out:request_txt",
    "spw:in:tick",
    "spw:out:job",
    "spw:out:request",
  ],
  "com.digitalarsenal.data-source.oem-source-iss": [
    "emit:in:tick",
    "emit_compact:in:tick",
  ],
  "com.digitalarsenal.foundation.decision-gate": [
    "branch:in:decision",
    "branch:in:stream",
    "branch:out:decision",
    "branch:out:etag",
    "branch:out:flatbuffer",
    "dispatch:in:decision",
    "dispatch:out:not_found",
    "dispatch:out:routed",
  ],
  "com.digitalarsenal.foundation.discovery-shape": [
    "shape_latest:in:decision",
    "shape_latest:in:snapshot",
    "shape_latest:out:body",
    "shape_latest:out:decision",
    "shape_latest:out:etag",
    "shape_latest:out:stream",
    "shape_peers:in:decision",
    "shape_peers:in:snapshot",
    "shape_peers:out:body",
    "shape_peers:out:decision",
    "shape_peers:out:etag",
    "shape_pnm:in:decision",
    "shape_pnm:in:snapshot",
    "shape_pnm:out:body",
    "shape_pnm:out:decision",
    "shape_pnm:out:etag",
    "shape_standards:in:decision",
    "shape_standards:in:snapshot",
    "shape_standards:out:body",
    "shape_standards:out:decision",
    "shape_standards:out:etag",
  ],
  "com.digitalarsenal.foundation.http-respond": [
    "respond:in:body",
    "respond:in:decision",
    "respond:in:error",
    "respond:in:etag",
  ],
  "com.digitalarsenal.foundation.http-route": [
    "discover:out:decision",
    "route:out:decision",
    "route_node_activity:out:decision",
    "route_node_status:out:decision",
    "route_public_query:out:decision",
  ],
  "com.digitalarsenal.foundation.omm-json": ["encode:out:json"],
  "com.digitalarsenal.hostcap.flatsql-store": [
    "store:in:config",
    "store:in:provenance",
    "store:in:trigger",
    "store:out:result",
  ],
  "com.orbpro.cpf-source": ["emit:in:config"],
  "com.orbpro.glonass-source": ["emit:in:config"],
  "com.orbpro.intelsat-source": ["emit:in:config"],
  "com.orbpro.iss-source": ["emit:in:config"],
  "com.orbpro.sensor-shaders": [
    "get_shader_bundle:in:request",
    "load_shader_bundle:in:request",
  ],
  "com.orbpro.sgp4": ["propagate_path:in:request", "propagate_path:out:samples"],
  "com.orbpro.spacex-starlink-source": ["emit:in:config"],
  "covariance-analysis": [
    "compute_covariance:in:covariance",
    "compute_covariance:out:covariance",
  ],
  licensing: [
    "client_fetch_and_decrypt:in:protected_content",
    "client_fetch_and_decrypt:out:plaintext",
    "decrypt_and_verify:in:protected_content",
    "decrypt_and_verify:out:plaintext",
    "server_publish_module:in:protected_content",
  ],
  "maneuver-planner": ["invoke:in:request", "invoke:out:response"],
  "orbit-determination": [
    "fit:in:meme",
    "fit:in:options",
    "fit:out:provenance",
    "fit:out:result",
  ],
  "protection-key-server": [
    "check_key_rotation:in:request",
    "check_key_rotation:out:status",
    "configure_runtime:in:config",
    "configure_runtime:out:status",
    "get_public_key:in:request",
    "get_public_key:out:response",
    "handle_key_request:in:request",
    "handle_key_request:out:response",
    "request_challenge:in:request",
    "request_challenge:out:response",
  ],
  "protection-license-client": [
    "decrypt:in:ciphertext",
    "decrypt:in:key",
    "decrypt:out:plaintext",
    "decrypt_and_verify:in:dek",
    "decrypt_and_verify:in:protected_content",
    "decrypt_and_verify:in:signer_key",
    "decrypt_and_verify:out:plaintext",
    "get_dek:in:request",
    "get_dek:out:response",
    "verify:in:public_key",
    "verify:in:signed_content",
    "verify:out:result",
  ],
});

/**
 * Frozen totals. Assertions use them as an UPPER BOUND so the ledger may only
 * shrink; growing it fails `test/wildcard-port-boundary.test.js`.
 */
export const LEGACY_WILDCARD_LEDGER_FROZEN_PLUGIN_COUNT = 25;
export const LEGACY_WILDCARD_LEDGER_FROZEN_PORT_COUNT = 126;

const ledgerIndex = new Map(
  Object.entries(LegacyWildcardPortLedger).map(([pluginId, ports]) => [
    pluginId,
    new Set(ports),
  ]),
);

/**
 * @param {string|undefined} pluginId
 * @param {string|undefined} methodId
 * @param {"in"|"out"} direction
 * @param {string|undefined} portId
 * @returns {boolean}
 */
export function isLegacyWildcardPort(pluginId, methodId, direction, portId) {
  if (
    typeof pluginId !== "string" ||
    typeof methodId !== "string" ||
    typeof portId !== "string"
  ) {
    return false;
  }
  return (
    ledgerIndex.get(pluginId)?.has(`${methodId}:${direction}:${portId}`) === true
  );
}
