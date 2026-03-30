#include <stdbool.h>
#include <stdint.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <wasmedge/wasmedge.h>

static void fail_result(const char *step, WasmEdge_Result res) {
  fprintf(
      stderr,
      "%s failed: %s (0x%x)\n",
      step,
      WasmEdge_ResultGetMessage(res),
      WasmEdge_ResultGetCode(res));
  exit(1);
}

typedef struct ImportedMemoryConfig {
  bool found;
  bool shared;
  bool has_max;
  uint32_t min;
  uint32_t max;
} ImportedMemoryConfig;

typedef struct FunctionTypeArity {
  uint32_t param_count;
  uint32_t return_count;
} FunctionTypeArity;

typedef struct ImportedModuleConfig {
  ImportedMemoryConfig memory;
  uint32_t receive_on_main_thread_param_len;
  uint32_t notify_mailbox_postmessage_param_len;
} ImportedModuleConfig;

typedef struct RunnerContext {
  WasmEdge_ConfigureContext *conf;
  WasmEdge_ASTModuleContext *ast;
  WasmEdge_StoreContext *store;
  WasmEdge_MemoryInstanceContext *shared_memory;
  pthread_mutex_t store_mutex;
} RunnerContext;

typedef struct ThreadLaunchContext {
  RunnerContext *runner;
  WasmEdge_ExecutorContext *executor;
  WasmEdge_ModuleInstanceContext *module;
  WasmEdge_TableInstanceContext *indirect_table;
  WasmEdge_FunctionInstanceContext *stack_set_limits;
  WasmEdge_FunctionInstanceContext *stack_restore;
  WasmEdge_FunctionInstanceContext *thread_init;
  WasmEdge_FunctionInstanceContext *tls_init;
  WasmEdge_FunctionInstanceContext *thread_exit;
  WasmEdge_FunctionInstanceContext *thread_crashed;
  uint32_t pthread_ptr;
  uint32_t start_routine;
  uint32_t arg;
} ThreadLaunchContext;

#define EM_PTHREAD_STACK_OFFSET 52U
#define EM_PTHREAD_STACK_SIZE_OFFSET 56U
#define EM_PTHREAD_EAGAIN 6

static WasmEdge_Result stub_void(
    void *Data,
    const WasmEdge_CallingFrameContext *CallFrameCxt,
    const WasmEdge_Value *In,
    WasmEdge_Value *Out) {
  (void)Data;
  (void)CallFrameCxt;
  (void)In;
  (void)Out;
  return WasmEdge_Result_Success;
}

static WasmEdge_Result stub_receive_on_main_thread(
    void *Data,
    const WasmEdge_CallingFrameContext *CallFrameCxt,
    const WasmEdge_Value *In,
    WasmEdge_Value *Out) {
  (void)Data;
  (void)CallFrameCxt;
  (void)In;
  Out[0] = WasmEdge_ValueGenF64(0.0);
  return WasmEdge_Result_Success;
}

