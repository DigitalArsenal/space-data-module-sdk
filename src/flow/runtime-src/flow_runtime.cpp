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
#include <vector>

#include "space_data_module_invoke.h"

#define FLOW_EXPORT extern "C" __attribute__((visibility("default")))

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
  uint8_t _pad[6];
};
static_assert(sizeof(FlowFrameDescriptorC) == 48, "FlowFrameDescriptor must be 48 bytes");

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
//   FLOW_NODE_COUNT / FLOW_EDGE_COUNT / FLOW_TRIGGER_COUNT / FLOW_DEP_COUNT
//   FLOW_TRIGGER_BINDING_COUNT / FLOW_REQUIRED_PORT_COUNT
//   g_dispatch_descriptors[] / g_dependency_descriptors[]
//   FlowEdge g_edges[]                  (from_node, from_port, to_node, to_port)
//   FlowTriggerBinding g_trigger_bindings[] (trigger_index, target_node, port)
//   FlowRequiredPort g_required_ports[]     (node_index, port_id)
//   flow_call_entry(node_index) — linked-direct entry dispatch switch
//   flow_node_is_linked(node_index)
// ---------------------------------------------------------------------------

struct FlowEdge {
  uint32_t from_node;
  const char *from_port;
  uint32_t to_node;
  const char *to_port;
};

struct FlowTriggerBinding {
  uint32_t trigger_index;
  uint32_t target_node;
  const char *port;
};

struct FlowRequiredPort {
  uint32_t node_index;
  const char *port_id;
};

#include "flow_generated.inc"

// ---------------------------------------------------------------------------
// Scheduler state
// ---------------------------------------------------------------------------

