/**
 * SDN flow compiler (loop C.3c) — `space-data-module flow check|compile`.
 *
 * Compiles a *.flow.json FlowProgram document (the hosted-runtime fixture
 * shape: programId/nodes/edges/triggers/triggerBindings/requiredPlugins)
 * into a LINKED-DIRECT flow artifact:
 *
 *   flow.json + dependency manifests
 *     -> validation (plugin/method existence, edge port type compatibility,
 *        trigger bindings, capability union)
 *     -> flow_generated.inc (descriptor tables + required-port readiness
 *        tables + prefixed guest-link entry dispatch)
 *     -> emception em++ monolithic link of the SDK flow runtime template
 *        (src/flow/runtime-src/flow_runtime.cpp, the
 *        space_data_module_runtime_* ABI) with each dependency's PREFIXED
 *        guest-link wasm object (dist/guest-link/module-link.o, emitted by
 *        compileModuleFromSource) — ONE artifact, ONE linear memory
 *     -> a legal SDK module: plugin_get_manifest_flatbuffer/_size expose the
 *        flow's own $PLG manifest (capability union stamped), the
 *        flow_get_manifest_flatbuffer/_size pair exposes the encoded "FLOW"
 *        FlowProgram buffer, and the sds.manifest custom section carries the
 *        manifest bytes so `space-data-module check` passes.
 *
 * The emitted dist/ is loadable by BOTH flow hosts (sdn-server
 * internal/flowrt and src/flow/flowRuntimeHost.js) and follows the
 * FlowStore install triple (runtime.wasm + flow.json + artifact.json) plus
 * the module layout (isomorphic/module.wasm + plugin-manifest.json).
 *
 * Toolchain is EMCEPTION ONLY (the same runWithEmceptionLock pipeline the
 * module compiler uses) so the identical compile path can later run inside
 * the browser IDE. Never the system emcc.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { generateEmbeddedManifestSource } from "../embeddedManifest.js";
import { generateInvokeSupportHeader } from "../compiler/invokeGlue.js";
import { runWithEmceptionLock } from "../compiler/emceptionNode.js";
import { validateArtifactWithStandards } from "../compliance/index.js";
import { encodePluginManifest } from "../manifest/index.js";
import { appendWasmCustomSection } from "../bundle/wasm.js";
import { SDS_MANIFEST_SECTION_NAME } from "../bundle/constants.js";
import { sha256Bytes } from "../utils/crypto.js";
import { bytesToHex } from "../utils/encoding.js";
import { encodeFlowProgram } from "./flowCodec.js";
import { FLATSQL_LINK_SHIM_WASM } from "./flatsqlLinkShim.js";
import { normalizeManifestForSdnFlow } from "./normalize.js";
import {
  BackpressurePolicy,
  FlowEdgeT,
  FlowNodeT,
  FlowProgramT,
  FlowTriggerT,
  NodeKind,
  TriggerBindingT,
  TriggerKind,
} from "../generated/orbpro/flow.js";
import { DrainPolicy } from "../generated/orbpro/manifest.js";

const RUNTIME_TEMPLATE_PATH = fileURLToPath(
  new URL("./runtime-src/flow_runtime.cpp", import.meta.url),
);

const RUNTIME_ABI_EXPORTS = [
  "get_node_descriptor_count",
  "get_edge_descriptor_count",
  "get_trigger_descriptor_count",
  "get_dependency_descriptor_count",
  "reset_state",
  "get_ready_node_index",
  "begin_node_invocation",
  "get_current_invocation_descriptor",
  "apply_node_invocation_result",
  "complete_node_invocation",
  "enqueue_trigger_frames",
  "enqueue_trigger_frame",
  "get_node_dispatch_descriptors",
  "get_dependency_descriptors",
  "get_node_states",
  "get_ingress_states",
  "dispatch_current_invocation_direct",
  "drain_linked",
].map((name) => `space_data_module_runtime_${name}`);

const FLOW_ARTIFACT_EXPORTS = [
  ...RUNTIME_ABI_EXPORTS,
  "malloc",
  "free",
  "plugin_get_manifest_flatbuffer",
  "plugin_get_manifest_flatbuffer_size",
  "flow_get_manifest_flatbuffer",
  "flow_get_manifest_flatbuffer_size",
];

// Additional exports of LINKED-mode artifacts (flow.engineLinkage ==
// "flatsql"): the host wires the store's live engine db handle in and reads
// the engine body-reference table out (loop C.7 direct linkage).
const FLOW_LINKED_EXPORTS = [
  "sdn_flatsql_link_init",
  "sdn_flatsql_link_ref_table",
  "sdn_flatsql_link_ref_slots",
];

// Capability stamped onto linked-mode flow manifests. Hosts treat it as the
// first-party gate: linking grants FULL store-memory access, so a host must
// refuse to mount a linked artifact unless it can (and is willing to) share
// its live engine instance. Untrusted modules never get this capability —
// they stay on the storage.flatsql_* hostcall bridge permanently.
export const ENGINE_LINK_CAPABILITY = "storage_engine_link";

export function flowEngineLinkage(flow) {
  const linkage = String(flow?.engineLinkage ?? "").trim().toLowerCase();
  if (linkage === "" || linkage === "none" || linkage === "bridge") return null;
  if (linkage === "flatsql") return "flatsql";
  throw new Error(
    `Unsupported flow.engineLinkage "${flow.engineLinkage}" (expected "flatsql" or omitted for bridge mode).`,
  );
}

const GUEST_LINK_OBJECT_FILENAME = "module-link.o";
const GUEST_LINK_METADATA_FILENAME = "metadata.json";
const GUEST_LINK_LINKED_DIRNAME = "guest-link-linked";
const SKIPPED_SCAN_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "deps",
  "third_party",
  ".emcache",
]);

function cIdent(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_]/g, "_");
}

function cString(value) {
  return JSON.stringify(String(value ?? ""));
}

function pushIssue(issues, severity, code, message, location) {
  issues.push({ severity, code, message, location });
}

// ---------------------------------------------------------------------------
// Flow document + dependency loading
// ---------------------------------------------------------------------------

export async function loadFlowDocument(flowPath) {
  const raw = await readFile(flowPath, "utf8");
  const flow = JSON.parse(raw);
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) {
    throw new Error(`Flow document ${flowPath} must be a JSON object.`);
  }
  return flow;
}

async function loadDependencyFromDirectory(dir) {
  const manifestPath = path.join(dir, "plugin-manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    return null;
  }
  if (!manifest?.pluginId) {
    return null;
  }
  const entry = {
    pluginId: manifest.pluginId,
    dir,
    manifestPath,
    manifest,
    normalized: normalizeManifestForSdnFlow(manifest),
    wasmPath: path.join(dir, "dist", "isomorphic", "module.wasm"),
    guestLink: null,
  };
  const readGuestLink = async (dirname) => {
    const guestLinkDir = path.join(dir, "dist", dirname);
    const [objectBytes, metadata] = await Promise.all([
      readFile(path.join(guestLinkDir, GUEST_LINK_OBJECT_FILENAME)),
      readFile(path.join(guestLinkDir, GUEST_LINK_METADATA_FILENAME), "utf8").then(JSON.parse),
    ]);
    return { objectBytes: new Uint8Array(objectBytes), metadata };
  };
  try {
    entry.guestLink = await readGuestLink("guest-link");
  } catch {
    entry.guestLink = null;
  }
  // Optional engine-linked object variant (compiled -DSDN_FLATSQL_LINKED):
  // used instead of guestLink when the flow compiles in linked mode.
  try {
    entry.guestLinkLinked = await readGuestLink(GUEST_LINK_LINKED_DIRNAME);
  } catch {
    entry.guestLinkLinked = null;
  }
  return entry;
}

async function scanForDependencyDirs(root, found) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((entry) => entry.isFile() && entry.name === "plugin-manifest.json")) {
    found.push(root);
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIPPED_SCAN_DIRECTORIES.has(entry.name)) {
      continue;
    }
    await scanForDependencyDirs(path.join(root, entry.name), found);
  }
}

/**
 * Resolve dependency module packages for a flow. `depsPath` is either a JSON
 * file mapping pluginId -> package directory, or a directory root that is
 * scanned recursively for `plugin-manifest.json` packages (dist/ trees are
 * skipped; each package's dist/guest-link is picked up when present).
 * Returns Map<pluginId, dependencyEntry>.
 */