static WasmEdge_Result stub_pthread_create(
    void *Data,
    const WasmEdge_CallingFrameContext *CallFrameCxt,
    const WasmEdge_Value *In,
    WasmEdge_Value *Out) {
  (void)CallFrameCxt;
  RunnerContext *runner = Data;
  if (runner == NULL || runner->ast == NULL || runner->store == NULL ||
      runner->shared_memory == NULL) {
    Out[0] = WasmEdge_ValueGenI32(EM_PTHREAD_EAGAIN);
    return WasmEdge_Result_Success;
  }
  ThreadLaunchContext *thread_context =
      calloc(1, sizeof(ThreadLaunchContext));
  if (thread_context == NULL) {
    Out[0] = WasmEdge_ValueGenI32(EM_PTHREAD_EAGAIN);
    return WasmEdge_Result_Success;
  }
  thread_context->runner = runner;
  thread_context->pthread_ptr = (uint32_t)WasmEdge_ValueGetI32(In[0]);
  thread_context->start_routine = (uint32_t)WasmEdge_ValueGetI32(In[2]);
  thread_context->arg = (uint32_t)WasmEdge_ValueGetI32(In[3]);

  thread_context->executor = WasmEdge_ExecutorCreate(runner->conf, NULL);
  if (thread_context->executor == NULL) {
    free(thread_context);
    Out[0] = WasmEdge_ValueGenI32(EM_PTHREAD_EAGAIN);
    return WasmEdge_Result_Success;
  }

  pthread_mutex_lock(&runner->store_mutex);
  WasmEdge_Result instantiate_result = WasmEdge_ExecutorInstantiate(
      thread_context->executor,
      &thread_context->module,
      runner->store,
      runner->ast);
  pthread_mutex_unlock(&runner->store_mutex);
  if (!WasmEdge_ResultOK(instantiate_result) || thread_context->module == NULL) {
    WasmEdge_ExecutorDelete(thread_context->executor);
    free(thread_context);
    Out[0] = WasmEdge_ValueGenI32(EM_PTHREAD_EAGAIN);
    return WasmEdge_Result_Success;
  }

  WasmEdge_String export_name =
      WasmEdge_StringCreateByCString("__indirect_function_table");
  thread_context->indirect_table =
      WasmEdge_ModuleInstanceFindTable(thread_context->module, export_name);
  WasmEdge_StringDelete(export_name);

  export_name = WasmEdge_StringCreateByCString("emscripten_stack_set_limits");
  thread_context->stack_set_limits =
      WasmEdge_ModuleInstanceFindFunction(thread_context->module, export_name);
  WasmEdge_StringDelete(export_name);

  export_name = WasmEdge_StringCreateByCString("_emscripten_stack_restore");
  thread_context->stack_restore =
      WasmEdge_ModuleInstanceFindFunction(thread_context->module, export_name);
  WasmEdge_StringDelete(export_name);

  export_name = WasmEdge_StringCreateByCString("_emscripten_thread_init");
  thread_context->thread_init =
      WasmEdge_ModuleInstanceFindFunction(thread_context->module, export_name);
  WasmEdge_StringDelete(export_name);

  export_name = WasmEdge_StringCreateByCString("_emscripten_tls_init");
  thread_context->tls_init =
      WasmEdge_ModuleInstanceFindFunction(thread_context->module, export_name);
  WasmEdge_StringDelete(export_name);

  export_name = WasmEdge_StringCreateByCString("_emscripten_thread_exit");
  thread_context->thread_exit =
      WasmEdge_ModuleInstanceFindFunction(thread_context->module, export_name);
  WasmEdge_StringDelete(export_name);

  export_name = WasmEdge_StringCreateByCString("_emscripten_thread_crashed");
  thread_context->thread_crashed =
      WasmEdge_ModuleInstanceFindFunction(thread_context->module, export_name);
  WasmEdge_StringDelete(export_name);

  if (thread_context->indirect_table == NULL ||
      thread_context->stack_set_limits == NULL ||
      thread_context->stack_restore == NULL ||
      thread_context->thread_init == NULL ||
      thread_context->tls_init == NULL ||
      thread_context->thread_exit == NULL) {
    pthread_mutex_lock(&runner->store_mutex);
    WasmEdge_ModuleInstanceDelete(thread_context->module);
    pthread_mutex_unlock(&runner->store_mutex);
    WasmEdge_ExecutorDelete(thread_context->executor);
    free(thread_context);
    Out[0] = WasmEdge_ValueGenI32(EM_PTHREAD_EAGAIN);
    return WasmEdge_Result_Success;
  }

  pthread_t thread;
  pthread_attr_t thread_attr;
  if (pthread_attr_init(&thread_attr) != 0) {
    pthread_mutex_lock(&runner->store_mutex);
    WasmEdge_ModuleInstanceDelete(thread_context->module);
    pthread_mutex_unlock(&runner->store_mutex);
    WasmEdge_ExecutorDelete(thread_context->executor);
    free(thread_context);
    Out[0] = WasmEdge_ValueGenI32(EM_PTHREAD_EAGAIN);
    return WasmEdge_Result_Success;
  }
  pthread_attr_setdetachstate(&thread_attr, PTHREAD_CREATE_DETACHED);

  extern void *run_guest_thread(void *Data);
  const int rc = pthread_create(
      &thread,
      &thread_attr,
      run_guest_thread,
      thread_context);
  pthread_attr_destroy(&thread_attr);
  if (rc != 0) {
    pthread_mutex_lock(&runner->store_mutex);
    WasmEdge_ModuleInstanceDelete(thread_context->module);
    pthread_mutex_unlock(&runner->store_mutex);
    WasmEdge_ExecutorDelete(thread_context->executor);
    free(thread_context);
    Out[0] = WasmEdge_ValueGenI32(rc);
    return WasmEdge_Result_Success;
  }

  (void)CallFrameCxt;
  Out[0] = WasmEdge_ValueGenI32(0);
  return WasmEdge_Result_Success;
}

