export const COMPILED_RUNTIME_HOST_IMPORT_MODULE = "space_data_module_host";
export const COMPILED_RUNTIME_HOST_DISPATCH = "dispatch_current_invocation";

export const COMPILED_RUNTIME_EXPORTS = Object.freeze({
  mallocSymbol: "malloc",
  freeSymbol: "free",
  descriptorSymbol: "space_data_module_runtime_get_descriptor",
  nodeDescriptorCountSymbol:
    "space_data_module_runtime_get_node_descriptor_count",
  edgeDescriptorCountSymbol:
    "space_data_module_runtime_get_edge_descriptor_count",
  triggerDescriptorCountSymbol:
    "space_data_module_runtime_get_trigger_descriptor_count",
  dependencyDescriptorCountSymbol:
    "space_data_module_runtime_get_dependency_descriptor_count",
  resetStateSymbol: "space_data_module_runtime_reset_state",
  enqueueTriggerSymbol: "space_data_module_runtime_enqueue_trigger_frames",
  enqueueTriggerFrameSymbol: "space_data_module_runtime_enqueue_trigger_frame",
  enqueueEdgeSymbol: "space_data_module_runtime_enqueue_edge_frames",
  enqueueEdgeFrameSymbol: "space_data_module_runtime_enqueue_edge_frame",
  readyNodeSymbol: "space_data_module_runtime_get_ready_node_index",
  beginInvocationSymbol:
    "space_data_module_runtime_begin_node_invocation",
  completeInvocationSymbol:
    "space_data_module_runtime_complete_node_invocation",
  ingressFrameDescriptorsSymbol:
    "space_data_module_runtime_get_ingress_frame_descriptors",
  ingressFrameDescriptorCountSymbol:
    "space_data_module_runtime_get_ingress_frame_descriptor_count",
  currentInvocationDescriptorSymbol:
    "space_data_module_runtime_get_current_invocation_descriptor",
  prepareInvocationDescriptorSymbol:
    "space_data_module_runtime_prepare_node_invocation_descriptor",
  applyInvocationResultSymbol:
    "space_data_module_runtime_apply_node_invocation_result",
  nodeDispatchDescriptorsSymbol:
    "space_data_module_runtime_get_node_dispatch_descriptors",
  nodeDispatchDescriptorCountSymbol:
    "space_data_module_runtime_get_node_dispatch_descriptor_count",
  dependencyDescriptorsSymbol:
    "space_data_module_runtime_get_dependency_descriptors",
  dependencyCountSymbol: "space_data_module_runtime_get_dependency_count",
  nodeRuntimeStateSymbol: "space_data_module_runtime_get_node_states",
  ingressRuntimeStateSymbol: "space_data_module_runtime_get_ingress_states",
  dispatchCurrentInvocationSymbol:
    "space_data_module_runtime_dispatch_current_invocation_direct",
});
