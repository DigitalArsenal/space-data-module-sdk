// C++ guest-side wrapper for the `secrets` host capability.
//
// Mirrors the server-side handlers in
// sdn-server/internal/modulert/caps/secrets.go. `secrets` is the node's
// encrypted-at-rest credential keystore: an operator enters a third-party
// credential once (Space-Track, an EDC/CPF account, or ANY service they define
// a lane for), and a module the operator has explicitly approved can read that
// one lane through the two operations below.
//
// ---------------------------------------------------------------------------
// THE APPROVAL CONTRACT — read this before using the header
// ---------------------------------------------------------------------------
//
// This is the ONLY capability family that hands a guest raw plaintext secret
// material. Nothing in this header enforces anything; the guarantees are all
// host-side, and they are these:
//
//  1. CAPABILITY PER LANE. A lane named "<lane>" is gated by the capability
//     "secrets:<lane>". Declare exactly the lanes you read in your manifest's
//     `capabilities`. "secrets:spacetrack" conveys NOTHING about
//     "secrets:edc_cpf" or any operator-defined lane — the host re-checks the
//     exact lane on every single call, so a module holding one lane's grant is
//     refused on every other.
//
//  2. THE OPERATOR APPROVES YOUR MODULE HASH. Every "secrets:*" capability is
//     sensitive, which means the operator must record an approval for your
//     module's exact SHA-256 content hash, for that exact lane, in the node's
//     capability_policy.json. Without it the module is DENIED AT LOAD — the
//     whole module fails to load, not just this call. Recompiling changes the
//     hash and therefore revokes the approval; that is deliberate.
//
//  3. LANES ARE OPERATOR-DEFINED. Do not assume a fixed set. The well-known
//     lanes ("spacetrack", "edc_cpf", "myintelsat") are only the ones the node
//     ships a verifier for; an operator may create a lane for any service.
//     Treat the lane id as configuration, not as a compile-time constant, and
//     handle "not configured" as a normal runtime state.
//
//  4. THE CREDENTIAL ARRIVES AS PLAINTEXT. Once secrets_get() returns, the
//     password is in your linear memory. The host cannot protect it any
//     further. Therefore:
//       - NEVER log it, and never include it in an error message, a trace, or
//         a progress event.
//       - NEVER persist it — not to storage.write, not to the filesystem, not
//         into a record, not into a cache that outlives the call.
//       - NEVER forward it anywhere except the provider it belongs to.
//       - Use it, then wipe() it. Hold it for the shortest span you can.
//     If your module also holds the `http` capability it is technically able to
//     exfiltrate the credential; the operator's approval is the trust decision
//     that permits that, so honor it.
//
//  5. THERE IS NO ENUMERATION. There is no "list" and no "export" operation,
//     by design. A guest may ask for a lane it is approved for and nothing
//     else — it can never discover which credentials the node holds. Do not
//     probe lane names to find out.
//
// ---------------------------------------------------------------------------
// USAGE
// ---------------------------------------------------------------------------
//
//   #include "sdm_hostcall_wire.hpp"          // must come first
//   #include "secretsClient.hpp"
//
//   sdm_secrets::Credential cred;
//   if (!sdm_secrets::secrets_get("spacetrack", &cred)) {
//     // Not approved for this lane, or the operator has not entered it yet.
//     // Report the CONDITION, never the lane's contents.
//     return report_error("space-track credential unavailable");
//   }
//   const bool ok = provider_login(cred.username, cred.secret);
//   sdm_secrets::wipe(&cred);   // do this even on the failure path
//
// To decide whether to attempt a fetch at all without touching the plaintext:
//
//   sdm_secrets::Status status;
//   if (sdm_secrets::secrets_status("spacetrack", &status) && status.configured) { ... }
//
// Wire shapes (JSON meta documents; nothing here uses binary segments):
//
//   secrets.get     -> {"id":"<lane>"}
//                   <- {"ok":true,"result":{"id":"...","username":"...","secret":"..."}}
//   secrets.status  -> {"id":"<lane>"}
//                   <- {"ok":true,"result":{"id":"...","configured":true,
//                        "username_masked":"o***@example.com",
//                        "updated_at":"...","verified_at":"..."}}
//
// A refusal (unapproved lane, unconfigured credential, missing keystore) comes
// back as {"ok":false,...} and NEVER carries credential material. Both helpers
// return false in that case and leave their output parameter untouched.
//
// This header assumes the including translation unit has already pulled in the
// sdm_hostcall wire protocol (sdm_hostcall::call / Segment / Response — see
// space-data-network-modules/common/sdm_hostcall_wire.hpp) ahead of this file,
// since that protocol is what actually crosses the WASM import boundary.
// Keeping that as a precondition (rather than a relative #include reaching
// across repos) avoids a fragile cross-repo path that would break depending on
// checkout layout — same convention as keyslotClient.hpp.

