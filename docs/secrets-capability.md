# Credential Lanes — the `secrets` Capability

A module often needs an operator's third-party credential: a Space-Track login,
a data-provider API password, an account at whatever service the operator uses.
The `secrets` capability is how that credential reaches the module **without the
credential ever living in the module, the manifest, the flow, or a record**.

The operator enters the credential once on their node. The node seals it at rest
under its own key material. A module the operator has explicitly approved can
then read exactly that one credential at runtime.

This document is normative for module authors. The guest-side helper is
[`src/host/cpp/secretsClient.hpp`](../src/host/cpp/secretsClient.hpp); the
reference host implementation is `sdn-server/internal/modulert/caps/secrets.go`.

## Lanes

A **lane** is a named credential slot on the node — `spacetrack`,
`acme-weather`, `zephyr_billing`. Lane ids are lowercase
`[a-z0-9_-]{2,64}`.

**Lanes are operator-defined.** A few are well-known (`spacetrack`, `edc_cpf`,
`myintelsat`) because the node ships a verifier that can probe them, but an
operator may create a lane for any service at all. Do not hard-code an
assumption that a fixed set exists:

- Take the lane id as **module configuration**, not as a compile-time constant,
  so an operator can point your module at their own lane.
- Treat "not configured" as a **normal runtime state**, not an error condition
  that should crash a run.
- A lane may be permanently **unverified**. The node cannot probe a service it
  knows nothing about, so `verified_at` stays empty forever for most
  operator-defined lanes. That is honest, not broken.

## The approval contract

Reading a credential requires **two** things, and neither is something your
module can arrange for itself.

1. **Declare the capability.** Add `secrets:<lane>` to your manifest's
   `capabilities` for each lane you read. `secrets:spacetrack` conveys nothing
   about `secrets:edc_cpf`: the host re-checks the exact lane on **every call**,
   so a module holding one lane's grant is refused on every other lane.

2. **The operator approves your module's content hash.** Every `secrets:*`
   capability is *sensitive*. The operator records an approval for your module's
   exact SHA-256 content hash, for that exact lane, in the node's
   `capability_policy.json`. Without it the module is **denied at load** — the
   whole module fails to load, not just the call.

   Recompiling changes the hash and therefore **revokes** the approval. That is
   deliberate: the approval is for the bytes the operator reviewed, not for a
   name.

There is **no enumeration**. There is no `secrets.list` and no `secrets.export`.
A guest can ask for a lane it is already approved for and nothing else; it can
never discover which credentials the node holds. Do not probe lane names.

## Handling the plaintext

`secrets.get` returns the credential **in the clear**, in your linear memory.
There is no way around that — the module's job is to present the password to the
provider's own login, so the secret *is* the message. Once it crosses the
boundary the host cannot protect it further, and these rules are yours to keep:

- **Never log it.** Not in an error message, not in a trace, not in a progress
  event, not at debug level.
- **Never persist it.** Not through `storage.write`, not to the filesystem, not
  into a record, not into a cache that outlives the call.
- **Never forward it** anywhere except the provider it belongs to.
- **Wipe it** as soon as the provider call is done, on success *and* failure
  paths, and keep its lifetime as short as you can.

If your module also holds `http`, it is technically capable of exfiltrating the
credential. The operator's approval is precisely the decision to trust it not
to. Honor that.

## Minimal usage

```cpp
#include "sdm_hostcall_wire.hpp"   // must be included first
#include "secretsClient.hpp"

// The lane comes from module configuration — never assume "spacetrack".
bool fetch_provider_data(const std::string& lane) {
  sdm_secrets::Credential cred;
  if (!sdm_secrets::secrets_get(lane, &cred)) {
    // Not approved for this lane, or the operator has not entered it yet.
    // Report the CONDITION, never the lane's contents.
    log_error("provider credential unavailable");
    return false;
  }

  const bool ok = provider_login(cred.username, cred.secret);
  sdm_secrets::wipe(&cred);   // on every path, including this failure one
  return ok;
}
```

Manifest:

```json
{
  "pluginId": "com.example.provider-fetch",
  "capabilities": ["http", "secrets:acme-weather"]
}
```

To decide whether a fetch is worth attempting without touching the plaintext:

```cpp
sdm_secrets::Status status;
if (sdm_secrets::secrets_status(lane, &status) && status.configured) {
  // A credential is present. status.username_masked is safe to show an
  // operator ("o***@acme.example"); status.verified_at is EMPTY when the node
  // has never probed it, which is normal for an operator-defined lane.
}
```

`secrets_status` is gated by the **same** per-lane capability, so an unapproved
module cannot use it to probe which credentials a node holds.

## Wire shapes

Both operations are plain JSON meta documents; neither uses binary segments.

```
secrets.get     -> {"id":"<lane>"}
                <- {"ok":true,"result":{"id":"...","username":"...","secret":"..."}}

secrets.status  -> {"id":"<lane>"}
                <- {"ok":true,"result":{"id":"...","configured":true,
                     "username_masked":"o***@example.com",
                     "updated_at":"...","verified_at":"..."}}
```

A refusal — unapproved lane, unconfigured credential, no keystore on this node —
comes back as `{"ok":false,...}` and **never** carries credential material. Both
helpers return `false` in that case and leave their output parameter untouched.
A `false` return never means "empty credential"; it means no credential was
obtained.

## Failure modes worth expecting

| Situation | What you see |
|---|---|
| Capability not declared in the manifest | Refused per call (`ok:false`) |
| Declared but not approved by the operator | **Module denied at load** |
| Approved for a different lane | Refused per call (`ok:false`) |
| Lane exists but the operator has not filled it in | `secrets_get` false; `secrets_status` `configured:false` |
| Lane has no verifier on this node | `verified_at` empty — normal, not an error |
| Node has no credential keystore | Refused per call (`ok:false`) |
