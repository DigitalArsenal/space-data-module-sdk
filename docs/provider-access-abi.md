# Provider Access ABI

**Status:** v1 — owner directive 2026-08-07, graph task `sdk-provider-access-abi`.

One generalized port that lets a WASM module **control** imagery and terrain
providers and **read the already-decoded bytes** those providers hold in
memory — identical import names and signatures in the browser, in native
WasmEdge, and in the Docker WasmEdge container.

This is a *provider access* port, not a *Cesium* port and not an *OrbPro* port.
Nothing in the guest ABI names an engine, a tile scheme, or a vendor. The same
three imports serve a browser engine's live quadtree cache, a host-side tile
store, and a deterministic test fixture.

## Table of contents

- [Doctrine](#doctrine)
- [Capability](#capability)
- [The import set](#the-import-set)
- [Tile descriptor](#tile-descriptor)
- [Acquire requests](#acquire-requests)
- [Control operations](#control-operations)
- [Error codes](#error-codes)
- [Copy contract](#copy-contract)
- [Runtime satisfaction](#runtime-satisfaction)
- [Parity envelope](#parity-envelope)
- [Guest usage](#guest-usage)

## Doctrine

Four rules govern every line below.

1. **One port, two planes.** Control is metadata and rides the existing
   `space_data_module_host` sync hostcall bridge as `provider.*` operations.
   Data is bulk bytes and rides three dedicated imports that write straight
   into guest linear memory. Control never carries pixels; data never carries
   JSON.
2. **No runtime detection in module code.** A module that reads terrain never
   asks which runtime it is in. Every difference is absorbed in the SDK host
   shims.
3. **Present everywhere, honest everywhere.** The imports link in *every*
   runtime. There is no lane where `space_data_provider.acquire` is missing —
   a missing import is a link-time divergence, the worst class. When nothing
   can serve a request the port returns a **value** (a negative error code),
   never a trap, and the same code in every runtime.
4. **Decoded or nothing, by default.** The port hands over buffers the provider
   already decoded. It never re-fetches and never re-parses *unless the caller
   explicitly raised its cost ceiling*. Every acquire carries a declared
   [cost class](#cost-classes); the default ceiling admits only already-resident
   bytes, and an adapter that would have to exceed it returns
   `SDM_PROVIDER_E_UNSUPPORTED` rather than quietly paying it.

## Capability

The port is gated by the existing coarse capability, with a scope:

```json
{
  "capability": "scene_access",
  "scope": "provider.v1",
  "required": false,
  "description": "Read and control imagery/terrain providers."
}
```

`scene_access` is already in the SDK recommended capability vocabulary
(`src/capabilities.js`) and already maps to the typed
`CapabilityKind.SCENE_ACCESS` PLG enum (`src/manifest/normalize.js`). **This
ABI introduces no new host capability** — it is a scope on an existing one,
exactly as `gpu_compute` uses `scope: "webgpu.v1"`. No owner sign-off gate,
no SDS enum change, no new generic hook.

`required: false` is the recommended posture. A module whose analysis degrades
gracefully without provider bytes must declare it optional and handle
`SDM_PROVIDER_E_NO_PROVIDER` as a first-class outcome, because that is the
answer it will get on a headless node with no tile store configured.

## The import set

Import module: **`space_data_provider`**. Three functions. Every parameter and
every result is `i32`.

```wat
(import "space_data_provider" "acquire"
        (func (param i32 i32 i32) (result i32)))
(import "space_data_provider" "read"
        (func (param i32 i32 i32 i32 i32) (result i32)))
(import "space_data_provider" "release"
        (func (param i32) (result i32)))
```

| function  | params                                             | result |
| --------- | -------------------------------------------------- | ------ |
| `acquire` | `reqPtr, reqLen, descPtr`                           | handle `> 0`, or negative error code |
| `read`    | `handle, plane, srcOffset, dstPtr, dstLen`          | bytes written `>= 0`, or negative error code |
| `release` | `handle`                                            | `0`, or negative error code |

Open, read, close. Three doors.

**No `i64` appears anywhere in the boundary signature, and no `f64` either.**
This is deliberate. The i64 legalization trap measured on this SDK — a
64-bit-parameter import legalizes differently depending on how the host
instantiates it, and the mismatch surfaces as a link failure or a silently
truncated argument in exactly one runtime — is sidestepped by construction, not
by convention. Every 64-bit quantity in this ABI (bounding rectangles, height
extrema, sample coordinates) travels either inside the JSON acquire request or
inside the descriptor struct in guest memory, where it is plain
little-endian IEEE-754 the guest reads with a normal load. The boundary itself
carries only pointers, lengths, indices and codes.

- `acquire(reqPtr, reqLen, descPtr)` — `reqPtr/reqLen` is a UTF-8 JSON request
  (see [Acquire requests](#acquire-requests)). `descPtr` is a guest pointer to
  at least `SDM_PROVIDER_TILE_DESC_BYTES` (128) writable bytes; on success the
  host fills it with the [tile descriptor](#tile-descriptor). The returned
  handle pins the provider's decoded buffer on the host side until `release`.
  The call blocks until the tile is resident (browser: `Atomics.wait` on the
  SAB hostcall channel, the same mechanism `http` and `storage` already use;
  WasmEdge: a blocking host call). `descPtr` is left untouched on failure.
- `read(handle, plane, srcOffset, dstPtr, dstLen)` — copies at most `dstLen`
  bytes of `plane`, starting at `srcOffset` bytes into that plane, into guest
  memory at `dstPtr`. Returns the number of bytes written, which is
  `min(dstLen, planeByteLength - srcOffset)` and may legally be less than
  `dstLen` at the tail. Reading a plane in several chunks is supported and
  yields exactly the same bytes as one whole-plane read.
- `release(handle)` — unpins. Releasing an already-released handle returns
  `SDM_PROVIDER_E_BAD_HANDLE`, in every runtime. Handles are per-instance and
  per-thread-group; they are never valid across an instance restart.

Error detail (a message, a name, the failing operation) is retrieved through
the control plane with `provider.lastError`. It is deliberately not an extra
import: strings are metadata and metadata rides the existing bridge.

## Tile descriptor

`SDM_PROVIDER_TILE_DESC_BYTES = 128`. Little-endian. `u32` fields are 4-byte
aligned; `f64` fields start at offset 48 and are all 8-byte aligned, so a
guest may read them with aligned loads on every target.

| offset | type  | field             | meaning |
| ------ | ----- | ----------------- | ------- |
| 0      | u32   | `magic`           | `0x53445054` (`'SDPT'`) |
| 4      | u32   | `version`         | `1` |
| 8      | u32   | `kind`            | `1` terrain, `2` imagery |
| 12     | u32   | `encoding`        | see below |
| 16     | u32   | `width`           | elements per row |
| 20     | u32   | `height`          | rows |
| 24     | u32   | `planeCount`      | number of readable planes, `>= 1` |
| 28     | u32   | `bytesPerElement` | of plane 0 |
| 32     | u32   | `rowStrideBytes`  | of plane 0; `>= width * bytesPerElement` |
| 36     | u32   | `byteLength`      | of plane 0 |
| 40     | u32   | `flags`           | see below |
| 44     | u32   | `level`           | source level, or `0xFFFFFFFF` for derived tiles |
| 48     | f64   | `west`            | radians |
| 56     | f64   | `south`           | radians |
| 64     | f64   | `east`            | radians |
| 72     | f64   | `north`           | radians |
| 80     | f64   | `minValue`        | terrain: min height, metres. imagery: `0` |
| 88     | f64   | `maxValue`        | terrain: max height, metres. imagery: `0` |
| 96     | u32   | `tileX`           | source tile X, or `0xFFFFFFFF` |
| 100    | u32   | `tileY`           | source tile Y, or `0xFFFFFFFF` |
| 104    | u32   | `hostCopies`      | host→guest copies this acquire will cost per whole-plane read |
| 108    | u32   | `sourceId`        | FNV-1a 32 of the provider id — stable, comparable across runtimes |
| 112    | u32   | `costClass`       | what this acquire actually cost — see [Cost classes](#cost-classes) |
| 116    | u32[3]| `reserved`        | zero |

`encoding`:

| value | name | element |
| ----- | ---- | ------- |
| 1  | `SDM_PROVIDER_ENC_HEIGHT_F32`  | `float` metres above the ellipsoid |
| 2  | `SDM_PROVIDER_ENC_HEIGHT_F64`  | `double` metres above the ellipsoid |
| 16 | `SDM_PROVIDER_ENC_RGBA8`       | 4 × `uint8_t` |
| 17 | `SDM_PROVIDER_ENC_RGB8`        | 3 × `uint8_t` |
| 18 | `SDM_PROVIDER_ENC_GRAY8`       | 1 × `uint8_t` |
| 19 | `SDM_PROVIDER_ENC_GRAY16`      | 1 × `uint16_t` |
| 20 | `SDM_PROVIDER_ENC_RGBA_F32`    | 4 × `float`, 0..1 |

**Terrain heights are always delivered in metres**, as `f32` or `f64`. A
provider's on-the-wire encoding — a 16-bit heightmap with
`{heightScale, heightOffset, elementsPerHeight, stride, elementMultiplier,
isBigEndian}` structure, or a quantized-mesh's zig-zag-encoded `u16`
vertices — is the *provider's* business. The adapter dequantizes into metres
exactly once and pins the result. Guests never see a scale/offset field
because guests must never reimplement a provider's quantization; that is the
single most likely place for two runtimes to disagree by one ULP, and the ABI
removes the opportunity rather than documenting it.

`flags`:

| bit | name | meaning |
| --- | ---- | ------- |
| 0 | `SDM_PROVIDER_FLAG_INTERPOLATED` | values were interpolated from a coarser level than requested |
| 1 | `SDM_PROVIDER_FLAG_STAGED`       | host had to stage a copy; `hostCopies` is `2` |
| 2 | `SDM_PROVIDER_FLAG_PARTIAL`      | some elements have no data and hold the no-data sentinel |
| 3 | `SDM_PROVIDER_FLAG_DERIVED`      | not a source tile (profile/region request) |
| 4 | `SDM_PROVIDER_FLAG_FIXTURE`      | served by the deterministic fixture adapter |

Bit 4 exists so a parity test can *prove* it compared fixture bytes against
fixture bytes, rather than assuming it.

### The no-data sentinel

A terrain sample with no data is **not** absent, **not** `0`, and **not** NaN.
It is an exact bit pattern:

| encoding | sentinel | bits |
| -------- | -------- | ---- |
| `HEIGHT_F32` | `-FLT_MAX` | `0xFF7FFFFF` |
| `HEIGHT_F64` | `-DBL_MAX` | `0xFFEFFFFFFFFFFFFF` |

NaN is specifically rejected. WebAssembly does not canonicalize NaN payloads
across all producing operations, so two runtimes can hold *different bits* for
"a NaN" and a byte-identical-output assertion would fail on a value that is
semantically equal. A sentinel with one exact encoding cannot do that.

This also closes a real defect class in the existing engine seam, where "no
data" is expressed as `Cartographic.height === undefined` — a JS-object-only
state that a typed array cannot represent at all, and which therefore silently
becomes `0` (sea level) the moment anyone packs those samples into a buffer.
Sea level under a ridge is exactly the failure the RF terrain solver was filed
for. The sentinel is defined here, in the ABI, so no consumer has to invent it.

### Cost classes

`costClass` states what an acquire actually cost. The acquire request carries
`"maxCost"`, and an adapter that cannot serve within it returns
`SDM_PROVIDER_E_UNSUPPORTED`.

| value | name | meaning |
| ----- | ---- | ------- |
| 0 | `SDM_PROVIDER_COST_RESIDENT`   | bytes already decoded and resident; pure memcpy |
| 1 | `SDM_PROVIDER_COST_DEQUANTIZE` | resident, but dequantized to metres by the adapter |
| 2 | `SDM_PROVIDER_COST_REDECODE`   | adapter re-decoded already-fetched source data |
| 3 | `SDM_PROVIDER_COST_REFETCH`    | adapter went to the network |
| 4 | `SDM_PROVIDER_COST_READBACK`   | adapter stalled the GPU to read a texture back |

**`maxCost` defaults to `1`.** That default *is* the owner's "never re-fetch or
re-parse" rule, enforced by the ABI rather than by discipline. A caller who
genuinely wants the expensive path must raise the ceiling and thereby say so in
its own source.

Class 1 exists because it is unavoidable and honest: a quantized-mesh terrain
tile holds `uint16` vertices and **no metre-space array exists anywhere** in
the provider. The adapter dequantizes with the provider's own formula, once,
into the pinned buffer. That is not a re-decode — nothing is re-parsed and
nothing is re-fetched — but it is not free either, so it gets its own class
instead of being hidden inside class 0.

## Acquire requests

The JSON request selects one of three shapes. All angles are **radians**.

**`tile`** — one source tile, exactly as the provider decoded it. Zero
resampling, zero interpolation.

```json
{"op":"tile","providerId":"terrain.fixture","level":9,"x":123,"y":45}
```

**`profile`** — heights along a path. The seam the RF terrain solver consumes:
one call, one copy, `width = samples`, `height = 1`,
`encoding = SDM_PROVIDER_ENC_HEIGHT_F64`.

```json
{"op":"profile","providerId":"terrain.fixture",
 "start":[-1.9,0.65],"end":[-1.88,0.66],"samples":256,"level":"mostDetailed"}
```

or with explicit positions:

```json
{"op":"profile","providerId":"terrain.fixture",
 "positions":[[-1.9,0.65],[-1.899,0.6501]]}
```

`level` is an integer, `"mostDetailed"`, or omitted (adapter's default). The
sampled positions are great-circle-interpolated between `start` and `end` by
the *host adapter*, using the adapter's native sampler, so that two runtimes
sampling the same source agree byte-for-byte. A guest that interpolates its
own positions and passes them explicitly gets exactly what it asked for.

**`region`** — a rectangle resampled onto a `width × height` grid. What a
viewshed, a coverage raster, or a cloud-mask lane wants.

```json
{"op":"region","providerId":"imagery.fixture",
 "rectangle":[-1.91,0.64,-1.87,0.67],"width":256,"height":256,"level":9}
```

`region` on a terrain provider yields heights; on an imagery provider it
yields pixels. The port does not care which — that is the whole point.

Every shape accepts `"maxCost": N` (default `1`) and `"plane": "height" |
"pixels" | N`.

### Imagery is not terrain, and the ABI says so

Terrain can honour `maxCost: 0..1` because a decoded terrain tile stays
resident in the provider for as long as the tile is loaded. **Imagery cannot**,
on the current engine tree: the CPU-side pixel buffer is released immediately
after the texture is uploaded to the GPU, so for any tile the renderer has
finished with, the decoded pixels are simply gone.

The consequence is stated here rather than discovered later:

- imagery `acquire` at the default `maxCost: 1` succeeds **only** for tiles
  caught in the window between decode and upload, and returns
  `SDM_PROVIDER_E_UNSUPPORTED` otherwise;
- imagery at `maxCost: 4` may be served by GPU readback — but those are the
  *reprojected* pixels the renderer holds, not the source pixels, and the
  descriptor says so via `FLAG_DERIVED`;
- imagery at `maxCost: 3` re-fetches and re-decodes from the provider.

An adapter that wants to offer resident imagery must tap the pixels *before*
upload; that is an engine-side change and belongs to the engine owner, not to
this ABI. Until it exists, **`SDM_PROVIDER_E_UNSUPPORTED` is the correct and
final answer for resident imagery pixels**, and it is the same answer in all
three runtimes. The ABI does not promise imagery parity with terrain, because
the engine cannot currently deliver it, and a port that promised it would be
lying in exactly the way this SDK exists to prevent.

## Control operations

Ride the existing `space_data_module_host.call` bridge. No new imports.

| operation | request | response |
| --------- | ------- | -------- |
| `provider.list` | `{"kind":"terrain"\|"imagery"\|null}` | `{"providers":[{id,kind,name,ready,minLevel,maxLevel,tileWidth,tileHeight,encoding,credit}]}` |
| `provider.describe` | `{"id":"..."}` | the same record, plus adapter-specific `attributes` |
| `provider.select` | `{"kind":"terrain","id":"..."}` | `{"selected":"..."}` |
| `provider.configure` | `{"id":"...","settings":{...}}` | `{"applied":["alpha","show"],"rejected":[]}` |
| `provider.availability` | `{"id":"...","level":9,"x":1,"y":2}` | `{"available":true}` |
| `provider.prefetch` | `{"id":"...","rectangle":[w,s,e,n],"level":9}` | `{"requested":N,"pending":M,"supported":bool}` |
| `provider.await` | `{"id":"...","rectangle":[...],"level":9,"timeoutMs":30000}` | `{"ready":true,"pending":0}` |
| `provider.lastError` | `{}` | `{"code":-3,"name":"...","message":"...","operation":"..."}` |
| `provider.stats` | `{}` | `{"acquires":N,"reads":N,"bytesCopied":N,"hostCopies":N,"pinned":N}` |

`provider.list` returning `{"providers":[]}` is a **success**, not an error. A
headless node with nothing configured is a legitimate, enumerable state; making
it an error would mean the "nothing here" path differs from the "something
here" path in shape, and modules would grow runtime-shaped branches. They
return the same shape, so they don't.

`provider.configure` is intentionally a key/value bag with an explicit
`applied`/`rejected` split. Adapters apply what their underlying surface
natively supports and *report* the rest as rejected. An adapter must never
emulate a setting its provider does not have.

`provider.stats.hostCopies` is what a copy-count assertion reads. It is
maintained identically by every adapter.

`provider.prefetch` carries `"supported"` because **region prefetch is a
genuine engine LACK**, ruled by the engine owner: the browser engine loads
tiles from camera position only, and its one region-shaped API loads
*availability metadata*, not geometry. Rather than invent an engine API — which
the native-API law forbids — the port reports `"supported": false` with
`"requested": 0`. A host-side tile-store adapter, which has no camera and can
simply fetch, reports `"supported": true`. This is a real capability difference
and it is **declared in the response, not hidden**: a module reads one boolean
and does not branch on runtime. Closing the gap is engine work, tracked
separately as `orbpro-provider-access-port`.

## Error codes

Negative `i32`, returned from `acquire`, `read` and `release`. Identical value,
identical meaning, identical trap class (none — these are values) in every
runtime.

| code | name | when |
| ---- | ---- | ---- |
| `-1`  | `SDM_PROVIDER_E_INVALID_REQUEST` | malformed JSON, unknown `op`, out-of-range field |
| `-2`  | `SDM_PROVIDER_E_NO_CAPABILITY`   | `scene_access`/`provider.v1` not granted |
| `-3`  | `SDM_PROVIDER_E_NO_PROVIDER`     | no provider with that id or kind |
| `-4`  | `SDM_PROVIDER_E_NOT_READY`       | provider exists but is not ready; `provider.await` first |
| `-5`  | `SDM_PROVIDER_E_NOT_AVAILABLE`   | no data at that level/x/y |
| `-6`  | `SDM_PROVIDER_E_BOUNDS`          | pointer/length outside guest memory, or offset past the plane |
| `-7`  | `SDM_PROVIDER_E_BAD_HANDLE`      | unknown or already-released handle |
| `-8`  | `SDM_PROVIDER_E_BAD_PLANE`       | `plane >= planeCount` |
| `-9`  | `SDM_PROVIDER_E_UNSUPPORTED`     | adapter cannot serve this without re-fetch or re-decode |
| `-10` | `SDM_PROVIDER_E_TIMEOUT`         | load did not complete in the adapter's budget |
| `-11` | `SDM_PROVIDER_E_HOST`            | adapter threw; detail via `provider.lastError` |
| `-12` | `SDM_PROVIDER_E_PORT_UNAVAILABLE`| no provider port bound in this runtime at all |

`-9` is the honesty code. An adapter that *could* produce the answer by
re-downloading a tile or re-decoding a PNG must return `-9` rather than pay a
cost the caller did not ask for. A caller that wants the expensive path asks
for it explicitly through `provider.prefetch` + `provider.await`.

## Copy contract

The owner's budget is **one copy host→wasm, zero re-decode**. The port meets it
where the memory topology permits and reports honestly where it does not.
`descriptor.hostCopies` and `provider.stats.hostCopies` are the measurement,
readable from inside the guest, identical field in every runtime.

| lane | copies for a whole-plane `read` | why |
| ---- | ------------------------------- | --- |
| WasmEdge native | **1** | host writes the pinned decoded buffer into linear memory |
| WasmEdge in Docker | **1** | same host path |
| Browser, wasi-threads guest | **1** | guest memory is a `SharedArrayBuffer`; the controlling thread that owns the provider caches writes into it directly at `dstPtr` |
| Browser, sequential guest | **2** (`FLAG_STAGED`) | guest memory is not shared, so the controlling thread stages into the SAB and the worker performs the final copy |

Zero of these paths encode the bytes into a hostcall envelope. That matters:
the generic `space_data_module_host` envelope route costs **five** copies for a
tile in the browser worker topology (provider array → envelope encode → SAB
`data.set` → worker `new Uint8Array(length)` → bridge `lastResponseBytes` →
`read_response` into linear memory). A 262 KB heightmap through the generic
route is over a megabyte of memcpy per tile. That measured cost is the entire
justification for three dedicated imports instead of one more `provider.*`
operation on the existing bridge.

The sequential-browser `2` is the **already-sanctioned browser-sequential
throughput divergence** and nothing more. Bytes are identical, error codes are
identical, `FLAG_STAGED` and `hostCopies` state the difference out loud, and a
module that wants to assert `hostCopies == 1` can — it will simply be asserting
that it is running threaded. It closes when `browser-worker-topology` lands.

## Runtime satisfaction

The imports are always present. What is bound behind them varies, and only in
the SDK host shims.

**Browser, engine present.** `createEngineProviderAdapter({ scene })` satisfies
the port from the engine's live provider objects, through engine-native APIs
only. It binds in two tiers, and which tier answered is visible to the guest in
`descriptor.costClass`:

- **Tier A — the engine's own `ProviderAccessPort`,** when the engine exposes
  one. This is the `costClass 0/1` path: it walks the loaded tile cache and
  hands over the decoded terrain data the engine already holds. Reaching into
  a provider's private fields is *engine* work, not SDK work — those fields
  rot on every upstream pin advance, and the engine's owner keeps them tested
  inside the engine's own gates. The SDK calls the public port and nothing
  else.
- **Tier B — public engine API only,** when no port is present. Terrain is
  served through the engine's exported most-detailed terrain sampler, which
  re-requests and re-decodes: `costClass 2`. Under the default `maxCost: 1`
  this tier therefore **refuses** with `SDM_PROVIDER_E_UNSUPPORTED`, and a
  caller gets bytes only by explicitly raising its ceiling.

Tier B works today against real provider objects with no engine change, which
is what makes the port usable before the engine port lands; Tier A is what
makes it cheap afterwards. Neither tier ever silently upgrades its cost.

**WasmEdge, native or Docker.** There is no engine. The ruling, explicitly:

> The server-side satisfaction is a **host-side tile-store adapter**, not a
> refusal — and not an engine port. `createTileStoreProviderAdapter(...)`
> serves the identical operations from tile sources reachable by the host,
> using **only capabilities that already exist**: `filesystem` for a local
> tileset directory, `http` for a remote tile service. It introduces no new
> generic hook, so it needs no owner sign-off and no new connector. Where the
> SDN node wants to expose its own curated terrain/imagery sources through
> this port, that is a node-side *configuration* of this adapter — a `sdn`
> escalation for wiring, never a change to this ABI.

**Any runtime with nothing bound.** The port answers and does not lie:
`provider.list` → `{"providers":[]}`; `acquire` → `SDM_PROVIDER_E_NO_PROVIDER`;
with the capability withheld entirely, `SDM_PROVIDER_E_NO_CAPABILITY`; with no
port installed by the host at all, `SDM_PROVIDER_E_PORT_UNAVAILABLE`. All three
are values, none is a trap, and **all three are reachable in the browser too** —
ask a browser adapter for a provider id that does not exist and you get `-3`,
the same `-3`. The failure path is therefore parity-testable in every lane
rather than being a WasmEdge-only special case, which is the difference between
a mirror and an excuse.

A module never branches on runtime. It branches on `-3`, and that branch is
exercised in all three lanes.

## Parity envelope

**Inside the envelope** — byte-identical across browser, native WasmEdge and
Docker WasmEdge, at any thread count:

- every descriptor field for a given request against a given source
- every byte of every plane read from the **fixture provider**
- every error code, for every malformed and unsatisfiable request
- `provider.list` / `describe` / `availability` shapes and ordering
- the digest returned by the `provider-digest` demo module

The fixture provider is a deterministic analytic source (a closed-form height
field and a closed-form pixel field, both functions of tile coordinates only).
It is bound in the browser as a real engine-shaped provider object and under
WasmEdge as a fixture tile store, so both lanes exercise the *adapter* code
paths rather than a shared shortcut. `FLAG_FIXTURE` proves which one answered.

**Outside the envelope** — and this is stated so it is never mistaken for a
defect: bytes from *live* network providers. Two runtimes reading a live
world-terrain service are not obliged to hold the same tiles at the same
instant, and asserting so would be false rigor. Their **ABI behaviour** —
codes, descriptor shapes, plane counts, bounds handling, copy accounting — is
fully inside the envelope.

**Divergence in anything listed as inside the envelope is a P1 SDK defect.**
Not a platform quirk. File, block, fix.

## Consumer seam — terrain source

The immediate consumer is the RF terrain solver, and the point of defining the
terrain half first is that it must not ship a private terrain path.

`src/host/terrainSourceSeam.js` defines the one JS interface both the engine
port and the SDK adapters implement, plus
`assertTerrainSourceConformance(source)` so a consumer can prove at wiring time
that whatever it was handed is the real seam:

```js
{
  id,                                   // stable provider id
  costClass,                            // what readHeights will cost
  readHeights(positions, out) -> Promise<Float64Array>,   // bulk, contiguous metres
  sampleCompat(provider, positions) -> Promise<Cartographic[]>, // legacy shape
}
```

`sampleCompat` is signature-compatible with the sampler the solver's injectable
statics already hold, so the seam can be assigned on day one with no call-site
change. `readHeights` is the real entry: contiguous metres, no per-sample JS
object, no-data expressed as the sentinel rather than `undefined`.

The cutover is therefore two recorded steps, not a rewrite:

1. **Now** — the solver keeps its injectable statics and receives a
   conforming seam through them. No private terrain path is introduced.
2. **On engine-port landing** — the terrain source becomes an explicit
   parameter on the analysis entry points (the pluggable-propagation law
   applied to terrain) and call sites move from `sampleCompat` to
   `readHeights`. Tracked as `orbpro-provider-access-port`.

## Guest usage

`templates/provider-access-module/include/space_data_provider_abi.h` declares
the imports and the descriptor for `clang --target=wasm32-wasip1-threads`. The
module is EH-free and compiles identically for every lane; there is exactly one
`dist/isomorphic/module.wasm`.

```c
#include "space_data_provider_abi.h"

sdm_provider_tile_desc_t desc;
const char *req =
    "{\"op\":\"profile\",\"providerId\":\"terrain.fixture\","
    "\"start\":[-1.9,0.65],\"end\":[-1.88,0.66],\"samples\":256,\"maxCost\":1}";

int32_t h = sdm_provider_acquire(req, (int32_t)strlen(req), &desc);
if (h < 0) {
  /* -3 here on a node with no terrain configured. Same branch, every lane. */
  return handle_no_terrain(h);
}
double heights[256];
int32_t n = sdm_provider_read(h, 0, 0, (int32_t)(uintptr_t)heights,
                              (int32_t)sizeof heights);
sdm_provider_release(h);
```

`desc.hostCopies` is `1` on WasmEdge and on a threaded browser guest, `2` on a
sequential browser guest, and the 2048 bytes in `heights` are identical in all
of them.