export async function resolveFlowDependencies({ depsPath, cwd = process.cwd() } = {}) {
  const dependencies = new Map();
  if (!depsPath) {
    return dependencies;
  }
  const resolved = path.resolve(cwd, depsPath);
  const candidateDirs = [];
  if (resolved.endsWith(".json")) {
    const map = JSON.parse(await readFile(resolved, "utf8"));
    for (const dir of Object.values(map)) {
      candidateDirs.push(path.resolve(path.dirname(resolved), dir));
    }
  } else {
    await scanForDependencyDirs(resolved, candidateDirs);
  }
  for (const dir of candidateDirs) {
    const entry = await loadDependencyFromDirectory(dir);
    if (entry && !dependencies.has(entry.pluginId)) {
      dependencies.set(entry.pluginId, entry);
    }
  }
  return dependencies;
}

// ---------------------------------------------------------------------------
// Validation — flow check
// ---------------------------------------------------------------------------

function findMethod(normalizedManifest, methodId) {
  return (normalizedManifest?.methods ?? []).find(
    (method) => method.methodId === methodId,
  ) ?? null;
}

function portAcceptedTypes(port) {
  const types = [];
  for (const typeSet of port?.acceptedTypeSets ?? []) {
    for (const type of typeSet?.allowedTypes ?? []) {
      types.push(type);
    }
  }
  return types;
}

function typesCompatible(fromTypes, toTypes) {
  if (fromTypes.length === 0 || toTypes.length === 0) {
    return true; // untyped side — no declared constraint to violate
  }
  for (const to of toTypes) {
    if (to.acceptsAnyFlatbuffer === true) return true;
  }
  for (const from of fromTypes) {
    if (from.acceptsAnyFlatbuffer === true) return true;
  }
  for (const from of fromTypes) {
    for (const to of toTypes) {
      if (
        (from.fileIdentifier && to.fileIdentifier && from.fileIdentifier === to.fileIdentifier) ||
        (from.schemaName && to.schemaName && from.schemaName === to.schemaName)
      ) {
        return true;
      }
    }
  }
  return false;
}

function describeTypes(types) {
  if (types.length === 0) return "(untyped)";
  return types
    .map((type) =>
      type.acceptsAnyFlatbuffer
        ? "*"
        : `${type.schemaName ?? "?"}${type.fileIdentifier ? `/${type.fileIdentifier}` : ""}`,
    )
    .join("|");
}

function isHostModelNode(node) {
  const kind = String(node?.kind ?? "").toLowerCase();
  return node?.dispatchModel === "host" || kind === "sink" || kind === "source";
}

function capabilityId(capability) {
  if (typeof capability === "string") return capability;
  return capability?.capability ?? null;
}

// A module manifest's own DEPENDENCIES entries (PLG PluginDependency:
// PLUGIN_ID / MIN_VERSION / MAX_VERSION) — component dependencies (linked
// libraries such as the flatsql engine module), NOT graph nodes.
function normalizeManifestDependency(entry) {
  if (typeof entry === "string") {
    return entry.trim() ? { pluginId: entry.trim(), minVersion: null, maxVersion: null } : null;
  }
  const pluginId =
    entry?.pluginId ?? entry?.PLUGIN_ID ?? entry?.plugin_id ?? null;
  if (!pluginId || typeof pluginId !== "string") {
    return null;
  }
  return {
    pluginId,
    minVersion:
      entry?.minVersion ?? entry?.MIN_VERSION ?? entry?.min_version ?? entry?.version ?? null,
    maxVersion: entry?.maxVersion ?? entry?.MAX_VERSION ?? entry?.max_version ?? null,
  };
}

function manifestDependencies(manifest) {
  const raw = manifest?.dependencies ?? manifest?.DEPENDENCIES ?? [];
  return (Array.isArray(raw) ? raw : [])
    .map(normalizeManifestDependency)
    .filter(Boolean);
}

/**
 * Walk node modules' manifest DEPENDENCIES transitively and collect the
 * flow's COMPONENT dependency set (deduped, version-bound). Resolvable
 * components contribute their declared capabilities to the union; components
 * that cannot be resolved from the dependency set are reported as warnings
 * but still propagated into the emitted bundle's DEPENDENCIES.
 */
function collectComponentDependencies({ nodePluginIds, dependencies, issues, capabilities }) {
  const components = new Map();
  const visited = new Set(nodePluginIds);
  const queue = [];
  for (const pluginId of nodePluginIds) {
    const dependency = dependencies.get(pluginId);
    for (const declared of manifestDependencies(dependency?.manifest)) {
      queue.push({ declared, declaredBy: pluginId });
    }
  }
  while (queue.length > 0) {
    const { declared, declaredBy } = queue.shift();
    const existing = components.get(declared.pluginId);
    if (existing) {
      if (
        declared.minVersion &&
        existing.minVersion &&
        declared.minVersion !== existing.minVersion
      ) {
        pushIssue(
          issues,
          "warning",
          "component-version-conflict",
          `Component dependency "${declared.pluginId}" is declared with conflicting version bindings ` +
            `("${existing.minVersion}" by ${existing.declaredBy.join(", ")} vs "${declared.minVersion}" by ${declaredBy}); ` +
            `keeping "${existing.minVersion}".`,
          "flow.dependencies",
        );
      }
      if (!existing.declaredBy.includes(declaredBy)) {
        existing.declaredBy.push(declaredBy);
      }
      continue;
    }
    const resolved = dependencies.get(declared.pluginId) ?? null;
    const record = {
      pluginId: declared.pluginId,
      minVersion: declared.minVersion ?? resolved?.manifest?.version ?? null,
      maxVersion: declared.maxVersion ?? null,
      resolved: Boolean(resolved),
      declaredBy: [declaredBy],
    };
    components.set(declared.pluginId, record);
    if (resolved) {
      for (const capability of resolved.manifest?.capabilities ?? []) {
        const id = capabilityId(capability);
        if (id) capabilities.add(id);
      }
      if (!visited.has(declared.pluginId)) {
        visited.add(declared.pluginId);
        for (const transitive of manifestDependencies(resolved.manifest)) {
          queue.push({ declared: transitive, declaredBy: declared.pluginId });
        }
      }
    } else {
      pushIssue(
        issues,
        "warning",
        "unresolved-component-dependency",
        `Component dependency "${declared.pluginId}" (declared by "${declaredBy}") is not resolvable from the ` +
          "dependency set; it is propagated into the bundle DEPENDENCIES but its capabilities cannot be verified.",
        "flow.dependencies",
      );
    }
  }
  return [...components.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId));
}

/**
 * findFlowCycles returns every elementary cycle reachable in the node graph
 * as { nodeIds, edges } (iterative DFS with back-edge extraction; each cycle
 * reported once). Self-loops are cycles of length one.
 */
export function findFlowCycles(nodes, edges) {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map();
  const out = new Map();
  for (const node of nodes) {
    if (!node?.nodeId) continue;
    color.set(node.nodeId, WHITE);
    out.set(node.nodeId, []);
  }
  for (const edge of edges) {
    if (out.has(edge?.fromNodeId) && color.has(edge?.toNodeId)) {
      out.get(edge.fromNodeId).push(edge);
    }
  }

  const cycles = [];
  const seen = new Set();
  const stack = [];

  const visit = (start) => {
    const frames = [{ nodeId: start, edgeIdx: 0 }];
    color.set(start, GRAY);
    stack.push(start);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const nodeEdges = out.get(frame.nodeId) ?? [];
      if (frame.edgeIdx >= nodeEdges.length) {
        color.set(frame.nodeId, BLACK);
        stack.pop();
        frames.pop();
        continue;
      }
      const edge = nodeEdges[frame.edgeIdx];
      frame.edgeIdx += 1;
      const next = edge.toNodeId;
      const state = color.get(next);
      if (state === GRAY) {
        // Back edge: extract the cycle from the stack.
        const at = stack.indexOf(next);
        const nodeIds = stack.slice(at);
        const key = [...nodeIds].sort().join(" ");
        if (!seen.has(key)) {
          seen.add(key);
          const cycleEdges = [];
          for (let i = 0; i < nodeIds.length; i += 1) {
            const from = nodeIds[i];
            const to = nodeIds[(i + 1) % nodeIds.length];
            const found = (out.get(from) ?? []).find((candidate) => candidate.toNodeId === to);
            if (found) cycleEdges.push(found);
          }
          cycles.push({ nodeIds, edges: cycleEdges });
        }
      } else if (state === WHITE) {
        color.set(next, GRAY);
        stack.push(next);
        frames.push({ nodeId: next, edgeIdx: 0 });
      }
    }
  };

  for (const nodeId of color.keys()) {
    if (color.get(nodeId) === WHITE) visit(nodeId);
  }
  return cycles;
}

