// C++ guest-side hostcall as an SDS $PIV invocation (module -> host), replacing the JSON meta + binary segments
// envelope: PIVRequest.METHOD_ID is the operation and PAYLOAD_ARENA holds its frames, named by TAB.PORT_ID - the
// "params" aligned record (schemas/runtime/HostOps.fbs, FlatBuffers aligned binary layout), list ports (runs of aligned
// records) and raw ports (unbounded bytes: bodies, record streams, urls, sql). The PIVResponse carries the "result"
// record and the operation's list / raw ports, or STATUS FAILED with ERROR_CODE / ERROR_MESSAGE. HOST_OPERATIONS in
// src/standards/runtimeContracts.js names each operation's frames. The same space_data_module_host.call import carries it.
//
// Include paths: the SDK-generated "sds/PIV/main_generated.h" (as every SDK-compiled module has), the runtime headers
// (src/generated/runtime/cpp: HostOps_aligned.h) and flatbuffers.
//
//   sdn::runtime::Aligned::StorageExpireParams p{};
//   sdm_piv::put(p.SCHEMA, "WXF.fbs"); p.set_has_SCHEMA(true);
//   p.BEFORE_MS = cutoff_ms;
//   auto r = sdm_piv::call("storage.expire", "StorageExpireParams", p);
//   if (const auto* out = r.result<sdn::runtime::Aligned::StorageExpireResult>()) { out->DELETED; } else { r.error_message(); }
//
//   auto get = sdm_piv::call("http.request", "HttpParams", http, {sdm_piv::raw("url", url)});
//   std::string_view body = get.raw("body");
#ifndef SDM_PIV_HOSTCALL_HPP
#define SDM_PIV_HOSTCALL_HPP

#include <cstdint>
#include <cstring>
#include <initializer_list>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "sds/PIV/main_generated.h"
#include "HostOps_aligned.h"

extern "C" {
#if defined(__wasm__)
__attribute__((import_module("space_data_module_host"), import_name("call")))
#endif
int32_t sdm_piv_host_call(const uint8_t* op_ptr, int32_t op_len, const uint8_t* payload_ptr, int32_t payload_len);
#if defined(__wasm__)
__attribute__((import_module("space_data_module_host"), import_name("response_len")))
#endif
int32_t sdm_piv_host_response_len(void);
#if defined(__wasm__)
__attribute__((import_module("space_data_module_host"), import_name("read_response")))
#endif
int32_t sdm_piv_host_read_response(uint8_t* dst_ptr, int32_t dst_len);
}

namespace sdm_piv {

constexpr uint32_t kArenaAlignment = 8;  // the SDK invoke codec's PAYLOAD_ARENA alignment (INVOKE_ARENA_ALIGNMENT)
constexpr const char* kHostOpsSchema = "HostOps.fbs";

/// Set an aligned string; false (and the field left empty) when the value does not fit - never truncated.
template <size_t N>
inline bool put(flatbuffers::aligned_runtime::AlignedString<N>& field, std::string_view value) {
  if (value.size() > N) { field.clear(); return false; }
  field.set(std::string(value));
  return true;
}

/// A frame of the call: an aligned record or a run of them (root_type set), or raw bytes (root_type null).
struct Frame {
  const char* port;
  const uint8_t* data;
  size_t size;
  const char* root_type = nullptr;
  uint32_t byte_length = 0;  // the record stride; 0 = a run of records (a variable-length aligned stream)
  uint16_t alignment = 1;
};
inline Frame raw(const char* port, std::string_view bytes) {
  return {port, reinterpret_cast<const uint8_t*>(bytes.data()), bytes.size()};
}
inline Frame raw(const char* port, const uint8_t* data, size_t size) { return {port, data, size}; }
/// A list port: `count` records of T back to back.
template <typename T>
inline Frame list(const char* port, const char* root_type, const T* items, size_t count) {
  return {port, reinterpret_cast<const uint8_t*>(items), sizeof(T) * count, root_type, 0, static_cast<uint16_t>(alignof(T))};
}

/// The host's $PIV response.
class Response {
 public:
  explicit Response(std::vector<uint8_t> bytes, std::string transport_error = {})
      : bytes_(std::move(bytes)), error_(std::move(transport_error)) {
    if (!error_.empty()) return;
    flatbuffers::Verifier verifier(bytes_.data(), bytes_.size());
    if (!VerifyPIVBuffer(verifier) || !GetPIV(bytes_.data())->RESPONSE()) error_ = "host answered without a $PIV response";
  }
  const PIVResponse* get() const { return error_.empty() ? GetPIV(bytes_.data())->RESPONSE() : nullptr; }
  bool ok() const { const auto* r = get(); return r && r->STATUS() == pivStatus_OK && !r->ERROR_CODE(); }
  std::string error_code() const {
    const auto* r = get();
    return !r ? "failed" : r->ERROR_CODE() ? r->ERROR_CODE()->str() : (ok() ? "" : "failed");
  }
  std::string error_message() const {
    if (!error_.empty()) return error_;
    const auto* r = get();
    return r && r->ERROR_MESSAGE() ? r->ERROR_MESSAGE()->str() : std::string();
  }
  /// The bytes of output port `port` (empty when the call failed or the port is absent).
  std::string_view raw(const char* port) const {
    const auto [data, size] = frame(port, nullptr);
    return {reinterpret_cast<const char*>(data), size};
  }
  /// The "result" record as T, read in place (nullptr when the call failed or the frame is not one T).
  template <typename T>
  const T* result(const char* root_type = nullptr) const {
    const auto [data, size] = frame("result", root_type);
    return data && size == sizeof(T) && reinterpret_cast<uintptr_t>(data) % alignof(T) == 0 ? T::fromBytes(data) : nullptr;
  }
  /// A list port as `count` records of T, read in place.
  template <typename T>
  std::pair<const T*, size_t> list(const char* port, const char* root_type = nullptr) const {
    const auto [data, size] = frame(port, root_type);
    if (!data || size % sizeof(T) || reinterpret_cast<uintptr_t>(data) % alignof(T)) return {nullptr, 0};
    return {T::fromBytes(data), size / sizeof(T)};
  }