#ifndef SDM_SECRETS_CLIENT_HPP
#define SDM_SECRETS_CLIENT_HPP

#ifndef SDM_HOSTCALL_WIRE_HPP
#error "include sdm_hostcall_wire.hpp (sdm_hostcall::call/Segment/Response) before secretsClient.hpp"
#endif

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

namespace sdm_secrets {

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

inline size_t skip_ws(std::string_view text, size_t cursor) {
  while (cursor < text.size()) {
    const char c = text[cursor];
    if (c != ' ' && c != '\t' && c != '\n' && c != '\r') {
      break;
    }
    ++cursor;
  }
  return cursor;
}

inline bool hex_nibble(char c, uint32_t* out) {
  if (c >= '0' && c <= '9') {
    *out = static_cast<uint32_t>(c - '0');
    return true;
  }
  if (c >= 'a' && c <= 'f') {
    *out = static_cast<uint32_t>(c - 'a' + 10);
    return true;
  }
  if (c >= 'A' && c <= 'F') {
    *out = static_cast<uint32_t>(c - 'A' + 10);
    return true;
  }
  return false;
}

inline void append_utf8(std::string* out, uint32_t code_point) {
  if (code_point < 0x80u) {
    out->push_back(static_cast<char>(code_point));
  } else if (code_point < 0x800u) {
    out->push_back(static_cast<char>(0xC0u | (code_point >> 6)));
    out->push_back(static_cast<char>(0x80u | (code_point & 0x3Fu)));
  } else if (code_point < 0x10000u) {
    out->push_back(static_cast<char>(0xE0u | (code_point >> 12)));
    out->push_back(static_cast<char>(0x80u | ((code_point >> 6) & 0x3Fu)));
    out->push_back(static_cast<char>(0x80u | (code_point & 0x3Fu)));
  } else {
    out->push_back(static_cast<char>(0xF0u | (code_point >> 18)));
    out->push_back(static_cast<char>(0x80u | ((code_point >> 12) & 0x3Fu)));
    out->push_back(static_cast<char>(0x80u | ((code_point >> 6) & 0x3Fu)));
    out->push_back(static_cast<char>(0x80u | (code_point & 0x3Fu)));
  }
}

// parse_string reads the JSON string starting at text[cursor] == '"' and
// advances cursor past the closing quote.
//
// \uXXXX IS DECODED, including surrogate pairs. This is not optional
// pedantry: the host serializes with Go's encoding/json, whose default HTML
// escaping turns '<', '>' and '&' into <, > and &. A password
// containing any of those characters would be silently corrupted by a decoder
// that passed escapes through — and a corrupted password looks exactly like a
// wrong password at the provider.
inline bool parse_string(std::string_view text, size_t* cursor, std::string* out) {
  if (!cursor || !out || *cursor >= text.size() || text[*cursor] != '"') {
    return false;
  }
  size_t i = *cursor + 1;
  std::string value;
  while (i < text.size()) {
    const char c = text[i++];
    if (c == '"') {
      *cursor = i;
      *out = value;
      return true;
    }
    if (c != '\\') {
      value.push_back(c);
      continue;
    }
    if (i >= text.size()) {
      return false;
    }
    const char escaped = text[i++];
    switch (escaped) {
      case '"':
      case '\\':
      case '/':
        value.push_back(escaped);
        break;
      case 'b':
        value.push_back('\b');
        break;
      case 'f':
        value.push_back('\f');
        break;
      case 'n':
        value.push_back('\n');
        break;
      case 'r':
        value.push_back('\r');
        break;
      case 't':
        value.push_back('\t');
        break;
      case 'u': {
        if (i + 4 > text.size()) {
          return false;
        }
        uint32_t code_point = 0;
        for (int n = 0; n < 4; ++n) {
          uint32_t nibble = 0;
          if (!hex_nibble(text[i + static_cast<size_t>(n)], &nibble)) {
            return false;
          }
          code_point = (code_point << 4) | nibble;
        }
        i += 4;
        // High surrogate: consume the paired low surrogate if present.
        if (code_point >= 0xD800u && code_point <= 0xDBFFu &&
            i + 6 <= text.size() && text[i] == '\\' && text[i + 1] == 'u') {
          uint32_t low = 0;
          bool low_ok = true;
          for (int n = 0; n < 4; ++n) {
            uint32_t nibble = 0;
            if (!hex_nibble(text[i + 2 + static_cast<size_t>(n)], &nibble)) {
              low_ok = false;
              break;
            }
            low = (low << 4) | nibble;
          }
          if (low_ok && low >= 0xDC00u && low <= 0xDFFFu) {
            code_point = 0x10000u + ((code_point - 0xD800u) << 10) + (low - 0xDC00u);
            i += 6;
          }
        }
        append_utf8(&value, code_point);
        break;
      }
      default:
        return false;
    }
  }
  return false;
}

inline bool skip_value(std::string_view text, size_t* cursor);

// skip_container walks a balanced {...} or [...] respecting string literals,
// so a brace or bracket inside a string value cannot end it early.
inline bool skip_container(std::string_view text, size_t* cursor) {
  const char open = text[*cursor];
  const char close = (open == '{') ? '}' : ']';
  int depth = 0;
  size_t i = *cursor;
  while (i < text.size()) {
    const char c = text[i];
    if (c == '"') {
      std::string ignored;
      if (!parse_string(text, &i, &ignored)) {
        return false;
      }
      continue;
    }
    if (c == open) {
      ++depth;
    } else if (c == close) {
      --depth;
      if (depth == 0) {
        *cursor = i + 1;
        return true;
      }
    }
    ++i;
  }
  return false;
}

// skip_value advances cursor past one complete JSON value.
inline bool skip_value(std::string_view text, size_t* cursor) {
  size_t i = skip_ws(text, *cursor);
  if (i >= text.size()) {
    return false;
  }
  const char c = text[i];
  if (c == '"') {
    std::string ignored;
    if (!parse_string(text, &i, &ignored)) {
      return false;
    }
    *cursor = i;
    return true;
  }
  if (c == '{' || c == '[') {
    *cursor = i;
    return skip_container(text, cursor);
  }
  // Number, true, false, null: run to the next structural character.
  while (i < text.size()) {
    const char n = text[i];
    if (n == ',' || n == '}' || n == ']' || n == ' ' || n == '\t' || n == '\n' || n == '\r') {
      break;
    }
    ++i;
  }
  *cursor = i;
  return true;
}

// find_member locates `key` among the MEMBERS of the object beginning at
// text[object_start] == '{' and leaves value_cursor at the start of its value.
//
// This is a structural walk, not a substring search. A substring search for
// "\"secret\"" would happily match those characters inside some OTHER member's
// string value — and for a credential parser that is not a hypothetical: it
// would silently return attacker-influenced text as the password.
inline bool find_member(
    std::string_view text,
    size_t object_start,
    std::string_view key,
    size_t* value_cursor) {
  if (object_start >= text.size() || text[object_start] != '{' || !value_cursor) {
    return false;
  }
  size_t i = skip_ws(text, object_start + 1);
  if (i < text.size() && text[i] == '}') {
    return false;  // empty object
  }
  while (i < text.size()) {
    std::string member;
    i = skip_ws(text, i);
    if (!parse_string(text, &i, &member)) {
      return false;
    }
    i = skip_ws(text, i);
    if (i >= text.size() || text[i] != ':') {
      return false;
    }
    i = skip_ws(text, i + 1);
    if (member == key) {
      *value_cursor = i;
      return true;
    }
    if (!skip_value(text, &i)) {
      return false;
    }
    i = skip_ws(text, i);
    if (i < text.size() && text[i] == ',') {
      i = skip_ws(text, i + 1);
      continue;
    }
    return false;  // end of object without a match
  }
  return false;
}

// result_object returns the cursor of the top-level "result" object in a
// response meta document ({"ok":true,"result":{...}}).
inline bool result_object(std::string_view meta, size_t* cursor) {
  size_t root = skip_ws(meta, 0);
  if (root >= meta.size() || meta[root] != '{') {
    return false;
  }
  size_t value = 0;
  if (!find_member(meta, root, "result", &value)) {
    return false;
  }
  value = skip_ws(meta, value);
  if (value >= meta.size() || meta[value] != '{') {
    return false;
  }
  *cursor = value;
  return true;
}

inline bool result_string(std::string_view meta, std::string_view field, std::string* out) {
  size_t result = 0;
  if (!result_object(meta, &result)) {
    return false;
  }
  size_t value = 0;
  if (!find_member(meta, result, field, &value)) {
    return false;
  }
  return parse_string(meta, &value, out);
}

inline bool result_bool(std::string_view meta, std::string_view field, bool* out) {
  size_t result = 0;
  if (!result_object(meta, &result)) {
    return false;
  }
  size_t value = 0;
  if (!find_member(meta, result, field, &value)) {
    return false;
  }
  value = skip_ws(meta, value);
  if (value >= meta.size()) {
    return false;
  }
  if (meta.compare(value, 4, "true") == 0) {
    *out = true;
    return true;
  }
  if (meta.compare(value, 5, "false") == 0) {
    *out = false;
    return true;
  }
  return false;
}

// Optional string member: absent (or null) is SUCCESS with an empty value.
// "verified_at" is omitted entirely for a credential that was stored and never
// verified — the normal, permanent state of a lane the node has no verifier
// for. Treating that as a parse failure would turn an honest "unverified" into
// an error.
inline bool result_optional_string(std::string_view meta, std::string_view field, std::string* out) {
  size_t result = 0;
  if (!result_object(meta, &result)) {
    return false;
  }
  size_t value = 0;
  if (!find_member(meta, result, field, &value)) {
    out->clear();
    return true;
  }
  value = skip_ws(meta, value);
  if (value < meta.size() && meta.compare(value, 4, "null") == 0) {
    out->clear();
    return true;
  }
  return parse_string(meta, &value, out);
}

inline std::string lane_request(std::string_view lane) {
  return "{\"id\":\"" + escape_json_string(lane) + "\"}";
}

}  // namespace detail