// edgeIsBounded: a cycle edge is safe only with a finite queue bound and a
// policy that cannot grow the queue without limit.
function edgeIsBounded(edge) {
  const policy = String(edge?.backpressurePolicy ?? "queue").toLowerCase();
  const depth = Number(edge?.queueDepth ?? 1);
  const boundedPolicy = policy === "queue" || policy === "drop-oldest" || policy === "drop-newest";
  return boundedPolicy && Number.isFinite(depth) && depth > 0 && depth <= 65536;
}

// ---------------------------------------------------------------------------
// Flow-manifest `api` block validation (gateway loop G.1 extension, validated
// since G.2). The block is declarative OpenAPI metadata copied VERBATIM into
// the compiled bundle and parsed at mount time by the host's OpenAPI
// generator, so shape errors would otherwise surface only as a wrong or
// missing spec entry on a live node. Rules mirror the host-side reader
// (sdn-server internal/flowrt/apidoc.go + internal/api/docs.go).
// ---------------------------------------------------------------------------

const FLOW_API_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const FLOW_API_PARAM_LOCATIONS = new Set(["query", "path", "header", "cookie"]);
const FLOW_API_TEMPLATE_SEGMENT = /^\{[A-Za-z_][A-Za-z0-9_]*\}$/;

function flowAPIPathTemplateParams(path) {
  const params = [];
  for (const segment of String(path ?? "").split("/")) {
    if (FLOW_API_TEMPLATE_SEGMENT.test(segment)) params.push(segment.slice(1, -1));
  }
  return params;
}

function flowAPIPathSegmentValid(segment) {
  if (segment.includes("{") || segment.includes("}")) {
    return FLOW_API_TEMPLATE_SEGMENT.test(segment);
  }
  return true;
}

export function validateFlowAPIDeclaration(flow, issues) {
  const api = flow?.api;
  if (api === undefined || api === null) return;
  if (typeof api !== "object" || Array.isArray(api)) {
    pushIssue(issues, "error", "api-invalid", "flow.api must be an object when present.", "flow.api");
    return;
  }
  if (api.basePath !== undefined) {
    if (typeof api.basePath !== "string" || !api.basePath.startsWith("/")) {
      pushIssue(
        issues,
        "error",
        "api-invalid-base-path",
        'flow.api.basePath must be a string starting with "/" (documentation hint; the node config mount path wins).',
        "flow.api.basePath",
      );
    }
  }
  for (const key of ["tag", "tagDescription"]) {
    if (api[key] !== undefined && typeof api[key] !== "string") {
      pushIssue(issues, "error", "api-invalid-tag", `flow.api.${key} must be a string when present.`, `flow.api.${key}`);
    }
  }
  const routes = api.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    pushIssue(
      issues,
      "error",
      "api-missing-routes",
      "flow.api.routes must be a non-empty array of route declarations.",
      "flow.api.routes",
    );
    return;
  }
  const seenRoutes = new Set();
  routes.forEach((route, index) => {
    const location = `flow.api.routes[${index}]`;
    if (typeof route !== "object" || route === null || Array.isArray(route)) {
      pushIssue(issues, "error", "api-invalid-route", "Route declaration must be an object.", location);
      return;
    }
    if (typeof route.path !== "string") {
      pushIssue(issues, "error", "api-invalid-route-path", 'Route "path" must be a string (may be "" for the mount root).', location);
    } else {
      if (/\s/.test(route.path)) {
        pushIssue(issues, "error", "api-invalid-route-path", `Route path "${route.path}" must not contain whitespace.`, location);
      }
      for (const segment of route.path.split("/")) {
        if (!flowAPIPathSegmentValid(segment)) {
          pushIssue(
            issues,
            "error",
            "api-invalid-route-path",
            `Route path "${route.path}" has a malformed template segment "${segment}" (expected "{paramName}").`,
            location,
          );
        }
      }
    }
    let method = "GET";
    if (route.method !== undefined) {
      if (typeof route.method !== "string" || !FLOW_API_METHODS.has(route.method.trim().toUpperCase())) {
        pushIssue(
          issues,
          "error",
          "api-invalid-route-method",
          `Route method "${route.method}" is not a valid HTTP method (${[...FLOW_API_METHODS].join(", ")}).`,
          location,
        );
      } else {
        method = route.method.trim().toUpperCase();
      }
    }
    if (typeof route.path === "string") {
      const key = `${method} ${route.path}`;
      if (seenRoutes.has(key)) {
        pushIssue(issues, "error", "api-duplicate-route", `Route "${key}" is declared more than once.`, location);
      }
      seenRoutes.add(key);
    }
    for (const key of ["operationId", "summary", "description"]) {
      if (route[key] !== undefined && typeof route[key] !== "string") {
        pushIssue(issues, "error", "api-invalid-route-field", `Route "${key}" must be a string when present.`, location);
      }
    }
    for (const key of ["anonymous", "deprecated"]) {
      if (route[key] !== undefined && typeof route[key] !== "boolean") {
        pushIssue(issues, "error", "api-invalid-route-field", `Route "${key}" must be a boolean when present.`, location);
      }
    }
    const declaredPathParams = new Set();
    if (route.params !== undefined) {
      if (!Array.isArray(route.params)) {
        pushIssue(issues, "error", "api-invalid-params", 'Route "params" must be an array of OpenAPI parameter objects.', location);
      } else {
        route.params.forEach((param, paramIndex) => {
          const paramLocation = `${location}.params[${paramIndex}]`;
          if (typeof param !== "object" || param === null || Array.isArray(param)) {
            pushIssue(issues, "error", "api-invalid-params", "Parameter must be an OpenAPI parameter object.", paramLocation);
            return;
          }
          if (typeof param.name !== "string" || param.name.length === 0) {
            pushIssue(issues, "error", "api-invalid-params", 'Parameter "name" must be a non-empty string.', paramLocation);
          }
          if (typeof param.in !== "string" || !FLOW_API_PARAM_LOCATIONS.has(param.in)) {
            pushIssue(
              issues,
              "error",
              "api-invalid-params",
              `Parameter "in" must be one of ${[...FLOW_API_PARAM_LOCATIONS].join(", ")}.`,
              paramLocation,
            );
          } else if (param.in === "path" && typeof param.name === "string") {
            declaredPathParams.add(param.name);
          }
        });
      }
    }
    for (const templateParam of flowAPIPathTemplateParams(route.path)) {
      if (!declaredPathParams.has(templateParam)) {
        pushIssue(
          issues,
          "warning",
          "api-undeclared-path-param",
          `Route path template "{${templateParam}}" has no matching {"name":"${templateParam}","in":"path"} entry in params; ` +
            "the generated spec will carry an undocumented path parameter.",
          location,
        );
      }
    }
    if (route.requestBody !== undefined && (typeof route.requestBody !== "object" || route.requestBody === null || Array.isArray(route.requestBody))) {
      pushIssue(issues, "error", "api-invalid-request-body", 'Route "requestBody" must be an OpenAPI requestBody object.', location);
    }
    if (route.responses !== undefined) {
      if (typeof route.responses !== "object" || route.responses === null || Array.isArray(route.responses)) {
        pushIssue(issues, "error", "api-invalid-responses", 'Route "responses" must be an object keyed by status code.', location);
      } else {
        for (const [status, response] of Object.entries(route.responses)) {
          const responseLocation = `${location}.responses["${status}"]`;
          if (status !== "default" && !/^[1-5][0-9]{2}$/.test(status)) {
            pushIssue(
              issues,
              "error",
              "api-invalid-responses",
              `Response key "${status}" must be a 3-digit HTTP status code or "default".`,
              responseLocation,
            );
          }
          if (typeof response !== "object" || response === null || Array.isArray(response)) {
            pushIssue(issues, "error", "api-invalid-responses", "Response value must be an object.", responseLocation);
            continue;
          }
          if (response.recordStream !== undefined && typeof response.recordStream !== "boolean") {
            pushIssue(issues, "error", "api-invalid-responses", '"recordStream" must be a boolean when present.', responseLocation);
          }
          if (response.content !== undefined) {
            if (typeof response.content !== "object" || response.content === null || Array.isArray(response.content)) {
              pushIssue(issues, "error", "api-invalid-responses", '"content" must be an object keyed by media type.', responseLocation);
            } else {
              for (const [mediaType, mediaValue] of Object.entries(response.content)) {
                if (!mediaType.includes("/")) {
                  pushIssue(
                    issues,
                    "error",
                    "api-invalid-responses",
                    `Content key "${mediaType}" is not a media type (expected e.g. "application/json").`,
                    responseLocation,
                  );
                }
                if (typeof mediaValue !== "object" || mediaValue === null || Array.isArray(mediaValue)) {
                  pushIssue(issues, "error", "api-invalid-responses", `Content["${mediaType}"] must be an object.`, responseLocation);
                }
              }
            }
          }
          if (response.headers !== undefined && (typeof response.headers !== "object" || response.headers === null || Array.isArray(response.headers))) {
            pushIssue(issues, "error", "api-invalid-responses", '"headers" must be an object of OpenAPI header objects.', responseLocation);
          }
        }
      }
    }
  });
}

