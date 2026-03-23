# Cross-Repo Integration TODO

This file is the checked-in summary of the remaining work after the SDK-side
deployment, protocol, aligned-binary, and emception changes landed.

Detailed local working notes live under `.claude/todos/`.

## `space-data-module-sdk`

- [ ] Add an end-to-end example package that combines:
  - hosted protocol metadata
  - deployment-plan metadata
  - mixed regular/aligned port contracts
  - signed `sds.bundle` packaging
- [ ] Add bundle/vector coverage for deployment plans that include:
  - `protocolInstallations`
  - `inputBindings`
  - `scheduleBindings`
  - `serviceBindings`
  - `authPolicies`
  - `publicationBindings`
- [ ] Add an SDK-level deployment-plan-driven harness helper so downstream
      repos can generate runtime/install tests from:
  - manifest
  - deployment plan
  - selected runtime profile
- [ ] Add a concrete example of regular FlatBuffer input plus aligned-binary
      output, mirroring the OrbPro/SGP4 contract.
- [ ] Document browser-local versus delegated deployment bindings more sharply
      for:
  - filesystem
  - scheduler
  - inbound HTTP services
  - protocol hosting
- [ ] Keep the next host ABI expansion scoped to typed async/resource-oriented
      hostcalls, not new ad hoc JSON bridges.

## `sdn-flow`

- [ ] Finish applying generated deployment plans in the installed host/runtime
      path.
- [ ] Keep the flow compiler generating C++ and compiling it through the SDK
      emception API only.
- [ ] Move remaining deterministic runtime/editor behavior out of the JS
      runtime path and into compiled WASM modules.
- [ ] Replace editor/runtime JSON `msg` plumbing with typed frame transport.
- [ ] Add deployment/install packaging that persists the generated deployment
      plan with compiled artifacts.
- [ ] Enforce auth, service, schedule, and publication bindings at runtime.

## `OrbPro`

- [ ] Consume `sds.bundle` deployment-plan metadata during install.
- [ ] Generalize the licensing-server protocol install path to arbitrary module
      protocols.
- [ ] Preserve aligned-binary metadata end-to-end for mixed-format modules such
      as SGP4.
- [ ] Apply approved-key trust mappings from `hd-wasm-wallet` to REST and
      libp2p/IPFS services.
- [ ] Distinguish local hosting from delegated hosting cleanly in browser
      deployments.

## `space-data-network`

- [ ] Generalize the WASI/libp2p harness from OrbPro-specific protocols to
      manifest/deployment-driven protocol installs.
- [ ] Complete the `publish -> PNM -> fetch/pin` loop with signed policy-driven
      retention behavior.
- [ ] Expose installed protocol metadata and publish offerings through node-info
      and related APIs.
- [ ] Route stream handlers by `wireId` and preserve aligned-binary metadata in
      the stream bridge.
- [ ] Apply trust/auth policy uniformly across REST, pubsub, and direct
      protocol services.

## Scenario Acceptance Targets

- [ ] CSV OMM ingest to FlatSQL on disk plus authenticated HTTPS query service
- [ ] SDN publish discovery, pull, watch, and policy-driven pinning
- [ ] Scheduled space-weather ingest plus PNM publication and FlatSQL REST
- [ ] Approved-key-only REST and IPFS services
- [ ] Homomorphic conjunction service built on `../flatbuffers/wasm`
