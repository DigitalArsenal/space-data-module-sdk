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
- producer-to-consumer input bindings

Those values vary per environment and should not change the identity of a
signed `.wasm` artifact.

Instead, attach them as a deployment-plan payload in `sds.bundle`.

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
      "wireId": "/sdn/sgp4/1.0.0",
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
      "targetMethodId": "propagate",
      "targetInputPortId": "request",
      "sourceKind": "pubsub",
      "topic": "/spacedatanetwork/sds/OMM.fbs"
    }
  ]
}
```

## Identity Rules

- `wireId` identifies the network protocol.
- `specUri` identifies the message or schema contract.
- multiaddrs identify one deployment instance of that protocol.

Do not treat those as interchangeable.
