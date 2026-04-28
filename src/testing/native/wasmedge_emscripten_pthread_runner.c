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

typedef enum HostControlOpcode {
  HOST_CONTROL_WRITE = 1,
  HOST_CONTROL_READ = 2,
  HOST_CONTROL_FREE = 3,
  HOST_CONTROL_INSTALL_MODULE = 16,
  HOST_CONTROL_LIST_MODULES = 17,
  HOST_CONTROL_UNLOAD_MODULE = 18,
  HOST_CONTROL_INVOKE_MODULE = 19,
  HOST_CONTROL_APPEND_ROW = 20,
  HOST_CONTROL_LIST_ROWS = 21,
  HOST_CONTROL_RESOLVE_ROW = 22,
  HOST_CONTROL_ALLOCATE_REGION = 23,
  HOST_CONTROL_DESCRIBE_REGION = 24,
  HOST_CONTROL_RESOLVE_RECORD = 25,
  HOST_CONTROL_QUERY_ROWS = 26,
} HostControlOpcode;

#define EM_PTHREAD_STACK_OFFSET 52U
#define EM_PTHREAD_STACK_SIZE_OFFSET 56U
#define EM_PTHREAD_EAGAIN 6
static const uint8_t HOST_CONTROL_MAGIC[4] = {'O', 'R', 'P', 'W'};

typedef struct JsonSlice {
  const char *data;
  size_t length;
} JsonSlice;

typedef struct JsonBuffer {
  char *data;
  size_t length;
  size_t capacity;
} JsonBuffer;

typedef struct RuntimeHostModule {
  char *module_id;
  char *wasm_path;
  char *metadata_json;
  char **method_ids;
  size_t method_id_count;
  WasmEdge_ConfigureContext *conf;
  WasmEdge_LoaderContext *loader;
  WasmEdge_ValidatorContext *validator;
  WasmEdge_ExecutorContext *executor;
  WasmEdge_StoreContext *store;
  WasmEdge_ASTModuleContext *ast;
  WasmEdge_ModuleInstanceContext *module;
  RunnerContext runner;
  bool store_mutex_initialized;
} RuntimeHostModule;

typedef struct RuntimeHostRow {
  char *schema_file_id;
  uint64_t row_id;
  char *payload_json;
} RuntimeHostRow;

typedef struct RuntimeHostRegion {
  uint64_t region_id;
  char *layout_id;
  uint32_t record_byte_length;
  uint16_t alignment;
  uint8_t **records;
  size_t record_count;
} RuntimeHostRegion;

typedef struct RuntimeHostState {
  RuntimeHostModule *modules;
  size_t module_count;
  size_t module_capacity;
  RuntimeHostRow *rows;
  size_t row_count;
  size_t row_capacity;
  uint64_t next_row_id;
  RuntimeHostRegion *regions;
  size_t region_count;
  size_t region_capacity;
  uint64_t next_region_id;
} RuntimeHostState;

static WasmEdge_FunctionInstanceContext *find_first_available_function(
    WasmEdge_ModuleInstanceContext *module,
    const char *const *names,
    size_t name_count);

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

  {
    static const char *const stack_restore_names[] = {
        "_emscripten_stack_restore",
        "stackRestore",
    };
    thread_context->stack_restore = find_first_available_function(
        thread_context->module,
        stack_restore_names,
        sizeof(stack_restore_names) / sizeof(stack_restore_names[0]));
  }

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
  const WasmEdge_ValType seven_i32_params[7] = {
      WasmEdge_ValTypeGenI32(),
      WasmEdge_ValTypeGenI32(),
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
      receive_on_main_thread_param_len == 4
          ? four_i32_params
          : receive_on_main_thread_param_len == 7
              ? seven_i32_params
              : five_i32_params,
      receive_on_main_thread_param_len == 4
          ? 4
          : receive_on_main_thread_param_len == 7 ? 7 : 5,
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

static WasmEdge_FunctionInstanceContext *find_function(
    WasmEdge_ModuleInstanceContext *module,
    const char *name) {
  WasmEdge_String function_name = WasmEdge_StringCreateByCString(name);
  WasmEdge_FunctionInstanceContext *function =
      WasmEdge_ModuleInstanceFindFunction(module, function_name);
  WasmEdge_StringDelete(function_name);
  return function;
}

static WasmEdge_FunctionInstanceContext *find_first_available_function(
    WasmEdge_ModuleInstanceContext *module,
    const char *const *names,
    size_t name_count) {
  for (size_t index = 0; index < name_count; ++index) {
    WasmEdge_FunctionInstanceContext *function =
        find_function(module, names[index]);
    if (function != NULL) {
      return function;
    }
  }
  return NULL;
}

static WasmEdge_MemoryInstanceContext *resolve_guest_memory(
    WasmEdge_ModuleInstanceContext *module,
    RunnerContext *runner) {
  WasmEdge_String memory_name = WasmEdge_StringCreateByCString("memory");
  WasmEdge_MemoryInstanceContext *memory =
      WasmEdge_ModuleInstanceFindMemory(module, memory_name);
  WasmEdge_StringDelete(memory_name);
  if (memory != NULL) {
    return memory;
  }
  return runner->shared_memory;
}

static bool write_guest_memory(
    WasmEdge_MemoryInstanceContext *memory,
    uint32_t offset,
    const uint8_t *bytes,
    uint32_t length) {
  if (length == 0) {
    return true;
  }
  const WasmEdge_Result result =
      WasmEdge_MemoryInstanceSetData(memory, bytes, offset, length);
  if (WasmEdge_ResultOK(result)) {
    return true;
  }
  fprintf(
      stderr,
      "guest memory write failed: %s (0x%x)\n",
      WasmEdge_ResultGetMessage(result),
      WasmEdge_ResultGetCode(result));
  return false;
}

static bool read_guest_memory(
    const WasmEdge_MemoryInstanceContext *memory,
    uint32_t offset,
    uint8_t *bytes,
    uint32_t length) {
  if (length == 0) {
    return true;
  }
  const WasmEdge_Result result =
      WasmEdge_MemoryInstanceGetData(memory, bytes, offset, length);
  if (WasmEdge_ResultOK(result)) {
    return true;
  }
  fprintf(
      stderr,
      "guest memory read failed: %s (0x%x)\n",
      WasmEdge_ResultGetMessage(result),
      WasmEdge_ResultGetCode(result));
  return false;
}

static bool guest_malloc(
    WasmEdge_ExecutorContext *executor,
    WasmEdge_FunctionInstanceContext *malloc_fn,
    uint32_t length,
    uint32_t *pointer_out) {
  WasmEdge_Value params[1];
  WasmEdge_Value returns[1];
  params[0] = WasmEdge_ValueGenI32((int32_t)length);
  if (!invoke_function(
          executor,
          malloc_fn,
          params,
          1,
          returns,
          1,
          "plugin_alloc")) {
    return false;
  }
  *pointer_out = (uint32_t)WasmEdge_ValueGetI32(returns[0]);
  return true;
}

static bool guest_free(
    WasmEdge_ExecutorContext *executor,
    WasmEdge_FunctionInstanceContext *free_fn,
    uint32_t pointer,
    uint32_t length) {
  if (pointer == 0) {
    return true;
  }
  WasmEdge_Value params[2];
  params[0] = WasmEdge_ValueGenI32((int32_t)pointer);
  params[1] = WasmEdge_ValueGenI32((int32_t)length);
  return invoke_function(
      executor,
      free_fn,
      params,
      2,
      NULL,
      0,
      "plugin_free");
}

static bool read_exact(FILE *stream, uint8_t *buffer, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    const size_t read_len = fread(buffer + offset, 1, length - offset, stream);
    if (read_len == 0) {
      if (feof(stream)) {
        return false;
      }
      if (ferror(stream)) {
        perror("fread");
      }
      return false;
    }
    offset += read_len;
  }
  return true;
}

static bool write_all(FILE *stream, const uint8_t *buffer, size_t length) {
  size_t offset = 0;
  while (offset < length) {
    const size_t write_len =
        fwrite(buffer + offset, 1, length - offset, stream);
    if (write_len == 0) {
      if (ferror(stream)) {
        perror("fwrite");
      }
      return false;
    }
    offset += write_len;
  }
  return fflush(stream) == 0;
}

