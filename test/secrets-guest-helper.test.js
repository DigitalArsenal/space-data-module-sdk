// Guest-side `secrets` capability helper (src/host/cpp/secretsClient.hpp).
//
// The header is a C++ translation-unit include, so it is exercised the way a
// module author actually uses it: compiled against a MOCK sdm_hostcall bridge
// that returns canned host responses, then run. That covers the two things the
// header is responsible for — the request it emits, and how it parses the
// response — without needing a node, a keystore, or a wasm toolchain.
//
// The suite deliberately depends on nothing but the Node standard library and a
// host C++ compiler, so it runs standalone.

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HEADER_PATH = fileURLToPath(
  new URL("../src/host/cpp/secretsClient.hpp", import.meta.url),
);

function findCxxCompiler() {
  for (const candidate of ["c++", "clang++", "g++"]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // try the next one
    }
  }
  return null;
}

const CXX = findCxxCompiler();

// The mock bridge. It stands in for
// space-data-network-modules/common/sdm_hostcall_wire.hpp: same
// sdm_hostcall::call / Segment / Response surface, but instead of crossing the
// wasm import boundary it records the operation + request meta and replays a
// canned response document.
const MOCK_BRIDGE = `
#define SDM_HOSTCALL_WIRE_HPP
#include <string>
#include <string_view>
#include <vector>
#include <cstdint>
#include <cstddef>

namespace sdm_hostcall {
struct Segment { const uint8_t* data; size_t size; };
struct Response { std::string meta; std::vector<std::vector<uint8_t>> segments; };

// Set by each case before calling the helper.
inline std::string mock_response_meta;
inline bool mock_call_succeeds = true;
// Recorded by call().
inline std::string last_operation;
inline std::string last_meta;
inline int call_count = 0;

inline bool call(std::string_view operation,
                 std::string_view meta_json,
                 const std::vector<Segment>& segments,
                 Response* response_out) {
  ++call_count;
  last_operation = std::string(operation);
  last_meta = std::string(meta_json);
  if (!segments.empty()) { return false; }
  if (!response_out) { return false; }
  response_out->meta = mock_response_meta;
  // A refused hostcall returns false; the meta still crosses back, and it never
  // carries credential material (the host builds it with errCapJSON).
  return mock_call_succeeds;
}
}  // namespace sdm_hostcall
`;