static void add_host_func(
    WasmEdge_ModuleInstanceContext *mod,
    const char *name,
    WasmEdge_HostFunc_t fn,
    void *data,
    const WasmEdge_ValType *params,
    uint32_t param_len,
    const WasmEdge_ValType *returns,
    uint32_t return_len) {
  WasmEdge_FunctionTypeContext *type =
      WasmEdge_FunctionTypeCreate(params, param_len, returns, return_len);
  WasmEdge_FunctionInstanceContext *func =
      WasmEdge_FunctionInstanceCreate(type, fn, data, 0);
  WasmEdge_String func_name = WasmEdge_StringCreateByCString(name);
  WasmEdge_ModuleInstanceAddFunction(mod, func_name, func);
  WasmEdge_StringDelete(func_name);
  WasmEdge_FunctionTypeDelete(type);
}

static bool read_file_bytes(
    const char *path,
    uint8_t **buffer,
    size_t *buffer_len) {
  FILE *file = fopen(path, "rb");
  if (file == NULL) {
    return false;
  }
  if (fseek(file, 0, SEEK_END) != 0) {
    fclose(file);
    return false;
  }
  long file_size = ftell(file);
  if (file_size < 0) {
    fclose(file);
    return false;
  }
  if (fseek(file, 0, SEEK_SET) != 0) {
    fclose(file);
    return false;
  }
  uint8_t *bytes = malloc((size_t)file_size);
  if (bytes == NULL) {
    fclose(file);
    return false;
  }
  const size_t read_len = fread(bytes, 1, (size_t)file_size, file);
  fclose(file);
  if (read_len != (size_t)file_size) {
    free(bytes);
    return false;
  }
  *buffer = bytes;
  *buffer_len = read_len;
  return true;
}

static bool read_u32_leb(
    const uint8_t *bytes,
    size_t length,
    size_t *offset,
    uint32_t *value) {
  uint32_t result = 0;
  uint32_t shift = 0;
  while (*offset < length) {
    const uint8_t byte = bytes[*offset];
    *offset += 1;
    result |= (uint32_t)(byte & 0x7F) << shift;
    if ((byte & 0x80) == 0) {
      *value = result;
      return true;
    }
    shift += 7;
    if (shift >= 35) {
      return false;
    }
  }
  return false;
}

static bool skip_bytes(size_t length, size_t *offset, uint32_t byte_count) {
  if (*offset + byte_count > length) {
    return false;
  }
  *offset += byte_count;
  return true;
}

static bool read_name_equals(
    const uint8_t *bytes,
    size_t length,
    size_t *offset,
    const char *expected) {
  uint32_t name_len = 0;
  if (!read_u32_leb(bytes, length, offset, &name_len)) {
    return false;
  }
  if (*offset + name_len > length) {
    return false;
  }
  const size_t expected_len = strlen(expected);
  const bool equals =
      expected_len == (size_t)name_len &&
      memcmp(bytes + *offset, expected, expected_len) == 0;
  *offset += name_len;
  return equals;
}

