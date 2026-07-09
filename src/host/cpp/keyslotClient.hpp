// C++ guest-side wrapper for the `keyslot` host capability.
//
// Mirrors the intent of space-data-module-sdk/src/host/hostcallWire.js plus
// the server-side handlers in
// sdn-server/internal/modulert/caps/keyslot.go: `keyslot` is a host-side
// crypto oracle. A module never receives a slot's private key material —
// only the *outputs* of private-key operations cross the host/guest
// boundary (a signature; the plaintext of a payload wrapped to a slot's
// public key). The removed `keyslot.get` raw-export operation must never be
// reintroduced here.
//
// This header assumes the including translation unit has already pulled in
// the sdm_hostcall wire protocol (sdm_hostcall::call / Segment / Response —
// see space-data-network-modules/common/sdm_hostcall_wire.hpp) ahead of this
// file, since that protocol is what actually crosses the WASM import
// boundary. Keeping that as a precondition (rather than a relative
// #include reaching across repos) avoids a fragile cross-repo path that
// would break depending on checkout layout.
//
// keyslot.sign request/response wire shape (JSON meta document; the
// payload bytes travel as a binary segment referenced by "$bin", not
// inline base64 — the host bridge base64-encodes it for the capability
// handler on the way through):
//
//   -> {"slotId":"...", "payload":{"$bin":0}, "algorithm":"ed25519"}
//   <- {"signature":"<base64>", "algorithm":"ed25519"}
//
// See sdn-server/internal/modulert/caps/keyslot.go (handleKeyslotSign) for
// the authoritative host-side implementation.

#ifndef SDM_KEYSLOT_CLIENT_HPP
#define SDM_KEYSLOT_CLIENT_HPP

#ifndef SDM_HOSTCALL_WIRE_HPP
#error "include sdm_hostcall_wire.hpp (sdm_hostcall::call/Segment/Response) before keyslotClient.hpp"
#endif

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace sdm_keyslot {

namespace detail {

inline std::string escape_json_string(std::string_view value) {
  std::string escaped;
  escaped.reserve(value.size());
  for (const char c : value) {
    switch (c) {
      case '"':
        escaped += "\\\"";
        break;
      case '\\':
        escaped += "\\\\";
        break;
      case '\n':
        escaped += "\\n";
        break;
      case '\r':
        escaped += "\\r";
        break;
      case '\t':
        escaped += "\\t";
        break;
      default:
        escaped.push_back(c);
        break;
    }
  }
  return escaped;
}

inline int decode_base64_char(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  if (c == '=') return -2;
  return -1;
}

inline bool decode_base64_bytes(std::string_view text, std::vector<uint8_t>* bytes_out) {
  if (!bytes_out) {
    return false;
  }
  bytes_out->clear();
  uint32_t accumulator = 0;
  int bits_collected = 0;
  bool padding_seen = false;
  for (const char c : text) {
    if (c == ' ' || c == '\n' || c == '\r' || c == '\t') {
      continue;
    }
    const int decoded = decode_base64_char(c);
    if (decoded == -1) {
      return false;
    }
    if (decoded == -2) {
      padding_seen = true;
      continue;
    }
    if (padding_seen) {
      return false;
    }
    accumulator = (accumulator << 6) | static_cast<uint32_t>(decoded);
    bits_collected += 6;
    if (bits_collected >= 8) {
      bits_collected -= 8;
      bytes_out->push_back(static_cast<uint8_t>((accumulator >> bits_collected) & 0xffu));
    }
  }
  return true;
}

inline size_t skip_json_ws(std::string_view text, size_t cursor) {
  while (cursor < text.size()) {
    const char c = text[cursor];
    if (c != ' ' && c != '\t' && c != '\n' && c != '\r') {
      break;
    }
    ++cursor;
  }
  return cursor;
}

// Minimal find-key-then-read-string-value JSON scan. Good enough for the
// small, flat `{"signature":"...","algorithm":"..."}` result documents this
// header parses; not a general JSON parser.
inline bool extract_json_string_field(
    std::string_view text,
    std::string_view field,
    std::string* value_out) {
  if (!value_out) {
    return false;
  }
  const std::string marker = "\"" + std::string(field) + "\"";
  const size_t field_pos = text.find(marker);
  if (field_pos == std::string_view::npos) {
    return false;
  }
  const size_t colon_pos = text.find(':', field_pos + marker.size());
  if (colon_pos == std::string_view::npos) {
    return false;
  }
  size_t cursor = skip_json_ws(text, colon_pos + 1);
  if (cursor >= text.size() || text[cursor] != '"') {
    return false;
  }
  ++cursor;

  std::string out;
  while (cursor < text.size()) {
    const char c = text[cursor++];
    if (c == '"') {
      *value_out = out;
      return true;
    }
    if (c == '\\') {
      if (cursor >= text.size()) {
        return false;
      }
      const char escaped = text[cursor++];
      switch (escaped) {
        case '"':
        case '\\':
        case '/':
          out.push_back(escaped);
          break;
        case 'b':
          out.push_back('\b');
          break;
        case 'f':
          out.push_back('\f');
          break;
        case 'n':
          out.push_back('\n');
          break;
        case 'r':
          out.push_back('\r');
          break;
        case 't':
          out.push_back('\t');
          break;
        default:
          return false;
      }
      continue;
    }
    out.push_back(c);
  }
  return false;
}

}  // namespace detail

// keyslot_sign asks the host to sign `data` (length `len`) using the
// private key material held in slot `slot_id`. `algorithm` is "ed25519" (the
// default) or "secp256k1" — it must match what the slot actually holds. The
// slot's private key never crosses into guest memory; only the resulting
// signature does. Returns false on any hostcall, transport, or decode
// failure and leaves `signature_out` untouched in that case.
inline bool keyslot_sign(
    std::string_view slot_id,
    const uint8_t* data,
    size_t len,
    std::vector<uint8_t>* signature_out,
    std::string_view algorithm = "ed25519") {
  if (!signature_out || slot_id.empty()) {
    return false;
  }
  const std::string meta =
      "{\"slotId\":\"" + detail::escape_json_string(slot_id) +
      "\",\"payload\":{\"$bin\":0},\"algorithm\":\"" +
      detail::escape_json_string(algorithm) + "\"}";
  sdm_hostcall::Response response;
  if (!sdm_hostcall::call("keyslot.sign", meta, {{data, len}}, &response)) {
    return false;
  }
  std::string signature_base64;
  if (!detail::extract_json_string_field(response.meta, "signature", &signature_base64)) {
    return false;
  }
  return detail::decode_base64_bytes(signature_base64, signature_out);
}

}  // namespace sdm_keyslot

#endif  // SDM_KEYSLOT_CLIENT_HPP