/**
 * Validate a flow document against its dependency manifests. Returns
 * { ok, issues, capabilities, nodes } where `capabilities` is the computed
 * capability union of all linked nodes and `nodes` carries the resolved
 * per-node dispatch classification (linked-direct vs host).
 */
export function checkFlowProgram({ flow, dependencies = new Map() } = {}) {
  const issues = [];
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow?.edges) ? flow.edges : [];
  const triggers = Array.isArray(flow?.triggers) ? flow.triggers : [];
  const triggerBindings = Array.isArray(flow?.triggerBindings) ? flow.triggerBindings : [];
  const requiredPlugins = Array.isArray(flow?.requiredPlugins) ? flow.requiredPlugins : [];

  if (!flow?.programId || typeof flow.programId !== "string") {
    pushIssue(issues, "error", "missing-program-id", "flow.programId must be a non-empty string.", "flow.programId");
  }
  if (nodes.length === 0) {
    pushIssue(issues, "error", "missing-nodes", "flow.nodes must declare at least one node.", "flow.nodes");
  }

  const nodeIndex = new Map();
  const resolvedNodes = [];
  nodes.forEach((node, index) => {
    const location = `flow.nodes[${index}]`;
    if (!node?.nodeId) {
      pushIssue(issues, "error", "missing-node-id", "Node is missing nodeId.", location);
      return;
    }
    if (nodeIndex.has(node.nodeId)) {
      pushIssue(issues, "error", "duplicate-node-id", `Node id "${node.nodeId}" is declared more than once.`, location);
      return;
    }
    nodeIndex.set(node.nodeId, index);

    const dependency = dependencies.get(node.pluginId) ?? null;
    let method = null;
    let dispatchModel = "host";
    if (dependency) {
      dispatchModel = "linked-direct";
      method = findMethod(dependency.normalized, node.methodId);
      if (!method) {
        pushIssue(
          issues,
          "error",
          "unknown-method",
          `Node "${node.nodeId}" references method "${node.methodId}" which does not exist on plugin "${node.pluginId}".`,
          location,
        );
      }
    } else if (!isHostModelNode(node)) {
      pushIssue(
        issues,
        "error",
        "unknown-plugin",
        `Node "${node.nodeId}" references plugin "${node.pluginId}" which is not resolvable from the dependency set.`,
        location,
      );
    }
    resolvedNodes.push({ node, index, dependency, method, dispatchModel });
  });

  const resolvedByNodeId = new Map(resolvedNodes.map((entry) => [entry.node.nodeId, entry]));

  edges.forEach((edge, index) => {
    const location = `flow.edges[${index}]`;
    const from = resolvedByNodeId.get(edge?.fromNodeId);
    const to = resolvedByNodeId.get(edge?.toNodeId);
    if (!from) {
      pushIssue(issues, "error", "unknown-edge-node", `Edge references unknown fromNodeId "${edge?.fromNodeId}".`, location);
    }
    if (!to) {
      pushIssue(issues, "error", "unknown-edge-node", `Edge references unknown toNodeId "${edge?.toNodeId}".`, location);
    }
    if (!from || !to) return;

    let fromTypes = [];
    if (from.method) {
      const fromPort = (from.method.outputPorts ?? []).find((port) => port.portId === edge.fromPortId);
      if (!fromPort) {
        pushIssue(
          issues,
          "error",
          "unknown-output-port",
          `Edge fromPortId "${edge.fromPortId}" is not an output port of ${from.node.pluginId}:${from.node.methodId}.`,
          location,
        );
        return;
      }
      fromTypes = portAcceptedTypes(fromPort);
    }

    let toTypes = [];
    if (to.method) {
      const toPort = (to.method.inputPorts ?? []).find((port) => port.portId === edge.toPortId);
      if (!toPort) {
        pushIssue(
          issues,
          "error",
          "unknown-input-port",
          `Edge toPortId "${edge.toPortId}" is not an input port of ${to.node.pluginId}:${to.node.methodId}.`,
          location,
        );
        return;
      }
      toTypes = portAcceptedTypes(toPort);
    }

    if (!typesCompatible(fromTypes, toTypes)) {
      pushIssue(
        issues,
        "error",
        "edge-type-mismatch",
        `Edge ${edge.fromNodeId}.${edge.fromPortId} -> ${edge.toNodeId}.${edge.toPortId} is not type-compatible: ` +
          `${describeTypes(fromTypes)} does not satisfy ${describeTypes(toTypes)}.`,
        location,
      );
    }

    if (from.index > to.index) {
      pushIssue(
        issues,
        "warning",
        "non-topological-node-order",
        `Edge ${edge.fromNodeId} -> ${edge.toNodeId} flows backwards in node declaration order; ` +
          "the compiled scheduler scans nodes in declaration order, so declare producers before consumers.",
        location,
      );
    }
  });

  // Unending-loop detection: cycles in the node graph make the drain loop
  // spin forever on a single ingress frame. Cycles are a hard error unless
  // the flow explicitly opts in with `allowCycles: true` AND every edge on
  // every cycle is bounded (finite queueDepth with a queue/drop policy) —
  // sanctioned feedback must be unable to grow without bound. Applies to
  // `flow check`, `flow compile`, and any flow UI built on this validator.
  const cycles = findFlowCycles(nodes, edges);
  if (cycles.length > 0) {
    const allowCycles = flow?.allowCycles === true;
    for (const cycle of cycles) {
      const path = [...cycle.nodeIds, cycle.nodeIds[0]].join(" -> ");
      if (!allowCycles) {
        pushIssue(
          issues,
          "error",
          "flow-cycle",
          `Flow graph contains a cycle: ${path}. Cycles hang the scheduler; break the loop, ` +
            `or set flow.allowCycles = true AND give every edge in the cycle a bounded ` +
            `backpressure policy (finite queueDepth).`,
          "flow.edges",
        );
        continue;
      }
      const unbounded = cycle.edges.filter((edge) => !edgeIsBounded(edge));
      if (unbounded.length > 0) {
        const labels = unbounded.map((edge) => `${edge.fromNodeId} -> ${edge.toNodeId}`).join(", ");
        pushIssue(
          issues,
          "error",
          "unbounded-cycle",
          `Flow cycle ${path} is allowed by flow.allowCycles but has unbounded edges (${labels}); ` +
            `every cycle edge needs backpressurePolicy queue|drop-oldest|drop-newest with a finite queueDepth.`,
          "flow.edges",
        );
      } else {
        pushIssue(
          issues,
          "warning",
          "sanctioned-cycle",
          `Flow contains a sanctioned feedback cycle (${path}); all cycle edges are bounded.`,
          "flow.edges",
        );
      }
    }
  }

  const triggerIds = new Set(triggers.map((trigger) => trigger?.triggerId).filter(Boolean));
  if (triggers.length === 0) {
    pushIssue(issues, "error", "missing-triggers", "flow.triggers must declare at least one trigger.", "flow.triggers");
  }
  triggerBindings.forEach((binding, index) => {
    const location = `flow.triggerBindings[${index}]`;
    if (!triggerIds.has(binding?.triggerId)) {
      pushIssue(issues, "error", "unknown-trigger", `Trigger binding references unknown triggerId "${binding?.triggerId}".`, location);
    }
    const target = resolvedByNodeId.get(binding?.targetNodeId);
    if (!target) {
      pushIssue(issues, "error", "unknown-binding-node", `Trigger binding references unknown targetNodeId "${binding?.targetNodeId}".`, location);
      return;
    }
    if (target.method) {
      const port = (target.method.inputPorts ?? []).find((candidate) => candidate.portId === binding.targetPortId);
      if (!port) {
        pushIssue(
          issues,
          "error",
          "unknown-binding-port",
          `Trigger binding targetPortId "${binding.targetPortId}" is not an input port of ${target.node.pluginId}:${target.node.methodId}.`,
          location,
        );
      }
    }
  });

  for (const pluginId of requiredPlugins) {
    if (!dependencies.has(pluginId)) {
      pushIssue(
        issues,
        "error",
        "unknown-plugin",
        `flow.requiredPlugins lists "${pluginId}" which is not resolvable from the dependency set.`,
        "flow.requiredPlugins",
      );
    }
  }
  for (const entry of resolvedNodes) {
    if (entry.dependency && !requiredPlugins.includes(entry.node.pluginId)) {
      pushIssue(
        issues,
        "warning",
        "missing-required-plugin",
        `Node "${entry.node.nodeId}" uses plugin "${entry.node.pluginId}" which is not listed in flow.requiredPlugins.`,
        "flow.requiredPlugins",
      );
    }
  }

  // Gateway `api` block (when present): shape-validate the declarative HTTP
  // surface so a bad block fails `flow check`/`flow compile` instead of
  // silently corrupting the host-generated OpenAPI spec.
  validateFlowAPIDeclaration(flow, issues);

  // Capability union — the flow's permission set is the union of its nodes'
  // declared capabilities plus the capabilities of every transitively
  // resolved COMPONENT dependency (modules declared in node manifests'
  // DEPENDENCIES — linked libraries, not graph boxes).
  const capabilities = new Set();
  for (const entry of resolvedNodes) {
    for (const capability of entry.dependency?.manifest?.capabilities ?? []) {
      const id = capabilityId(capability);
      if (id) capabilities.add(id);
    }
  }

  // Engine linkage mode (loop C.7): linked flows stamp the engine-link
  // capability so hosts can gate mounting (first-party only) and know to
  // register the live engine instance + link shim at instantiation.
  let engineLinkage = null;
  try {
    engineLinkage = flowEngineLinkage(flow);
  } catch (error) {
    pushIssue(issues, "error", "invalid-engine-linkage", error.message, "flow.engineLinkage");
  }
  if (engineLinkage) {
    capabilities.add(ENGINE_LINK_CAPABILITY);
  }
  const componentDependencies = collectComponentDependencies({
    nodePluginIds: [
      ...new Set(resolvedNodes.filter((entry) => entry.dependency).map((entry) => entry.node.pluginId)),
    ],
    dependencies,
    issues,
    capabilities,
  });

  const errors = issues.filter((issue) => issue.severity === "error");
  return {
    ok: errors.length === 0,
    issues,
    errors,
    warnings: issues.filter((issue) => issue.severity === "warning"),
    capabilities: [...capabilities].sort(),
    engineLinkage,
    componentDependencies,
    nodes: resolvedNodes.map((entry) => ({
      nodeId: entry.node.nodeId,
      pluginId: entry.node.pluginId,
      methodId: entry.node.methodId,
      dispatchModel: entry.dispatchModel,
    })),
  };
}

