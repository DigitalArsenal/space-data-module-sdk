// WASI preview1 command host for the SDK parity lanes. WasmEdge 0.16.4's
// CLI enables atomics but does not implement wasi.thread-spawn. Like the SDN
// Go host, use a fresh instance per worker, shared memory, and ONE executor:
// atomic.wait/notify waiters belong to the executor in this runtime revision.
#define _POSIX_C_SOURCE 200809L
#include <wasmedge/wasmedge.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define MAX_WORKERS 32

typedef struct {
  WasmEdge_ModuleInstanceContext *instance;
  WasmEdge_Async *async;
} Worker;

typedef struct {
  WasmEdge_ExecutorContext *executor;
  WasmEdge_StoreContext *store;
  WasmEdge_ASTModuleContext *ast;
  pthread_mutex_t mutex;
  Worker workers[MAX_WORKERS];
  int32_t next_tid;
  bool closed;
  bool failed;
  bool exited;
} Threads;

static WasmEdge_String name(const char *s) {
  return WasmEdge_StringWrap(s, (uint32_t)strlen(s));
}

static uint64_t monotonic_ms(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000;
}

static bool wait_until(WasmEdge_Async *call, uint64_t deadline) {
  uint64_t now = monotonic_ms();
  return WasmEdge_AsyncWaitFor(call, now < deadline ? deadline - now : 0);
}

static void require_result(const char *step, WasmEdge_Result result) {
  if (!WasmEdge_ResultOK(result)) {
    fprintf(stderr, "wasm trap: %s: %s\n", step,
            WasmEdge_ResultGetMessage(result));
    exit(1);
  }
}

// Called with the mutex held. Only release instances after execution ends.
static void reap(Threads *g) {
  for (size_t i = 0; i < MAX_WORKERS; ++i) {
    Worker *w = &g->workers[i];
    if (!w->async || !WasmEdge_AsyncWaitFor(w->async, 0)) continue;
    WasmEdge_Result result = WasmEdge_AsyncGet(w->async, NULL, 0);
    if (WasmEdge_ResultGetCode(result) == WasmEdge_ErrCode_Terminated) {
      g->exited = true;
      g->closed = true;
    } else if (!WasmEdge_ResultOK(result)) {
      fprintf(stderr, "wasm trap: wasi worker: %s\n",
              WasmEdge_ResultGetMessage(result));
      g->failed = true;
      g->closed = true;
    }
    WasmEdge_AsyncDelete(w->async);
    WasmEdge_ModuleInstanceDelete(w->instance);
    *w = (Worker){0};
  }
}

static WasmEdge_Result thread_spawn(void *data,
    const WasmEdge_CallingFrameContext *frame, const WasmEdge_Value *in,
    WasmEdge_Value *out) {
  Threads *g = data;
  out[0] = WasmEdge_ValueGenI32(-6); // WASI EAGAIN: caller may retry or run inline.
  pthread_mutex_lock(&g->mutex);
  if (g->closed) goto done;
  reap(g);
  if (g->closed || g->next_tid >= (1 << 29)) goto done;
  Worker *w = NULL;
  for (size_t i = 0; i < MAX_WORKERS; ++i) {
    if (!g->workers[i].async) { w = &g->workers[i]; break; }
  }
  if (!w) goto done;
  WasmEdge_Result result = WasmEdge_ExecutorInstantiate(
      WasmEdge_CallingFrameGetExecutor(frame), &w->instance, g->store, g->ast);
  if (!WasmEdge_ResultOK(result)) goto discard;
  const WasmEdge_FunctionInstanceContext *entry =
      WasmEdge_ModuleInstanceFindFunction(w->instance, name("wasi_thread_start"));
  if (!entry) goto discard;
  int32_t tid = g->next_tid++;
  WasmEdge_Value args[] = {WasmEdge_ValueGenI32(tid), in[0]};
  w->async = WasmEdge_ExecutorAsyncInvoke(WasmEdge_CallingFrameGetExecutor(frame), entry, args, 2);
  if (!w->async) goto discard;
  out[0] = WasmEdge_ValueGenI32(tid);
  goto done;
discard:
  if (w->instance) WasmEdge_ModuleInstanceDelete(w->instance);
  *w = (Worker){0};
done:
  pthread_mutex_unlock(&g->mutex);
  return WasmEdge_Result_Success;
}