// Credential is one lane's operator-entered credential.
//
// `secret` IS THE PLAINTEXT. See rule 4 in the header comment: do not log it,
// do not persist it, do not put it in an error message, and wipe() it as soon
// as the provider call is done.
struct Credential {
  std::string username;
  std::string secret;
};

// Status reports whether a lane holds a credential, WITHOUT disclosing it.
//
// `verified_at` is empty when the node has never successfully probed this
// credential. For an operator-defined lane that is permanent and correct — the
// node has no verifier for a service it knows nothing about — so an empty
// `verified_at` is NOT an error and must not be treated as one.
struct Status {
  std::string id;
  bool configured = false;
  std::string username_masked;
  std::string updated_at;
  std::string verified_at;
};

// wipe overwrites a credential's buffers in place and clears them. Call it on
// EVERY path once the credential has been used, including error paths.
//
// This bounds the window during which the plaintext sits in linear memory. It
// is not a defense against a host that reads guest memory (nothing in a guest
// could be), and a std::string that reallocated while being built may have left
// an older copy behind — so keep the credential's lifetime short as well.
inline void wipe(Credential* credential) {
  if (!credential) {
    return;
  }
  for (size_t i = 0; i < credential->secret.size(); ++i) {
    credential->secret[i] = '\0';
  }
  for (size_t i = 0; i < credential->username.size(); ++i) {
    credential->username[i] = '\0';
  }
  credential->secret.clear();
  credential->username.clear();
}