// ---------------------------------------------------------------------------
// Flow module manifest — the flow bundle is itself a legal SDK module.
// ---------------------------------------------------------------------------

function clonePortDefinition(port, portId) {
  return {
    ...JSON.parse(JSON.stringify(port ?? {})),
    portId,
  };
}

// Fully-shaped wildcard port for graph endpoints whose backing manifest port
// cannot be resolved (e.g. host-model egress sinks) — the compliance rules
// require acceptedTypeSets/minStreams/maxStreams/required on every port.
function wildcardPortDefinition(portId, { required }) {
  return {
    portId,
    displayName: portId,
    acceptedTypeSets: [
      {
        setId: `${cIdent(portId)}-any`,
        allowedTypes: [{ acceptsAnyFlatbuffer: true }],
        description: "Accepts any frame (flow-compiler wildcard).",
      },
    ],
    minStreams: required ? 1 : 0,
    maxStreams: 1,
    required,
    description: "Flow-compiler synthesized port.",
  };
}

function rawMethod(dependency, methodId) {
  return (dependency?.manifest?.methods ?? []).find(
    (method) => method?.methodId === methodId,
  ) ?? null;
}

export function buildFlowModuleManifest({ flow, check, dependencies }) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow?.edges) ? flow.edges : [];
  const triggers = Array.isArray(flow?.triggers) ? flow.triggers : [];
  const triggerBindings = Array.isArray(flow?.triggerBindings) ? flow.triggerBindings : [];
  const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));

  const hostModelNodeIds = new Set(
    check.nodes.filter((node) => node.dispatchModel === "host").map((node) => node.nodeId),
  );

  // One method per trigger: the flow's ingress surface. Input ports mirror the
  // trigger bindings' target ports; output ports mirror the frames delivered
  // to host-model (egress) nodes.
  const egressPorts = [];
  const seenEgressPorts = new Set();
  for (const edge of edges) {
    if (!hostModelNodeIds.has(edge.toNodeId)) continue;
    const fromNode = nodeById.get(edge.fromNodeId);
    const fromDependency = fromNode ? dependencies.get(fromNode.pluginId) : null;
    const fromMethod = fromDependency ? rawMethod(fromDependency, fromNode.methodId) : null;
    const fromPort = (fromMethod?.outputPorts ?? []).find(
      (port) => port?.portId === edge.fromPortId,
    );
    const key = `${edge.toNodeId}:${edge.toPortId}`;
    if (seenEgressPorts.has(key)) continue;
    seenEgressPorts.add(key);
    egressPorts.push(
      fromPort
        ? clonePortDefinition(fromPort, edge.toPortId)
        : wildcardPortDefinition(edge.toPortId, { required: false }),
    );
  }

  const methods = triggers.map((trigger) => {
    const inputPorts = [];
    const seenInputPorts = new Set();
    for (const binding of triggerBindings) {
      if (binding.triggerId !== trigger.triggerId) continue;
      if (seenInputPorts.has(binding.targetPortId)) continue;
      seenInputPorts.add(binding.targetPortId);
      const targetNode = nodeById.get(binding.targetNodeId);
      const targetDependency = targetNode ? dependencies.get(targetNode.pluginId) : null;
      const targetMethod = targetDependency ? rawMethod(targetDependency, targetNode.methodId) : null;
      const targetPort = (targetMethod?.inputPorts ?? []).find(
        (port) => port?.portId === binding.targetPortId,
      );
      inputPorts.push(
        targetPort
          ? clonePortDefinition(targetPort, binding.targetPortId)
          : wildcardPortDefinition(binding.targetPortId, { required: true }),
      );
    }
    return {
      methodId: cIdent(trigger.triggerId),
      displayName: `Flow trigger ${trigger.triggerId}`,
      description: `Compiled-flow ingress for trigger "${trigger.triggerId}" (${trigger.kind ?? "manual"}).`,
      inputPorts,
      outputPorts: egressPorts,
      maxBatch: 1,
      drainPolicy: "single-shot",
    };
  });

  const externalInterfaces = [];
  const seenInterfaceIds = new Set();
  const schemasUsed = [];
  const seenSchemas = new Set();
  for (const node of nodes) {
    const dependency = dependencies.get(node.pluginId);
    for (const externalInterface of dependency?.manifest?.externalInterfaces ?? []) {
      if (!externalInterface?.interfaceId || seenInterfaceIds.has(externalInterface.interfaceId)) {
        continue;
      }
      seenInterfaceIds.add(externalInterface.interfaceId);
      externalInterfaces.push(JSON.parse(JSON.stringify(externalInterface)));
    }
    for (const schema of dependency?.manifest?.schemasUsed ?? []) {
      const key = `${schema?.schemaName ?? ""}:${schema?.fileIdentifier ?? ""}`;
      if (seenSchemas.has(key)) continue;
      seenSchemas.add(key);
      schemasUsed.push(JSON.parse(JSON.stringify(schema)));
    }
  }

  // Bundle DEPENDENCIES (PLG PluginDependency entries): NODE dependencies
  // (the modules linked into the artifact as graph nodes, version-bound to
  // the exact resolved version) merged with the transitively collected
  // COMPONENT dependencies (modules declared in node manifests' own
  // DEPENDENCIES). The PLG PluginDependency table has no "kind" field, so
  // both kinds share the manifest vector; the node/component split is
  // preserved in artifact.json's dependency records.
  const seenDependencyIds = new Set();
  const bundleDependencies = [];
  for (const node of nodes) {
    const dependency = dependencies.get(node.pluginId);
    if (!dependency || seenDependencyIds.has(node.pluginId)) continue;
    seenDependencyIds.add(node.pluginId);
    bundleDependencies.push({
      pluginId: node.pluginId,
      minVersion: dependency.manifest?.version ?? null,
      maxVersion: dependency.manifest?.version ?? null,
    });
  }
  for (const component of check.componentDependencies ?? []) {
    if (seenDependencyIds.has(component.pluginId)) continue;
    seenDependencyIds.add(component.pluginId);
    bundleDependencies.push({
      pluginId: component.pluginId,
      minVersion: component.minVersion,
      maxVersion: component.maxVersion,
    });
  }

  return {
    pluginId: flow.programId,
    name: flow.name ?? flow.programId,
    version: flow.version ?? "0.0.0",
    pluginFamily: "flow",
    description:
      flow.description ??
      `Compiled SDN flow "${flow.programId}" (linked-direct monolithic artifact).`,
    // The flow's permission set is the union of its nodes' declared
    // capabilities plus resolved component-dependency capabilities, computed
    // and stamped by `flow check`.
    capabilities: check.capabilities,
    dependencies: bundleDependencies,
    externalInterfaces,
    methods,
    schemasUsed,
    runtimeTargets: ["browser", "wasmedge"],
    buildArtifacts: [
      {
        artifactId: `${cIdent(flow.programId)}-flow-runtime`,
        kind: "wasm",
        path: "dist/isomorphic/module.wasm",
        target: "browser,wasmedge",
      },
    ],
    abiVersion: 1,
  };
}