static WasmEdge_ModuleInstanceContext *memory_import(Threads *g) {
  uint32_t count = WasmEdge_ASTModuleListImportsLength(g->ast);
  const WasmEdge_ImportTypeContext **imports = calloc(count, sizeof(*imports));
  if (count && !imports) exit(1);
  WasmEdge_ASTModuleListImports(g->ast, imports, count);
  WasmEdge_ModuleInstanceContext *env = NULL;
  bool threaded = false;
  for (uint32_t i = 0; i < count; ++i) {
    WasmEdge_String mod = WasmEdge_ImportTypeGetModuleName(imports[i]);
    WasmEdge_String field = WasmEdge_ImportTypeGetExternalName(imports[i]);
    if (WasmEdge_StringIsEqual(mod, name("wasi")) &&
        WasmEdge_StringIsEqual(field, name("thread-spawn"))) threaded = true;
    if (WasmEdge_ImportTypeGetExternalType(imports[i]) !=
        WasmEdge_ExternalType_Memory) continue;
    if (env || !WasmEdge_StringIsEqual(mod, name("env")) ||
        !WasmEdge_StringIsEqual(field, name("memory"))) {
      fprintf(stderr, "unsupported imported memory: expected one env.memory\n");
      exit(1);
    }
    const WasmEdge_MemoryTypeContext *type =
        WasmEdge_ImportTypeGetMemoryType(g->ast, imports[i]);
    WasmEdge_Limit limit = WasmEdge_MemoryTypeGetLimit(type);
    if (!limit.Shared || !limit.HasMax) {
      fprintf(stderr, "WASI threads require bounded shared memory\n");
      exit(1);
    }
    env = WasmEdge_ModuleInstanceCreate(name("env"));
    WasmEdge_MemoryInstanceContext *memory = WasmEdge_MemoryInstanceCreate(type);
    if (!env || !memory) exit(1);
    WasmEdge_ModuleInstanceAddMemory(env, name("memory"), memory);
    require_result("register memory", WasmEdge_ExecutorRegisterImport(
        g->executor, g->store, env));
  }
  free(imports);
  if (threaded && !env) {
    fprintf(stderr, "WASI threads require imported shared memory\n");
    exit(1);
  }
  return env;
}

// Reactor artifacts use the same PIV request/response bytes as commands. Stage
// the request through the public allocator, then monitor the direct call with
// the same worker-group lifecycle as _start. No guest ABI is reimplemented.
static uint32_t stage_direct_request(Threads *g,
    WasmEdge_ModuleInstanceContext *instance,
    WasmEdge_MemoryInstanceContext *memory, WasmEdge_Value args[3]) {
  size_t size = 0, capacity = 4096;
  uint8_t *input = malloc(capacity);
  if (!input) exit(1);
  for (;;) {
    size += fread(input + size, 1, capacity - size, stdin);
    if (ferror(stdin)) { fprintf(stderr, "failed to read stdin\n"); exit(1); }
    if (feof(stdin)) break;
    if (capacity >= (1U << 30)) { fprintf(stderr, "request exceeds 1 GiB\n"); exit(1); }
    capacity *= 2;
    uint8_t *grown = realloc(input, capacity);
    if (!grown) exit(1);
    input = grown;
  }
  const WasmEdge_FunctionInstanceContext *init =
      WasmEdge_ModuleInstanceFindFunction(instance, name("_initialize"));
  if (init) require_result("initialize", WasmEdge_ExecutorInvoke(g->executor, init, NULL, 0, NULL, 0));
  const WasmEdge_FunctionInstanceContext *alloc =
      WasmEdge_ModuleInstanceFindFunction(instance, name("plugin_alloc"));
  if (!alloc || !memory) { fprintf(stderr, "direct module requires plugin_alloc and memory\n"); exit(1); }
  uint32_t padded = ((uint32_t)size + 7U) & ~7U;
  WasmEdge_Value allocation_size = WasmEdge_ValueGenI32((int32_t)(padded + 4));
  WasmEdge_Value pointer;
  require_result("allocate", WasmEdge_ExecutorInvoke(g->executor, alloc, &allocation_size, 1, &pointer, 1));
  uint32_t ptr = (uint32_t)WasmEdge_ValueGetI32(pointer);
  if (!ptr || ptr % 8) { fprintf(stderr, "invalid direct allocation\n"); exit(1); }
  uint32_t length_ptr = ptr + padded;
  const uint8_t zero[4] = {0};
  require_result("copy request", WasmEdge_MemoryInstanceSetData(memory, input, ptr, (uint32_t)size));
  require_result("clear response length", WasmEdge_MemoryInstanceSetData(memory, zero, length_ptr, 4));
  free(input);
  args[0] = pointer;
  args[1] = WasmEdge_ValueGenI32((int32_t)size);
  args[2] = WasmEdge_ValueGenI32((int32_t)length_ptr);
  return length_ptr;
}

