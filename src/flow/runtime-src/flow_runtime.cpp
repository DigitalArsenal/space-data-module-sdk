/*
 * Generic compiled-flow runtime — the SDK flow compiler's runtime template.
 *
 * `space-data-module flow compile` links this translation unit with the
 * flow's generated descriptor tables (flow_generated.inc), the flow's
 * embedded manifests, and each linked-direct dependency's PREFIXED
 * guest-link wasm object (the "Prefixed guest-link wasm object for
 * monolithic flow linking" emitted by compileModuleFromSource) into ONE
 * artifact with ONE linear memory.
 *
 * Implements the `space_data_module_runtime_*` ABI bound by BOTH hosts —
 * sdn-server internal/flowrt (abi.go/runtime.go, WasmEdge) and the SDK's
 * src/flow/flowRuntimeHost.js (browser/node):
 *   - descriptor tables (FlowNodeDispatchDescriptor 60B,
 *     SignedArtifactDependencyDescriptor 72B, FlowFrameDescriptor 48B,
 *     FlowInvocationDescriptor 24B, node state 32B, ingress state 24B),
 *   - a frame-queue scheduler (trigger bindings -> node queues -> edges)
 *     whose readiness rule honours the dependency manifests' required
 *     input ports (compiled in from the manifests by the flow compiler),
 *   - linked-direct dispatch: node entries are the dependencies' prefixed
 *     guest-link method symbols; their SDK invoke ABI
 *     (plugin_get_input_frame / plugin_push_output* / ...) is provided by
 *     the in-artifact shim below, so frames flow node-to-node inside this
 *     module's linear memory with zero host copies. Capability hostcalls
 *     (e.g. space_data_module_host.call) remain wasm imports.
 *
 * The flow graph tables (node/edge/trigger-binding/dependency/required-port
 * tables and the entry dispatch switch) are generated from the *.flow.json
 * document by src/flow/flowCompiler.js into flow_generated.inc.
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <string>
#include <memory>
#include <vector>

#include "space_data_module_invoke.h"

#define FLOW_EXPORT extern "C" __attribute__((visibility("default")))

#ifdef SDN_FLATSQL_LINKED
static void sdn_flatsql_link_reset_refs(void);
#endif

// Guest-link objects compiled from Emscripten C++ may import the memory
// growth notification; provide the same weak no-op the module compiler uses.
extern "C" __attribute__((weak)) void emscripten_notify_memory_growth(int) {}

// ---------------------------------------------------------------------------
// ABI structs — layouts must match sdn-server internal/flowrt/abi.go exactly.
// ---------------------------------------------------------------------------

struct FlowFrameDescriptorC {
  uint32_t ingress_index;
  uint32_t type_descriptor_idx;
  uint32_t port_id_ptr;
  uint32_t alignment;
  uint32_t offset;
  uint32_t size;
  uint32_t stream_id;
  uint32_t sequence;
  uint64_t trace_token;
  uint8_t end_of_stream;
  uint8_t occupied;
  uint8_t wire_format;
  uint8_t ownership;
  uint8_t mutability;
  uint8_t lifetime;
  uint8_t _pad[2];
};
static_assert(sizeof(FlowFrameDescriptorC) == 48, "FlowFrameDescriptor must be 48 bytes");

struct FlowRoutingRuntimeStateC {
  uint64_t aligned_shared_routes;
  uint64_t aligned_copied_routes;
  uint64_t canonical_routes;
  uint64_t rejected_frames;
};
static_assert(sizeof(FlowRoutingRuntimeStateC) == 32,
              "FlowRoutingRuntimeState must be 32 bytes");

struct FlowInvocationDescriptorC {
  uint32_t node_index;
  uint32_t dispatch_descriptor_idx;
  uint32_t plugin_id_ptr;
  uint32_t method_id_ptr;
  uint32_t frames_ptr;
  uint32_t frame_count;
};
static_assert(sizeof(FlowInvocationDescriptorC) == 24, "FlowInvocationDescriptor must be 24 bytes");

struct FlowNodeDispatchDescriptorC {
  uint32_t node_id_ptr;
  uint32_t node_index;
  uint32_t dependency_id_ptr;
  uint32_t dependency_index;
  uint32_t plugin_id_ptr;
  uint32_t method_id_ptr;
  uint32_t dispatch_model_ptr;
  uint32_t entrypoint_ptr;
  uint32_t manifest_bytes_symbol_ptr;
  uint32_t manifest_size_symbol_ptr;
  uint32_t init_symbol_ptr;
  uint32_t destroy_symbol_ptr;
  uint32_t malloc_symbol_ptr;
  uint32_t free_symbol_ptr;
  uint32_t stream_invoke_symbol_ptr;
};
static_assert(sizeof(FlowNodeDispatchDescriptorC) == 60, "FlowNodeDispatchDescriptor must be 60 bytes");

struct SignedArtifactDependencyDescriptorC {
  uint32_t dependency_id_ptr;
  uint32_t plugin_id_ptr;
  uint32_t version_ptr;
  uint32_t sha256_ptr;
  uint32_t signature_ptr;
  uint32_t signer_public_key_ptr;
  uint32_t entrypoint_ptr;
  uint32_t manifest_bytes_symbol_ptr;
  uint32_t manifest_size_symbol_ptr;
  uint32_t init_symbol_ptr;
  uint32_t destroy_symbol_ptr;
  uint32_t malloc_symbol_ptr;
  uint32_t free_symbol_ptr;
  uint32_t stream_invoke_symbol_ptr;
  uint32_t wasm_bytes_ptr;
  uint32_t wasm_size;
  uint32_t manifest_bytes_ptr;
  uint32_t manifest_size;
};
static_assert(sizeof(SignedArtifactDependencyDescriptorC) == 72, "SignedArtifactDependencyDescriptor must be 72 bytes");

struct FlowIngressRuntimeStateC {
  uint64_t total_received;
  uint64_t total_dropped;
  uint32_t queued_frames;
  uint8_t _pad[4];
};
static_assert(sizeof(FlowIngressRuntimeStateC) == 24, "FlowIngressRuntimeState must be 24 bytes");

struct FlowNodeRuntimeStateC {
  uint64_t invocation_count;
  uint64_t consumed_frames;
  uint32_t queued_frames;
  uint32_t backlog_remaining;
  uint32_t last_status;
  uint8_t ready;
  uint8_t yielded;
  uint8_t _pad[2];
};
static_assert(sizeof(FlowNodeRuntimeStateC) == 32, "FlowNodeRuntimeState must be 32 bytes");

// ---------------------------------------------------------------------------
// Generated flow graph tables (from the flow document via flowCompiler.js):
//   FLOW_NODE_COUNT / FLOW_ROUTE_EDGE_COUNT / FLOW_EDGE_COUNT
//   FLOW_TRIGGER_COUNT / FLOW_DEP_COUNT
//   FLOW_TRIGGER_BINDING_COUNT / FLOW_REQUIRED_PORT_COUNT
//   g_dispatch_descriptors[] / g_dependency_descriptors[]
//   FlowEdge g_edges[]                  (endpoints + exact compiled type contract)
//   FlowTriggerBinding g_trigger_bindings[] (target + exact input-port type)
//   FlowRequiredPort g_required_ports[]     (node_index, port_id)
//   flow_call_entry(node_index) — linked-direct entry dispatch switch
//   flow_node_is_linked(node_index)
// ---------------------------------------------------------------------------

struct FlowEdge {
  uint32_t from_node;
  const char *from_port;
  uint32_t to_node;
  const char *to_port;
  const char *schema_name;
  const char *file_identifier;
  const char *schema_version;
  const uint8_t *schema_hash;
  uint32_t schema_hash_size;
  const char *root_type_name;
  uint32_t canonical_fallback_available;
  uint32_t aligned_eligible;
  uint32_t aligned_layout_fields;
  uint32_t aligned_byte_length;
  uint32_t aligned_fixed_string_length;
  uint32_t aligned_required_alignment;
};
static_assert(sizeof(FlowEdge) == 64, "FlowEdge must be 64 bytes on wasm32");

struct FlowTriggerBinding {
  uint32_t trigger_index;
  uint32_t target_node;
  const char *port;
  uint32_t type_descriptor_idx;
};
static_assert(sizeof(FlowTriggerBinding) == 16,
              "FlowTriggerBinding must be 16 bytes on wasm32");

struct FlowRequiredPort {
  uint32_t node_index;
  const char *port_id;
};

#include "flow_generated.inc"

enum FlowWireFormat : uint8_t {
  kFlowFlatbuffer = 0,
  kFlowAlignedBinary = 1,
};

struct FlowTypeDescriptorView {
  const char *schema_name;
  const char *file_identifier;
  const char *schema_version;
  const uint8_t *schema_hash;
  uint32_t schema_hash_size;
  const char *root_type_name;
  uint32_t canonical_fallback_available;
  uint32_t aligned_eligible;
  uint32_t aligned_layout_fields;
  uint32_t aligned_byte_length;
  uint32_t aligned_fixed_string_length;
  uint32_t aligned_required_alignment;
};

static bool flow_resolve_type_descriptor(uint32_t index,
                                         FlowTypeDescriptorView *out) {
  if (out == nullptr) return false;
  if (index < FLOW_EDGE_COUNT) {
    const FlowEdge &edge = g_edges[index];
    out->schema_name = edge.schema_name;
    out->file_identifier = edge.file_identifier;
    out->schema_version = edge.schema_version;
    out->schema_hash = edge.schema_hash;
    out->schema_hash_size = edge.schema_hash_size;
    out->root_type_name = edge.root_type_name;
    out->canonical_fallback_available = edge.canonical_fallback_available;
    out->aligned_eligible = edge.aligned_eligible;
    out->aligned_layout_fields = edge.aligned_layout_fields;
    out->aligned_byte_length = edge.aligned_byte_length;
    out->aligned_fixed_string_length = edge.aligned_fixed_string_length;
    out->aligned_required_alignment = edge.aligned_required_alignment;
    return true;
  }
  return false;
}

static bool flow_nullable_string_equal(const char *left, const char *right) {
  if (left == nullptr || right == nullptr) return left == right;
  return strcmp(left, right) == 0;
}

static bool flow_type_identity_equal(const FlowTypeDescriptorView &left,
                                     const FlowTypeDescriptorView &right) {
  if (!flow_nullable_string_equal(left.schema_name, right.schema_name) ||
      !flow_nullable_string_equal(left.file_identifier, right.file_identifier) ||
      !flow_nullable_string_equal(left.schema_version, right.schema_version) ||
      !flow_nullable_string_equal(left.root_type_name, right.root_type_name) ||
      left.schema_hash_size != right.schema_hash_size) {
    return false;
  }
  if (left.schema_hash_size == 0) return true;
  if (left.schema_hash == nullptr || right.schema_hash == nullptr) return false;
  return memcmp(left.schema_hash, right.schema_hash, left.schema_hash_size) == 0;
}

static bool flow_binding_accepts_descriptor(uint32_t binding_index,
                                            uint32_t descriptor_index,
                                            uint8_t wire_format) {
  FlowTypeDescriptorView binding_type;
  FlowTypeDescriptorView provided_type;
  if (binding_index >= FLOW_TRIGGER_BINDING_COUNT ||
      !flow_resolve_type_descriptor(g_trigger_bindings[binding_index].type_descriptor_idx,
                                    &binding_type) ||
      !flow_resolve_type_descriptor(descriptor_index, &provided_type) ||
      !flow_type_identity_equal(binding_type, provided_type)) {
    return false;
  }
  if (wire_format == kFlowFlatbuffer) {
    return provided_type.canonical_fallback_available != 0;
  }
  return provided_type.aligned_eligible != 0 &&
         binding_type.aligned_eligible != 0 &&
         provided_type.aligned_layout_fields == binding_type.aligned_layout_fields &&
         provided_type.aligned_byte_length == binding_type.aligned_byte_length &&
         provided_type.aligned_fixed_string_length ==
             binding_type.aligned_fixed_string_length &&
         provided_type.aligned_required_alignment ==
             binding_type.aligned_required_alignment;
}

// ---------------------------------------------------------------------------
// Scheduler state
// ---------------------------------------------------------------------------

enum FlowOwnership : uint8_t {
  kFlowHostOwned = 0,
  kFlowPluginOwned = 1,
  kFlowTransferred = 2,
};

enum FlowMutability : uint8_t {
  kFlowImmutable = 0,
  kFlowSingleWriterMutable = 1,
  kFlowAppendOnly = 2,
};

struct PayloadStorage {
  std::vector<uint8_t> bytes;
  uint32_t payload_offset = 0;
};

struct QueuedFrame {
  std::string port;
  std::shared_ptr<PayloadStorage> storage;
  uint32_t payload_offset = 0;
  uint32_t payload_size = 0;
  uint32_t type_descriptor_idx = 0xFFFFFFFFu;
  uint32_t alignment = 1;
  uint32_t byte_length = 0;
  uint32_t fixed_string_length = 0;
  uint32_t required_alignment = 1;
  uint32_t stream_id = 0;
  uint32_t sequence = 0;
  uint64_t frame_id = 0;
  uint8_t end_of_stream = 0;
  uint8_t wire_format = kFlowFlatbuffer;
  uint8_t ownership = kFlowHostOwned;
  uint8_t mutability = kFlowImmutable;
  uint8_t tracks_external_lifetime = 0;

  const uint8_t *data() const {
    if (!storage || payload_size == 0) return nullptr;
    return storage->bytes.data() + payload_offset;
  }
};

static std::vector<QueuedFrame> g_queues[FLOW_NODE_COUNT];
static FlowNodeRuntimeStateC g_node_states[FLOW_NODE_COUNT];
static FlowIngressRuntimeStateC g_ingress_states[FLOW_TRIGGER_COUNT];

// Current invocation (one at a time — both host drain loops are serialized).
static constexpr uint32_t kMaxInvocationFrames = 64;
static constexpr uint32_t kInvalidIndex = 0xFFFFFFFFu;
static FlowInvocationDescriptorC g_current_desc;
static FlowFrameDescriptorC g_current_frames[kMaxInvocationFrames];
static QueuedFrame g_current_owned[kMaxInvocationFrames];
static uint32_t g_current_node = kInvalidIndex;
static uint32_t g_invocation_generation = 0;
static uint64_t g_next_frame_id = 1;
struct ExternalFrameLifetime {
  uint64_t frame_id;
  uint32_t references;
};
static std::vector<ExternalFrameLifetime> g_active_external_frames;
static FlowRoutingRuntimeStateC g_routing_state;
// Fair ready-node cursor. A yielding source can remain ready for thousands of
// bounded pages; always scanning from node zero would let it monopolize the
// scheduler and accumulate every downstream frame in linear memory.
static uint32_t g_ready_cursor = 0;

// Readiness: a node is ready when it has queued frames AND every required
// input port of its bound method (compiled in from the dependency manifest)
// has at least one queued frame. Host-model nodes have no required-port rows
// and fire on any queued frame.
static bool flow_node_is_ready(uint32_t node) {
  // A linked guest that yielded with internal backlog owns its continuation
  // state. Resume it without fabricating/replaying an input frame. This is the
  // compiled-runtime meaning of plugin_set_yielded + backlog_remaining.
  if (g_node_states[node].yielded != 0 &&
      g_node_states[node].backlog_remaining > 0) {
    return true;
  }
  if (g_queues[node].empty()) return false;
  for (uint32_t r = 0; r < FLOW_REQUIRED_PORT_COUNT; r++) {
    if (g_required_ports[r].node_index != node) continue;
    bool present = false;
    for (const QueuedFrame &frame : g_queues[node]) {
      if (strcmp(frame.port.c_str(), g_required_ports[r].port_id) == 0) {
        present = true;
        break;
      }
    }
    if (!present) return false;
  }
  return true;
}

static uint32_t flow_find_ready_node(void) {
  for (uint32_t offset = 0; offset < FLOW_NODE_COUNT; offset++) {
    const uint32_t node = (g_ready_cursor + offset) % FLOW_NODE_COUNT;
    if (flow_node_is_ready(node)) return node;
  }
  return kInvalidIndex;
}

static uint64_t flow_memory_byte_size(void) {
  return static_cast<uint64_t>(__builtin_wasm_memory_size(0)) * 65536ull;
}

static bool flow_valid_memory_range(uint32_t offset, uint32_t size) {
  const uint64_t memory_size = flow_memory_byte_size();
  return static_cast<uint64_t>(offset) <= memory_size &&
         static_cast<uint64_t>(size) <= memory_size - static_cast<uint64_t>(offset);
}

static bool flow_is_power_of_two(uint32_t value) {
  return value != 0 && (value & (value - 1u)) == 0;
}

static bool flow_valid_c_string(uint32_t ptr, uint32_t max_length = 1024) {
  if (ptr == 0) return true;
  const uint64_t memory_size = flow_memory_byte_size();
  if (static_cast<uint64_t>(ptr) >= memory_size) return false;
  const char *text = reinterpret_cast<const char *>(ptr);
  const uint64_t remaining = memory_size - static_cast<uint64_t>(ptr);
  const uint64_t limit = remaining < max_length ? remaining : max_length;
  for (uint64_t i = 0; i < limit; i++) {
    if (text[i] == '\0') return true;
  }
  return false;
}

static std::shared_ptr<PayloadStorage> flow_copy_payload(
    const uint8_t *payload, uint32_t length, uint32_t alignment,
    uint32_t *payload_offset) {
  const uint32_t normalized_alignment = flow_is_power_of_two(alignment) ? alignment : 1;
  auto storage = std::make_shared<PayloadStorage>();
  if (length == 0) {
    *payload_offset = 0;
    return storage;
  }
  storage->bytes.resize(static_cast<size_t>(length) + normalized_alignment - 1u);
  const uintptr_t base = reinterpret_cast<uintptr_t>(storage->bytes.data());
  const uint32_t padding = static_cast<uint32_t>(
      (normalized_alignment - (base % normalized_alignment)) % normalized_alignment);
  storage->payload_offset = padding;
  *payload_offset = padding;
  memcpy(storage->bytes.data() + padding, payload, length);
  return storage;
}

static bool flow_find_current_alias(const uint8_t *payload, uint32_t length,
                                    std::shared_ptr<PayloadStorage> *storage,
                                    uint32_t *payload_offset) {
  if (payload == nullptr && length > 0) return false;
  const uintptr_t requested_begin = reinterpret_cast<uintptr_t>(payload);
  const uintptr_t requested_end = requested_begin + length;
  if (requested_end < requested_begin) return false;
  for (uint32_t i = 0; i < g_current_desc.frame_count; i++) {
    const QueuedFrame &current = g_current_owned[i];
    const uint8_t *current_data = current.data();
    if (current_data == nullptr && current.payload_size > 0) continue;
    const uintptr_t current_begin = reinterpret_cast<uintptr_t>(current_data);
    const uintptr_t current_end = current_begin + current.payload_size;
    if (requested_begin < current_begin || requested_end > current_end) continue;
    *storage = current.storage;
    *payload_offset = current.payload_offset +
                      static_cast<uint32_t>(requested_begin - current_begin);
    return true;
  }
  return false;
}

struct FlowOutputFrameView {
  const char *port = nullptr;
  const char *schema_name = nullptr;
  const char *file_identifier = nullptr;
  const char *root_type_name = nullptr;
  const uint8_t *payload = nullptr;
  uint32_t length = 0;
  uint32_t wire_format = kFlowFlatbuffer;
  uint32_t byte_length = 0;
  uint32_t fixed_string_length = 0;
  uint32_t required_alignment = 1;
  uint32_t alignment = 1;
  uint32_t stream_id = 0;
  uint32_t sequence = 0;
  uint64_t frame_id = 0;
  uint8_t end_of_stream = 0;
  uint8_t ownership = kFlowHostOwned;
  uint8_t mutability = kFlowImmutable;
};

static bool flow_output_matches_edge_identity(const FlowOutputFrameView &out,
                                              const FlowEdge &edge) {
  if (out.schema_name != nullptr && out.schema_name[0] != '\0' &&
      strcmp(out.schema_name, edge.schema_name) != 0) {
    return false;
  }
  if (out.file_identifier != nullptr && out.file_identifier[0] != '\0' &&
      strcmp(out.file_identifier, edge.file_identifier) != 0) {
    return false;
  }
  if (out.root_type_name != nullptr && out.root_type_name[0] != '\0' &&
      strcmp(out.root_type_name, edge.root_type_name) != 0) {
    return false;
  }
  return true;
}

static int32_t route_output(uint32_t from_node, const FlowOutputFrameView &out) {
  if (out.port == nullptr) return -20;
  if (out.wire_format > kFlowAlignedBinary || out.ownership > kFlowTransferred ||
      out.mutability > kFlowAppendOnly) {
    g_routing_state.rejected_frames++;
    return -21;
  }
  if (out.length > 0) {
    if (out.payload == nullptr) {
      g_routing_state.rejected_frames++;
      return -22;
    }
    const uint32_t payload_ptr = reinterpret_cast<uint32_t>(out.payload);
    if (!flow_valid_memory_range(payload_ptr, out.length)) {
      g_routing_state.rejected_frames++;
      return -22;
    }
  }
  std::vector<uint32_t> matching_edges;
  for (uint32_t e = 0; e < FLOW_ROUTE_EDGE_COUNT; e++) {
    if (g_edges[e].from_node != from_node) continue;
    if (strcmp(g_edges[e].from_port, out.port) != 0) continue;
    matching_edges.push_back(e);
  }
  if (matching_edges.empty()) return 0;
  if (out.mutability != kFlowImmutable &&
      (out.ownership != kFlowTransferred || matching_edges.size() != 1)) {
    g_routing_state.rejected_frames++;
    return -23;
  }

  for (uint32_t edge_index : matching_edges) {
    const FlowEdge &edge = g_edges[edge_index];
    if (!flow_output_matches_edge_identity(out, edge)) {
      g_routing_state.rejected_frames++;
      return -24;
    }
    if (out.wire_format == kFlowFlatbuffer) {
      if (edge.canonical_fallback_available == 0) {
        g_routing_state.rejected_frames++;
        return -25;
      }
      continue;
    }
    if (edge.aligned_eligible == 0 || edge.aligned_byte_length == 0 ||
        edge.aligned_required_alignment == 0 ||
        !flow_is_power_of_two(edge.aligned_required_alignment) ||
        out.length != edge.aligned_byte_length ||
        (out.byte_length != 0 && out.byte_length != edge.aligned_byte_length) ||
        (out.fixed_string_length != 0 &&
         out.fixed_string_length != edge.aligned_fixed_string_length) ||
        (out.required_alignment != 0 &&
         out.required_alignment != edge.aligned_required_alignment) ||
        reinterpret_cast<uintptr_t>(out.payload) % edge.aligned_required_alignment != 0) {
      g_routing_state.rejected_frames++;
      return -26;
    }
  }

  std::shared_ptr<PayloadStorage> aliased_storage;
  uint32_t aliased_offset = 0;
  const bool aliases_current = flow_find_current_alias(
      out.payload, out.length, &aliased_storage, &aliased_offset);

  for (uint32_t edge_index : matching_edges) {
    const FlowEdge &edge = g_edges[edge_index];
    QueuedFrame frame;
    frame.port = edge.to_port;
    frame.payload_size = out.length;
    frame.type_descriptor_idx = edge_index;
    frame.stream_id = out.stream_id;
    frame.sequence = out.sequence;
    frame.end_of_stream = out.end_of_stream;
    frame.frame_id = out.frame_id != 0 ? out.frame_id : g_next_frame_id++;
    frame.wire_format = static_cast<uint8_t>(out.wire_format);
    frame.ownership = kFlowHostOwned;
    frame.mutability = kFlowImmutable;
    if (out.wire_format == kFlowAlignedBinary) {
      frame.alignment = edge.aligned_required_alignment;
      frame.byte_length = edge.aligned_byte_length;
      frame.fixed_string_length = edge.aligned_fixed_string_length;
      frame.required_alignment = edge.aligned_required_alignment;
    } else {
      frame.alignment = 1;
      frame.byte_length = 0;
      frame.fixed_string_length = 0;
      frame.required_alignment = 1;
    }
    if (aliases_current) {
      frame.storage = aliased_storage;
      frame.payload_offset = aliased_offset;
      if (out.wire_format == kFlowAlignedBinary) {
        g_routing_state.aligned_shared_routes++;
      } else {
        g_routing_state.canonical_routes++;
      }
    } else {
      const uint32_t copy_alignment =
          out.wire_format == kFlowAlignedBinary ? edge.aligned_required_alignment : 1;
      frame.storage = flow_copy_payload(
          out.payload, out.length, copy_alignment, &frame.payload_offset);
      if (out.wire_format == kFlowAlignedBinary) {
        g_routing_state.aligned_copied_routes++;
      } else {
        g_routing_state.canonical_routes++;
      }
    }
    uint32_t to = edge.to_node;
    g_queues[to].push_back(static_cast<QueuedFrame &&>(frame));
    g_node_states[to].queued_frames = static_cast<uint32_t>(g_queues[to].size());
    g_node_states[to].ready = flow_node_is_ready(to) ? 1 : 0;
  }
  return static_cast<int32_t>(matching_edges.size());
}

// ---------------------------------------------------------------------------
// SDK invoke-ABI shim: the linked guest-link method entries read their inputs
// and push their outputs through these functions (declared by the SDK's
// generated space_data_module_invoke.h). Inputs alias the current
// invocation's queued payload buffers — zero copies inside the flow.
// ---------------------------------------------------------------------------

static std::vector<plugin_input_frame_t> g_shim_inputs;

struct ShimOutput {
  std::string port;
  std::string schema_name;
  std::string file_identifier;
  std::string root_type_name;
  const uint8_t *payload = nullptr;
  uint32_t payload_length = 0;
  uint32_t wire_format = kFlowFlatbuffer;
  uint32_t fixed_string_length = 0;
  uint32_t byte_length = 0;
  uint32_t required_alignment = 1;
  uint64_t sequence = 0;
  int32_t end_of_stream = 0;
};
static std::vector<ShimOutput> g_shim_outputs;
static std::string g_shim_error_code;
static std::string g_shim_error_message;
static int32_t g_shim_yielded = 0;
static uint32_t g_shim_backlog_remaining = 0;

extern "C" uint32_t plugin_get_input_count(void) {
  return static_cast<uint32_t>(g_shim_inputs.size());
}

extern "C" const plugin_input_frame_t *plugin_get_input_frame(uint32_t index) {
  if (index >= g_shim_inputs.size()) return nullptr;
  return &g_shim_inputs[index];
}

extern "C" int32_t plugin_find_input_index(const char *port_id, uint32_t ordinal) {
  if (port_id == nullptr) return -1;
  uint32_t seen = 0;
  for (uint32_t i = 0; i < g_shim_inputs.size(); i++) {
    if (g_shim_inputs[i].port_id != nullptr && strcmp(g_shim_inputs[i].port_id, port_id) == 0) {
      if (seen == ordinal) return static_cast<int32_t>(i);
      seen++;
    }
  }
  return -1;
}

extern "C" void plugin_reset_output_state(void) {
  g_shim_outputs.clear();
  g_shim_error_code.clear();
  g_shim_error_message.clear();
  g_shim_yielded = 0;
  g_shim_backlog_remaining = 0;
}

static int32_t shim_push_output(
    const char *port_id, const char *schema_name, const char *file_identifier,
    uint32_t wire_format, const char *root_type_name,
    uint32_t fixed_string_length, uint32_t byte_length,
    uint32_t required_alignment, const uint8_t *payload_ptr,
    uint32_t payload_length) {
  ShimOutput out;
  out.port = port_id != nullptr ? port_id : "";
  out.schema_name = schema_name != nullptr ? schema_name : "";
  out.file_identifier = file_identifier != nullptr ? file_identifier : "";
  out.root_type_name = root_type_name != nullptr ? root_type_name : "";
  out.payload = payload_ptr;
  out.payload_length = payload_length;
  out.wire_format = wire_format;
  out.fixed_string_length = fixed_string_length;
  out.byte_length = byte_length;
  out.required_alignment = required_alignment > 0 ? required_alignment : 1;
  g_shim_outputs.push_back(static_cast<ShimOutput &&>(out));
  return 0;
}

extern "C" int32_t plugin_push_output(const char *port_id, const char *schema_name,
                                      const char *file_identifier,
                                      const uint8_t *payload_ptr, uint32_t payload_length) {
  return shim_push_output(
      port_id, schema_name, file_identifier, kFlowFlatbuffer, nullptr,
      0, 0, 1, payload_ptr, payload_length);
}

extern "C" int32_t plugin_push_output_typed(
    const char *port_id, const char *schema_name, const char *file_identifier,
    uint32_t wire_format, const char *root_type_name,
    uint16_t fixed_string_length, uint32_t byte_length,
    uint16_t required_alignment, const uint8_t *payload_ptr,
    uint32_t payload_length) {
  return shim_push_output(
      port_id, schema_name, file_identifier, wire_format, root_type_name,
      fixed_string_length, byte_length, required_alignment,
      payload_ptr, payload_length);
}

extern "C" int32_t plugin_push_output_ex(
    const char *port_id, const char *schema_name, const char *file_identifier,
    uint32_t wire_format, const char *root_type_name,
    uint16_t fixed_string_length, uint16_t required_alignment,
    const uint8_t *payload_ptr, uint32_t payload_length) {
  return shim_push_output(
      port_id, schema_name, file_identifier, wire_format, root_type_name,
      fixed_string_length, payload_length, required_alignment,
      payload_ptr, payload_length);
}

extern "C" int32_t plugin_set_output_frame_id(uint32_t output_index, uint64_t frame_id) {
  if (output_index >= g_shim_outputs.size()) return -1;
  g_shim_outputs[output_index].sequence = frame_id >> 1;
  g_shim_outputs[output_index].end_of_stream = static_cast<int32_t>(frame_id & 1u);
  return 0;
}

extern "C" int32_t plugin_set_output_stream_frame(uint32_t output_index, uint64_t sequence,
                                                  int32_t end_of_stream) {
  if (output_index >= g_shim_outputs.size()) return -1;
  g_shim_outputs[output_index].sequence = sequence;
  g_shim_outputs[output_index].end_of_stream = end_of_stream;
  return 0;
}

extern "C" void plugin_set_yielded(int32_t yielded) { g_shim_yielded = yielded; }

extern "C" void plugin_set_backlog_remaining(uint32_t backlog_remaining) {
  g_shim_backlog_remaining = backlog_remaining;
}

extern "C" void plugin_set_error(const char *error_code, const char *error_message) {
  g_shim_error_code = error_code != nullptr ? error_code : "";
  g_shim_error_message = error_message != nullptr ? error_message : "";
}

static int32_t flow_validate_frame_descriptor(
    const FlowFrameDescriptorC &fd, bool require_active_generation) {
  if (fd.occupied == 0) return 0;
  if (!flow_is_power_of_two(fd.alignment)) return -30;
  if (fd.wire_format > kFlowAlignedBinary || fd.ownership > kFlowTransferred ||
      fd.mutability > kFlowAppendOnly) {
    return -31;
  }
  if (fd.mutability != kFlowImmutable && fd.ownership != kFlowTransferred) {
    return -32;
  }
  if (fd.size > 0 &&
      (fd.offset == 0 || !flow_valid_memory_range(fd.offset, fd.size))) {
    return -33;
  }
  if (fd.size > 0 && fd.offset % fd.alignment != 0) return -34;
  if (!flow_valid_c_string(fd.port_id_ptr)) return -35;
  if (require_active_generation &&
      (g_current_node == kInvalidIndex || fd.ingress_index != g_invocation_generation)) {
    return -36;
  }
  if (fd.wire_format == kFlowAlignedBinary) {
    FlowTypeDescriptorView type_descriptor;
    if (require_active_generation) {
      if (fd.type_descriptor_idx >= FLOW_ROUTE_EDGE_COUNT) return -37;
    } else if (!flow_resolve_type_descriptor(fd.type_descriptor_idx,
                                             &type_descriptor)) {
      return -37;
    }
    if (require_active_generation &&
        !flow_resolve_type_descriptor(fd.type_descriptor_idx,
                                      &type_descriptor)) {
      return -37;
    }
    if (type_descriptor.aligned_eligible == 0 ||
        type_descriptor.aligned_byte_length == 0 ||
        type_descriptor.aligned_required_alignment == 0 ||
        !flow_is_power_of_two(type_descriptor.aligned_required_alignment) ||
        fd.size != type_descriptor.aligned_byte_length ||
        fd.alignment < type_descriptor.aligned_required_alignment ||
        fd.offset % type_descriptor.aligned_required_alignment != 0) {
      return -38;
    }
  }
  return 0;
}

static bool flow_external_frame_id_active(uint64_t frame_id) {
  if (frame_id == 0) return false;
  for (const ExternalFrameLifetime &active : g_active_external_frames) {
    if (active.frame_id == frame_id) return true;
  }
  return false;
}

static void flow_retain_external_frame_id(uint64_t frame_id) {
  if (frame_id == 0) return;
  for (ExternalFrameLifetime &active : g_active_external_frames) {
    if (active.frame_id != frame_id) continue;
    active.references++;
    return;
  }
  g_active_external_frames.push_back({frame_id, 1});
}

static void flow_release_external_frame_id(const QueuedFrame &frame) {
  if (frame.tracks_external_lifetime == 0 || frame.frame_id == 0) return;
  for (size_t index = 0; index < g_active_external_frames.size(); index++) {
    ExternalFrameLifetime &active = g_active_external_frames[index];
    if (active.frame_id != frame.frame_id) continue;
    if (active.references > 1) {
      active.references--;
    } else {
      g_active_external_frames.erase(g_active_external_frames.begin() + index);
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// space_data_module_runtime_* exports
// ---------------------------------------------------------------------------

FLOW_EXPORT uint32_t space_data_module_runtime_get_node_descriptor_count(void) {
  return FLOW_NODE_COUNT;
}
FLOW_EXPORT uint32_t space_data_module_runtime_get_edge_descriptor_count(void) {
  return FLOW_EDGE_COUNT;
}
FLOW_EXPORT uint32_t space_data_module_runtime_get_edge_descriptors(void) {
  return reinterpret_cast<uint32_t>(g_edges);
}
FLOW_EXPORT uint32_t space_data_module_runtime_get_route_edge_descriptor_count(void) {
  return FLOW_ROUTE_EDGE_COUNT;
}
FLOW_EXPORT uint32_t space_data_module_runtime_get_routing_state(void) {
  return reinterpret_cast<uint32_t>(&g_routing_state);
}
FLOW_EXPORT uint32_t space_data_module_runtime_get_current_invocation_generation(void) {
  return g_current_node == kInvalidIndex ? 0 : g_invocation_generation;
}
FLOW_EXPORT uint32_t space_data_module_runtime_get_trigger_descriptor_count(void) {
  return FLOW_TRIGGER_COUNT;
}
FLOW_EXPORT uint32_t space_data_module_runtime_get_dependency_descriptor_count(void) {
  return FLOW_DEP_COUNT;
}

FLOW_EXPORT void space_data_module_runtime_reset_state(void) {
  for (uint32_t n = 0; n < FLOW_NODE_COUNT; n++) {
    g_queues[n].clear();
    memset(&g_node_states[n], 0, sizeof(FlowNodeRuntimeStateC));
  }
  for (uint32_t t = 0; t < FLOW_TRIGGER_COUNT; t++) {
    memset(&g_ingress_states[t], 0, sizeof(FlowIngressRuntimeStateC));
  }
  for (uint32_t index = 0; index < kMaxInvocationFrames; index++) {
    g_current_owned[index] = QueuedFrame();
    memset(&g_current_frames[index], 0, sizeof(FlowFrameDescriptorC));
  }
  g_current_desc = FlowInvocationDescriptorC();
  memset(&g_routing_state, 0, sizeof(g_routing_state));
  g_active_external_frames.clear();
  g_current_node = kInvalidIndex;
  g_ready_cursor = 0;
  g_invocation_generation = 0;
  g_next_frame_id = 1;
#ifdef SDN_FLATSQL_LINKED
  sdn_flatsql_link_reset_refs();
#endif
}

FLOW_EXPORT uint32_t space_data_module_runtime_get_ready_node_index(void) {
  if (g_current_node != kInvalidIndex) return kInvalidIndex;  // invocation open
  return flow_find_ready_node();
}

FLOW_EXPORT int32_t space_data_module_runtime_begin_node_invocation(int32_t node_index,
                                                                    int32_t frame_budget) {
  if (node_index < 0 || static_cast<uint32_t>(node_index) >= FLOW_NODE_COUNT) return -1;
  uint32_t node = static_cast<uint32_t>(node_index);
  uint32_t budget = frame_budget > 0 ? static_cast<uint32_t>(frame_budget) : kMaxInvocationFrames;
  if (budget > kMaxInvocationFrames) budget = kMaxInvocationFrames;

  uint32_t count = 0;
  auto &queue = g_queues[node];
  while (count < budget && !queue.empty()) {
    g_current_owned[count] = static_cast<QueuedFrame &&>(queue.front());
    queue.erase(queue.begin());
    count++;
  }
  g_invocation_generation++;
  if (g_invocation_generation == 0) g_invocation_generation = 1;
  for (uint32_t i = 0; i < count; i++) {
    FlowFrameDescriptorC &fd = g_current_frames[i];
    memset(&fd, 0, sizeof(fd));
    fd.ingress_index = g_invocation_generation;
    fd.type_descriptor_idx = g_current_owned[i].type_descriptor_idx;
    fd.port_id_ptr = reinterpret_cast<uint32_t>(g_current_owned[i].port.c_str());
    fd.alignment = g_current_owned[i].alignment;
    fd.offset = reinterpret_cast<uint32_t>(g_current_owned[i].data());
    fd.size = g_current_owned[i].payload_size;
    fd.stream_id = g_current_owned[i].stream_id;
    fd.sequence = g_current_owned[i].sequence;
    fd.trace_token = g_current_owned[i].frame_id;
    fd.end_of_stream = g_current_owned[i].end_of_stream;
    fd.occupied = 1;
    fd.wire_format = g_current_owned[i].wire_format;
    fd.ownership = g_current_owned[i].ownership;
    fd.mutability = g_current_owned[i].mutability;
    fd.lifetime = 1;
  }

  const FlowNodeDispatchDescriptorC &dd = g_dispatch_descriptors[node];
  g_current_desc.node_index = node;
  g_current_desc.dispatch_descriptor_idx = node;
  g_current_desc.plugin_id_ptr = dd.plugin_id_ptr;
  g_current_desc.method_id_ptr = dd.method_id_ptr;
  g_current_desc.frames_ptr = count > 0 ? reinterpret_cast<uint32_t>(&g_current_frames[0]) : 0;
  g_current_desc.frame_count = count;
  g_current_node = node;

  g_node_states[node].queued_frames = static_cast<uint32_t>(queue.size());
  g_node_states[node].ready = flow_node_is_ready(node) ? 1 : 0;
  return static_cast<int32_t>(count);
}

FLOW_EXPORT uint32_t space_data_module_runtime_get_current_invocation_descriptor(void) {
  if (g_current_node == kInvalidIndex) return 0;
  return reinterpret_cast<uint32_t>(&g_current_desc);
}

FLOW_EXPORT int32_t space_data_module_runtime_apply_node_invocation_result(
    int32_t node_index, int32_t status_code, int32_t backlog_remaining, int32_t yielded,
    int32_t frames_ptr, int32_t frame_count) {
  if (node_index < 0 || static_cast<uint32_t>(node_index) >= FLOW_NODE_COUNT) return -40;
  uint32_t node = static_cast<uint32_t>(node_index);
  if (g_current_node == kInvalidIndex || g_current_node != node) return -41;
  if (frame_count < 0 || frame_count > static_cast<int32_t>(kMaxInvocationFrames)) return -42;
  if (frame_count > 0 &&
      (frames_ptr <= 0 ||
       !flow_valid_memory_range(static_cast<uint32_t>(frames_ptr),
                                static_cast<uint32_t>(frame_count) *
                                    sizeof(FlowFrameDescriptorC)))) {
    return -43;
  }
  uint32_t routed = 0;
  const FlowFrameDescriptorC *frames = reinterpret_cast<const FlowFrameDescriptorC *>(frames_ptr);
  for (int32_t i = 0; i < frame_count; i++) {
    const FlowFrameDescriptorC &fd = frames[i];
    if (!fd.occupied) continue;
    const int32_t validation = flow_validate_frame_descriptor(fd, true);
    if (validation < 0) {
      g_routing_state.rejected_frames++;
      return validation;
    }
    const char *port = fd.port_id_ptr != 0 ? reinterpret_cast<const char *>(fd.port_id_ptr) : "";
    FlowOutputFrameView output;
    output.port = port;
    output.payload = reinterpret_cast<const uint8_t *>(fd.offset);
    output.length = fd.size;
    output.wire_format = fd.wire_format;
    output.alignment = fd.alignment;
    output.stream_id = fd.stream_id;
    output.sequence = fd.sequence;
    output.frame_id = fd.trace_token;
    output.end_of_stream = fd.end_of_stream;
    output.ownership = fd.ownership;
    output.mutability = fd.mutability;
    if (fd.type_descriptor_idx < FLOW_ROUTE_EDGE_COUNT) {
      const FlowEdge &edge = g_edges[fd.type_descriptor_idx];
      output.schema_name = edge.schema_name;
      output.file_identifier = edge.file_identifier;
      output.root_type_name = edge.root_type_name;
      output.byte_length = edge.aligned_byte_length;
      output.fixed_string_length = edge.aligned_fixed_string_length;
      output.required_alignment = edge.aligned_required_alignment;
    }
    const int32_t route_count = route_output(node, output);
    if (route_count < 0) return route_count;
    routed += static_cast<uint32_t>(route_count);
  }
  g_node_states[node].invocation_count++;
  g_node_states[node].consumed_frames += g_current_desc.frame_count;
  g_node_states[node].backlog_remaining = static_cast<uint32_t>(backlog_remaining);
  g_node_states[node].last_status = static_cast<uint32_t>(status_code);
  g_node_states[node].yielded = yielded != 0 ? 1 : 0;
  g_node_states[node].ready = flow_node_is_ready(node) ? 1 : 0;
  return static_cast<int32_t>(routed);
}

FLOW_EXPORT void space_data_module_runtime_complete_node_invocation(int32_t node_index) {
  (void)node_index;
  if (g_current_node == kInvalidIndex) return;
  const uint32_t completed_node = g_current_node;
  for (uint32_t i = 0; i < g_current_desc.frame_count; i++) {
    flow_release_external_frame_id(g_current_owned[i]);
    g_current_owned[i] = QueuedFrame();
  }
  g_current_desc = FlowInvocationDescriptorC();
  g_current_node = kInvalidIndex;
  g_ready_cursor = (completed_node + 1u) % FLOW_NODE_COUNT;
}

static void flow_enqueue_binding(const FlowTriggerBinding &binding,
                                 const FlowFrameDescriptorC *descriptor) {
  QueuedFrame frame;
  frame.port = binding.port;
  if (descriptor != nullptr) {
    const uint8_t *payload = descriptor->size > 0
                                 ? reinterpret_cast<const uint8_t *>(descriptor->offset)
                                 : nullptr;
    frame.payload_size = descriptor->size;
    frame.type_descriptor_idx = binding.type_descriptor_idx;
    frame.alignment = descriptor->alignment;
    frame.stream_id = descriptor->stream_id;
    frame.sequence = descriptor->sequence;
    frame.end_of_stream = descriptor->end_of_stream;
    frame.frame_id = descriptor->trace_token != 0
                         ? descriptor->trace_token
                         : g_next_frame_id++;
    frame.tracks_external_lifetime = descriptor->trace_token != 0 ? 1 : 0;
    frame.wire_format = descriptor->wire_format;
    frame.ownership = kFlowHostOwned;
    frame.mutability = kFlowImmutable;
    if (descriptor->wire_format == kFlowAlignedBinary) {
      FlowTypeDescriptorView type_descriptor;
      if (flow_resolve_type_descriptor(frame.type_descriptor_idx,
                                       &type_descriptor)) {
        frame.byte_length = type_descriptor.aligned_byte_length;
        frame.fixed_string_length = type_descriptor.aligned_fixed_string_length;
        frame.required_alignment = type_descriptor.aligned_required_alignment;
      }
    }
    frame.storage = flow_copy_payload(
        payload, descriptor->size, descriptor->alignment, &frame.payload_offset);
  } else {
    frame.type_descriptor_idx = binding.type_descriptor_idx;
    frame.frame_id = g_next_frame_id++;
    frame.storage = flow_copy_payload(nullptr, 0, 1, &frame.payload_offset);
  }
  g_queues[binding.target_node].push_back(static_cast<QueuedFrame &&>(frame));
  if (descriptor != nullptr && descriptor->trace_token != 0) {
    flow_retain_external_frame_id(descriptor->trace_token);
  }
  g_node_states[binding.target_node].queued_frames =
      static_cast<uint32_t>(g_queues[binding.target_node].size());
  g_node_states[binding.target_node].ready =
      flow_node_is_ready(binding.target_node) ? 1 : 0;
}

FLOW_EXPORT void space_data_module_runtime_enqueue_trigger_frames(int32_t trigger_index) {
  if (trigger_index < 0 || static_cast<uint32_t>(trigger_index) >= FLOW_TRIGGER_COUNT) return;
  for (uint32_t b = 0; b < FLOW_TRIGGER_BINDING_COUNT; b++) {
    if (g_trigger_bindings[b].trigger_index != static_cast<uint32_t>(trigger_index)) continue;
    flow_enqueue_binding(g_trigger_bindings[b], nullptr);
  }
  g_ingress_states[trigger_index].total_received++;
  g_ingress_states[trigger_index].queued_frames++;
}

FLOW_EXPORT int32_t space_data_module_runtime_enqueue_trigger_frame(int32_t trigger_index,
                                                                    int32_t frame_ptr) {
  if (trigger_index < 0 || static_cast<uint32_t>(trigger_index) >= FLOW_TRIGGER_COUNT) return -50;
  if (frame_ptr == 0) {
    space_data_module_runtime_enqueue_trigger_frames(trigger_index);
    return 0;
  }
  if (frame_ptr < 0 ||
      !flow_valid_memory_range(static_cast<uint32_t>(frame_ptr),
                               sizeof(FlowFrameDescriptorC))) {
    g_routing_state.rejected_frames++;
    return -51;
  }
  const FlowFrameDescriptorC *fd = reinterpret_cast<const FlowFrameDescriptorC *>(frame_ptr);
  const int32_t validation = flow_validate_frame_descriptor(*fd, false);
  if (validation < 0) {
    g_routing_state.rejected_frames++;
    return validation;
  }
  if (fd->trace_token != 0 && flow_external_frame_id_active(fd->trace_token)) {
    g_routing_state.rejected_frames++;
    return -52;
  }
  if (fd->size > 0 && fd->type_descriptor_idx == kInvalidIndex) {
    FlowTypeDescriptorView common_type;
    bool common_type_set = false;
    for (uint32_t b = 0; b < FLOW_TRIGGER_BINDING_COUNT; b++) {
      if (g_trigger_bindings[b].trigger_index !=
          static_cast<uint32_t>(trigger_index)) {
        continue;
      }
      FlowTypeDescriptorView binding_type;
      if (!flow_resolve_type_descriptor(
              g_trigger_bindings[b].type_descriptor_idx, &binding_type) ||
          (common_type_set &&
           !flow_type_identity_equal(common_type, binding_type))) {
        g_routing_state.rejected_frames++;
        return -54;
      }
      if (!common_type_set) {
        common_type = binding_type;
        common_type_set = true;
      }
    }
  }
  for (uint32_t b = 0; b < FLOW_TRIGGER_BINDING_COUNT; b++) {
    if (g_trigger_bindings[b].trigger_index !=
        static_cast<uint32_t>(trigger_index)) {
      continue;
    }
    if (fd->type_descriptor_idx != kInvalidIndex &&
        !flow_binding_accepts_descriptor(b, fd->type_descriptor_idx,
                                         fd->wire_format)) {
      g_routing_state.rejected_frames++;
      return -53;
    }
  }
  uint32_t enqueued = 0;
  for (uint32_t b = 0; b < FLOW_TRIGGER_BINDING_COUNT; b++) {
    if (g_trigger_bindings[b].trigger_index != static_cast<uint32_t>(trigger_index)) continue;
    flow_enqueue_binding(g_trigger_bindings[b], fd);
    enqueued++;
  }
  g_ingress_states[trigger_index].total_received++;
  g_ingress_states[trigger_index].queued_frames++;
  return static_cast<int32_t>(enqueued);
}

FLOW_EXPORT uint32_t space_data_module_runtime_get_node_dispatch_descriptors(void) {
  return reinterpret_cast<uint32_t>(&g_dispatch_descriptors[0]);
}

FLOW_EXPORT uint32_t space_data_module_runtime_get_dependency_descriptors(void) {
#if FLOW_DEP_COUNT > 0
  return reinterpret_cast<uint32_t>(&g_dependency_descriptors[0]);
#else
  return 0;
#endif
}

FLOW_EXPORT uint32_t space_data_module_runtime_get_node_states(void) {
  return reinterpret_cast<uint32_t>(&g_node_states[0]);
}

FLOW_EXPORT uint32_t space_data_module_runtime_get_ingress_states(void) {
#if FLOW_TRIGGER_COUNT > 0
  return reinterpret_cast<uint32_t>(&g_ingress_states[0]);
#else
  return 0;
#endif
}

FLOW_EXPORT int32_t space_data_module_runtime_dispatch_current_invocation_direct(
    int32_t frame_budget);

// In-wasm scheduler loop (loop C.5c): run every ready LINKED-DIRECT node to
// completion inside one host call — ready-node selection, invocation
// begin/dispatch/complete, and frame routing all stay in this module's
// linear memory instead of costing 3-4 host<->wasm round-trips per node.
// Returns the number of linked dispatches performed and stops (without
// consuming it) at the first ready node that is NOT linked (host-model,
// e.g. the egress sink) so the host loop handles it — node order is
// identical to the host-driven loop (first ready by index). Hosts probe for
// this export and fall back to per-node driving when absent (older
// artifacts).
FLOW_EXPORT int32_t space_data_module_runtime_drain_linked(int32_t max_iterations) {
  if (g_current_node != kInvalidIndex) return -1;  // invocation open
  if (max_iterations == 0) return 0;               // presence probe
  int32_t budget = max_iterations > 0 ? max_iterations : 1024;
  int32_t dispatched = 0;
  for (int32_t i = 0; i < budget; i++) {
    const uint32_t node = flow_find_ready_node();
    if (node == kInvalidIndex || !flow_node_is_linked(node)) break;
    if (space_data_module_runtime_begin_node_invocation(static_cast<int32_t>(node), 64) < 0) {
      space_data_module_runtime_complete_node_invocation(static_cast<int32_t>(node));
      break;
    }
    space_data_module_runtime_dispatch_current_invocation_direct(64);
    space_data_module_runtime_complete_node_invocation(static_cast<int32_t>(node));
    dispatched++;
  }
  return dispatched;
}

// Linked-direct dispatch: run the current node's linked guest-link entry over
// the current invocation frames — all inside this module's linear memory.
FLOW_EXPORT int32_t space_data_module_runtime_dispatch_current_invocation_direct(
    int32_t frame_budget) {
  (void)frame_budget;
  if (g_current_node == kInvalidIndex) return -1;
  uint32_t node = g_current_node;
  if (!flow_node_is_linked(node)) return -2;

  g_shim_inputs.clear();
  for (uint32_t i = 0; i < g_current_desc.frame_count; i++) {
    const QueuedFrame &owned = g_current_owned[i];
    plugin_input_frame_t input;
    memset(&input, 0, sizeof(input));
    input.port_id = owned.port.c_str();
    FlowTypeDescriptorView type_descriptor;
    if (flow_resolve_type_descriptor(owned.type_descriptor_idx,
                                     &type_descriptor)) {
      input.schema_name = type_descriptor.schema_name;
      input.file_identifier = type_descriptor.file_identifier;
      input.root_type_name = type_descriptor.root_type_name;
      input.schema_version = type_descriptor.schema_version;
      input.schema_hash = type_descriptor.schema_hash;
      input.schema_hash_length = type_descriptor.schema_hash_size;
    }
    input.payload = owned.data();
    input.payload_length = owned.payload_size;
    input.fixed_string_length = static_cast<uint16_t>(owned.fixed_string_length);
    input.byte_length = owned.byte_length;
    input.size = owned.payload_size;
    input.generation = g_invocation_generation;
    input.alignment = static_cast<uint16_t>(owned.alignment);
    input.required_alignment = static_cast<uint16_t>(owned.required_alignment);
    input.wire_format = owned.wire_format;
    input.trace_id = owned.frame_id;
    input.stream_id = owned.stream_id;
    input.sequence = owned.sequence;
    input.end_of_stream = owned.end_of_stream != 0 ? 1 : 0;
    input.ownership = owned.ownership;
    input.mutability = owned.mutability;
    input.frame_id = owned.frame_id;
    g_shim_inputs.push_back(input);
  }
  plugin_reset_output_state();

  int32_t status = flow_call_entry(node);

  uint32_t routed = 0;
  for (const ShimOutput &out : g_shim_outputs) {
    FlowOutputFrameView output;
    output.port = out.port.c_str();
    output.schema_name = out.schema_name.c_str();
    output.file_identifier = out.file_identifier.c_str();
    output.root_type_name = out.root_type_name.c_str();
    output.payload = out.payload;
    output.length = out.payload_length;
    output.wire_format = out.wire_format;
    output.fixed_string_length = out.fixed_string_length;
    output.byte_length = out.byte_length;
    output.required_alignment = out.required_alignment;
    output.alignment = out.required_alignment;
    output.sequence = static_cast<uint32_t>(out.sequence);
    output.frame_id = (out.sequence << 1) |
                      (out.end_of_stream != 0 ? 1ull : 0ull);
    output.end_of_stream = out.end_of_stream != 0 ? 1 : 0;
    output.ownership = kFlowPluginOwned;
    output.mutability = kFlowImmutable;
    const int32_t route_count = route_output(node, output);
    if (route_count < 0) {
      status = route_count;
      break;
    }
    routed += static_cast<uint32_t>(route_count);
  }
  g_node_states[node].invocation_count++;
  g_node_states[node].consumed_frames += g_current_desc.frame_count;
  g_node_states[node].last_status = static_cast<uint32_t>(status);
  g_node_states[node].yielded = g_shim_yielded != 0 ? 1 : 0;
  g_node_states[node].backlog_remaining = g_shim_backlog_remaining;
  g_node_states[node].ready = flow_node_is_ready(node) ? 1 : 0;
  g_shim_inputs.clear();
  return static_cast<int32_t>(routed);
}

#ifdef SDN_FLATSQL_LINKED
// ============================================================================
// Direct FlatSQL engine linkage (loop C.7 — the B-iv end state).
//
// Compiled ONLY into linked-mode flows (`flow.engineLinkage == "flatsql"`).
// The artifact imports the live store engine's FUNCTION exports from module
// "flatsql" (scalars cross instances fine) and crosses the memory boundary
// through the tiny flatsql_link shim (src/flow/flatsqlLinkShim.js), whose
// memory IS the engine memory. Query submission therefore never touches the
// hostcall bridge: SQL text + TLV params are poked into engine-malloc'd
// space, flatsql_query_raw_flatbuffer_stream runs as a direct in-wasm call,
// and the materialized aligned stream stays in ENGINE memory.
//
// Result delivery keeps the loop C.5c body-reference contract: the guest
// registers the engine artifact in the exported engine-ref table below and
// forwards a {"$sdnbodyref":1,...} descriptor whose token carries the "SDNE"
// magic. The host resolves the token AFTER the linked drain, while it still
// holds the store engine lock (mirror hit = zero copies warm; miss = one
// engine->host copy verified against the descriptor's fnv1a64).
//
// Concurrency contract (docs/flatsql-component-linkage.md section 4.1 item
// 4): the engine is SQLITE_THREADSAFE=0 — the HOST must hold the store
// engine lock for the whole linked drain that reaches these calls.
// ============================================================================

#define FSL_IMPORT(mod, name) \
  extern "C" __attribute__((import_module(mod), import_name(name)))

FSL_IMPORT("flatsql", "malloc") uint32_t fsl_engine_malloc(uint32_t size);
FSL_IMPORT("flatsql", "free") void fsl_engine_free(uint32_t ptr);
FSL_IMPORT("flatsql", "flatsql_query_raw_flatbuffer_stream")
int32_t fsl_engine_query_raw(int32_t handle, uint32_t sql_ptr, uint32_t param_ptr,
                             uint32_t param_len, int32_t param_count);
FSL_IMPORT("flatsql", "flatsql_response_artifact_data") uint32_t fsl_engine_artifact_data(void);
FSL_IMPORT("flatsql", "flatsql_response_artifact_size") int32_t fsl_engine_artifact_size(void);
FSL_IMPORT("flatsql", "flatsql_response_artifact_row_count") double fsl_engine_artifact_rows(void);
FSL_IMPORT("flatsql", "flatsql_response_artifact_column_count") double fsl_engine_artifact_cols(void);
FSL_IMPORT("flatsql", "flatsql_response_artifact_cache_hit") int32_t fsl_engine_artifact_cache_hit(void);
FSL_IMPORT("flatsql", "flatsql_query_cache_generation") double fsl_engine_generation(int32_t handle);
FSL_IMPORT("flatsql", "flatsql_get_error") uint32_t fsl_engine_get_error(void);
FSL_IMPORT("flatsql_link", "peek8") uint32_t fsl_link_peek8(uint32_t addr);
FSL_IMPORT("flatsql_link", "peek64") uint64_t fsl_link_peek64(uint32_t addr);
FSL_IMPORT("flatsql_link", "poke8") void fsl_link_poke8(uint32_t addr, uint32_t value);
FSL_IMPORT("flatsql_link", "fnv1a64") uint64_t fsl_link_fnv1a64(uint32_t addr, uint32_t len);
FSL_IMPORT("flatsql_link", "count_frames") int32_t fsl_link_count_frames(uint32_t addr, uint32_t len);

// ABI struct shared with guest-link objects compiled -DSDN_FLATSQL_LINKED
// (e.g. data-source/retrieval). Field order/sizes are load-bearing.
struct SdnFlatsqlLinkedResult {
  uint64_t generation;
  uint64_t fnv1a64;
  uint64_t token;  // engine body-ref token (0 unless want_ref)
  uint32_t engine_ptr;
  uint32_t size;
  int32_t rows;
  int32_t cols;
  int32_t cache_hit;
  int32_t frames;
};
static_assert(sizeof(SdnFlatsqlLinkedResult) == 48, "SdnFlatsqlLinkedResult must be 48 bytes");

// Engine body-reference table read by the host after each linked drain.
// Layout mirrors flatsqlLinkShim.js readEngineRefEntry (40 bytes LE).
struct SdnEngineRefEntry {
  uint64_t token;
  uint64_t generation;
  uint64_t fnv1a64;
  uint32_t engine_ptr;
  uint32_t size;
  uint32_t frames;
  uint32_t used;
};
static_assert(sizeof(SdnEngineRefEntry) == 40, "SdnEngineRefEntry must be 40 bytes");

static constexpr uint32_t kSdnEngineRefSlots = 8;
static constexpr uint64_t kSdnEngineRefTokenMagic = 0x53444E45ull << 32;  // "SDNE"

static SdnEngineRefEntry g_engine_refs[kSdnEngineRefSlots];
static uint64_t g_engine_ref_counter = 0;
static int32_t g_fsl_db_handle = 0;
static char g_fsl_error[512];

static void sdn_flatsql_link_reset_refs(void) {
  memset(g_engine_refs, 0, sizeof(g_engine_refs));
}

// Host wiring exports: the host sets the store db handle after instantiation
// and reads the ref table (in this module's memory) after linked drains.
FLOW_EXPORT void sdn_flatsql_link_init(int32_t db_handle) { g_fsl_db_handle = db_handle; }
FLOW_EXPORT uint32_t sdn_flatsql_link_ref_table(void) {
  return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(&g_engine_refs[0]));
}
FLOW_EXPORT uint32_t sdn_flatsql_link_ref_slots(void) { return kSdnEngineRefSlots; }

extern "C" uint32_t sdn_flatsql_linked_available(void) { return g_fsl_db_handle != 0 ? 1u : 0u; }
extern "C" const char *sdn_flatsql_linked_error(void) { return g_fsl_error; }

static void fsl_set_error_from_engine(const char *fallback) {
  uint32_t ptr = fsl_engine_get_error();
  uint32_t i = 0;
  if (ptr != 0) {
    for (; i < sizeof(g_fsl_error) - 1; i++) {
      uint32_t b = fsl_link_peek8(ptr + i);
      if (b == 0) break;
      g_fsl_error[i] = static_cast<char>(b);
    }
  }
  if (i == 0 && fallback != nullptr) {
    strncpy(g_fsl_error, fallback, sizeof(g_fsl_error) - 1);
    i = static_cast<uint32_t>(strlen(g_fsl_error));
  }
  g_fsl_error[i] = '\0';
}

static void fsl_copy_to_engine(uint32_t dst, const uint8_t *src, uint32_t len) {
  for (uint32_t i = 0; i < len; i++) fsl_link_poke8(dst + i, src[i]);
}

// Copy engine memory into this module's memory (byte path: json branch,
// error strings). 8-byte strides through the shim keep the call count low.
extern "C" int32_t sdn_flatsql_linked_read(uint8_t *dst, uint32_t engine_ptr, uint32_t len) {
  uint32_t i = 0;
  for (; i + 8 <= len; i += 8) {
    uint64_t w = fsl_link_peek64(engine_ptr + i);
    memcpy(dst + i, &w, 8);
  }
  for (; i < len; i++) dst[i] = static_cast<uint8_t>(fsl_link_peek8(engine_ptr + i));
  return 0;
}

// Local FNV-1a 64 over FLOW memory (identity keys for the etag cache below —
// never crosses the wire, does not need the word-folded shape).
static uint64_t fsl_local_fnv(const uint8_t *data, uint32_t len) {
  uint64_t hash = 1469598103934665603ull;
  for (uint32_t i = 0; i < len; i++) {
    hash ^= data[i];
    hash *= 1099511628211ull;
  }
  return hash;
}

// Etag/frame-count cache: hashing the (possibly multi-MB) engine artifact
// happens ONCE per (query identity, engine generation); warm requests reuse
// the cached fnv1a64/frames with zero rehashing (the same staleness authority
// the host mirror uses — the engine's own generation counter).
struct FslEtagCacheEntry {
  uint64_t key_sql;
  uint64_t key_params;
  uint64_t generation;
  uint64_t fnv;
  int32_t frames;
  uint32_t valid;
};
static constexpr uint32_t kFslEtagCacheSlots = 8;
static FslEtagCacheEntry g_fsl_etag_cache[kFslEtagCacheSlots];
static uint32_t g_fsl_etag_next = 0;

// Submit a raw-stream query DIRECTLY to the linked engine instance.
// Returns 0 on success; negative on failure (message via
// sdn_flatsql_linked_error). want_ref != 0 additionally computes the
// fnv1a64/frame metadata and registers an engine body-ref token.
extern "C" int32_t sdn_flatsql_linked_query_raw_stream(
    const char *sql, uint32_t sql_len, const uint8_t *params_tlv, uint32_t tlv_len,
    uint32_t param_count, int32_t want_ref, SdnFlatsqlLinkedResult *out) {
  g_fsl_error[0] = '\0';
  if (out == nullptr) return -1;
  memset(out, 0, sizeof(*out));
  if (g_fsl_db_handle == 0) {
    strncpy(g_fsl_error, "flatsql linkage not initialized (sdn_flatsql_link_init not called)",
            sizeof(g_fsl_error) - 1);
    return -2;
  }

  uint32_t sql_ptr = fsl_engine_malloc(sql_len + 1);
  if (sql_ptr == 0) {
    strncpy(g_fsl_error, "engine malloc failed for sql", sizeof(g_fsl_error) - 1);
    return -3;
  }
  fsl_copy_to_engine(sql_ptr, reinterpret_cast<const uint8_t *>(sql), sql_len);
  fsl_link_poke8(sql_ptr + sql_len, 0);

  uint32_t tlv_ptr = 0;
  if (tlv_len > 0) {
    tlv_ptr = fsl_engine_malloc(tlv_len);
    if (tlv_ptr == 0) {
      fsl_engine_free(sql_ptr);
      strncpy(g_fsl_error, "engine malloc failed for params", sizeof(g_fsl_error) - 1);
      return -3;
    }
    fsl_copy_to_engine(tlv_ptr, params_tlv, tlv_len);
  }

  const int32_t ok = fsl_engine_query_raw(g_fsl_db_handle, sql_ptr, tlv_ptr, tlv_len,
                                          static_cast<int32_t>(param_count));
  fsl_engine_free(sql_ptr);
  if (tlv_ptr != 0) fsl_engine_free(tlv_ptr);
  if (ok == 0) {
    fsl_set_error_from_engine("flatsql_query_raw_flatbuffer_stream failed");
    return -4;
  }

  out->engine_ptr = fsl_engine_artifact_data();
  out->size = static_cast<uint32_t>(fsl_engine_artifact_size());
  out->rows = static_cast<int32_t>(fsl_engine_artifact_rows());
  out->cols = static_cast<int32_t>(fsl_engine_artifact_cols());
  out->cache_hit = fsl_engine_artifact_cache_hit();
  out->generation = static_cast<uint64_t>(fsl_engine_generation(g_fsl_db_handle));

  if (want_ref != 0) {
    const uint64_t key_sql = fsl_local_fnv(reinterpret_cast<const uint8_t *>(sql), sql_len);
    const uint64_t key_params = tlv_len > 0 ? fsl_local_fnv(params_tlv, tlv_len) : 0;
    FslEtagCacheEntry *hit = nullptr;
    for (uint32_t i = 0; i < kFslEtagCacheSlots; i++) {
      FslEtagCacheEntry &entry = g_fsl_etag_cache[i];
      if (entry.valid && entry.key_sql == key_sql && entry.key_params == key_params &&
          entry.generation == out->generation) {
        hit = &entry;
        break;
      }
    }
    if (hit != nullptr) {
      out->fnv1a64 = hit->fnv;
      out->frames = hit->frames;
    } else {
      out->fnv1a64 = fsl_link_fnv1a64(out->engine_ptr, out->size);
      out->frames = fsl_link_count_frames(out->engine_ptr, out->size);
      FslEtagCacheEntry &slot = g_fsl_etag_cache[g_fsl_etag_next % kFslEtagCacheSlots];
      g_fsl_etag_next++;
      slot.key_sql = key_sql;
      slot.key_params = key_params;
      slot.generation = out->generation;
      slot.fnv = out->fnv1a64;
      slot.frames = out->frames;
      slot.valid = 1;
    }

    g_engine_ref_counter++;
    const uint64_t token = kSdnEngineRefTokenMagic | (g_engine_ref_counter & 0xFFFFFFFFull);
    SdnEngineRefEntry &ref = g_engine_refs[g_engine_ref_counter % kSdnEngineRefSlots];
    ref.token = token;
    ref.generation = out->generation;
    ref.fnv1a64 = out->fnv1a64;
    ref.engine_ptr = out->engine_ptr;
    ref.size = out->size;
    ref.frames = static_cast<uint32_t>(out->frames < 0 ? 0 : out->frames);
    ref.used = 1;
    out->token = token;
  }
  return 0;
}
#endif  // SDN_FLATSQL_LINKED