// ---------------------------------------------------------------------------
// FlowProgram flatbuffer encoding (plain JSON document -> FlowProgramT)
// ---------------------------------------------------------------------------

const nodeKindByName = {
  trigger: NodeKind.TRIGGER,
  transform: NodeKind.TRANSFORM,
  analyzer: NodeKind.ANALYZER,
  publisher: NodeKind.PUBLISHER,
  responder: NodeKind.RESPONDER,
  renderer: NodeKind.RENDERER,
  sink: NodeKind.SINK,
};

const triggerKindByName = {
  manual: TriggerKind.MANUAL,
  timer: TriggerKind.TIMER,
  "pubsub-subscription": TriggerKind.PUBSUB_SUBSCRIPTION,
  "protocol-request": TriggerKind.PROTOCOL_REQUEST,
  "http-request": TriggerKind.HTTP_REQUEST,
  "orbpro-event": TriggerKind.ORBPRO_EVENT,
  "scene-event": TriggerKind.SCENE_EVENT,
  "system-event": TriggerKind.SYSTEM_EVENT,
};

const drainPolicyByName = {
  "single-shot": DrainPolicy.SINGLE_SHOT,
  "drain-until-yield": DrainPolicy.DRAIN_UNTIL_YIELD,
  "drain-to-empty": DrainPolicy.DRAIN_TO_EMPTY,
};

const backpressureByName = {
  queue: BackpressurePolicy.QUEUE,
  "drop-oldest": BackpressurePolicy.DROP_OLDEST,
  "drop-newest": BackpressurePolicy.DROP_NEWEST,
};

function lookupEnum(map, value, fallback) {
  const key = String(value ?? "").trim().toLowerCase();
  return map[key] ?? fallback;
}

export function encodeFlowDocumentProgram(flow) {
  const program = Object.assign(new FlowProgramT(), {
    programId: flow.programId ?? "",
    // FlowProgram.name is a required field in the FLOW schema.
    name: flow.name ?? flow.programId ?? "",
    version: flow.version ?? null,
    description: flow.description ?? null,
    requiredPlugins: Array.isArray(flow.requiredPlugins) ? [...flow.requiredPlugins] : [],
    nodes: (flow.nodes ?? []).map((node) =>
      Object.assign(new FlowNodeT(), {
        nodeId: node.nodeId ?? "",
        pluginId: node.pluginId ?? "",
        methodId: node.methodId ?? "",
        kind: lookupEnum(nodeKindByName, node.kind, NodeKind.TRANSFORM),
        drainPolicy: lookupEnum(drainPolicyByName, node.drainPolicy, DrainPolicy.DRAIN_UNTIL_YIELD),
        timeSliceMicros: Number(node.timeSliceMicros ?? 0),
      }),
    ),
    edges: (flow.edges ?? []).map((edge, index) =>
      Object.assign(new FlowEdgeT(), {
        edgeId: edge.edgeId ?? `edge-${index}`,
        fromNodeId: edge.fromNodeId ?? "",
        fromPortId: edge.fromPortId ?? "",
        toNodeId: edge.toNodeId ?? "",
        toPortId: edge.toPortId ?? "",
        acceptedTypes: [],
        backpressurePolicy: lookupEnum(backpressureByName, edge.backpressurePolicy, BackpressurePolicy.QUEUE),
        queueDepth: Number(edge.queueDepth ?? 1),
      }),
    ),
    triggers: (flow.triggers ?? []).map((trigger) =>
      Object.assign(new FlowTriggerT(), {
        triggerId: trigger.triggerId ?? "",
        kind: lookupEnum(triggerKindByName, trigger.kind, TriggerKind.MANUAL),
        source: trigger.source ?? null,
        protocolId: trigger.protocolId ?? null,
        defaultIntervalMs: BigInt(trigger.defaultIntervalMs ?? 0),
        acceptedTypes: [],
        description: trigger.description ?? null,
      }),
    ),
    triggerBindings: (flow.triggerBindings ?? []).map((binding) =>
      Object.assign(new TriggerBindingT(), {
        triggerId: binding.triggerId ?? "",
        targetNodeId: binding.targetNodeId ?? "",
        targetPortId: binding.targetPortId ?? "",
        backpressurePolicy: lookupEnum(backpressureByName, binding.backpressurePolicy, BackpressurePolicy.QUEUE),
        queueDepth: Number(binding.queueDepth ?? 1),
      }),
    ),
  });
  return encodeFlowProgram(program);
}

// ---------------------------------------------------------------------------
// flow_generated.inc codegen
// ---------------------------------------------------------------------------