// secrets_get returns the operator-entered credential for `lane`.
//
// Requires the "secrets:<lane>" capability, declared in the manifest AND
// approved by the operator for this module's content hash. Returns false —
// leaving `credential_out` untouched — when the module is not approved for this
// lane, the lane holds no credential, the node has no keystore, or the response
// cannot be parsed. A false return NEVER means "empty credential"; it means no
// credential was obtained.
inline bool secrets_get(std::string_view lane, Credential* credential_out) {
  if (!credential_out || lane.empty()) {
    return false;
  }
  sdm_hostcall::Response response;
  if (!sdm_hostcall::call("secrets.get", detail::lane_request(lane), {}, &response)) {
    return false;
  }
  std::string username;
  std::string secret;
  if (!detail::result_string(response.meta, "username", &username)) {
    return false;
  }
  if (!detail::result_string(response.meta, "secret", &secret)) {
    return false;
  }
  credential_out->username = username;
  credential_out->secret = secret;
  return true;
}

// secrets_status reports whether `lane` is configured, without returning the
// credential. It is gated by the SAME per-lane capability as secrets_get: an
// unapproved module cannot use it to probe which credentials the node holds.
//
// Use it to decide whether a fetch is worth attempting, or to surface
// "credential not configured" to the operator, without ever touching plaintext.
inline bool secrets_status(std::string_view lane, Status* status_out) {
  if (!status_out || lane.empty()) {
    return false;
  }
  sdm_hostcall::Response response;
  if (!sdm_hostcall::call("secrets.status", detail::lane_request(lane), {}, &response)) {
    return false;
  }
  Status parsed;
  if (!detail::result_bool(response.meta, "configured", &parsed.configured)) {
    return false;
  }
  if (!detail::result_optional_string(response.meta, "id", &parsed.id)) {
    return false;
  }
  if (!detail::result_optional_string(response.meta, "username_masked", &parsed.username_masked)) {
    return false;
  }
  if (!detail::result_optional_string(response.meta, "updated_at", &parsed.updated_at)) {
    return false;
  }
  if (!detail::result_optional_string(response.meta, "verified_at", &parsed.verified_at)) {
    return false;
  }
  *status_out = parsed;
  return true;
}

}  // namespace sdm_secrets

#endif  // SDM_SECRETS_CLIENT_HPP