static bool skip_limits(
    const uint8_t *bytes,
    size_t length,
    size_t *offset) {
  uint32_t flags = 0;
  uint32_t ignored = 0;
  if (!read_u32_leb(bytes, length, offset, &flags) ||
      !read_u32_leb(bytes, length, offset, &ignored)) {
    return false;
  }
  if ((flags & 0x01U) != 0 && !read_u32_leb(bytes, length, offset, &ignored)) {
    return false;
  }
  return true;
}

static bool read_imported_module_config(
    const char *wasm_path,
    ImportedModuleConfig *config) {
  memset(config, 0, sizeof(*config));

  uint8_t *bytes = NULL;
  size_t length = 0;
  if (!read_file_bytes(wasm_path, &bytes, &length)) {
    return false;
  }

  bool ok = false;
  FunctionTypeArity *types = NULL;
  uint32_t type_count = 0;
  size_t offset = 8;
  if (length < 8 || memcmp(bytes, "\0asm", 4) != 0) {
    goto cleanup;
  }

  while (offset < length) {
    const uint8_t section_id = bytes[offset];
    offset += 1;

    uint32_t section_len = 0;
    if (!read_u32_leb(bytes, length, &offset, &section_len)) {
      goto cleanup;
    }
    if (offset + section_len > length) {
      goto cleanup;
    }

    const size_t section_end = offset + section_len;
    if (section_id == 1) {
      if (!read_u32_leb(bytes, section_end, &offset, &type_count)) {
        goto cleanup;
      }
      types = calloc(type_count, sizeof(FunctionTypeArity));
      if (types == NULL && type_count > 0) {
        goto cleanup;
      }
      for (uint32_t index = 0; index < type_count; index++) {
        if (offset >= section_end || bytes[offset] != 0x60) {
          goto cleanup;
        }
        offset += 1;
        if (!read_u32_leb(
                bytes,
                section_end,
                &offset,
                &types[index].param_count)) {
          goto cleanup;
        }
        if (!skip_bytes(section_end, &offset, types[index].param_count)) {
          goto cleanup;
        }
        if (!read_u32_leb(
                bytes,
                section_end,
                &offset,
                &types[index].return_count)) {
          goto cleanup;
        }
        if (!skip_bytes(section_end, &offset, types[index].return_count)) {
          goto cleanup;
        }
      }
      offset = section_end;
      continue;
    }

    if (section_id != 2) {
      offset = section_end;
      continue;
    }

    uint32_t import_count = 0;
    if (!read_u32_leb(bytes, section_end, &offset, &import_count)) {
      goto cleanup;
    }

    for (uint32_t index = 0; index < import_count; index++) {
      const bool is_env =
          read_name_equals(bytes, section_end, &offset, "env");
      size_t field_name_offset = offset;
      uint32_t field_name_len = 0;
      if (!read_u32_leb(
              bytes,
              section_end,
              &field_name_offset,
              &field_name_len)) {
        goto cleanup;
      }
      if (field_name_offset + field_name_len > section_end) {
        goto cleanup;
      }
      const bool is_memory_name =
          field_name_len == 6 &&
          memcmp(bytes + field_name_offset, "memory", 6) == 0;
      const bool is_receive_on_main_thread_name =
          field_name_len == 37 &&
          memcmp(
              bytes + field_name_offset,
              "_emscripten_receive_on_main_thread_js",
              37) == 0;
      const bool is_notify_mailbox_postmessage_name =
          field_name_len == 38 &&
          memcmp(
              bytes + field_name_offset,
              "_emscripten_notify_mailbox_postmessage",
              38) == 0;
      offset = field_name_offset + field_name_len;

      if (offset >= section_end) {
        goto cleanup;
      }
      const uint8_t kind = bytes[offset];
      offset += 1;

      switch (kind) {
      case 0x00: {
        uint32_t type_index = 0;
        if (!read_u32_leb(bytes, section_end, &offset, &type_index)) {
          goto cleanup;
        }
        if (is_env && is_receive_on_main_thread_name &&
            type_index < type_count) {
          config->receive_on_main_thread_param_len =
              types[type_index].param_count;
        }
        if (is_env && is_notify_mailbox_postmessage_name &&
            type_index < type_count) {
          config->notify_mailbox_postmessage_param_len =
              types[type_index].param_count;
        }
        break;
      }
      case 0x01:
        if (!skip_bytes(section_end, &offset, 1) ||
            !skip_limits(bytes, section_end, &offset)) {
          goto cleanup;
        }
        break;
      case 0x02: {
        uint32_t flags = 0;
        uint32_t min_pages = 0;
        uint32_t max_pages = 0;
        if (!read_u32_leb(bytes, section_end, &offset, &flags) ||
            !read_u32_leb(bytes, section_end, &offset, &min_pages)) {
          goto cleanup;
        }
        const bool has_max = (flags & 0x01U) != 0;
        const bool shared = (flags & 0x02U) != 0;
        if (has_max &&
            !read_u32_leb(bytes, section_end, &offset, &max_pages)) {
          goto cleanup;
        }
        if (is_env && is_memory_name) {
          config->memory.found = true;
          config->memory.shared = shared;
          config->memory.has_max = has_max;
          config->memory.min = min_pages;
          config->memory.max = max_pages;
        }
        break;
      }
      case 0x03:
        if (!skip_bytes(section_end, &offset, 2)) {
          goto cleanup;
        }
        break;
      case 0x04: {
        uint32_t tag_type = 0;
        uint32_t type_index = 0;
        if (!read_u32_leb(bytes, section_end, &offset, &tag_type) ||
            !read_u32_leb(bytes, section_end, &offset, &type_index)) {
          goto cleanup;
        }
        break;
      }
      default:
        goto cleanup;
      }
    }

    ok = true;
    goto cleanup;
  }

  ok = true;

cleanup:
  free(types);
  free(bytes);
  return ok;
}