 private:
  std::pair<const uint8_t*, size_t> frame(const char* port, const char* root_type) const {
    const auto* r = get();
    if (!ok() || !r->OUTPUTS() || !r->PAYLOAD_ARENA()) return {nullptr, 0};
    for (const auto* tab : *r->OUTPUTS()) {
      if (!tab->PORT_ID() || tab->PORT_ID()->str() != port) continue;
      if (root_type && (!tab->TYPE_REF() || !tab->TYPE_REF()->ROOT_TYPE() || tab->TYPE_REF()->ROOT_TYPE()->str() != root_type)) return {nullptr, 0};
      const uint64_t end = static_cast<uint64_t>(tab->OFFSET()) + tab->SIZE();
      if (end > r->PAYLOAD_ARENA()->size()) return {nullptr, 0};
      return {r->PAYLOAD_ARENA()->data() + tab->OFFSET(), tab->SIZE()};
    }
    return {nullptr, 0};
  }
  std::vector<uint8_t> bytes_;
  std::string error_;
};

/// Call an operation with its frames (the "params" record first when it takes one - see call() below).
inline Response call_frames(const char* op, const std::vector<Frame>& frames) {
  std::vector<uint8_t> arena;
  std::vector<TABT> tabs;
  for (const Frame& f : frames) {
    const uint32_t align = f.alignment > kArenaAlignment ? f.alignment : kArenaAlignment;
    arena.resize((arena.size() + align - 1) / align * align, 0);
    TABT tab;
    tab.OFFSET = static_cast<uint32_t>(arena.size());
    tab.SIZE = static_cast<uint32_t>(f.size);
    tab.ALIGNMENT = align;
    tab.PORT_ID = f.port;
    if (f.root_type) {
      tab.WIRE_FORMAT = payloadWireFormat_ALIGNED_BINARY;
      tab.TYPE_REF = std::make_unique<FlatBufferTypeRefT>();
      tab.TYPE_REF->SCHEMA_NAME = kHostOpsSchema;
      tab.TYPE_REF->ROOT_TYPE = f.root_type;
      tab.TYPE_REF->WIRE_FORMAT = payloadWireFormat_ALIGNED_BINARY;
      tab.TYPE_REF->BYTE_LENGTH = f.byte_length;
      tab.TYPE_REF->REQUIRED_ALIGNMENT = f.alignment;
    }
    arena.insert(arena.end(), f.data, f.data + f.size);
    tabs.push_back(std::move(tab));
  }
  flatbuffers::FlatBufferBuilder b(arena.size() + 256 * (tabs.size() + 1));
  flatbuffers::Offset<flatbuffers::Vector<uint8_t>> arena_vector;
  if (!arena.empty()) {
    b.ForceVectorAlignment(arena.size(), sizeof(uint8_t), kArenaAlignment);
    arena_vector = b.CreateVector(arena);
  }
  std::vector<flatbuffers::Offset<TAB>> inputs;
  for (const TABT& tab : tabs) inputs.push_back(CreateTAB(b, &tab));
  const auto inputs_vector = b.CreateVector(inputs);
  const auto method = b.CreateString(op);
  PIVRequestBuilder request(b);
  request.add_METHOD_ID(method);
  request.add_INPUTS(inputs_vector);
  if (!arena.empty()) request.add_PAYLOAD_ARENA(arena_vector);
  const auto request_offset = request.Finish();
  PIVBuilder piv(b);
  piv.add_REQUEST(request_offset);
  FinishPIVBuffer(b, piv.Finish());

  sdm_piv_host_call(reinterpret_cast<const uint8_t*>(op), static_cast<int32_t>(std::strlen(op)), b.GetBufferPointer(),
                    static_cast<int32_t>(b.GetSize()));
  const int32_t len = sdm_piv_host_response_len();
  if (len <= 0) return Response({}, "host returned no response");
  std::vector<uint8_t> bytes(static_cast<size_t>(len));
  if (sdm_piv_host_read_response(bytes.data(), len) != len) return Response({}, "host response was truncated");
  return Response(std::move(bytes));
}

/// Call an operation with its "params" record (aligned type `params_type`) and any list / raw frames.
template <typename Params>
inline Response call(const char* op, const char* params_type, const Params& params, std::initializer_list<Frame> more = {}) {
  std::vector<Frame> frames{{"params", reinterpret_cast<const uint8_t*>(&params), sizeof(Params), params_type,
                             static_cast<uint32_t>(sizeof(Params)), static_cast<uint16_t>(alignof(Params))}};
  frames.insert(frames.end(), more.begin(), more.end());
  return call_frames(op, frames);
}
/// Call an operation without a "params" record (clock.now, plugin.getConfig, filesystem.readFile with raw "path", ...).
inline Response call(const char* op, std::initializer_list<Frame> frames = {}) { return call_frames(op, std::vector<Frame>(frames)); }

}  // namespace sdm_piv

#endif  // SDM_PIV_HOSTCALL_HPP
