// C++ guest-side typed hostcall: a module calls its host with one HostCall FlatBuffer (HCLQ) and gets one
// HostCallResult (HCLR) back - the typed replacement of the JSON meta + binary segments envelope
// (src/host/hostcallWire.js, space-data-network-modules common/sdm_hostcall_wire.hpp). Typed contracts 1.0, owner
// 2026-10-13: "flatbuffer SDS only"; no JSON forms.
//
// The parameters and results are the generated sdn::runtime tables (src/generated/runtime/cpp/*_generated.h, which
// the including translation unit puts on its include path with the flatbuffers headers):
//
//   auto r = sdm_typed::call("storage.expire", [&](flatbuffers::FlatBufferBuilder& b) {
//     auto p = sdn::runtime::CreateStorageExpireParamsDirect(b, "WXF.fbs", "noaa-ncep", nullptr, cutoff_ms, 500, 100000);
//     return sdm_typed::params(sdn::runtime::HostCallParams_StorageExpireParams, p);
//   });
//   if (!r.ok()) { r.message(); }
//   const auto* expired = r.value_as<sdn::runtime::StorageExpireResult>();
//
// The same space_data_module_host.call import carries it; the host tells a typed call by its HCLQ identifier.
#ifndef SDM_TYPED_HOSTCALL_HPP
#define SDM_TYPED_HOSTCALL_HPP

#include <cstdint>
#include <cstring>
#include <string>
#include <utility>
#include <vector>

#include "HostCall_generated.h"
#include "HostCallResult_generated.h"

extern "C" {
#if defined(__wasm__)
__attribute__((import_module("space_data_module_host"), import_name("call")))
#endif
int32_t sdm_typed_host_call(const uint8_t* op_ptr, int32_t op_len, const uint8_t* payload_ptr, int32_t payload_len);
#if defined(__wasm__)
__attribute__((import_module("space_data_module_host"), import_name("response_len")))
#endif
int32_t sdm_typed_host_response_len(void);
#if defined(__wasm__)
__attribute__((import_module("space_data_module_host"), import_name("read_response")))
#endif
int32_t sdm_typed_host_read_response(uint8_t* dst_ptr, int32_t dst_len);
}

namespace sdm_typed {

/// A built parameter table and its union tag.
struct Params {
  sdn::runtime::HostCallParams type = sdn::runtime::HostCallParams_NONE;
  flatbuffers::Offset<void> offset;
};
template <typename T>
inline Params params(sdn::runtime::HostCallParams type, flatbuffers::Offset<T> table) {
  return Params{type, table.Union()};
}

/// The host's answer: the HCLR bytes, verified, and typed views of them.
class Result {
 public:
  Result() = default;
  explicit Result(std::vector<uint8_t> bytes, std::string transport_error = {})
      : bytes_(std::move(bytes)), transport_error_(std::move(transport_error)) {
    if (!transport_error_.empty()) return;
    if (bytes_.size() < 8 || !sdn::runtime::HostCallResultBufferHasIdentifier(bytes_.data())) {
      transport_error_ = "host answered without a HostCallResult (HCLR)";
      return;
    }
    flatbuffers::Verifier verifier(bytes_.data(), bytes_.size());
    if (!sdn::runtime::VerifyHostCallResultBuffer(verifier)) transport_error_ = "host answered with a malformed HostCallResult";
  }
  const sdn::runtime::HostCallResult* get() const {
    return transport_error_.empty() ? sdn::runtime::GetHostCallResult(bytes_.data()) : nullptr;
  }
  bool ok() const { const auto* r = get(); return r && r->OK(); }
  sdn::runtime::hostCallErrorCode code() const {
    const auto* r = get();
    if (!r) return sdn::runtime::hostCallErrorCode_Failed;
    return r->ERROR() ? r->ERROR()->CODE() : (r->OK() ? sdn::runtime::hostCallErrorCode_None : sdn::runtime::hostCallErrorCode_Failed);
  }
  std::string message() const {
    if (!transport_error_.empty()) return transport_error_;
    const auto* r = get();
    return r && r->ERROR() && r->ERROR()->MESSAGE() ? r->ERROR()->MESSAGE()->str() : std::string();
  }
  /// The result value as T (nullptr when the call failed or the value is another member).
  template <typename T>
  const T* value_as() const {
    const auto* r = get();
    return r && r->OK() ? r->template VALUE_as<T>() : nullptr;
  }
  const std::vector<uint8_t>& bytes() const { return bytes_; }

 private:
  std::vector<uint8_t> bytes_;
  std::string transport_error_;
};

/// Call the host: `build` adds the operation's parameter table to the builder and returns params(tag, offset).
template <typename Build>
inline Result call(const char* op, Build&& build) {
  flatbuffers::FlatBufferBuilder b(256);
  const Params p = build(b);
  const auto op_offset = b.CreateString(op);
  sdn::runtime::FinishHostCallBuffer(b, sdn::runtime::CreateHostCall(b, op_offset, p.type, p.offset));
  sdm_typed_host_call(reinterpret_cast<const uint8_t*>(op), static_cast<int32_t>(std::strlen(op)), b.GetBufferPointer(),
                      static_cast<int32_t>(b.GetSize()));
  const int32_t len = sdm_typed_host_response_len();
  if (len <= 0) return Result({}, "host returned no response");
  std::vector<uint8_t> bytes(static_cast<size_t>(len));
  if (sdm_typed_host_read_response(bytes.data(), len) != len) return Result({}, "host response was truncated");
  return Result(std::move(bytes));
}

/// An operation with no parameters (clock.now, host.info, plugin.getConfig, ...).
inline Result call(const char* op) {
  return call(op, [](flatbuffers::FlatBufferBuilder&) { return Params{}; });
}

}  // namespace sdm_typed

#endif  // SDM_TYPED_HOSTCALL_HPP