static bool add_imported_env_memory_from_file(
    const char *wasm_path,
    WasmEdge_ModuleInstanceContext *env,
    WasmEdge_MemoryInstanceContext **memory_out) {
  ImportedModuleConfig config;
  if (!read_imported_module_config(wasm_path, &config)) {
    return false;
  }
  if (!config.memory.found) {
    *memory_out = NULL;
    return true;
  }
  if (!config.memory.has_max) {
    return false;
  }

  WasmEdge_Limit limit = {
      .HasMax = config.memory.has_max,
      .Shared = config.memory.shared,
      .Min = config.memory.min,
      .Max = config.memory.max,
  };
  WasmEdge_MemoryTypeContext *host_memory_type =
      WasmEdge_MemoryTypeCreate(limit);
  WasmEdge_MemoryInstanceContext *memory =
      WasmEdge_MemoryInstanceCreate(host_memory_type);
  WasmEdge_String memory_name = WasmEdge_StringCreateByCString("memory");
  WasmEdge_ModuleInstanceAddMemory(env, memory_name, memory);
  WasmEdge_StringDelete(memory_name);
  WasmEdge_MemoryTypeDelete(host_memory_type);
  *memory_out = memory;
  return true;
}

static void register_env_host_functions(
    WasmEdge_ModuleInstanceContext *env,
    RunnerContext *runner,
    uint32_t receive_on_main_thread_param_len,
    uint32_t notify_mailbox_postmessage_param_len) {
  const WasmEdge_ValType i32_param[1] = {WasmEdge_ValTypeGenI32()};
  const WasmEdge_ValType two_i32_params[2] = {
      WasmEdge_ValTypeGenI32(),
      WasmEdge_ValTypeGenI32()};
  const WasmEdge_ValType three_i32_params[3] = {
      WasmEdge_ValTypeGenI32(),
      WasmEdge_ValTypeGenI32(),
      WasmEdge_ValTypeGenI32()};
  const WasmEdge_ValType four_i32_params[4] = {
      WasmEdge_ValTypeGenI32(),
      WasmEdge_ValTypeGenI32(),
      WasmEdge_ValTypeGenI32(),
      WasmEdge_ValTypeGenI32()};
  const WasmEdge_ValType five_i32_params[5] = {
      WasmEdge_ValTypeGenI32(),
      WasmEdge_ValTypeGenI32(),
      WasmEdge_ValTypeGenI32(),
      WasmEdge_ValTypeGenI32(),
      WasmEdge_ValTypeGenI32()};
  const WasmEdge_ValType f64_return[1] = {WasmEdge_ValTypeGenF64()};
  const WasmEdge_ValType i32_return[1] = {WasmEdge_ValTypeGenI32()};

  add_host_func(
      env,
      "_emscripten_thread_set_strongref",
      stub_void,
      runner,
      i32_param,
      1,
      NULL,
      0);
  add_host_func(
      env,
      "emscripten_exit_with_live_runtime",
      stub_void,
      runner,
      NULL,
      0,
      NULL,
      0);
  add_host_func(
      env,
      "_emscripten_init_main_thread_js",
      stub_void,
      runner,
      i32_param,
      1,
      NULL,
      0);
  add_host_func(
      env,
      "__emscripten_init_main_thread_js",
      stub_void,
      runner,
      i32_param,
      1,
      NULL,
      0);
  add_host_func(
      env,
      "_emscripten_thread_mailbox_await",
      stub_void,
      runner,
      i32_param,
      1,
      NULL,
      0);
  add_host_func(
      env,
      "_emscripten_receive_on_main_thread_js",
      stub_receive_on_main_thread,
      runner,
      receive_on_main_thread_param_len == 4 ? four_i32_params : five_i32_params,
      receive_on_main_thread_param_len == 4 ? 4 : 5,
      f64_return,
      1);
  add_host_func(
      env,
      "emscripten_check_blocking_allowed",
      stub_void,
      runner,
      NULL,
      0,
      NULL,
      0);
  add_host_func(
      env,
      "__pthread_create_js",
      stub_pthread_create,
      runner,
      four_i32_params,
      4,
      i32_return,
      1);
  add_host_func(
      env,
      "_emscripten_thread_cleanup",
      stub_void,
      runner,
      i32_param,
      1,
      NULL,
      0);
  add_host_func(
      env,
      "__emscripten_thread_cleanup",
      stub_void,
      runner,
      i32_param,
      1,
      NULL,
      0);
  add_host_func(
      env,
      "_emscripten_notify_mailbox_postmessage",
      stub_void,
      runner,
      notify_mailbox_postmessage_param_len == 3
          ? three_i32_params
          : two_i32_params,
      notify_mailbox_postmessage_param_len == 3 ? 3 : 2,
      NULL,
      0);
}