export function generateFlowTables({ flow, check, dependencies }) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const edges = Array.isArray(flow?.edges) ? flow.edges : [];
  const triggers = Array.isArray(flow?.triggers) ? flow.triggers : [];
  const triggerBindings = Array.isArray(flow?.triggerBindings) ? flow.triggerBindings : [];
  const nodeIndex = new Map(nodes.map((node, index) => [node.nodeId, index]));
  const triggerIndex = new Map(triggers.map((trigger, index) => [trigger.triggerId, index]));
  const dispatchByNodeId = new Map(check.nodes.map((node) => [node.nodeId, node.dispatchModel]));

  // Linked dependencies (deduped by pluginId, in first-use order). In
  // engine-linked mode a dependency's `guest-link-linked` object variant
  // (compiled -DSDN_FLATSQL_LINKED, calling the runtime template's direct
  // engine helpers instead of storage.flatsql_* hostcalls) is preferred when
  // the package ships one; pure compute nodes fall back to their standard
  // object (both variants share the deterministic symbol prefix).
  const engineLinked = Boolean(check.engineLinkage);
  const linkedDependencies = [];
  const dependencyIndexByPluginId = new Map();
  for (const node of nodes) {
    if (dispatchByNodeId.get(node.nodeId) !== "linked-direct") continue;
    if (dependencyIndexByPluginId.has(node.pluginId)) continue;
    const dependency = dependencies.get(node.pluginId);
    const chosenGuestLink = engineLinked
      ? (dependency?.guestLinkLinked ?? dependency?.guestLink ?? null)
      : (dependency?.guestLink ?? null);
    if (!chosenGuestLink) {
      throw new Error(
        `Plugin "${node.pluginId}" has no guest-link object (dist/guest-link/${GUEST_LINK_OBJECT_FILENAME}); ` +
          "rebuild the module with a build that persists compileModuleFromSource's guestLink output.",
      );
    }
    dependencyIndexByPluginId.set(node.pluginId, linkedDependencies.length);
    linkedDependencies.push({ ...dependency, guestLink: chosenGuestLink });
  }

  const nodeEntries = nodes.map((node) => {
    const dispatchModel = dispatchByNodeId.get(node.nodeId) ?? "host";
    if (dispatchModel !== "linked-direct") {
      return { node, dispatchModel, entrySymbol: null, dependency: null };
    }
    const dependency = linkedDependencies[dependencyIndexByPluginId.get(node.pluginId)];
    const entrySymbol = dependency.guestLink.metadata?.methodSymbols?.[node.methodId];
    if (!entrySymbol) {
      throw new Error(
        `Guest-link metadata for plugin "${node.pluginId}" carries no method symbol for "${node.methodId}".`,
      );
    }
    return { node, dispatchModel, entrySymbol, dependency };
  });

  // Required input ports per node — the compiled scheduler's readiness rule.
  const requiredPorts = [];
  for (const entry of nodeEntries) {
    if (!entry.dependency) continue;
    const method = findMethod(entry.dependency.normalized, entry.node.methodId);
    for (const port of method?.inputPorts ?? []) {
      if (port.required !== false && Number(port.minStreams ?? 1) > 0) {
        requiredPorts.push({ nodeIndex: nodeIndex.get(entry.node.nodeId), portId: port.portId });
      }
    }
  }

  const lines = [];
  lines.push("// Generated from the flow document by space-data-module flow compile — do not edit.");
  lines.push(`#define FLOW_NODE_COUNT ${nodes.length}u`);
  lines.push(`#define FLOW_EDGE_COUNT ${edges.length}u`);
  lines.push(`#define FLOW_TRIGGER_COUNT ${triggers.length}u`);
  lines.push(`#define FLOW_DEP_COUNT ${linkedDependencies.length}u`);
  lines.push(`#define FLOW_TRIGGER_BINDING_COUNT ${triggerBindings.length}u`);
  lines.push(`#define FLOW_REQUIRED_PORT_COUNT ${requiredPorts.length}u`);
  lines.push("");

  // Prefixed guest-link entry declarations.
  const declaredEntries = new Set();
  for (const entry of nodeEntries) {
    if (entry.entrySymbol && !declaredEntries.has(entry.entrySymbol)) {
      declaredEntries.add(entry.entrySymbol);
      lines.push(`extern "C" int ${entry.entrySymbol}(void);`);
    }
  }
  lines.push("");

  const strConsts = [];
  const strName = (tag, value) => {
    const name = `kStr_${tag}`;
    strConsts.push(`static const char ${name}[] = ${cString(value)};`);
    return name;
  };
  const nodeStrs = nodeEntries.map((entry, index) => ({
    id: strName(`node${index}_id`, entry.node.nodeId),
    dep: entry.dependency ? strName(`node${index}_dep`, entry.dependency.pluginId) : null,
    plugin: strName(`node${index}_plugin`, entry.node.pluginId),
    method: strName(`node${index}_method`, entry.node.methodId),
    model: strName(`node${index}_model`, entry.dispatchModel),
    entry: entry.entrySymbol ? strName(`node${index}_entry`, entry.entrySymbol) : null,
  }));
  const depStrs = linkedDependencies.map((dependency, index) => ({
    id: strName(`dep${index}_id`, dependency.pluginId),
    plugin: strName(`dep${index}_plugin`, dependency.pluginId),
    version: strName(`dep${index}_version`, dependency.manifest?.version ?? ""),
    entry: strName(
      `dep${index}_entry`,
      Object.values(dependency.guestLink.metadata?.methodSymbols ?? {})[0] ?? "",
    ),
  }));
  const sym = {
    malloc: strName("sym_malloc", "malloc"),
    free: strName("sym_free", "free"),
  };
  lines.push(...strConsts, "");

  lines.push(`FlowEdge g_edges[FLOW_EDGE_COUNT${edges.length === 0 ? " + 1" : ""}] = {`);
  for (const edge of edges) {
    lines.push(
      `  { ${nodeIndex.get(edge.fromNodeId)}u, ${cString(edge.fromPortId)}, ${nodeIndex.get(edge.toNodeId)}u, ${cString(edge.toPortId)} },`,
    );
  }
  lines.push("};");
  lines.push(
    `FlowTriggerBinding g_trigger_bindings[FLOW_TRIGGER_BINDING_COUNT${triggerBindings.length === 0 ? " + 1" : ""}] = {`,
  );
  for (const binding of triggerBindings) {
    lines.push(
      `  { ${triggerIndex.get(binding.triggerId)}u, ${nodeIndex.get(binding.targetNodeId)}u, ${cString(binding.targetPortId)} },`,
    );
  }
  lines.push("};");
  lines.push(
    `FlowRequiredPort g_required_ports[FLOW_REQUIRED_PORT_COUNT${requiredPorts.length === 0 ? " + 1" : ""}] = {`,
  );
  for (const requirement of requiredPorts) {
    lines.push(`  { ${requirement.nodeIndex}u, ${cString(requirement.portId)} },`);
  }
  lines.push("};");
  lines.push("");
  lines.push("FlowNodeDispatchDescriptorC g_dispatch_descriptors[FLOW_NODE_COUNT];");
  lines.push(
    `SignedArtifactDependencyDescriptorC g_dependency_descriptors[FLOW_DEP_COUNT${linkedDependencies.length === 0 ? " + 1" : ""}];`,
  );
  lines.push("");
  lines.push("static void flow_init_descriptors() {");
  nodeEntries.forEach((entry, index) => {
    const strs = nodeStrs[index];
    const dependencyIdx = entry.dependency
      ? `${dependencyIndexByPluginId.get(entry.dependency.pluginId)}u`
      : "0xFFFFFFFFu";
    lines.push("  {");
    lines.push(`    FlowNodeDispatchDescriptorC &d = g_dispatch_descriptors[${index}];`);
    lines.push(`    d.node_id_ptr = reinterpret_cast<uint32_t>(${strs.id});`);
    lines.push(`    d.node_index = ${index}u;`);
    lines.push(`    d.dependency_id_ptr = ${strs.dep ? `reinterpret_cast<uint32_t>(${strs.dep})` : "0"};`);
    lines.push(`    d.dependency_index = ${dependencyIdx};`);
    lines.push(`    d.plugin_id_ptr = reinterpret_cast<uint32_t>(${strs.plugin});`);
    lines.push(`    d.method_id_ptr = reinterpret_cast<uint32_t>(${strs.method});`);
    lines.push(`    d.dispatch_model_ptr = reinterpret_cast<uint32_t>(${strs.model});`);
    lines.push(`    d.entrypoint_ptr = ${strs.entry ? `reinterpret_cast<uint32_t>(${strs.entry})` : "0"};`);
    lines.push(`    d.malloc_symbol_ptr = reinterpret_cast<uint32_t>(${sym.malloc});`);
    lines.push(`    d.free_symbol_ptr = reinterpret_cast<uint32_t>(${sym.free});`);
    lines.push(`    d.stream_invoke_symbol_ptr = ${strs.entry ? `reinterpret_cast<uint32_t>(${strs.entry})` : "0"};`);
    lines.push("  }");
  });
  linkedDependencies.forEach((dependency, index) => {
    const strs = depStrs[index];
    lines.push("  {");
    lines.push(`    SignedArtifactDependencyDescriptorC &dd = g_dependency_descriptors[${index}];`);
    lines.push(`    dd.dependency_id_ptr = reinterpret_cast<uint32_t>(${strs.id});`);
    lines.push(`    dd.plugin_id_ptr = reinterpret_cast<uint32_t>(${strs.plugin});`);
    lines.push(`    dd.version_ptr = reinterpret_cast<uint32_t>(${strs.version});`);
    lines.push(`    dd.entrypoint_ptr = reinterpret_cast<uint32_t>(${strs.entry});`);
    lines.push(`    dd.malloc_symbol_ptr = reinterpret_cast<uint32_t>(${sym.malloc});`);
    lines.push(`    dd.free_symbol_ptr = reinterpret_cast<uint32_t>(${sym.free});`);
    lines.push(`    dd.stream_invoke_symbol_ptr = reinterpret_cast<uint32_t>(${strs.entry});`);
    lines.push("  }");
  });
  lines.push("}");
  lines.push(
    "static struct FlowDescriptorInit { FlowDescriptorInit() { flow_init_descriptors(); } } g_flow_descriptor_init;",
  );
  lines.push("");

  const linked = nodeEntries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.dispatchModel === "linked-direct");
  lines.push("static inline bool flow_node_is_linked(uint32_t node) {");
  lines.push(
    `  switch (node) { ${linked.map(({ index }) => `case ${index}u:`).join(" ")} return true; default: return false; }`,
  );
  lines.push("}");
  lines.push("static inline int32_t flow_call_entry(uint32_t node) {");
  lines.push("  switch (node) {");
  for (const { entry, index } of linked) {
    lines.push(`    case ${index}u: return ${entry.entrySymbol}();`);
  }
  lines.push("    default: return -1;");
  lines.push("  }");
  lines.push("}");
  return { source: lines.join("\n") + "\n", linkedDependencies };
}

// ---------------------------------------------------------------------------
// Compilation — flow compile (emception monolithic link)
// ---------------------------------------------------------------------------

