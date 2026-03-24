# Protocol Installation Metadata

This SDK now separates protocol identity from deployment-time routing.

That split matters because module artifacts are portable, compiled, and
signable, while deployment endpoints are environment-specific.

## Canonical Manifest

Hosted protocol declarations belong in `manifest.protocols`.

Those declarations describe what a module can host or dial:

- `protocolId`
- `methodId`
- `inputPortId`
- `outputPortId`
- `wireId`
- `transportKind`
- `role`
- `specUri`
- `autoInstall`
- `advertise`
- `discoveryKey`
- `defaultPort`
- `requireSecureTransport`

These fields are embedded in the compiled `PluginManifest.fbs` bytes and are
part of the canonical module contract.

## Deployment Metadata

Concrete deployment routing does **not** belong in the canonical manifest.

Examples:

- concrete multiaddrs
- resolved listen ports
- selected peer IDs
- node-info URLs
- interface-keyed input bindings
- scheduler bindings
- hosted service bindings
- request-time auth policy
- publication, pinning, retention, and archive policy

Those values vary per environment and should not change the identity of a
signed `.wasm` artifact.

Instead, attach them as a deployment-plan payload in `sds.bundle`.

Deployment plans should use `protocolId` as the required identifier for a
resolved protocol installation. `wireId` is optional deployment metadata for
legacy transports that still expose it, not a required routing key.

Deployment input and publication bindings should reference
`manifest.externalInterfaces[].interfaceId`. That keeps deployment routing tied
to the declared module contract instead of transport-specific `topic` or
`wireId` hints.

The standard bundle entry is:

- `entryId`: `deployment-plan`
- `sectionName`: `sds.deployment`
- `payloadEncoding`: `json-utf8`
- `mediaType`: `application/vnd.space-data.module.deployment+json`

## Public Helpers

Use `space-data-module-sdk/deployment` to work with that payload:

- `normalizeDeploymentPlan(...)`
- `validateDeploymentPlan(...)`
- `createDeploymentPlanBundleEntry(...)`
- `findDeploymentPlanEntry(...)`
- `readDeploymentPlanFromBundle(...)`

## Example Manifest Protocol

```json
{
  "protocols": [
    {
      "protocolId": "sgp4-stream",
      "methodId": "propagate",
      "inputPortId": "request",
      "outputPortId": "state",
      "wireId": "/sdn/sgp4/1.0.0",
      "transportKind": "libp2p",
      "role": "handle",
      "specUri": "https://spacedatastandards.org/#/schemas/PNM",
      "autoInstall": true,
      "advertise": true,
      "discoveryKey": "sgp4-stream",
      "defaultPort": 443,
      "requireSecureTransport": true
    }
  ]
}
```

## Example Deployment Plan

```json
{
  "formatVersion": 1,
  "pluginId": "com.example.sgp4",
  "version": "1.2.3",
  "protocolInstallations": [
    {
      "protocolId": "sgp4-stream",
      "transportKind": "libp2p",
      "role": "handle",
      "peerId": "12D3KooW...",
      "listenMultiaddrs": [
        "/ip4/127.0.0.1/tcp/14080/ws/p2p/12D3KooW..."
      ],
      "advertisedMultiaddrs": [
        "/dns4/sgp4.example.test/tcp/443/wss/p2p/12D3KooW..."
      ],
      "nodeInfoUrl": "https://sgp4.example.test/api/node/info"
    }
  ],
  "inputBindings": [
    {
      "bindingId": "catalog-feed",
      "interfaceId": "catalog-pubsub",
      "targetMethodId": "propagate",
      "targetInputPortId": "request",
      "sourceKind": "pubsub"
    }
  ],
  "scheduleBindings": [
    {
      "scheduleId": "poll-upstream",
      "bindingMode": "local",
      "targetMethodId": "propagate",
      "targetInputPortId": "request",
      "scheduleKind": "cron",
      "cron": "*/15 * * * *"
    }
  ],
  "serviceBindings": [
    {
      "serviceId": "https-query",
      "bindingMode": "delegated",
      "serviceKind": "http-server",
      "routePath": "/api/sgp4",
      "method": "GET",
      "remoteUrl": "https://gateway.example.test/api/sgp4",
      "authPolicyId": "approved-keys"
    }
  ],
  "authPolicies": [
    {
      "policyId": "approved-keys",
      "bindingMode": "delegated",
      "targetKind": "service",
      "targetId": "https-query",
      "walletProfileId": "orbpro-default",
      "trustMapId": "approved-operators",
      "allowServerKeys": ["ed25519:..."]
    }
  ],
  "publicationBindings": [
    {
      "publicationId": "state-catalog",
      "interfaceId": "state-catalog-pubsub",
      "bindingMode": "local",
      "sourceKind": "method-output",
      "sourceMethodId": "propagate",
      "sourceOutputPortId": "state",
      "schemaName": "CAT.fbs",
      "emitPnm": true,
      "emitFlatbufferArchive": true,
      "archivePath": "/data/catalog/cat.bin",
      "queryInterfaceId": "state-query-api",
      "recordRangeStartField": "startIndex",
      "recordRangeStopField": "stopIndex"
    }
  ]
}
```

## Identity Rules

- `wireId` identifies the network protocol.
- `specUri` identifies the message or schema contract.
- multiaddrs identify one deployment instance of that protocol.
- `interfaceId` identifies the declared module boundary used by deployment
  input/publication bindings.
- deployment plans should resolve installed protocol surfaces by `protocolId`;
  include `wireId` only when a host integration still needs that legacy hint.

Do not treat those as interchangeable.