static bool read_guest_u32(
    WasmEdge_MemoryInstanceContext *memory,
    uint32_t offset,
    uint32_t *value) {
  const uint8_t *bytes =
      WasmEdge_MemoryInstanceGetPointerConst(memory, offset, 4);
  if (bytes == NULL) {
    return false;
  }
  *value = (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
           ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
  return true;
}

static bool invoke_function(
    WasmEdge_ExecutorContext *executor,
    WasmEdge_FunctionInstanceContext *function,
    const WasmEdge_Value *params,
    uint32_t params_len,
    WasmEdge_Value *returns,
    uint32_t returns_len,
    const char *label) {
  const WasmEdge_Result result = WasmEdge_ExecutorInvoke(
      executor,
      function,
      params,
      params_len,
      returns,
      returns_len);
  if (WasmEdge_ResultOK(result)) {
    return true;
  }
  fprintf(
      stderr,
      "%s failed: %s (0x%x)\n",
      label,
      WasmEdge_ResultGetMessage(result),
      WasmEdge_ResultGetCode(result));
  return false;
}

static void destroy_thread_launch_context(ThreadLaunchContext *context) {
  if (context == NULL) {
    return;
  }
  if (context->module != NULL) {
    pthread_mutex_lock(&context->runner->store_mutex);
    WasmEdge_ModuleInstanceDelete(context->module);
    pthread_mutex_unlock(&context->runner->store_mutex);
  }
  if (context->executor != NULL) {
    WasmEdge_ExecutorDelete(context->executor);
  }
  free(context);
}

void *run_guest_thread(void *Data) {
  ThreadLaunchContext *context = Data;
  if (context == NULL || context->runner == NULL ||
      context->runner->shared_memory == NULL) {
    destroy_thread_launch_context(context);
    return NULL;
  }

  uint32_t stack_high = 0;
  uint32_t stack_size = 0;
  if (!read_guest_u32(
          context->runner->shared_memory,
          context->pthread_ptr + EM_PTHREAD_STACK_OFFSET,
          &stack_high) ||
      !read_guest_u32(
          context->runner->shared_memory,
          context->pthread_ptr + EM_PTHREAD_STACK_SIZE_OFFSET,
          &stack_size)) {
    destroy_thread_launch_context(context);
    return NULL;
  }
  const uint32_t stack_low = stack_high - stack_size;

  WasmEdge_Value params[6];
  WasmEdge_Value returns[1];

  params[0] = WasmEdge_ValueGenI32((int32_t)stack_high);
  params[1] = WasmEdge_ValueGenI32((int32_t)stack_low);
  if (!invoke_function(
          context->executor,
          context->stack_set_limits,
          params,
          2,
          NULL,
          0,
          "emscripten_stack_set_limits")) {
    goto thread_crashed;
  }

  params[0] = WasmEdge_ValueGenI32((int32_t)stack_high);
  if (!invoke_function(
          context->executor,
          context->stack_restore,
          params,
          1,
          NULL,
          0,
          "_emscripten_stack_restore")) {
    goto thread_crashed;
  }

  params[0] = WasmEdge_ValueGenI32((int32_t)context->pthread_ptr);
  params[1] = WasmEdge_ValueGenI32(0);
  params[2] = WasmEdge_ValueGenI32(0);
  params[3] = WasmEdge_ValueGenI32(1);
  params[4] = WasmEdge_ValueGenI32(0);
  params[5] = WasmEdge_ValueGenI32(0);
  if (!invoke_function(
          context->executor,
          context->thread_init,
          params,
          6,
          NULL,
          0,
          "_emscripten_thread_init")) {
    goto thread_crashed;
  }

  if (!invoke_function(
          context->executor,
          context->tls_init,
          NULL,
          0,
          returns,
          1,
          "_emscripten_tls_init")) {
    goto thread_crashed;
  }

  WasmEdge_Value function_ref;
  const WasmEdge_Result table_result = WasmEdge_TableInstanceGetData(
      context->indirect_table,
      &function_ref,
      context->start_routine);
  if (!WasmEdge_ResultOK(table_result)) {
    fprintf(
        stderr,
        "table lookup failed: %s (0x%x)\n",
        WasmEdge_ResultGetMessage(table_result),
        WasmEdge_ResultGetCode(table_result));
    goto thread_crashed;
  }
  const WasmEdge_FunctionInstanceContext *entry_function =
      WasmEdge_ValueGetFuncRef(function_ref);
  if (entry_function == NULL) {
    fprintf(stderr, "thread entry function pointer was null\n");
    goto thread_crashed;
  }

  params[0] = WasmEdge_ValueGenI32((int32_t)context->arg);
  if (!invoke_function(
          context->executor,
          (WasmEdge_FunctionInstanceContext *)entry_function,
          params,
          1,
          returns,
          1,
          "thread entry")) {
    goto thread_crashed;
  }

  params[0] = WasmEdge_ValueGenI32(WasmEdge_ValueGetI32(returns[0]));
  invoke_function(
      context->executor,
      context->thread_exit,
      params,
      1,
      NULL,
      0,
      "_emscripten_thread_exit");
  destroy_thread_launch_context(context);
  return NULL;

thread_crashed:
  if (context->thread_crashed != NULL) {
    invoke_function(
        context->executor,
        context->thread_crashed,
        NULL,
        0,
        NULL,
        0,
        "_emscripten_thread_crashed");
  }
  destroy_thread_launch_context(context);
  return NULL;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s module.wasm [module-args...]\n", argv[0]);
    return 2;
  }

  WasmEdge_ConfigureContext *conf = WasmEdge_ConfigureCreate();
  WasmEdge_ConfigureAddProposal(conf, WasmEdge_Proposal_Threads);
  WasmEdge_LoaderContext *loader = WasmEdge_LoaderCreate(conf);
  WasmEdge_ValidatorContext *validator = WasmEdge_ValidatorCreate(conf);
  WasmEdge_ExecutorContext *executor = WasmEdge_ExecutorCreate(conf, NULL);
  WasmEdge_StoreContext *store = WasmEdge_StoreCreate();
  RunnerContext runner = {
      .conf = conf,
      .ast = NULL,
      .store = store,
      .shared_memory = NULL,
  };
  pthread_mutex_init(&runner.store_mutex, NULL);

  WasmEdge_ASTModuleContext *ast = NULL;
  WasmEdge_Result res = WasmEdge_LoaderParseFromFile(loader, &ast, argv[1]);
  if (!WasmEdge_ResultOK(res)) {
    fail_result("parse", res);
  }
  runner.ast = ast;
  res = WasmEdge_ValidatorValidate(validator, ast);
  if (!WasmEdge_ResultOK(res)) {
    fail_result("validate", res);
  }

  WasmEdge_ModuleInstanceContext *wasi =
      WasmEdge_ModuleInstanceCreateWASIWithFds(
          (const char *const *)(argv + 1),
          (uint32_t)(argc - 1),
          NULL,
          0,
          NULL,
          0,
          STDIN_FILENO,
          STDOUT_FILENO,
          STDERR_FILENO);
  res = WasmEdge_ExecutorRegisterImport(executor, store, wasi);
  if (!WasmEdge_ResultOK(res)) {
    fail_result("register wasi", res);
  }

  WasmEdge_ModuleInstanceContext *env =
      WasmEdge_ModuleInstanceCreate(WasmEdge_StringCreateByCString("env"));
  ImportedModuleConfig import_config;
  if (!read_imported_module_config(argv[1], &import_config)) {
    fprintf(stderr, "failed to inspect wasm import contract\n");
    return 1;
  }
  if (!add_imported_env_memory_from_file(argv[1], env, &runner.shared_memory)) {
    fprintf(stderr, "failed to create imported env memory\n");
    return 1;
  }
  register_env_host_functions(
      env,
      &runner,
      import_config.receive_on_main_thread_param_len == 4
          ? 4
          : 5,
      import_config.notify_mailbox_postmessage_param_len == 3
          ? 3
          : 2);
  res = WasmEdge_ExecutorRegisterImport(executor, store, env);
  if (!WasmEdge_ResultOK(res)) {
    fail_result("register env", res);
  }

  WasmEdge_ModuleInstanceContext *mod = NULL;
  res = WasmEdge_ExecutorInstantiate(executor, &mod, store, ast);
  if (!WasmEdge_ResultOK(res)) {
    fail_result("instantiate", res);
  }

  WasmEdge_String start_name = WasmEdge_StringCreateByCString("_start");
  WasmEdge_FunctionInstanceContext *start =
      WasmEdge_ModuleInstanceFindFunction(mod, start_name);
  WasmEdge_StringDelete(start_name);
  if (start == NULL) {
    fprintf(stderr, "_start not found\n");
    return 3;
  }

  res = WasmEdge_ExecutorInvoke(executor, start, NULL, 0, NULL, 0);
  if (!WasmEdge_ResultOK(res)) {
    fail_result("invoke", res);
  }

  const uint32_t exit_code = WasmEdge_ModuleInstanceWASIGetExitCode(wasi);

  WasmEdge_ASTModuleDelete(ast);
  WasmEdge_StoreDelete(store);
  WasmEdge_ExecutorDelete(executor);
  WasmEdge_ValidatorDelete(validator);
  WasmEdge_LoaderDelete(loader);
  WasmEdge_ConfigureDelete(conf);
  pthread_mutex_destroy(&runner.store_mutex);
  return (int)exit_code;
}