static uint32_t read_le_u32_bytes(const uint8_t *bytes) {
  return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
         ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static void runtime_host_state_init(RuntimeHostState *state) {
  memset(state, 0, sizeof(*state));
  state->next_row_id = 1;
  state->next_region_id = 1;
}

static void json_buffer_init(JsonBuffer *buffer) {
  memset(buffer, 0, sizeof(*buffer));
}

static void json_buffer_free(JsonBuffer *buffer) {
  free(buffer->data);
  buffer->data = NULL;
  buffer->length = 0;
  buffer->capacity = 0;
}

static bool json_buffer_reserve(JsonBuffer *buffer, size_t additional) {
  const size_t required = buffer->length + additional + 1;
  if (required <= buffer->capacity) {
    return true;
  }
  size_t next_capacity = buffer->capacity == 0 ? 256 : buffer->capacity;
  while (next_capacity < required) {
    next_capacity *= 2;
  }
  char *next = realloc(buffer->data, next_capacity);
  if (next == NULL) {
    return false;
  }
  buffer->data = next;
  buffer->capacity = next_capacity;
  return true;
}

static bool json_buffer_append_bytes(
    JsonBuffer *buffer,
    const char *bytes,
    size_t length) {
  if (!json_buffer_reserve(buffer, length)) {
    return false;
  }
  memcpy(buffer->data + buffer->length, bytes, length);
  buffer->length += length;
  buffer->data[buffer->length] = '\0';
  return true;
}

static bool json_buffer_append_cstr(JsonBuffer *buffer, const char *value) {
  return json_buffer_append_bytes(buffer, value, strlen(value));
}

static bool json_buffer_append_char(JsonBuffer *buffer, char value) {
  return json_buffer_append_bytes(buffer, &value, 1);
}

static bool json_buffer_append_u64(JsonBuffer *buffer, uint64_t value) {
  char scratch[32];
  const int written =
      snprintf(scratch, sizeof(scratch), "%llu", (unsigned long long)value);
  return written > 0 &&
         json_buffer_append_bytes(buffer, scratch, (size_t)written);
}

static bool json_buffer_append_u32(JsonBuffer *buffer, uint32_t value) {
  char scratch[32];
  const int written = snprintf(scratch, sizeof(scratch), "%u", value);
  return written > 0 &&
         json_buffer_append_bytes(buffer, scratch, (size_t)written);
}

static bool json_buffer_append_json_string(
    JsonBuffer *buffer,
    const char *value) {
  if (!json_buffer_append_char(buffer, '"')) {
    return false;
  }
  for (const unsigned char *cursor = (const unsigned char *)value;
       *cursor != '\0';
       ++cursor) {
    switch (*cursor) {
      case '"':
      case '\\':
        if (!json_buffer_append_char(buffer, '\\') ||
            !json_buffer_append_char(buffer, (char)*cursor)) {
          return false;
        }
        break;
      case '\b':
        if (!json_buffer_append_cstr(buffer, "\\b")) {
          return false;
        }
        break;
      case '\f':
        if (!json_buffer_append_cstr(buffer, "\\f")) {
          return false;
        }
        break;
      case '\n':
        if (!json_buffer_append_cstr(buffer, "\\n")) {
          return false;
        }
        break;
      case '\r':
        if (!json_buffer_append_cstr(buffer, "\\r")) {
          return false;
        }
        break;
      case '\t':
        if (!json_buffer_append_cstr(buffer, "\\t")) {
          return false;
        }
        break;
      default:
        if (*cursor < 0x20U) {
          char escaped[7];
          const int written =
              snprintf(escaped, sizeof(escaped), "\\u%04x", *cursor);
          if (written <= 0 ||
              !json_buffer_append_bytes(buffer, escaped, (size_t)written)) {
            return false;
          }
        } else if (!json_buffer_append_char(buffer, (char)*cursor)) {
          return false;
        }
        break;
    }
  }
  return json_buffer_append_char(buffer, '"');
}

static uint8_t *json_buffer_detach(
    JsonBuffer *buffer,
    uint32_t *length_out) {
  uint8_t *bytes = NULL;
  if (buffer->length > 0) {
    bytes = malloc(buffer->length);
    if (bytes == NULL) {
      return NULL;
    }
    memcpy(bytes, buffer->data, buffer->length);
  }
  *length_out = (uint32_t)buffer->length;
  json_buffer_free(buffer);
  return bytes;
}

static void skip_json_whitespace(
    const char *json,
    size_t length,
    size_t *offset) {
  while (*offset < length) {
    const char ch = json[*offset];
    if (ch != ' ' && ch != '\n' && ch != '\r' && ch != '\t') {
      return;
    }
    *offset += 1;
  }
}

static bool consume_json_string(
    const char *json,
    size_t length,
    size_t *offset) {
  if (*offset >= length || json[*offset] != '"') {
    return false;
  }
  *offset += 1;
  while (*offset < length) {
    const char ch = json[*offset];
    *offset += 1;
    if (ch == '\\') {
      if (*offset >= length) {
        return false;
      }
      *offset += 1;
      continue;
    }
    if (ch == '"') {
      return true;
    }
  }
  return false;
}

static bool consume_json_value(
    const char *json,
    size_t length,
    size_t *offset) {
  skip_json_whitespace(json, length, offset);
  if (*offset >= length) {
    return false;
  }
  const char ch = json[*offset];
  if (ch == '"') {
    return consume_json_string(json, length, offset);
  }
  if (ch == '{' || ch == '[') {
    const char open = ch;
    const char close = ch == '{' ? '}' : ']';
    *offset += 1;
    skip_json_whitespace(json, length, offset);
    if (*offset < length && json[*offset] == close) {
      *offset += 1;
      return true;
    }
    for (;;) {
      if (open == '{') {
        if (!consume_json_string(json, length, offset)) {
          return false;
        }
        skip_json_whitespace(json, length, offset);
        if (*offset >= length || json[*offset] != ':') {
          return false;
        }
        *offset += 1;
      }
      if (!consume_json_value(json, length, offset)) {
        return false;
      }
      skip_json_whitespace(json, length, offset);
      if (*offset >= length) {
        return false;
      }
      if (json[*offset] == close) {
        *offset += 1;
        return true;
      }
      if (json[*offset] != ',') {
        return false;
      }
      *offset += 1;
    }
  }
  while (*offset < length) {
    const char value_ch = json[*offset];
    if (value_ch == ',' || value_ch == '}' || value_ch == ']' ||
        value_ch == ' ' || value_ch == '\n' || value_ch == '\r' ||
        value_ch == '\t') {
      return true;
    }
    *offset += 1;
  }
  return true;
}

static bool duplicate_json_string_value(
    JsonSlice slice,
    char **value_out) {
  if (slice.length < 2 || slice.data[0] != '"' ||
      slice.data[slice.length - 1] != '"') {
    return false;
  }
  char *value = malloc(slice.length);
  if (value == NULL) {
    return false;
  }
  size_t write_index = 0;
  for (size_t index = 1; index + 1 < slice.length; ++index) {
    char ch = slice.data[index];
    if (ch == '\\') {
      if (index + 1 >= slice.length - 1) {
        free(value);
        return false;
      }
      index += 1;
      ch = slice.data[index];
      switch (ch) {
        case '"':
        case '\\':
        case '/':
          value[write_index++] = ch;
          break;
        case 'b':
          value[write_index++] = '\b';
          break;
        case 'f':
          value[write_index++] = '\f';
          break;
        case 'n':
          value[write_index++] = '\n';
          break;
        case 'r':
          value[write_index++] = '\r';
          break;
        case 't':
          value[write_index++] = '\t';
          break;
        default:
          free(value);
          return false;
      }
    } else {
      value[write_index++] = ch;
    }
  }
  value[write_index] = '\0';
  *value_out = value;
  return true;
}

static bool duplicate_json_slice(JsonSlice slice, char **value_out) {
  char *value = malloc(slice.length + 1);
  if (value == NULL) {
    return false;
  }
  memcpy(value, slice.data, slice.length);
  value[slice.length] = '\0';
  *value_out = value;
  return true;
}

static bool json_slice_is_null(JsonSlice slice) {
  return slice.length == 4 && memcmp(slice.data, "null", 4) == 0;
}

static bool parse_json_u64(JsonSlice slice, uint64_t *value_out) {
  char scratch[64];
  if (slice.length == 0 || slice.length >= sizeof(scratch)) {
    return false;
  }
  memcpy(scratch, slice.data, slice.length);
  scratch[slice.length] = '\0';
  char *end = NULL;
  const unsigned long long value = strtoull(scratch, &end, 10);
  if (end == scratch || *end != '\0') {
    return false;
  }
  *value_out = (uint64_t)value;
  return true;
}

static bool find_json_object_field(
    const char *json,
    size_t length,
    const char *field_name,
    JsonSlice *value_out) {
  size_t offset = 0;
  skip_json_whitespace(json, length, &offset);
  if (offset >= length || json[offset] != '{') {
    return false;
  }
  offset += 1;
  for (;;) {
    skip_json_whitespace(json, length, &offset);
    if (offset >= length) {
      return false;
    }
    if (json[offset] == '}') {
      return false;
    }
    const size_t key_start = offset;
    if (!consume_json_string(json, length, &offset)) {
      return false;
    }
    JsonSlice key_slice = {
        .data = json + key_start,
        .length = offset - key_start,
    };
    char *key_value = NULL;
    if (!duplicate_json_string_value(key_slice, &key_value)) {
      return false;
    }
    skip_json_whitespace(json, length, &offset);
    if (offset >= length || json[offset] != ':') {
      free(key_value);
      return false;
    }
    offset += 1;
    skip_json_whitespace(json, length, &offset);
    const size_t value_start = offset;
    if (!consume_json_value(json, length, &offset)) {
      free(key_value);
      return false;
    }
    const bool matched = strcmp(key_value, field_name) == 0;
    free(key_value);
    if (matched) {
      value_out->data = json + value_start;
      value_out->length = offset - value_start;
      return true;
    }
    skip_json_whitespace(json, length, &offset);
    if (offset >= length) {
      return false;
    }
    if (json[offset] == '}') {
      return false;
    }
    if (json[offset] != ',') {
      return false;
    }
    offset += 1;
  }
}

static bool ensure_runtime_host_capacity(
    void **buffer,
    size_t *capacity,
    size_t count,
    size_t item_size) {
  if (count < *capacity) {
    return true;
  }
  size_t next_capacity = *capacity == 0 ? 8 : *capacity * 2;
  while (next_capacity <= count) {
    next_capacity *= 2;
  }
  void *next = realloc(*buffer, next_capacity * item_size);
  if (next == NULL) {
    return false;
  }
  *buffer = next;
  *capacity = next_capacity;
  return true;
}

static void runtime_host_module_init(RuntimeHostModule *module) {
  memset(module, 0, sizeof(*module));
}

static void destroy_runtime_host_module(RuntimeHostModule *module) {
  if (module == NULL) {
    return;
  }
  free(module->module_id);
  free(module->wasm_path);
  free(module->metadata_json);
  for (size_t index = 0; index < module->method_id_count; ++index) {
    free(module->method_ids[index]);
  }
  free(module->method_ids);
  if (module->store != NULL) {
    WasmEdge_StoreDelete(module->store);
  }
  if (module->executor != NULL) {
    WasmEdge_ExecutorDelete(module->executor);
  }
  if (module->validator != NULL) {
    WasmEdge_ValidatorDelete(module->validator);
  }
  if (module->loader != NULL) {
    WasmEdge_LoaderDelete(module->loader);
  }
  if (module->conf != NULL) {
    WasmEdge_ConfigureDelete(module->conf);
  }
  if (module->ast != NULL) {
    WasmEdge_ASTModuleDelete(module->ast);
  }
  if (module->store_mutex_initialized) {
    pthread_mutex_destroy(&module->runner.store_mutex);
  }
  memset(module, 0, sizeof(*module));
}

static void destroy_runtime_host_region(RuntimeHostRegion *region) {
  if (region == NULL) {
    return;
  }
  for (size_t index = 0; index < region->record_count; ++index) {
    free(region->records[index]);
  }
  free(region->records);
  free(region->layout_id);
  memset(region, 0, sizeof(*region));
}

static void runtime_host_state_destroy(RuntimeHostState *state) {
  for (size_t index = 0; index < state->module_count; ++index) {
    destroy_runtime_host_module(&state->modules[index]);
  }
  free(state->modules);
  for (size_t index = 0; index < state->row_count; ++index) {
    free(state->rows[index].schema_file_id);
    free(state->rows[index].payload_json);
  }
  free(state->rows);
  for (size_t index = 0; index < state->region_count; ++index) {
    destroy_runtime_host_region(&state->regions[index]);
  }
  free(state->regions);
  memset(state, 0, sizeof(*state));
}

static bool invoke_optional_module_init(
    WasmEdge_ExecutorContext *executor,
    WasmEdge_ModuleInstanceContext *module,
    bool service_mode) {
  if (service_mode) {
    WasmEdge_FunctionInstanceContext *ctors =
        find_function(module, "__wasm_call_ctors");
    if (ctors != NULL) {
      return invoke_function(
          executor,
          ctors,
          NULL,
          0,
          NULL,
          0,
          "__wasm_call_ctors");
    }
    return true;
  }

  WasmEdge_FunctionInstanceContext *start = find_function(module, "_start");
  if (start != NULL) {
    return invoke_function(executor, start, NULL, 0, NULL, 0, "_start");
  }
  WasmEdge_FunctionInstanceContext *ctors =
      find_function(module, "__wasm_call_ctors");
  if (ctors != NULL) {
    return invoke_function(
        executor,
        ctors,
        NULL,
        0,
        NULL,
        0,
        "__wasm_call_ctors");
  }
  return true;
}

static bool serve_plugin_invoke_requests(
    WasmEdge_ExecutorContext *executor,
    WasmEdge_ModuleInstanceContext *module,
    RunnerContext *runner) {
  WasmEdge_MemoryInstanceContext *memory = resolve_guest_memory(module, runner);
  if (memory == NULL) {
    fprintf(stderr, "guest memory export/import was not found\n");
    return false;
  }

  WasmEdge_FunctionInstanceContext *malloc_fn =
      find_function(module, "plugin_alloc");
  WasmEdge_FunctionInstanceContext *free_fn =
      find_function(module, "plugin_free");
  WasmEdge_FunctionInstanceContext *invoke_fn =
      find_function(module, "plugin_invoke_stream");
  if (malloc_fn == NULL || free_fn == NULL || invoke_fn == NULL) {
    fprintf(
        stderr,
        "guest must export plugin_alloc, plugin_free, and plugin_invoke_stream\n");
    return false;
  }

  for (;;) {
    uint8_t length_bytes[4];
    const size_t prefix_read = fread(length_bytes, 1, sizeof(length_bytes), stdin);
    if (prefix_read == 0) {
      return feof(stdin);
    }
    if (prefix_read != sizeof(length_bytes)) {
      fprintf(stderr, "partial request length prefix\n");
      return false;
    }
    const uint32_t request_size =
        (uint32_t)length_bytes[0] |
        ((uint32_t)length_bytes[1] << 8) |
        ((uint32_t)length_bytes[2] << 16) |
        ((uint32_t)length_bytes[3] << 24);

    uint8_t *request_bytes = NULL;
    if (request_size > 0) {
      request_bytes = malloc(request_size);
      if (request_bytes == NULL) {
        fprintf(stderr, "failed to allocate host request buffer\n");
        return false;
      }
      if (!read_exact(stdin, request_bytes, request_size)) {
        free(request_bytes);
        fprintf(stderr, "failed to read complete request payload\n");
        return false;
      }
    }

    if (request_size >= 5 &&
        memcmp(request_bytes, HOST_CONTROL_MAGIC, sizeof(HOST_CONTROL_MAGIC)) == 0) {
      const uint8_t opcode = request_bytes[4];
      bool ok = true;
      uint8_t *response_bytes = NULL;
      uint32_t response_size = 0;

      if (opcode == HOST_CONTROL_WRITE) {
        const uint32_t payload_size = request_size - 5;
        uint32_t guest_ptr = 0;
        ok = guest_malloc(executor, malloc_fn, payload_size, &guest_ptr) &&
             (payload_size == 0 || guest_ptr != 0) &&
             write_guest_memory(memory, guest_ptr, request_bytes + 5, payload_size);
        if (ok) {
          response_size = 4;
          response_bytes = malloc(response_size);
          if (response_bytes == NULL) {
            ok = false;
          } else {
            response_bytes[0] = (uint8_t)(guest_ptr & 0xFFU);
            response_bytes[1] = (uint8_t)((guest_ptr >> 8) & 0xFFU);
            response_bytes[2] = (uint8_t)((guest_ptr >> 16) & 0xFFU);
            response_bytes[3] = (uint8_t)((guest_ptr >> 24) & 0xFFU);
          }
        }
      } else if (opcode == HOST_CONTROL_READ) {
        if (request_size != 13) {
          ok = false;
        } else {
          const uint32_t guest_ptr = read_le_u32_bytes(request_bytes + 5);
          response_size = read_le_u32_bytes(request_bytes + 9);
          response_bytes = malloc(response_size);
          if (response_bytes == NULL && response_size > 0) {
            ok = false;
          } else {
            ok = read_guest_memory(memory, guest_ptr, response_bytes, response_size);
          }
        }
      } else if (opcode == HOST_CONTROL_FREE) {
        if (request_size != 9 && request_size != 13) {
          ok = false;
        } else {
          const uint32_t guest_ptr = read_le_u32_bytes(request_bytes + 5);
          const uint32_t guest_len =
              request_size >= 13 ? read_le_u32_bytes(request_bytes + 9) : 0;
          ok = guest_free(executor, free_fn, guest_ptr, guest_len);
        }
      } else {
        ok = false;
      }

      free(request_bytes);
      if (!ok) {
        free(response_bytes);
        fprintf(stderr, "invalid WasmEdge host control request\n");
        return false;
      }

      uint8_t response_length_bytes[4];
      response_length_bytes[0] = (uint8_t)(response_size & 0xFFU);
      response_length_bytes[1] = (uint8_t)((response_size >> 8) & 0xFFU);
      response_length_bytes[2] = (uint8_t)((response_size >> 16) & 0xFFU);
      response_length_bytes[3] = (uint8_t)((response_size >> 24) & 0xFFU);
      ok = write_all(stdout, response_length_bytes, sizeof(response_length_bytes)) &&
           write_all(stdout, response_bytes, response_size);
      free(response_bytes);
      if (!ok) {
        return false;
      }
      continue;
    }

    uint32_t request_ptr = 0;
    uint32_t response_size_ptr = 0;
    uint32_t response_ptr = 0;
    uint32_t response_size = 0;
    bool ok = true;

    if (request_size > 0) {
      ok = guest_malloc(executor, malloc_fn, request_size, &request_ptr) &&
           request_ptr != 0 &&
           write_guest_memory(memory, request_ptr, request_bytes, request_size);
    }
    if (ok) {
      ok = guest_malloc(executor, malloc_fn, 4, &response_size_ptr) &&
           response_size_ptr != 0;
    }
    if (ok) {
      const uint8_t zero_u32[4] = {0, 0, 0, 0};
      ok = write_guest_memory(memory, response_size_ptr, zero_u32, 4);
    }
    if (ok) {
      WasmEdge_Value params[3];
      WasmEdge_Value returns[1];
      params[0] = WasmEdge_ValueGenI32((int32_t)request_ptr);
      params[1] = WasmEdge_ValueGenI32((int32_t)request_size);
      params[2] = WasmEdge_ValueGenI32((int32_t)response_size_ptr);
      ok = invoke_function(
          executor,
          invoke_fn,
          params,
          3,
          returns,
          1,
          "plugin_invoke_stream");
      if (ok) {
        response_ptr = (uint32_t)WasmEdge_ValueGetI32(returns[0]);
        ok = read_guest_u32(memory, response_size_ptr, &response_size);
      }
    }

    if (ok && response_size > 0 && response_ptr == 0) {
      fprintf(stderr, "plugin_invoke_stream returned null response pointer\n");
      ok = false;
    }

    uint8_t *response_bytes = NULL;
    if (ok && response_size > 0) {
      response_bytes = malloc(response_size);
      if (response_bytes == NULL) {
        fprintf(stderr, "failed to allocate host response buffer\n");
        ok = false;
      } else {
        ok = read_guest_memory(memory, response_ptr, response_bytes, response_size);
      }
    }

    if (ok) {
      uint8_t response_length_bytes[4];
      response_length_bytes[0] = (uint8_t)(response_size & 0xFFU);
      response_length_bytes[1] = (uint8_t)((response_size >> 8) & 0xFFU);
      response_length_bytes[2] = (uint8_t)((response_size >> 16) & 0xFFU);
      response_length_bytes[3] = (uint8_t)((response_size >> 24) & 0xFFU);
      ok = write_all(stdout, response_length_bytes, sizeof(response_length_bytes)) &&
           write_all(stdout, response_bytes, response_size);
    }

    free(response_bytes);
    free(request_bytes);
    if (response_ptr != 0) {
      guest_free(executor, free_fn, response_ptr, response_size);
    }
    if (response_size_ptr != 0) {
      guest_free(executor, free_fn, response_size_ptr, 4);
    }
    if (request_ptr != 0) {
      guest_free(executor, free_fn, request_ptr, request_size);
    }

    if (!ok) {
      return false;
    }
  }
}

static bool invoke_plugin_stream_once(
    WasmEdge_ExecutorContext *executor,
    WasmEdge_ModuleInstanceContext *module,
    RunnerContext *runner,
    const uint8_t *request_bytes,
    uint32_t request_size,
    uint8_t **response_bytes_out,
    uint32_t *response_size_out) {
  WasmEdge_MemoryInstanceContext *memory = resolve_guest_memory(module, runner);
  if (memory == NULL) {
    fprintf(stderr, "guest memory export/import was not found\n");
    return false;
  }

  WasmEdge_FunctionInstanceContext *malloc_fn =
      find_function(module, "plugin_alloc");
  WasmEdge_FunctionInstanceContext *free_fn =
      find_function(module, "plugin_free");
  WasmEdge_FunctionInstanceContext *invoke_fn =
      find_function(module, "plugin_invoke_stream");
  if (malloc_fn == NULL || free_fn == NULL || invoke_fn == NULL) {
    fprintf(
        stderr,
        "guest must export plugin_alloc, plugin_free, and plugin_invoke_stream\n");
    return false;
  }

  uint32_t request_ptr = 0;
  uint32_t response_size_ptr = 0;
  uint32_t response_ptr = 0;
  uint32_t response_size = 0;
  uint8_t *response_bytes = NULL;
  bool ok = true;

  if (request_size > 0) {
    ok = guest_malloc(executor, malloc_fn, request_size, &request_ptr) &&
         request_ptr != 0 &&
         write_guest_memory(memory, request_ptr, request_bytes, request_size);
  }
  if (ok) {
    ok = guest_malloc(executor, malloc_fn, 4, &response_size_ptr) &&
         response_size_ptr != 0;
  }
  if (ok) {
    const uint8_t zero_u32[4] = {0, 0, 0, 0};
    ok = write_guest_memory(memory, response_size_ptr, zero_u32, 4);
  }
  if (ok) {
    WasmEdge_Value params[3];
    WasmEdge_Value returns[1];
    params[0] = WasmEdge_ValueGenI32((int32_t)request_ptr);
    params[1] = WasmEdge_ValueGenI32((int32_t)request_size);
    params[2] = WasmEdge_ValueGenI32((int32_t)response_size_ptr);
    ok = invoke_function(
        executor,
        invoke_fn,
        params,
        3,
        returns,
        1,
        "plugin_invoke_stream");
    if (ok) {
      response_ptr = (uint32_t)WasmEdge_ValueGetI32(returns[0]);
      ok = read_guest_u32(memory, response_size_ptr, &response_size);
    }
  }
  if (ok && response_size > 0 && response_ptr == 0) {
    fprintf(stderr, "plugin_invoke_stream returned null response pointer\n");
    ok = false;
  }
  if (ok && response_size > 0) {
    response_bytes = malloc(response_size);
    if (response_bytes == NULL) {
      fprintf(stderr, "failed to allocate host response buffer\n");
      ok = false;
    } else {
      ok = read_guest_memory(memory, response_ptr, response_bytes, response_size);
    }
  }

  if (response_ptr != 0) {
    guest_free(executor, free_fn, response_ptr, response_size);
  }
  if (response_size_ptr != 0) {
    guest_free(executor, free_fn, response_size_ptr, 4);
  }
  if (request_ptr != 0) {
    guest_free(executor, free_fn, request_ptr, request_size);
  }
  if (!ok) {
    free(response_bytes);
    return false;
  }
  *response_bytes_out = response_bytes;
  *response_size_out = response_size;
  return true;
}

static bool initialize_runtime_host_module(
    RuntimeHostModule *module,
    char *module_id,
    char *wasm_path,
    char *metadata_json,
    char **method_ids,
    size_t method_id_count) {
  runtime_host_module_init(module);
  module->module_id = module_id;
  module->wasm_path = wasm_path;
  module->metadata_json = metadata_json;
  module->method_ids = method_ids;
  module->method_id_count = method_id_count;

  module->conf = WasmEdge_ConfigureCreate();
  if (module->conf == NULL) {
    goto fail;
  }
  WasmEdge_ConfigureAddProposal(module->conf, WasmEdge_Proposal_Threads);
  WasmEdge_ConfigureAddProposal(
      module->conf, WasmEdge_Proposal_ExceptionHandling);
  module->loader = WasmEdge_LoaderCreate(module->conf);
  module->validator = WasmEdge_ValidatorCreate(module->conf);
  module->executor = WasmEdge_ExecutorCreate(module->conf, NULL);
  module->store = WasmEdge_StoreCreate();
  if (module->loader == NULL || module->validator == NULL ||
      module->executor == NULL || module->store == NULL) {
    goto fail;
  }

  module->runner.conf = module->conf;
  module->runner.store = module->store;
  if (pthread_mutex_init(&module->runner.store_mutex, NULL) != 0) {
    goto fail;
  }
  module->store_mutex_initialized = true;

  WasmEdge_Result res = WasmEdge_LoaderParseFromFile(
      module->loader,
      &module->ast,
      module->wasm_path);
  if (!WasmEdge_ResultOK(res)) {
    goto fail;
  }
  module->runner.ast = module->ast;
  res = WasmEdge_ValidatorValidate(module->validator, module->ast);
  if (!WasmEdge_ResultOK(res)) {
    goto fail;
  }

  const char *wasi_args[2] = {module->wasm_path, "--serve-plugin-invoke"};
  WasmEdge_ModuleInstanceContext *wasi = WasmEdge_ModuleInstanceCreateWASI(
      wasi_args,
      2,
      NULL,
      0,
      NULL,
      0);
  if (wasi == NULL) {
    goto fail;
  }
  res = WasmEdge_ExecutorRegisterImport(module->executor, module->store, wasi);
  if (!WasmEdge_ResultOK(res)) {
    goto fail;
  }

  WasmEdge_ModuleInstanceContext *env =
      WasmEdge_ModuleInstanceCreate(WasmEdge_StringCreateByCString("env"));
  if (env == NULL) {
    goto fail;
  }
  ImportedModuleConfig import_config;
  if (!read_imported_module_config(module->wasm_path, &import_config) ||
      !add_imported_env_memory_from_file(
          module->wasm_path,
          env,
          &module->runner.shared_memory)) {
    goto fail;
  }
  register_env_host_functions(
      env,
      &module->runner,
      import_config.receive_on_main_thread_param_len == 4 ? 4 : 5,
      import_config.notify_mailbox_postmessage_param_len == 3 ? 3 : 2);
  res = WasmEdge_ExecutorRegisterImport(module->executor, module->store, env);
  if (!WasmEdge_ResultOK(res)) {
    goto fail;
  }

  res = WasmEdge_ExecutorInstantiate(
      module->executor,
      &module->module,
      module->store,
      module->ast);
  if (!WasmEdge_ResultOK(res)) {
    goto fail;
  }

  if (!invoke_optional_module_init(module->executor, module->module, true)) {
    goto fail;
  }

  return true;

fail:
  destroy_runtime_host_module(module);
  return false;
}

static bool invoke_runtime_host_module(
    RuntimeHostModule *module,
    const uint8_t *request_bytes,
    uint32_t request_size,
    uint8_t **response_bytes_out,
    uint32_t *response_size_out) {
  if (module == NULL || module->executor == NULL || module->module == NULL) {
    return false;
  }
  return invoke_plugin_stream_once(
      module->executor,
      module->module,
      &module->runner,
      request_bytes,
      request_size,
      response_bytes_out,
      response_size_out);
}

static RuntimeHostModule *find_runtime_host_module(
    RuntimeHostState *state,
    const char *module_id,
    size_t *index_out) {
  for (size_t index = 0; index < state->module_count; ++index) {
    if (strcmp(state->modules[index].module_id, module_id) == 0) {
      if (index_out != NULL) {
        *index_out = index;
      }
      return &state->modules[index];
    }
  }
  return NULL;
}

static RuntimeHostRegion *find_runtime_host_region(
    RuntimeHostState *state,
    uint64_t region_id) {
  for (size_t index = 0; index < state->region_count; ++index) {
    if (state->regions[index].region_id == region_id) {
      return &state->regions[index];
    }
  }
  return NULL;
}

static RuntimeHostRow *find_runtime_host_row(
    RuntimeHostState *state,
    const char *schema_file_id,
    uint64_t row_id) {
  for (size_t index = 0; index < state->row_count; ++index) {
    RuntimeHostRow *row = &state->rows[index];
    if (row->row_id == row_id &&
        strcmp(row->schema_file_id, schema_file_id) == 0) {
      return row;
    }
  }
  return NULL;
}

static uint64_t next_runtime_host_row_id_for_schema(
    RuntimeHostState *state,
    const char *schema_file_id) {
  uint64_t next_row_id = 1;
  for (size_t index = 0; index < state->row_count; ++index) {
    RuntimeHostRow *row = &state->rows[index];
    if (strcmp(row->schema_file_id, schema_file_id) != 0) {
      continue;
    }
    if (row->row_id >= next_row_id) {
      next_row_id = row->row_id + 1;
    }
  }
  return next_row_id;
}

static bool append_runtime_host_row_query_result_json(
    JsonBuffer *buffer,
    RuntimeHostState *state,
    const char *schema_file_id_filter) {
  if (!json_buffer_append_cstr(
          buffer,
          "{\"columns\":[\"schemaFileId\",\"rowId\"],\"rows\":[")) {
    return false;
  }
  uint64_t row_count = 0;
  bool first = true;
  for (size_t index = 0; index < state->row_count; ++index) {
    RuntimeHostRow *row = &state->rows[index];
    if (schema_file_id_filter != NULL &&
        strcmp(row->schema_file_id, schema_file_id_filter) != 0) {
      continue;
    }
    if (!first && !json_buffer_append_char(buffer, ',')) {
      return false;
    }
    first = false;
    if (!json_buffer_append_char(buffer, '[') ||
        !json_buffer_append_json_string(buffer, row->schema_file_id) ||
        !json_buffer_append_char(buffer, ',') ||
        !json_buffer_append_u64(buffer, row->row_id) ||
        !json_buffer_append_char(buffer, ']')) {
      return false;
    }
    row_count += 1;
  }
  return json_buffer_append_cstr(buffer, "],\"rowCount\":") &&
         json_buffer_append_u64(buffer, row_count) &&
         json_buffer_append_char(buffer, '}');
}

static bool append_runtime_host_module_json(
    JsonBuffer *buffer,
    const RuntimeHostModule *module) {
  if (!json_buffer_append_cstr(buffer, "{\"moduleId\":") ||
      !json_buffer_append_json_string(buffer, module->module_id) ||
      !json_buffer_append_cstr(buffer, ",\"metadata\":") ||
      !json_buffer_append_cstr(
          buffer,
          module->metadata_json != NULL ? module->metadata_json : "null") ||
      !json_buffer_append_cstr(buffer, ",\"methodIds\":[")) {
    return false;
  }
  for (size_t index = 0; index < module->method_id_count; ++index) {
    if ((index > 0 && !json_buffer_append_char(buffer, ',')) ||
        !json_buffer_append_json_string(buffer, module->method_ids[index])) {
      return false;
    }
  }
  return json_buffer_append_cstr(buffer, "]}");
}

static bool append_runtime_host_row_json(
    JsonBuffer *buffer,
    const RuntimeHostRow *row) {
  return json_buffer_append_cstr(buffer, "{\"handle\":{\"schemaFileId\":") &&
         json_buffer_append_json_string(buffer, row->schema_file_id) &&
         json_buffer_append_cstr(buffer, ",\"rowId\":") &&
         json_buffer_append_u64(buffer, row->row_id) &&
         json_buffer_append_cstr(buffer, "},\"payload\":") &&
         json_buffer_append_cstr(
             buffer,
             row->payload_json != NULL ? row->payload_json : "null") &&
         json_buffer_append_char(buffer, '}');
}

static bool append_runtime_host_region_descriptor_json(
    JsonBuffer *buffer,
    const RuntimeHostRegion *region) {
  return json_buffer_append_cstr(buffer, "{\"regionId\":") &&
         json_buffer_append_u64(buffer, region->region_id) &&
         json_buffer_append_cstr(buffer, ",\"layoutId\":") &&
         json_buffer_append_json_string(buffer, region->layout_id) &&
         json_buffer_append_cstr(buffer, ",\"recordByteLength\":") &&
         json_buffer_append_u32(buffer, region->record_byte_length) &&
         json_buffer_append_cstr(buffer, ",\"alignment\":") &&
         json_buffer_append_u32(buffer, region->alignment) &&
         json_buffer_append_cstr(buffer, ",\"recordCount\":") &&
         json_buffer_append_u64(buffer, (uint64_t)region->record_count) &&
         json_buffer_append_char(buffer, '}');
}

static bool append_runtime_host_region_record_json(
    JsonBuffer *buffer,
    const RuntimeHostRegion *region,
    uint32_t record_index) {
  if (!json_buffer_append_cstr(buffer, "{\"regionId\":") ||
      !json_buffer_append_u64(buffer, region->region_id) ||
      !json_buffer_append_cstr(buffer, ",\"recordIndex\":") ||
      !json_buffer_append_u32(buffer, record_index) ||
      !json_buffer_append_cstr(buffer, ",\"layoutId\":") ||
      !json_buffer_append_json_string(buffer, region->layout_id) ||
      !json_buffer_append_cstr(buffer, ",\"recordByteLength\":") ||
      !json_buffer_append_u32(buffer, region->record_byte_length) ||
      !json_buffer_append_cstr(buffer, ",\"alignment\":") ||
      !json_buffer_append_u32(buffer, region->alignment) ||
      !json_buffer_append_cstr(buffer, ",\"byteLength\":") ||
      !json_buffer_append_u32(buffer, region->record_byte_length) ||
      !json_buffer_append_cstr(buffer, ",\"bytes\":[")) {
    return false;
  }
  const uint8_t *record = region->records[record_index];
  for (uint32_t index = 0; index < region->record_byte_length; ++index) {
    if (index > 0 && !json_buffer_append_char(buffer, ',')) {
      return false;
    }
    if (!json_buffer_append_u32(buffer, record[index])) {
      return false;
    }
  }
  return json_buffer_append_cstr(buffer, "]}");
}

static bool parse_json_string_field(
    const char *json,
    size_t length,
    const char *field_name,
    char **value_out) {
  JsonSlice slice;
  return find_json_object_field(json, length, field_name, &slice) &&
         duplicate_json_string_value(slice, value_out);
}

static bool parse_json_optional_string_field(
    const char *json,
    size_t length,
    const char *field_name,
    char **value_out) {
  JsonSlice slice;
  if (!find_json_object_field(json, length, field_name, &slice)) {
    *value_out = NULL;
    return true;
  }
  if (json_slice_is_null(slice)) {
    *value_out = NULL;
    return true;
  }
  return duplicate_json_string_value(slice, value_out);
}

static bool parse_json_string_array_field(
    const char *json,
    size_t length,
    const char *field_name,
    char ***values_out,
    size_t *count_out) {
  JsonSlice slice;
  if (!find_json_object_field(json, length, field_name, &slice)) {
    *values_out = NULL;
    *count_out = 0;
    return true;
  }
  size_t offset = 0;
  skip_json_whitespace(slice.data, slice.length, &offset);
  if (offset >= slice.length || slice.data[offset] != '[') {
    return false;
  }
  offset += 1;
  char **values = NULL;
  size_t value_count = 0;
  size_t value_capacity = 0;
  for (;;) {
    skip_json_whitespace(slice.data, slice.length, &offset);
    if (offset >= slice.length) {
      break;
    }
    if (slice.data[offset] == ']') {
      offset += 1;
      *values_out = values;
      *count_out = value_count;
      return true;
    }
    const size_t value_start = offset;
    if (!consume_json_string(slice.data, slice.length, &offset) ||
        !ensure_runtime_host_capacity(
            (void **)&values,
            &value_capacity,
            value_count,
            sizeof(*values)) ||
        !duplicate_json_string_value(
            (JsonSlice){
                .data = slice.data + value_start,
                .length = offset - value_start,
            },
            &values[value_count])) {
      break;
    }
    value_count += 1;
    skip_json_whitespace(slice.data, slice.length, &offset);
    if (offset >= slice.length) {
      break;
    }
    if (slice.data[offset] == ']') {
      offset += 1;
      *values_out = values;
      *count_out = value_count;
      return true;
    }
    if (slice.data[offset] != ',') {
      break;
    }
    offset += 1;
  }
  for (size_t index = 0; index < value_count; ++index) {
    free(values[index]);
  }
  free(values);
  return false;
}

static bool parse_json_u64_field(
    const char *json,
    size_t length,
    const char *field_name,
    uint64_t *value_out) {
  JsonSlice slice;
  return find_json_object_field(json, length, field_name, &slice) &&
         parse_json_u64(slice, value_out);
}

static bool duplicate_json_field_raw(
    const char *json,
    size_t length,
    const char *field_name,
    char **value_out,
    const char *fallback_json) {
  JsonSlice slice;
  if (!find_json_object_field(json, length, field_name, &slice)) {
    *value_out = strdup(fallback_json);
    return *value_out != NULL;
  }
  return duplicate_json_slice(slice, value_out);
}

static bool parse_record_bytes_array(
    JsonSlice slice,
    uint32_t record_byte_length,
    uint8_t **record_out) {
  uint8_t *record = calloc(record_byte_length, 1);
  if (record == NULL) {
    return false;
  }
  if (json_slice_is_null(slice)) {
    *record_out = record;
    return true;
  }
  size_t offset = 0;
  skip_json_whitespace(slice.data, slice.length, &offset);
  if (offset >= slice.length || slice.data[offset] != '[') {
    free(record);
    return false;
  }
  offset += 1;
  size_t write_index = 0;
  for (;;) {
    skip_json_whitespace(slice.data, slice.length, &offset);
    if (offset >= slice.length) {
      free(record);
      return false;
    }
    if (slice.data[offset] == ']') {
      offset += 1;
      *record_out = record;
      return true;
    }
    size_t value_start = offset;
    if (!consume_json_value(slice.data, slice.length, &offset)) {
      free(record);
      return false;
    }
    uint64_t value = 0;
    JsonSlice value_slice = {
        .data = slice.data + value_start,
        .length = offset - value_start,
    };
    if (!parse_json_u64(value_slice, &value) || value > 255 ||
        write_index >= record_byte_length) {
      free(record);
      return false;
    }
    record[write_index++] = (uint8_t)value;
    skip_json_whitespace(slice.data, slice.length, &offset);
    if (offset >= slice.length) {
      free(record);
      return false;
    }
    if (slice.data[offset] == ']') {
      offset += 1;
      *record_out = record;
      return true;
    }
    if (slice.data[offset] != ',') {
      free(record);
      return false;
    }
    offset += 1;
  }
}

static bool parse_initial_records_field(
    const char *json,
    size_t length,
    uint32_t record_byte_length,
    uint8_t ***records_out,
    size_t *record_count_out) {
  JsonSlice slice;
  if (!find_json_object_field(json, length, "initialRecords", &slice)) {
    *records_out = NULL;
    *record_count_out = 0;
    return true;
  }
  size_t offset = 0;
  skip_json_whitespace(slice.data, slice.length, &offset);
  if (offset >= slice.length || slice.data[offset] != '[') {
    return false;
  }
  offset += 1;
  uint8_t **records = NULL;
  size_t record_count = 0;
  size_t record_capacity = 0;
  for (;;) {
    skip_json_whitespace(slice.data, slice.length, &offset);
    if (offset >= slice.length) {
      break;
    }
    if (slice.data[offset] == ']') {
      offset += 1;
      *records_out = records;
      *record_count_out = record_count;
      return true;
    }
    const size_t value_start = offset;
    if (!consume_json_value(slice.data, slice.length, &offset) ||
        !ensure_runtime_host_capacity(
            (void **)&records,
            &record_capacity,
            record_count,
            sizeof(*records))) {
      break;
    }
    JsonSlice value_slice = {
        .data = slice.data + value_start,
        .length = offset - value_start,
    };
    if (!parse_record_bytes_array(
            value_slice,
            record_byte_length,
            &records[record_count])) {
      break;
    }
    record_count += 1;
    skip_json_whitespace(slice.data, slice.length, &offset);
    if (offset < slice.length && slice.data[offset] == ',') {
      offset += 1;
      continue;
    }
    if (offset < slice.length && slice.data[offset] == ']') {
      offset += 1;
      *records_out = records;
      *record_count_out = record_count;
      return true;
    }
    break;
  }
  for (size_t index = 0; index < record_count; ++index) {
    free(records[index]);
  }
  free(records);
  return false;
}

static bool respond_with_json_buffer(
    JsonBuffer *buffer,
    uint8_t **response_bytes_out,
    uint32_t *response_size_out) {
  *response_bytes_out = json_buffer_detach(buffer, response_size_out);
  return *response_bytes_out != NULL || *response_size_out == 0;
}

static bool dispatch_runtime_host_request(
    RuntimeHostState *state,
    uint8_t opcode,
    const uint8_t *payload_bytes,
    uint32_t payload_size,
    uint8_t **response_bytes_out,
    uint32_t *response_size_out) {
  const char *json = (const char *)payload_bytes;
  const size_t json_length = payload_size;
  JsonBuffer response;
  json_buffer_init(&response);

  if (opcode == HOST_CONTROL_LIST_MODULES) {
    if (!json_buffer_append_char(&response, '[')) {
      goto fail;
    }
    for (size_t index = 0; index < state->module_count; ++index) {
      if (index > 0 && !json_buffer_append_char(&response, ',')) {
        goto fail;
      }
      if (!append_runtime_host_module_json(&response, &state->modules[index])) {
        goto fail;
      }
    }
    if (!json_buffer_append_char(&response, ']')) {
      goto fail;
    }
    return respond_with_json_buffer(&response, response_bytes_out, response_size_out);
  }

  if (opcode == HOST_CONTROL_INSTALL_MODULE) {
    char *module_id = NULL;
    char *wasm_path = NULL;
    char *metadata_json = NULL;
    char **method_ids = NULL;
    size_t method_id_count = 0;
    if (!parse_json_string_field(json, json_length, "moduleId", &module_id) ||
        !parse_json_string_field(json, json_length, "wasmPath", &wasm_path) ||
        !parse_json_string_array_field(
            json,
            json_length,
            "methodIds",
            &method_ids,
            &method_id_count) ||
        !duplicate_json_field_raw(
            json,
            json_length,
            "metadata",
            &metadata_json,
            "null")) {
      free(module_id);
      free(wasm_path);
      free(metadata_json);
      for (size_t index = 0; index < method_id_count; ++index) {
        free(method_ids[index]);
      }
      free(method_ids);
      goto fail;
    }

    size_t module_index = 0;
    const bool creating_module =
        find_runtime_host_module(state, module_id, &module_index) == NULL;
    RuntimeHostModule *module =
        creating_module ? NULL : &state->modules[module_index];
    if (creating_module) {
      if (!ensure_runtime_host_capacity(
              (void **)&state->modules,
              &state->module_capacity,
              state->module_count,
              sizeof(*state->modules))) {
        free(module_id);
        free(wasm_path);
        free(metadata_json);
        for (size_t index = 0; index < method_id_count; ++index) {
          free(method_ids[index]);
        }
        free(method_ids);
        goto fail;
      }
      module = &state->modules[state->module_count++];
      runtime_host_module_init(module);
    } else {
      destroy_runtime_host_module(module);
      runtime_host_module_init(module);
    }
    if (!initialize_runtime_host_module(
            module,
            module_id,
            wasm_path,
            metadata_json,
            method_ids,
            method_id_count)) {
      if (creating_module) {
        state->module_count -= 1;
      }
      goto fail;
    }
    if (!append_runtime_host_module_json(&response, module)) {
      goto fail;
    }
    return respond_with_json_buffer(&response, response_bytes_out, response_size_out);
  }

  if (opcode == HOST_CONTROL_UNLOAD_MODULE) {
    char *module_id = NULL;
    bool unloaded = false;
    if (!parse_json_string_field(json, json_length, "moduleId", &module_id)) {
      free(module_id);
      goto fail;
    }
    size_t module_index = 0;
    RuntimeHostModule *module =
        find_runtime_host_module(state, module_id, &module_index);
    free(module_id);
    if (module != NULL) {
      destroy_runtime_host_module(module);
      memmove(
          &state->modules[module_index],
          &state->modules[module_index + 1],
          (state->module_count - module_index - 1) * sizeof(*state->modules));
      state->module_count -= 1;
      unloaded = true;
    }
    if (!json_buffer_append_cstr(&response, unloaded ? "true" : "false")) {
      goto fail;
    }
    return respond_with_json_buffer(&response, response_bytes_out, response_size_out);
  }

  if (opcode == HOST_CONTROL_INVOKE_MODULE) {
    if (payload_size < 4) {
      goto fail;
    }
    const uint32_t module_id_length = read_le_u32_bytes(payload_bytes);
    if ((uint64_t)payload_size < 4ULL + (uint64_t)module_id_length) {
      goto fail;
    }
    char *module_id = malloc((size_t)module_id_length + 1);
    if (module_id == NULL) {
      goto fail;
    }
    memcpy(module_id, payload_bytes + 4, module_id_length);
    module_id[module_id_length] = '\0';
    RuntimeHostModule *module =
        find_runtime_host_module(state, module_id, NULL);
    free(module_id);
    if (module == NULL) {
      goto fail;
    }
    return invoke_runtime_host_module(
        module,
        payload_bytes + 4 + module_id_length,
        payload_size - 4 - module_id_length,
        response_bytes_out,
        response_size_out);
  }

  if (opcode == HOST_CONTROL_APPEND_ROW) {
    char *schema_file_id = NULL;
    char *payload_json = NULL;
    if (!parse_json_string_field(
            json,
            json_length,
            "schemaFileId",
            &schema_file_id) ||
        !duplicate_json_field_raw(
            json,
            json_length,
            "payload",
            &payload_json,
            "null")) {
      free(schema_file_id);
      free(payload_json);
      goto fail;
    }
    if (!ensure_runtime_host_capacity(
            (void **)&state->rows,
            &state->row_capacity,
            state->row_count,
            sizeof(*state->rows))) {
      free(schema_file_id);
      free(payload_json);
      goto fail;
    }
    RuntimeHostRow *row = &state->rows[state->row_count++];
    row->schema_file_id = schema_file_id;
    row->row_id = next_runtime_host_row_id_for_schema(state, schema_file_id);
    row->payload_json = payload_json;
    if (!json_buffer_append_cstr(&response, "{\"schemaFileId\":") ||
        !json_buffer_append_json_string(&response, row->schema_file_id) ||
        !json_buffer_append_cstr(&response, ",\"rowId\":") ||
        !json_buffer_append_u64(&response, row->row_id) ||
        !json_buffer_append_char(&response, '}')) {
      goto fail;
    }
    return respond_with_json_buffer(&response, response_bytes_out, response_size_out);
  }

  if (opcode == HOST_CONTROL_LIST_ROWS) {
    char *schema_file_id = NULL;
    if (!parse_json_optional_string_field(
            json,
            json_length,
            "schemaFileId",
            &schema_file_id)) {
      free(schema_file_id);
      goto fail;
    }
    if (!json_buffer_append_char(&response, '[')) {
      free(schema_file_id);
      goto fail;
    }
    bool first = true;
    for (size_t index = 0; index < state->row_count; ++index) {
      RuntimeHostRow *row = &state->rows[index];
      if (schema_file_id != NULL &&
          strcmp(row->schema_file_id, schema_file_id) != 0) {
        continue;
      }
      if (!first && !json_buffer_append_char(&response, ',')) {
        free(schema_file_id);
        goto fail;
      }
      first = false;
      if (!append_runtime_host_row_json(&response, row)) {
        free(schema_file_id);
        goto fail;
      }
    }
    free(schema_file_id);
    if (!json_buffer_append_char(&response, ']')) {
      goto fail;
    }
    return respond_with_json_buffer(&response, response_bytes_out, response_size_out);
  }

  if (opcode == HOST_CONTROL_RESOLVE_ROW) {
    char *schema_file_id = NULL;
    uint64_t row_id = 0;
    if (!parse_json_string_field(json, json_length, "schemaFileId", &schema_file_id) ||
        !parse_json_u64_field(json, json_length, "rowId", &row_id)) {
      free(schema_file_id);
      goto fail;
    }
    RuntimeHostRow *row = find_runtime_host_row(state, schema_file_id, row_id);
    free(schema_file_id);
    if (row == NULL) {
      if (!json_buffer_append_cstr(&response, "null")) {
        goto fail;
      }
    } else if (!append_runtime_host_row_json(&response, row)) {
      goto fail;
    }
    return respond_with_json_buffer(&response, response_bytes_out, response_size_out);
  }

  if (opcode == HOST_CONTROL_QUERY_ROWS) {
    char *sql = NULL;
    char *schema_file_id_filter = NULL;
    if (!parse_json_string_field(json, json_length, "sql", &sql)) {
      free(sql);
      goto fail;
    }
    const char *runtime_rows_query_prefix =
        "SELECT schemaFileId, rowId FROM RuntimeHostRow";
    if (strstr(sql, runtime_rows_query_prefix) != sql) {
      free(sql);
      goto fail;
    }
    const char *where_prefix = "WHERE schemaFileId = '";
    const char *where_clause = strstr(sql, where_prefix);
    if (where_clause != NULL) {
      const char *schema_start = where_clause + strlen(where_prefix);
      const char *schema_end = strchr(schema_start, '\'');
      if (schema_end == NULL) {
        free(sql);
        goto fail;
      }
      const size_t schema_length = (size_t)(schema_end - schema_start);
      schema_file_id_filter = malloc(schema_length + 1);
      if (schema_file_id_filter == NULL) {
        free(sql);
        goto fail;
      }
      memcpy(schema_file_id_filter, schema_start, schema_length);
      schema_file_id_filter[schema_length] = '\0';
    }
    const bool appended = append_runtime_host_row_query_result_json(
        &response,
        state,
        schema_file_id_filter);
    free(schema_file_id_filter);
    free(sql);
    if (!appended) {
      goto fail;
    }
    return respond_with_json_buffer(&response, response_bytes_out, response_size_out);
  }

  if (opcode == HOST_CONTROL_ALLOCATE_REGION) {
    char *layout_id = NULL;
    uint64_t record_byte_length_u64 = 0;
    uint64_t alignment_u64 = 1;
    uint8_t **records = NULL;
    size_t record_count = 0;
    if (!parse_json_string_field(json, json_length, "layoutId", &layout_id) ||
        !parse_json_u64_field(
            json,
            json_length,
            "recordByteLength",
            &record_byte_length_u64)) {
      free(layout_id);
      goto fail;
    }
    JsonSlice alignment_slice;
    if (find_json_object_field(json, json_length, "alignment", &alignment_slice) &&
        !parse_json_u64(alignment_slice, &alignment_u64)) {
      free(layout_id);
      goto fail;
    }
    if (record_byte_length_u64 == 0 || record_byte_length_u64 > UINT32_MAX ||
        alignment_u64 == 0 || alignment_u64 > UINT16_MAX ||
        !parse_initial_records_field(
            json,
            json_length,
            (uint32_t)record_byte_length_u64,
            &records,
            &record_count) ||
        !ensure_runtime_host_capacity(
            (void **)&state->regions,
            &state->region_capacity,
            state->region_count,
            sizeof(*state->regions))) {
      free(layout_id);
      for (size_t index = 0; index < record_count; ++index) {
        free(records[index]);
      }
      free(records);
      goto fail;
    }
    RuntimeHostRegion *region = &state->regions[state->region_count++];
    memset(region, 0, sizeof(*region));
    region->region_id = state->next_region_id++;
    region->layout_id = layout_id;
    region->record_byte_length = (uint32_t)record_byte_length_u64;
    region->alignment = (uint16_t)alignment_u64;
    region->records = records;
    region->record_count = record_count;
    if (!append_runtime_host_region_descriptor_json(&response, region)) {
      goto fail;
    }
    return respond_with_json_buffer(&response, response_bytes_out, response_size_out);
  }

  if (opcode == HOST_CONTROL_DESCRIBE_REGION) {
    uint64_t region_id = 0;
    if (!parse_json_u64_field(json, json_length, "regionId", &region_id)) {
      goto fail;
    }
    RuntimeHostRegion *region = find_runtime_host_region(state, region_id);
    if (region == NULL) {
      if (!json_buffer_append_cstr(&response, "null")) {
        goto fail;
      }
    } else if (!append_runtime_host_region_descriptor_json(&response, region)) {
      goto fail;
    }
    return respond_with_json_buffer(&response, response_bytes_out, response_size_out);
  }

  if (opcode == HOST_CONTROL_RESOLVE_RECORD) {
    uint64_t region_id = 0;
    uint64_t record_index_u64 = 0;
    if (!parse_json_u64_field(json, json_length, "regionId", &region_id) ||
        !parse_json_u64_field(json, json_length, "recordIndex", &record_index_u64)) {
      goto fail;
    }
    RuntimeHostRegion *region = find_runtime_host_region(state, region_id);
    if (region == NULL || record_index_u64 >= region->record_count) {
      if (!json_buffer_append_cstr(&response, "null")) {
        goto fail;
      }
    } else if (!append_runtime_host_region_record_json(
                   &response,
                   region,
                   (uint32_t)record_index_u64)) {
      goto fail;
    }
    return respond_with_json_buffer(&response, response_bytes_out, response_size_out);
  }

fail:
  json_buffer_free(&response);
  return false;
}

static bool serve_runtime_host_requests(void) {
  RuntimeHostState state;
  runtime_host_state_init(&state);
  bool ok = true;

  for (;;) {
    uint8_t length_bytes[4];
    const size_t prefix_read = fread(length_bytes, 1, sizeof(length_bytes), stdin);
    if (prefix_read == 0) {
      ok = feof(stdin);
      break;
    }
    if (prefix_read != sizeof(length_bytes)) {
      ok = false;
      break;
    }
    const uint32_t request_size = read_le_u32_bytes(length_bytes);
    uint8_t *request_bytes = NULL;
    if (request_size > 0) {
      request_bytes = malloc(request_size);
      if (request_bytes == NULL || !read_exact(stdin, request_bytes, request_size)) {
        free(request_bytes);
        ok = false;
        break;
      }
    }
    if (request_size < 5 ||
        memcmp(request_bytes, HOST_CONTROL_MAGIC, sizeof(HOST_CONTROL_MAGIC)) != 0) {
      free(request_bytes);
      ok = false;
      break;
    }
    uint8_t *response_bytes = NULL;
    uint32_t response_size = 0;
    ok = dispatch_runtime_host_request(
        &state,
        request_bytes[4],
        request_bytes + 5,
        request_size - 5,
        &response_bytes,
        &response_size);
    free(request_bytes);
    if (!ok) {
      free(response_bytes);
      break;
    }
    const uint8_t response_length_bytes[4] = {
        (uint8_t)(response_size & 0xFFU),
        (uint8_t)((response_size >> 8) & 0xFFU),
        (uint8_t)((response_size >> 16) & 0xFFU),
        (uint8_t)((response_size >> 24) & 0xFFU),
    };
    ok = write_all(stdout, response_length_bytes, sizeof(response_length_bytes)) &&
         write_all(stdout, response_bytes, response_size);
    free(response_bytes);
    if (!ok) {
      break;
    }
  }

  runtime_host_state_destroy(&state);
  return ok;
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
    fprintf(
        stderr,
        "usage: %s module.wasm [module-args...] | %s --serve-runtime-host\n",
        argv[0],
        argv[0]);
    return 2;
  }
  const bool serve_runtime_host =
      argc >= 2 && strcmp(argv[1], "--serve-runtime-host") == 0;
  if (serve_runtime_host) {
    return serve_runtime_host_requests() ? 0 : 1;
  }
  const bool serve_plugin_invoke =
      argc >= 3 && strcmp(argv[2], "--serve-plugin-invoke") == 0;

  WasmEdge_ConfigureContext *conf = WasmEdge_ConfigureCreate();
  WasmEdge_ConfigureAddProposal(conf, WasmEdge_Proposal_Threads);
  WasmEdge_ConfigureAddProposal(conf, WasmEdge_Proposal_ExceptionHandling);
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

  WasmEdge_ModuleInstanceContext *wasi = WasmEdge_ModuleInstanceCreateWASI(
      (const char *const *)(argv + 1),
      (uint32_t)(argc - 1),
      NULL,
      0,
      NULL,
      0);
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
          : import_config.receive_on_main_thread_param_len == 7 ? 7 : 5,
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

  if (!invoke_optional_module_init(executor, mod, serve_plugin_invoke)) {
    return 3;
  }

  uint32_t exit_code = WasmEdge_ModuleInstanceWASIGetExitCode(wasi);
  if (serve_plugin_invoke) {
    if (!serve_plugin_invoke_requests(executor, mod, &runner)) {
      exit_code = 1;
    } else {
      exit_code = 0;
    }
  }

  WasmEdge_ASTModuleDelete(ast);
  WasmEdge_StoreDelete(store);
  WasmEdge_ExecutorDelete(executor);
  WasmEdge_ValidatorDelete(validator);
  WasmEdge_LoaderDelete(loader);
  WasmEdge_ConfigureDelete(conf);
  pthread_mutex_destroy(&runner.store_mutex);
  return (int)exit_code;
}
