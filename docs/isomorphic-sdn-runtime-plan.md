# Isomorphic SDN Runtime Plan

## Goal

Make Space Data modules and flows portable across browser and server runtimes
without changing the signed module or flow artifact.

The same compiled WASM artifact should be deployable in both environments. The
deployment layer may change host bindings, trust policy, routing, and delegated
services, but not the module contract, method signatures, schemas, or protocol
IDs.

## Definition Of "Isomorphic"

Isomorphic does **not** mean the browser gets raw server powers like local cron,
raw TCP listeners, unrestricted filesystem access, or direct OS process
control.

It means:

- the same signed module or flow artifact runs in browser and server
- the same typed ports, schemas, protocol IDs, and deployment semantics apply
- runtime differences are expressed through explicit host bindings
- unsupported capabilities fail at deploy time unless a delegated service is
  configured

## Required Runtime Model

Every deployable artifact must separate:

1. Canonical artifact contract
   - methods
   - ports
   - schemas
   - capabilities
   - hosted protocol identity

2. Deployment bindings
   - browser-local vs server-local vs delegated services
   - trust policy
   - route bindings
   - multiaddrs and advertised addresses
   - scheduler bindings
   - storage bindings

## Capability Portability Rules

Each capability used by a module or flow must be classified into one of:

- `browser-local`
- `browser-delegated`
- `server-local`
- `server-delegated`
- `unsupported`

Initial intended classification:

| Capability Family | Browser | Server | Notes |
| --- | --- | --- | --- |
| `clock`, `random`, `logging`, `crypto_*` | local | local | shared baseline |
| `http` outbound | local | local | browser uses fetch/Web APIs |
| `websocket` outbound | local | local | secure transport only in browser |
| `pubsub` | delegated or local via web libp2p | local | same topic/schema contract |
| `protocol_dial` | local via web-safe libp2p transports | local | browser requires relay/web transport |
| `protocol_handle` | delegated | local | browser cannot assume inbound listeners |
| `filesystem` | delegated or OPFS-style adapter | local | no portable raw POSIX assumption |
| `storage_query` / `storage_write` | delegated or browser store | local | FlatSQL likely server-local first |
| `schedule_cron` | delegated | local | browser should not promise native cron |
| raw `tcp` / `udp` listen | unsupported or delegated | local | browser-unfriendly |
| inbound HTTPS service | delegated or service-worker/gateway model | local | same flow contract, different binding |

## Five Target Scenarios

### 1. CelesTrak OMM ingest -> FlatSQL -> HTTPS REST

Target outcome:

- same flow artifact compiles once
- server deployment binds local FlatSQL and local HTTPS listener
- browser deployment binds remote storage/query and delegated HTTPS gateway

Needed:

- server-side FlatSQL adapter in `sdn-flow`
- browser-side delegated storage/query binding
- CSV ingestion as compiled/runtime capability, not editor-only behavior

### 2. EPM-driven SDN/IPFS discovery -> offer list -> publish watch -> pull/pin

Target outcome:

- flow declares required pubsub/protocol/data input contracts
- deployment binds it to SDN/IPFS discovery and trust policy
- browser can consume via web-safe libp2p transports or delegated relay

Needed:

- generic SDN/IPFS host bindings in `sdn-flow`
- generic manifest-driven WASI/libp2p bridge in `space-data-network`
- actual `publish -> PNM -> fetch/pin` runtime completion

### 3. Scheduled space weather polling -> publish SDS records -> FlatBuffer on disk

Target outcome:

- same flow artifact
- server runs local schedule plus local file/storage/publish pipeline
- browser uses delegated scheduler and delegated durable storage

Needed:

- deployment-plan schedule metadata
- explicit publish/storage binding model
- file/archive representation that can target disk or delegated object storage

### 4. Authenticated REST and IPFS services using approved keys

Target outcome:

- modules do not implement trust policy internally
- deployment binds services to trust mappings and approved-key policy
- same flow contract, different enforcement adapters

Needed:

- request-time enforcement in host/harness
- common identity model across peer ID, xpub, and published entity profile data
- delegated auth path for browser-hosted services

### 5. Homomorphic encrypted conjunction service

Target outcome:

- HE operations come from `../flatbuffers/wasm`
- module/flow artifacts treat ciphertexts and HE operations as typed payloads and
  service calls
- SDN provides transport, trust, discovery, and hosting

Needed:

- actual conjunction/assessor module
- explicit HE deployment/service policy
- browser/server transport parity for encrypted typed payload exchange

## Repo Responsibilities

### `space-data-module-sdk`

This repo should own:

- canonical manifest schema
- protocol identity and deployment-binding schema
- bundle format and deployment metadata
- portable capability vocabulary
- deploy-time validation of portability requirements

Changes still needed here:

- add deployment metadata for scheduler binding
- add explicit binding vocabulary for local vs delegated host services
- add portability validation so browser deployments fail early when a capability
  has no legal binding
- keep canonical manifest free of concrete multiaddrs, peer selections, and
  environment-specific routes

### `sdn-flow`

`sdn-flow` should own:

- flow composition
- requirement inspection
- compiled runtime integration
- host binding resolution
- generated deployment plans

Changes needed there:

- make the compiled runtime the installed runtime, not the temporary JS runtime
- move CSV/file/cron/IPFS/pubsub/protocol behavior out of editor-only code
- generate deployment bindings that distinguish browser/server/delegated modes
- stop overstating browser/runtime capability support

### `space-data-network`

`space-data-network` should own:

- libp2p/IPFS harness
- trust and discovery
- PNM/pubsub/fetch/pin runtime
- generic manifest-driven protocol hosting
- request-time auth enforcement

Changes needed there:

- generalize the WASI stream bridge beyond OrbPro-only protocol IDs
- complete `publish -> PNM -> fetch/pin`
- normalize identity across peer ID, xpub, and entity profile data
- make browser `sdn-js` use real FlatBuffer/aligned-binary transport instead of
  JSON payload fallback

### `../flatbuffers/wasm`

This dependency should remain the owner of:

- aligned-binary FlatBuffer generation
- HE contexts and ciphertext operations
- encrypted field and encrypted payload tooling

This stack should consume it, not reimplement it.

## Hard Constraints

- No feature may be marked "browser-supported" unless it has either a true
  browser-local implementation or a required delegated binding path.
- No installed runtime may rely on editor-only handlers.
- No protocol host integration may depend on hardcoded product-specific protocol
  IDs when the manifest already declares protocol identity.
- No deployment should silently coerce server-only features into a browser
  deployment.

## Recommended Order

1. Finish the portable deployment vocabulary in this repo.
2. Replace `sdn-flow` installed runtime with the compiled runtime path.
3. Add browser/server/delegated binding generation in `sdn-flow`.
4. Generalize the `space-data-network` WASI/libp2p bridge.
5. Complete SDN publish/PNM/fetch/pin and trust enforcement.
6. Then build the concrete end-user flows and the HE conjunction service.

## Definition Of Done

This plan is complete when:

- one signed flow artifact can be deployed to browser or server
- deployment validation explains every required binding
- browser deployments use delegated services where local support is impossible
- server deployments use native host integrations where available
- SDN/IPFS discovery and hosting honor the same protocol metadata in both
  environments
- HE-enabled services can exchange typed encrypted payloads without inventing a
  second browser-only or server-only contract
