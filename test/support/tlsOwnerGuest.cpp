#include <stdint.h>
#include <pthread.h>
#define EXPORT(n) extern "C" __attribute__((export_name(n)))

thread_local volatile uint32_t tls_words[8192];
static int constructor_spawn_result = -1;
EXPORT("tls_address") uintptr_t tls_address() {
  return reinterpret_cast<uintptr_t>(&tls_words[0]);
}
EXPORT("tls_get") uint32_t tls_get() { return tls_words[7000]; }
EXPORT("tls_set") void tls_set() { tls_words[7000] = 0x12345678; }
EXPORT("stack_top") uintptr_t stack_top() {
  pthread_attr_t attr;
  void* base;
  size_t bytes;
  pthread_getattr_np(pthread_self(), &attr);
  pthread_attr_getstack(&attr, &base, &bytes);
  pthread_attr_destroy(&attr);
  return reinterpret_cast<uintptr_t>(base) + bytes;
}
EXPORT("stack_write") __attribute__((noinline)) uint32_t stack_write() {
  volatile uint32_t words[10000];
  for (unsigned i = 0; i < 10000; ++i) words[i] = 0xabcdef00u + i;
  return words[9999];
}
static void* child(void*) { tls_words[7000] = 1; return nullptr; }
EXPORT("spawn") int spawn() {
  pthread_t thread;
  int rc = pthread_create(&thread, nullptr, child, nullptr);
  return rc ? rc : pthread_join(thread, nullptr);
}
struct Initializer {
  Initializer() { tls_set(); constructor_spawn_result = spawn(); }
} initializer;
EXPORT("constructor_result") int constructor_result() { return constructor_spawn_result; }
EXPORT("probe") int probe() { return 0; }
int main() { return 0; }