static bool write_direct_response(WasmEdge_MemoryInstanceContext *memory,
    uint32_t ptr, uint32_t length_ptr) {
  uint8_t bytes[4];
  require_result("read response length", WasmEdge_MemoryInstanceGetData(memory, bytes, length_ptr, 4));
  uint32_t length = (uint32_t)bytes[0] | (uint32_t)bytes[1] << 8 |
      (uint32_t)bytes[2] << 16 | (uint32_t)bytes[3] << 24;
  if (!ptr || ptr % 8 || !length) {
    fprintf(stderr, "invalid direct response\n");
    return false;
  }
  const uint8_t *data = WasmEdge_MemoryInstanceGetPointerConst(memory, ptr, length);
  if (!data) { fprintf(stderr, "direct response is out of bounds\n"); return false; }
  return fwrite(data, 1, length, stdout) == length;
}

int main(int argc, char **argv) {
  if (strcmp(WasmEdge_VersionGet(), "0.16.4") != 0) {
    fprintf(stderr, "WASI threads runner requires WasmEdge 0.16.4; linked %s\n", WasmEdge_VersionGet());
    return 2;
  }
  if (argc == 2 && strcmp(argv[1], "--version") == 0) {
    printf("wasmedge version %s\nsdm-wasi-threads-runner 1\n",
           WasmEdge_VersionGet());
    return 0;
  }
  // WasmEdge's default logger writes to stdout. Guest stdout is binary; all
  // host diagnostics below are emitted to stderr instead.
  WasmEdge_LogOff();
  const char **envs = calloc((size_t)argc, sizeof(*envs));
  if (!envs) return 1;
  uint32_t env_count = 0;
  bool stats = false;
  int first = 1;
  for (; first < argc; ++first) {
    if (strcmp(argv[first], "--enable-threads") == 0) continue;
    if (strcmp(argv[first], "--sdm-thread-stats") == 0) { stats = true; continue; }
    if (strcmp(argv[first], "--env") == 0 && first + 1 < argc) {
      envs[env_count++] = argv[++first];
      continue;
    }
    break;
  }
  if (first >= argc || argv[first][0] == '-') {
    fprintf(stderr, "usage: %s [--env NAME=VALUE] module.wasm [args...]\n", argv[0]);
    free(envs);
    return 2;
  }
  WasmEdge_ConfigureContext *conf = WasmEdge_ConfigureCreate();
  WasmEdge_ConfigureAddProposal(conf, WasmEdge_Proposal_Threads);
  WasmEdge_LoaderContext *loader = WasmEdge_LoaderCreate(conf);
  WasmEdge_ValidatorContext *validator = WasmEdge_ValidatorCreate(conf);
  Threads g = {.executor = WasmEdge_ExecutorCreate(conf, NULL),
               .store = WasmEdge_StoreCreate(), .next_tid = 1};
  if (pthread_mutex_init(&g.mutex, NULL) != 0) return 1;
  require_result("parse", WasmEdge_LoaderParseFromFile(loader, &g.ast, argv[first]));
  require_result("validate", WasmEdge_ValidatorValidate(validator, g.ast));
  WasmEdge_ModuleInstanceContext *wasi = WasmEdge_ModuleInstanceCreateWASI(
      (const char *const *)(argv + first), (uint32_t)(argc - first),
      envs, env_count, NULL, 0);
  free(envs);
  if (!wasi) return 1;
  require_result("register WASI", WasmEdge_ExecutorRegisterImport(
      g.executor, g.store, wasi));
  WasmEdge_ModuleInstanceContext *env = memory_import(&g);
  WasmEdge_ModuleInstanceContext *threads = WasmEdge_ModuleInstanceCreate(name("wasi"));
  WasmEdge_ValType i32 = WasmEdge_ValTypeGenI32();
  WasmEdge_FunctionTypeContext *type = WasmEdge_FunctionTypeCreate(&i32, 1, &i32, 1);
  WasmEdge_FunctionInstanceContext *spawn = WasmEdge_FunctionInstanceCreate(
      type, thread_spawn, &g, 0);
  WasmEdge_FunctionTypeDelete(type);
  if (!threads || !spawn) return 1;
  WasmEdge_ModuleInstanceAddFunction(threads, name("thread-spawn"), spawn);
  require_result("register wasi threads", WasmEdge_ExecutorRegisterImport(
      g.executor, g.store, threads));
  WasmEdge_ModuleInstanceContext *instance = NULL;
  require_result("instantiate", WasmEdge_ExecutorInstantiate(
      g.executor, &instance, g.store, g.ast));
  const WasmEdge_FunctionInstanceContext *start =
      WasmEdge_ModuleInstanceFindFunction(instance, name("_start"));
  bool direct = start == NULL;
  WasmEdge_Value direct_args[3], response_pointer;
  uint32_t response_length_ptr = 0;
  WasmEdge_MemoryInstanceContext *memory = env
      ? WasmEdge_ModuleInstanceFindMemory(env, name("memory"))
      : WasmEdge_ModuleInstanceFindMemory(instance, name("memory"));
  if (direct) {
    start = WasmEdge_ModuleInstanceFindFunction(instance, name("plugin_invoke_stream"));
    if (!start) { fprintf(stderr, "module has neither _start nor plugin_invoke_stream\n"); return 1; }
    response_length_ptr = stage_direct_request(&g, instance, memory, direct_args);
  }
  WasmEdge_Async *main_call = WasmEdge_ExecutorAsyncInvoke(g.executor, start,
      direct ? direct_args : NULL, direct ? 3 : 0);
  if (!main_call) return 1;
  for (;;) {
    bool finished = WasmEdge_AsyncWaitFor(main_call, 1);
    pthread_mutex_lock(&g.mutex);
    reap(&g);
    bool stop = finished || g.failed || g.exited;
    if (stop) g.closed = true;
    pthread_mutex_unlock(&g.mutex);
    if (stop) break;
  }
  // Exit/trap in any thread ends the whole command. Cancel all executions
  // before releasing shared memory; a stuck cancellation ends this process
  // without freeing objects underneath live native workers.
  uint64_t deadline = monotonic_ms() + 2000;
  if (!WasmEdge_AsyncWaitFor(main_call, 0)) WasmEdge_AsyncCancel(main_call);
  pthread_mutex_lock(&g.mutex);
  for (size_t i = 0; i < MAX_WORKERS; ++i) {
    if (g.workers[i].async) WasmEdge_AsyncCancel(g.workers[i].async);
  }
  pthread_mutex_unlock(&g.mutex);
  if (!wait_until(main_call, deadline)) {
    fprintf(stderr, "wasm trap: main cancellation timed out\n");
    fflush(NULL);
    _Exit(1);
  }
  WasmEdge_Result result = WasmEdge_AsyncGet(main_call,
      direct ? &response_pointer : NULL, direct ? 1 : 0);
  bool failed = g.failed || (!WasmEdge_ResultOK(result) && !g.exited);
  if (failed) fprintf(stderr, "wasm trap: command: %s\n", WasmEdge_ResultGetMessage(result));
  for (size_t i = 0; i < MAX_WORKERS; ++i) {
    Worker *w = &g.workers[i];
    if (!w->async) continue;
    if (!wait_until(w->async, deadline)) {
      fprintf(stderr, "wasm trap: worker cancellation timed out\n");
      fflush(NULL);
      _Exit(1);
    }
    WasmEdge_AsyncDelete(w->async);
    WasmEdge_ModuleInstanceDelete(w->instance);
  }
  if (stats) fprintf(stderr, "sdm-wasi-threads: spawned=%d\n", g.next_tid - 1);
  if (direct && !failed && !g.exited) {
    failed = !write_direct_response(memory, (uint32_t)WasmEdge_ValueGetI32(response_pointer), response_length_ptr);
  }
  int exit_code = failed ? 1 : (int)WasmEdge_ModuleInstanceWASIGetExitCode(wasi);
  WasmEdge_AsyncDelete(main_call);
  WasmEdge_ModuleInstanceDelete(instance);
  WasmEdge_ModuleInstanceDelete(threads);
  if (env) WasmEdge_ModuleInstanceDelete(env);
  WasmEdge_ModuleInstanceDelete(wasi);
  WasmEdge_StoreDelete(g.store);
  WasmEdge_ASTModuleDelete(g.ast);
  WasmEdge_ExecutorDelete(g.executor);
  WasmEdge_ValidatorDelete(validator);
  WasmEdge_LoaderDelete(loader);
  WasmEdge_ConfigureDelete(conf);
  pthread_mutex_destroy(&g.mutex);
  return exit_code;
}