async function linkFlowArtifactWithEmception({ runtimeSource, invokeHeader, generatedInc, manifestSource, programSource, dependencyObjects, engineLinked = false }) {
  return runWithEmceptionLock(async (emception) => {
    const workDir = "/working/space-data-module-flow-compile";
    const write = (name, content) => emception.writeFile(`${workDir}/${name}`, content);
    emception.FS.mkdirTree(workDir);
    try {
      write("space_data_module_invoke.h", invokeHeader);
      write("flow_runtime.cpp", runtimeSource);
      write("flow_generated.inc", generatedInc);
      write("flow-manifest-exports.cpp", manifestSource);
      write("flow-program-exports.cpp", programSource);
      const objectPaths = [];
      dependencyObjects.forEach((objectBytes, index) => {
        const objectPath = `${workDir}/dep${index}.o`;
        emception.writeFile(objectPath, objectBytes);
        objectPaths.push(objectPath);
      });

      // -mbulk-memory: frame moves in the flow runtime (edge queues, arena
      // copies) lower to native memory.copy/memory.fill instead of byte
      // loops — decisive for interpreted hosts (loop C.5 wirespeed gate).
      // -DSDN_FLATSQL_LINKED compiles the direct engine-linkage block into
      // the runtime template (loop C.7): engine-facing calls become wasm
      // imports from modules "flatsql"/"flatsql_link" instead of hostcalls.
      const linkedDefine = engineLinked ? " -DSDN_FLATSQL_LINKED=1" : "";
      const compileCommands = [
        `em++ -c ${workDir}/flow_runtime.cpp -I${workDir} -std=c++17 -O3 -mbulk-memory -DNDEBUG${linkedDefine} -o ${workDir}/flow_runtime.o`,
        `em++ -c ${workDir}/flow-manifest-exports.cpp -std=c++17 -O3 -mbulk-memory -o ${workDir}/flow-manifest-exports.o`,
        `em++ -c ${workDir}/flow-program-exports.cpp -std=c++17 -O3 -mbulk-memory -o ${workDir}/flow-program-exports.o`,
      ];
      const exportSymbols = engineLinked
        ? [...FLOW_ARTIFACT_EXPORTS, ...FLOW_LINKED_EXPORTS]
        : FLOW_ARTIFACT_EXPORTS;
      const exportArgs = exportSymbols.map((symbol) => `-Wl,--export=${symbol}`).join(" ");
      const linkCommand =
        `em++ ${workDir}/flow_runtime.o ${workDir}/flow-manifest-exports.o ${workDir}/flow-program-exports.o ` +
        `${objectPaths.join(" ")} -O3 -s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=1 ` +
        `-s ERROR_ON_UNDEFINED_SYMBOLS=0 -Wl,--allow-undefined --no-entry ${exportArgs} ` +
        `-o ${workDir}/flow.wasm`;

      for (const command of [...compileCommands, linkCommand]) {
        const result = emception.run(command);
        if (result.returncode !== 0) {
          throw new Error(
            `Flow compilation failed (emception): ${command}\n${result.stderr || result.stdout}`,
          );
        }
      }
      return new Uint8Array(emception.readFile(`${workDir}/flow.wasm`));
    } finally {
      try {
        const entries = emception.FS.readdir(workDir).filter((entry) => entry !== "." && entry !== "..");
        for (const entry of entries) {
          emception.FS.unlink(`${workDir}/${entry}`);
        }
        emception.FS.rmdir(workDir);
      } catch {
        // Best-effort cleanup only.
      }
    }
  });
}

/**
 * Compile a validated flow document into the linked-direct flow bundle.
 * Returns { check, manifest, artifact, outputs, report }.
 */
export async function compileFlowProgram({ flow, dependencies, outDir, flowSourcePath = null }) {
  const check = checkFlowProgram({ flow, dependencies });
  if (!check.ok) {
    const error = new Error(
      `Flow validation failed:\n${check.errors.map((issue) => `  ${issue.code}: ${issue.message}`).join("\n")}`,
    );
    error.check = check;
    throw error;
  }

  const { source: generatedInc, linkedDependencies } = generateFlowTables({
    flow,
    check,
    dependencies,
  });
  const manifest = buildFlowModuleManifest({ flow, check, dependencies });
  const programBytes = encodeFlowDocumentProgram(flow);

  const runtimeSource = await readFile(RUNTIME_TEMPLATE_PATH, "utf8");
  const manifestSource = generateEmbeddedManifestSource({ manifest });
  const programSource = generateEmbeddedManifestSource({
    manifest: programBytes,
    bytesSymbol: "flow_get_manifest_flatbuffer",
    sizeSymbol: "flow_get_manifest_flatbuffer_size",
    bufferSymbol: "g_flow_program",
  });

  let wasmBytes = await linkFlowArtifactWithEmception({
    runtimeSource,
    invokeHeader: generateInvokeSupportHeader(),
    generatedInc,
    manifestSource,
    programSource,
    dependencyObjects: linkedDependencies.map((dependency) => dependency.guestLink.objectBytes),
    engineLinked: Boolean(check.engineLinkage),
  });
  wasmBytes = appendWasmCustomSection(
    wasmBytes,
    SDS_MANIFEST_SECTION_NAME,
    encodePluginManifest(manifest),
  );

  const dependencyRecords = [];
  for (const dependency of linkedDependencies) {
    let sha256 = null;
    try {
      sha256 = bytesToHex(await sha256Bytes(new Uint8Array(await readFile(dependency.wasmPath))));
    } catch {
      sha256 = null;
    }
    dependencyRecords.push({
      kind: "node",
      dependencyId: dependency.pluginId,
      pluginId: dependency.pluginId,
      version: dependency.manifest?.version ?? null,
      sha256,
      symbolPrefix: dependency.guestLink.metadata?.symbolPrefix ?? null,
      methodSymbols: dependency.guestLink.metadata?.methodSymbols ?? {},
    });
  }
  for (const component of check.componentDependencies ?? []) {
    dependencyRecords.push({
      kind: "component",
      dependencyId: component.pluginId,
      pluginId: component.pluginId,
      minVersion: component.minVersion,
      maxVersion: component.maxVersion,
      resolved: component.resolved,
      declaredBy: component.declaredBy,
    });
  }

  const artifact = {
    programId: flow.programId,
    name: flow.name ?? null,
    version: flow.version ?? null,
    compiler: "space-data-module flow compile (linked-direct, emception)",
    nodes: (flow.nodes ?? []).length,
    edges: (flow.edges ?? []).length,
    triggers: (flow.triggers ?? []).length,
    capabilities: check.capabilities,
    // "flatsql-direct": engine-facing query calls are direct wasm imports
    // from the live store engine instance (modules "flatsql"/"flatsql_link");
    // "bridge": queries travel the storage.flatsql_* capability hostcalls.
    engineLinkage: check.engineLinkage ? "flatsql-direct" : "bridge",
    dispatch: check.nodes,
    dependencies: dependencyRecords,
  };

  const outputs = {};
  if (outDir) {
    const moduleWasmPath = path.join(outDir, "isomorphic", "module.wasm");
    await mkdir(path.dirname(moduleWasmPath), { recursive: true });
    await writeFile(moduleWasmPath, wasmBytes);
    const runtimeWasmPath = path.join(outDir, "runtime.wasm");
    await writeFile(runtimeWasmPath, wasmBytes);
    const manifestPath = path.join(outDir, "plugin-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const artifactPath = path.join(outDir, "artifact.json");
    await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    const flowJsonPath = path.join(outDir, "flow.json");
    const flowJson = flowSourcePath
      ? await readFile(flowSourcePath, "utf8")
      : `${JSON.stringify(flow, null, 2)}\n`;
    await writeFile(flowJsonPath, flowJson);
    outputs.moduleWasmPath = moduleWasmPath;
    outputs.runtimeWasmPath = runtimeWasmPath;
    outputs.manifestPath = manifestPath;
    outputs.artifactPath = artifactPath;
    outputs.flowJsonPath = flowJsonPath;
    if (check.engineLinkage) {
      // Ship the deterministic flatsql_link shim next to the artifact so any
      // host can instantiate the memory-crossing component without depending
      // on the SDK at runtime (sdn-server embeds the identical bytes).
      const shimPath = path.join(outDir, "flatsql-link-shim.wasm");
      await writeFile(shimPath, FLATSQL_LINK_SHIM_WASM);
      outputs.linkShimPath = shimPath;
    }
  }

  const report = await validateArtifactWithStandards({
    manifest,
    wasmBytes,
    sourceName: outputs.moduleWasmPath ?? `${flow.programId} (flow bundle)`,
  });

  return { check, manifest, artifact, wasmBytes, outputs, report };
}
