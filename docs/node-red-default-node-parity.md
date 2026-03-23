# Node-RED Default Node Parity Matrix

This matrix defines the deployment intent for compiled `sdn-flow` artifacts.

Use three buckets:

- `wasi`: strict standalone WASI with no wrapper requirement
- `wasmedge`: standard server-side deployment target for maximum WASI
  compatibility
- `wrapper/delegated`: browser targets or features that still need host
  mediation

The practical reason for `wasmedge` is simple: standalone WASI still does not
give us portable networking parity, while WasmEdge adds socket, DNS, and TLS
extensions that make guest-owned network services realistic.

## `wasi` Target

These should run as plain standalone WASI programs with no wrapper layer:

- `change`
- `switch`
- `range`
- `template`
- `json`
- `csv`
- `yaml`
- `xml`
- `html`
- `split`
- `join`
- `batch`
- `sort`
- `rbe`
- `link in`
- `link out`
- `link call`
- `debug`
- deterministic flow routing and payload transforms
- `file` and `file in` when limited to WASI preopen/file access

Notes:

- `inject` only fits this bucket for direct/manual triggering, not scheduling.
- `file` parity here excludes file watching.

## `wasmedge` Target

These should aim to run in guest logic on WasmEdge without an extra wrapper:

- outbound `http request`
- inbound `http in` plus `http response`
- guest-owned TCP client/server behavior
- guest-owned UDP behavior
- guest-owned TLS/HTTPS behavior
- direct protocol services built on sockets
- WebSocket logic implemented in guest libraries over sockets/TLS
- MQTT logic implemented in guest libraries over sockets/TLS

Notes:

- `websocket` and `mqtt` are guest-library targets, not direct WasmEdge runtime
  APIs.
- prefer guest-owned protocol stacks over host wrappers whenever WasmEdge
  sockets/TLS are sufficient.

## Wrapper Or Delegated Host Required

These still require wrappers, delegated services, or explicit runtime support
outside the guest:

- `watch`
- `exec`
- cron-style `inject`
- `delay` and `trigger` when they depend on wall-clock scheduling
- `complete`
- `catch`
- `status`
- browser-local inbound listeners
- browser-local durable filesystem behavior beyond browser storage adapters
- any feature that depends on OS process control or file watching

## Planning Rule

If a node can be implemented entirely inside guest code on top of standard WASI
or WasmEdge extensions, it should not be modeled as a host capability. Host
capabilities should be reserved for features that truly still need wrappers or
delegated services.