struct QueuedFrame {
  std::string port;
  std::vector<uint8_t> payload;
  uint32_t stream_id = 0;
  uint32_t sequence = 0;
  uint8_t end_of_stream = 0;
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

// Readiness: a node is ready when it has queued frames AND every required
// input port of its bound method (compiled in from the dependency manifest)
// has at least one queued frame. Host-model nodes have no required-port rows
// and fire on any queued frame.
static bool flow_node_is_ready(uint32_t node) {
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

static void route_output(uint32_t from_node, const char *port, const uint8_t *payload,
                         uint32_t length, uint32_t stream_id, uint32_t sequence,
                         uint8_t end_of_stream) {
  for (uint32_t e = 0; e < FLOW_EDGE_COUNT; e++) {
    if (g_edges[e].from_node != from_node) continue;
    if (strcmp(g_edges[e].from_port, port) != 0) continue;
    QueuedFrame frame;
    frame.port = g_edges[e].to_port;
    frame.payload.assign(payload, payload + length);
    frame.stream_id = stream_id;
    frame.sequence = sequence;
    frame.end_of_stream = end_of_stream;
    uint32_t to = g_edges[e].to_node;
    g_queues[to].push_back(static_cast<QueuedFrame &&>(frame));
    g_node_states[to].queued_frames = static_cast<uint32_t>(g_queues[to].size());
    g_node_states[to].ready = flow_node_is_ready(to) ? 1 : 0;
  }
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
  std::vector<uint8_t> payload;
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

static int32_t shim_push_output(const char *port_id, const uint8_t *payload_ptr,
                                uint32_t payload_length) {
  ShimOutput out;
  out.port = port_id != nullptr ? port_id : "";
  if (payload_ptr != nullptr && payload_length > 0) {
    out.payload.assign(payload_ptr, payload_ptr + payload_length);
  }
  g_shim_outputs.push_back(static_cast<ShimOutput &&>(out));
  return 0;
}

extern "C" int32_t plugin_push_output(const char *port_id, const char *, const char *,
                                      const uint8_t *payload_ptr, uint32_t payload_length) {
  return shim_push_output(port_id, payload_ptr, payload_length);
}

extern "C" int32_t plugin_push_output_typed(
    const char *port_id, const char *, const char *, uint32_t, const char *,
    uint16_t, uint32_t, uint16_t, const uint8_t *payload_ptr, uint32_t payload_length) {
  return shim_push_output(port_id, payload_ptr, payload_length);
}

extern "C" int32_t plugin_push_output_ex(
    const char *port_id, const char *, const char *, uint32_t, const char *,
    uint16_t, uint16_t, const uint8_t *payload_ptr, uint32_t payload_length) {
  return shim_push_output(port_id, payload_ptr, payload_length);
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

// ---------------------------------------------------------------------------
// space_data_module_runtime_* exports
// ---------------------------------------------------------------------------

FLOW_EXPORT uint32_t space_data_module_runtime_get_node_descriptor_count(void) {
  return FLOW_NODE_COUNT;
}
FLOW_EXPORT uint32_t space_data_module_runtime_get_edge_descriptor_count(void) {
  return FLOW_EDGE_COUNT;
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
  g_current_node = kInvalidIndex;
}

FLOW_EXPORT uint32_t space_data_module_runtime_get_ready_node_index(void) {
  if (g_current_node != kInvalidIndex) return kInvalidIndex;  // invocation open
  for (uint32_t n = 0; n < FLOW_NODE_COUNT; n++) {
    if (flow_node_is_ready(n)) return n;
  }
  return kInvalidIndex;
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
  for (uint32_t i = 0; i < count; i++) {
    FlowFrameDescriptorC &fd = g_current_frames[i];
    memset(&fd, 0, sizeof(fd));
    fd.port_id_ptr = reinterpret_cast<uint32_t>(g_current_owned[i].port.c_str());
    fd.alignment = 1;
    fd.offset = reinterpret_cast<uint32_t>(g_current_owned[i].payload.data());
    fd.size = static_cast<uint32_t>(g_current_owned[i].payload.size());
    fd.stream_id = g_current_owned[i].stream_id;
    fd.sequence = g_current_owned[i].sequence;
    fd.end_of_stream = g_current_owned[i].end_of_stream;
    fd.occupied = 1;
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

FLOW_EXPORT uint32_t space_data_module_runtime_apply_node_invocation_result(
    int32_t node_index, int32_t status_code, int32_t backlog_remaining, int32_t yielded,
    int32_t frames_ptr, int32_t frame_count) {
  if (node_index < 0 || static_cast<uint32_t>(node_index) >= FLOW_NODE_COUNT) return 0;
  uint32_t node = static_cast<uint32_t>(node_index);
  uint32_t routed = 0;
  const FlowFrameDescriptorC *frames = reinterpret_cast<const FlowFrameDescriptorC *>(frames_ptr);
  for (int32_t i = 0; i < frame_count; i++) {
    const FlowFrameDescriptorC &fd = frames[i];
    if (!fd.occupied) continue;
    const char *port = fd.port_id_ptr != 0 ? reinterpret_cast<const char *>(fd.port_id_ptr) : "";
    const uint8_t *payload = reinterpret_cast<const uint8_t *>(fd.offset);
    route_output(node, port, payload, fd.size, fd.stream_id, fd.sequence, fd.end_of_stream);
    routed++;
  }
  g_node_states[node].invocation_count++;
  g_node_states[node].consumed_frames += g_current_desc.frame_count;
  g_node_states[node].backlog_remaining = static_cast<uint32_t>(backlog_remaining);
  g_node_states[node].last_status = static_cast<uint32_t>(status_code);
  g_node_states[node].yielded = yielded != 0 ? 1 : 0;
  return routed;
}

FLOW_EXPORT void space_data_module_runtime_complete_node_invocation(int32_t node_index) {
  (void)node_index;
  if (g_current_node == kInvalidIndex) return;
  for (uint32_t i = 0; i < g_current_desc.frame_count; i++) {
    g_current_owned[i] = QueuedFrame();
  }
  g_current_desc = FlowInvocationDescriptorC();
  g_current_node = kInvalidIndex;
}

static void flow_enqueue_binding(const FlowTriggerBinding &binding, const char *port,
                                 const uint8_t *payload, uint32_t length, uint32_t stream_id,
                                 uint32_t sequence, uint8_t end_of_stream) {
  QueuedFrame frame;
  frame.port = (port != nullptr && port[0] != '\0') ? port : binding.port;
  if (payload != nullptr && length > 0) {
    frame.payload.assign(payload, payload + length);
  }
  frame.stream_id = stream_id;
  frame.sequence = sequence;
  frame.end_of_stream = end_of_stream;
  g_queues[binding.target_node].push_back(static_cast<QueuedFrame &&>(frame));
  g_node_states[binding.target_node].queued_frames =
      static_cast<uint32_t>(g_queues[binding.target_node].size());
  g_node_states[binding.target_node].ready =
      flow_node_is_ready(binding.target_node) ? 1 : 0;
}

FLOW_EXPORT void space_data_module_runtime_enqueue_trigger_frames(int32_t trigger_index) {
  if (trigger_index < 0 || static_cast<uint32_t>(trigger_index) >= FLOW_TRIGGER_COUNT) return;
  for (uint32_t b = 0; b < FLOW_TRIGGER_BINDING_COUNT; b++) {
    if (g_trigger_bindings[b].trigger_index != static_cast<uint32_t>(trigger_index)) continue;
    flow_enqueue_binding(g_trigger_bindings[b], nullptr, nullptr, 0, 0, 0, 0);
  }
  g_ingress_states[trigger_index].total_received++;
  g_ingress_states[trigger_index].queued_frames++;
}

FLOW_EXPORT void space_data_module_runtime_enqueue_trigger_frame(int32_t trigger_index,
                                                                 int32_t frame_ptr) {
  if (trigger_index < 0 || static_cast<uint32_t>(trigger_index) >= FLOW_TRIGGER_COUNT) return;
  if (frame_ptr == 0) {
    space_data_module_runtime_enqueue_trigger_frames(trigger_index);
    return;
  }
  const FlowFrameDescriptorC *fd = reinterpret_cast<const FlowFrameDescriptorC *>(frame_ptr);
  const char *port =
      fd->port_id_ptr != 0 ? reinterpret_cast<const char *>(fd->port_id_ptr) : nullptr;
  const uint8_t *payload =
      (fd->offset != 0 && fd->size > 0) ? reinterpret_cast<const uint8_t *>(fd->offset) : nullptr;
  for (uint32_t b = 0; b < FLOW_TRIGGER_BINDING_COUNT; b++) {
    if (g_trigger_bindings[b].trigger_index != static_cast<uint32_t>(trigger_index)) continue;
    flow_enqueue_binding(g_trigger_bindings[b], port, payload, payload != nullptr ? fd->size : 0,
                         fd->stream_id, fd->sequence, fd->end_of_stream);
  }
  g_ingress_states[trigger_index].total_received++;
  g_ingress_states[trigger_index].queued_frames++;
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
    input.payload = owned.payload.data();
    input.payload_length = static_cast<uint32_t>(owned.payload.size());
    input.byte_length = input.payload_length;
    input.size = input.payload_length;
    input.alignment = 8;
    input.required_alignment = 1;
    input.wire_format = PLUGIN_PAYLOAD_WIRE_FORMAT_ALIGNED_BINARY;
    input.stream_id = owned.stream_id;
    input.sequence = owned.sequence;
    input.end_of_stream = owned.end_of_stream != 0 ? 1 : 0;
    g_shim_inputs.push_back(input);
  }
  plugin_reset_output_state();

  int32_t status = flow_call_entry(node);

  uint32_t routed = 0;
  for (const ShimOutput &out : g_shim_outputs) {
    route_output(node, out.port.c_str(), out.payload.data(),
                 static_cast<uint32_t>(out.payload.size()), 0,
                 static_cast<uint32_t>(out.sequence), out.end_of_stream != 0 ? 1 : 0);
    routed++;
  }
  g_node_states[node].invocation_count++;
  g_node_states[node].consumed_frames += g_current_desc.frame_count;
  g_node_states[node].last_status = static_cast<uint32_t>(status);
  g_node_states[node].yielded = g_shim_yielded != 0 ? 1 : 0;
  g_node_states[node].backlog_remaining = g_shim_backlog_remaining;
  g_shim_inputs.clear();
  return static_cast<int32_t>(routed);
}