const TEST_MAIN = `
#include <cstdio>
#include <cstring>

static int failures = 0;
static void check(bool condition, const char* what) {
  if (!condition) { std::printf("FAIL: %s\\n", what); ++failures; }
}
static void check_eq(const std::string& got, const char* want, const char* what) {
  if (got != want) {
    std::printf("FAIL: %s (got \\"%s\\", want \\"%s\\")\\n", what, got.c_str(), want);
    ++failures;
  }
}

static void reset(const char* meta, bool ok) {
  sdm_hostcall::mock_response_meta = meta;
  sdm_hostcall::mock_call_succeeds = ok;
  sdm_hostcall::last_operation.clear();
  sdm_hostcall::last_meta.clear();
  sdm_hostcall::call_count = 0;
}

int main() {
  // --- 1. secrets.get: request shape + plaintext round-trip ---------------
  reset("{\\"ok\\":true,\\"result\\":{\\"id\\":\\"acme-weather\\",\\"username\\":\\"ops@acme.example\\",\\"secret\\":\\"s3cr3t-canary\\"}}", true);
  sdm_secrets::Credential cred;
  check(sdm_secrets::secrets_get("acme-weather", &cred), "secrets_get on an approved lane");
  check_eq(sdm_hostcall::last_operation, "secrets.get", "operation name");
  check_eq(sdm_hostcall::last_meta, "{\\"id\\":\\"acme-weather\\"}", "request meta");
  check_eq(cred.username, "ops@acme.example", "username");
  check_eq(cred.secret, "s3cr3t-canary", "secret");

  // --- 2. wipe() clears the plaintext ------------------------------------
  sdm_secrets::wipe(&cred);
  check(cred.secret.empty() && cred.username.empty(), "wipe clears the credential");

  // --- 3. Go's HTML escaping must be decoded, not passed through ----------
  // encoding/json emits \\u003c / \\u003e / \\u0026 for < > &. A password
  // containing them would otherwise be silently corrupted.
  reset("{\\"ok\\":true,\\"result\\":{\\"id\\":\\"acme\\",\\"username\\":\\"u\\",\\"secret\\":\\"a\\\\u003cb\\\\u0026c\\\\u003ed\\"}}", true);
  sdm_secrets::Credential escaped;
  check(sdm_secrets::secrets_get("acme", &escaped), "secrets_get with escaped secret");
  check_eq(escaped.secret, "a<b&c>d", "unicode-escaped secret decoded");

  // --- 4. a hostile username may not smuggle a different secret ----------
  // The username value literally contains the characters "secret":" — a
  // substring-search parser would return the injected value as the password.
  reset("{\\"ok\\":true,\\"result\\":{\\"id\\":\\"acme\\",\\"username\\":\\"x\\\\\\",\\\\\\"secret\\\\\\":\\\\\\"INJECTED\\",\\"secret\\":\\"REAL-SECRET\\"}}", true);
  sdm_secrets::Credential hostile;
  check(sdm_secrets::secrets_get("acme", &hostile), "secrets_get with a hostile username");
  check_eq(hostile.secret, "REAL-SECRET", "the real secret wins over an injected one");

  // --- 5. a refusal yields false and leaves the output untouched ----------
  sdm_secrets::Credential kept;
  kept.username = "previous-user";
  kept.secret = "previous-secret";
  reset("{\\"ok\\":false,\\"error\\":{\\"message\\":\\"secrets.get requires the secrets:other capability grant\\"}}", false);
  check(!sdm_secrets::secrets_get("other", &kept), "an unapproved lane is refused");
  check_eq(kept.secret, "previous-secret", "a refusal must not clobber the output");

  // --- 6. a malformed / truncated result is a failure, not an empty secret -
  reset("{\\"ok\\":true,\\"result\\":{\\"id\\":\\"acme\\",\\"username\\":\\"u\\"}}", true);
  sdm_secrets::Credential missing;
  check(!sdm_secrets::secrets_get("acme", &missing), "a result with no secret field fails");
  check(missing.secret.empty(), "a failed get leaves no partial credential");

  // --- 7. empty lane / null out are rejected without a hostcall -----------
  reset("{\\"ok\\":true,\\"result\\":{\\"username\\":\\"u\\",\\"secret\\":\\"s\\"}}", true);
  sdm_secrets::Credential unused;
  check(!sdm_secrets::secrets_get("", &unused), "an empty lane id is rejected");
  check(!sdm_secrets::secrets_get("acme", nullptr), "a null output is rejected");
  check(sdm_hostcall::call_count == 0, "no hostcall is made for an invalid request");

  // --- 8. secrets.status: configured, masked, never a secret --------------
  reset("{\\"ok\\":true,\\"result\\":{\\"id\\":\\"acme-weather\\",\\"configured\\":true,\\"username_masked\\":\\"o***@acme.example\\",\\"updated_at\\":\\"2026-08-04T12:00:00Z\\"}}", true);
  sdm_secrets::Status status;
  check(sdm_secrets::secrets_status("acme-weather", &status), "secrets_status on an approved lane");
  check_eq(sdm_hostcall::last_operation, "secrets.status", "status operation name");
  check(status.configured, "configured");
  check_eq(status.id, "acme-weather", "status id");
  check_eq(status.username_masked, "o***@acme.example", "masked username");
  check_eq(status.updated_at, "2026-08-04T12:00:00Z", "updated_at");
  // An operator-defined lane has no verifier, so verified_at is ABSENT. That
  // is the honest "stored, not verified" state and must parse as success.
  check_eq(status.verified_at, "", "absent verified_at is empty, not an error");

  // --- 9. an unconfigured lane reports configured=false ------------------
  reset("{\\"ok\\":true,\\"result\\":{\\"id\\":\\"never-set\\",\\"configured\\":false}}", true);
  sdm_secrets::Status empty_status;
  check(sdm_secrets::secrets_status("never-set", &empty_status), "status for an unconfigured lane");
  check(!empty_status.configured, "unconfigured lane reports configured=false");
  check_eq(empty_status.username_masked, "", "no masked username for an unconfigured lane");

  // --- 10. a refused status leaves the output untouched -------------------
  sdm_secrets::Status prior;
  prior.configured = true;
  prior.id = "kept";
  reset("{\\"ok\\":false,\\"error\\":{\\"message\\":\\"requires the secrets:x capability grant\\"}}", false);
  check(!sdm_secrets::secrets_status("x", &prior), "a refused status returns false");
  check(prior.configured && prior.id == "kept", "a refused status must not clobber the output");

  // --- 11. the lane id is JSON-escaped into the request -------------------
  reset("{\\"ok\\":true,\\"result\\":{\\"configured\\":false}}", true);
  sdm_secrets::Status quoted;
  sdm_secrets::secrets_status("a\\"b", &quoted);
  check_eq(sdm_hostcall::last_meta, "{\\"id\\":\\"a\\\\\\"b\\"}", "lane id is escaped into the request meta");

  if (failures == 0) { std::printf("OK\\n"); }
  return failures == 0 ? 0 : 1;
}
`;

test("secrets guest helper compiles and behaves against a mock host bridge", (t) => {
  if (!CXX) {
    t.skip("no host C++ compiler available (c++/clang++/g++)");
    return;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "sdm-secrets-helper-"));
  try {
    const source = path.join(dir, "secrets_helper_test.cpp");
    const binary = path.join(dir, "secrets_helper_test");
    writeFileSync(
      source,
      `${MOCK_BRIDGE}\n#include "${HEADER_PATH}"\n${TEST_MAIN}\n`,
      "utf8",
    );
    execFileSync(CXX, ["-std=c++17", "-O0", "-Wall", "-Werror", source, "-o", binary], {
      stdio: "pipe",
    });
    const output = execFileSync(binary, { encoding: "utf8" });
    assert.equal(output.trim(), "OK", `guest helper assertions failed:\n${output}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The header is a CONTRACT document as much as code: the approval rules and the
// handling rules for the plaintext are the reason it is safe to ship. Guard the
// parts a future edit must not quietly drop.
test("secrets guest helper documents the approval and handling contract", async () => {
  const { readFile } = await import("node:fs/promises");
  const header = await readFile(HEADER_PATH, "utf8");

  for (const required of [
    "secrets:<lane>", // the per-lane capability name
    "capability_policy.json", // where the operator records the approval
    "content hash", // approval is keyed by module hash
    "DENIED AT LOAD", // the failure mode when unapproved
    "NEVER log", // handling rule
    "NEVER persist", // handling rule
    "LANES ARE OPERATOR-DEFINED", // lane ids are not a fixed set
    "THERE IS NO ENUMERATION", // no list/export operation exists
  ]) {
    assert.ok(
      header.includes(required),
      `secretsClient.hpp must document ${JSON.stringify(required)}`,
    );
  }

  // There must be no helper for an operation the host does not implement — a
  // guest may never enumerate or export the keystore.
  for (const forbidden of ["secrets.list", "secrets.export", "secrets.all"]) {
    assert.ok(
      !header.includes(`"${forbidden}"`),
      `secretsClient.hpp must not call ${forbidden}`,
    );
  }
});
