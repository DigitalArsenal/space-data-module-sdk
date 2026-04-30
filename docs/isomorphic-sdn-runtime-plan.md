# Isomorphic SDN Runtime Plan

## Goal

Run the same signed Space Data modules across browser, server, OrbPro, and
WasmEdge without changing the module contract.

The runtime differences are host differences, not module differences.

## Current Direction

`space-data-module-sdk` is the source of truth for:

- the canonical module artifact
- the canonical module ABI
- the canonical dynamic runtime host
- the canonical WasmEdge/browser/server harness model

Host runtime packages are layered on top of that runtime host as:

- graph/program compiler
- deployment planner
- editor/runtime authoring surface
- optional `emception`-backed build tooling

It is no longer the intended source of truth for a separate runtime model.

## Canonical Identity Model

### Standards Rows

Standards payloads are always addressed by:

- `($SCHEMA_FILE_ID, rowId)`

Rules:

- `rowId` is append-only
- `rowId` is never reused
- rows are not individually recycled
- if a host needs a new retention window, it recreates the mounted table/range

FlatSQL is the only query backend for standards rows.

### Runtime Aligned-Binary Records

High-performance derived runtime state is always addressed by:

- `(regionId, recordIndex)`

Rules:

- the host allocates all regions
- regions are dynamically requested at runtime
- regions are fixed-layout aligned-binary memory regions
- records stay stable for the lifetime of a region
- regions are not indexed in FlatSQL

### Raw Pointers

Raw pointers are valid only as internal execution details inside a live host or
module instance.

They are not a durable public contract.

## Host Responsibilities

The canonical SDK runtime host is responsible for:

- installing and loading modules dynamically
- exposing one canonical module registry for install/load/unload/invoke
- exposing FlatSQL-backed standards storage
- exposing canonical streamed FlatBuffer ingest into host-owned rows
- exposing row-handle resolution
- allocating aligned-binary runtime regions
- exposing region-record resolution
- routing typed invoke traffic across loaded modules
- hosting the same model in browser, server, and WasmEdge

The recommended outer transport / invoke / storage split is documented in
[`./flatsql-streaming-standard.md`](./flatsql-streaming-standard.md).

## OrbPro

OrbPro is not a separate storage/runtime architecture.

OrbPro adds a host-side entity/view layer over the same core model:

- standards rows live in FlatSQL
- WasmEngine owns transient zero-copy render/runtime views
- workers own query and index work
- main thread resolves transient shared-memory views for rendering and UI
- propagators write into host-managed aligned-binary regions

So OrbPro is:

- canonical SDK runtime host
- plus Cesium-facing entity/view helpers

## Server and Browser Node

Server and browser-node use the same core host model:

- FlatSQL-backed standards rows
- host-managed runtime regions
- dynamic module loading
- typed invoke routing

They do not need the OrbPro entity facade.

## WasmEdge

WasmEdge is a host target for the same runtime model.

The SDK’s WasmEdge runner should evolve from:

- single top-level guest launcher

to:

- dynamic multi-module host
- FlatSQL row service host
- runtime-region allocator host
- typed invoke router

This is a host concern, not a second guest ABI.

## Capability Model

The capabilities that matter most for this runtime model are:

- `database`
- `storage_query`
- `storage_write`
- `filesystem` only when backing FlatSQL to disk
- `pipe`
- `http`
- `network`
- `timers`

But direct standards-row reads and runtime-region reads should still happen
through the host’s typed row/region services rather than ad hoc JSON APIs.

## Dynamic Loading vs Compiled Flows

Dynamic module loading is the default runtime model.

Compiled flows remain useful, but only as an optional deployment/build mode:

- freezing a graph into one artifact
- minimizing moving parts
- packaging one sealed runtime

Compiled flow output must target the same runtime host contract, not invent a
parallel execution model.

## Definition of Done

This runtime model is complete when:

- the SDK ships one canonical runtime host surface
- the SDK host surface exposes row-handle, region, and registry services
- OrbPro, browser/server SDN nodes, and WasmEdge all consume that same host
- host runtime packages compile and deploy into that host rather than re-owning runtime behavior
- standards identity is always `($SCHEMA_FILE_ID, rowId)`
- aligned-binary runtime identity is always `(regionId, recordIndex)`
- Aerospace and SOCRATES validation pass on the composed host path
