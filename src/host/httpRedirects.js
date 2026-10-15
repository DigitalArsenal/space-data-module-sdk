/**
 * HTTP requests whose every redirect hop is checked (security audit
 * 2026-10-15, SEC-022).
 *
 * A host that checks its origin allow-list only against the first URL and
 * then lets fetch follow redirects can be walked to any origin (loopback,
 * cloud metadata, the page's own API) by one open redirect on an allowed
 * host. Here fetch never follows on its own (`redirect: "manual"`); each
 * Location is resolved, its protocol and origin are checked by the caller's
 * `assertAllowed`, and the hop count is bounded. A cross-origin hop drops the
 * guest's headers (Authorization, Cookie, anything else it set). A 303, or a
 * 301/302 after POST, continues as GET without a body, as browsers do.
 *
 * A browser's fetch hides the target of a manual redirect (an
 * `opaqueredirect` response). Such a redirect cannot be checked, so it is
 * refused rather than followed.
 */

export const DEFAULT_MAX_HTTP_REDIRECTS = 5;

// A response that reports a URL must report the one requested (fragment
// aside). An empty or absent url (synthetic Responses, some shims) says
// nothing and is accepted; `redirected` still applies.
function sameResource(responseUrl, requested) {
  if (typeof responseUrl !== "string" || responseUrl.length === 0) return true;
  let reported;
  try {
    reported = new URL(responseUrl);
  } catch {
    return false;
  }
  const expected = new URL(requested.href);
  reported.hash = "";
  expected.hash = "";
  return reported.href === expected.href;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function notAuthorized(message) {
  return Object.assign(new Error(message), { hostcallCode: "not-authorized" });
}

/**
 * @param {Function} fetchImpl
 * @param {string|URL} url
 * @param {object} init - fetch init; `redirect` may be "follow" (checked hops,
 *   the default), "manual" (return the 3xx) or "error" (throw on a redirect)
 * @param {{assertAllowed: (url: URL) => void, maxRedirects?: number}} policy
 * @returns {Promise<{response: Response, url: URL}>}
 */
export async function fetchWithCheckedRedirects(fetchImpl, url, init = {}, policy = {}) {
  if (typeof policy.assertAllowed !== "function") {
    throw new TypeError("fetchWithCheckedRedirects requires an assertAllowed policy.");
  }
  const mode = init.redirect ?? "follow";
  if (!["follow", "manual", "error"].includes(mode)) {
    throw new TypeError(`Unsupported HTTP redirect mode "${mode}".`);
  }
  const maxRedirects = Number.isSafeInteger(policy.maxRedirects)
    ? policy.maxRedirects
    : DEFAULT_MAX_HTTP_REDIRECTS;
  let current = url instanceof URL ? new URL(url.href) : new URL(String(url));
  let method = String(init.method ?? "GET").toUpperCase();
  let headers = init.headers;
  let body = init.body;
  for (let hop = 0; ; hop += 1) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw notAuthorized(
        `Unsupported HTTP protocol "${current.protocol}". Expected http: or https:.`,
      );
    }
    policy.assertAllowed(current);
    const response = await fetchImpl(current.toString(), {
      ...init,
      method,
      headers,
      body,
      redirect: "manual",
    });
    if (response?.type === "opaqueredirect") {
      throw notAuthorized(
        "HTTP request was redirected to a target this runtime does not reveal; refusing to follow an unchecked redirect.",
      );
    }
    // An embedder fetch that follows redirects itself (ignoring
    // redirect: "manual") has already gone wherever the Location said. Its
    // response must not reach the guest: the hop it took was never checked.
    if (response?.redirected === true || !sameResource(response?.url, current)) {
      try {
        await response?.body?.cancel?.();
      } catch {
        // discarded either way
      }
      throw notAuthorized(
        "HTTP request was redirected by the fetch implementation itself; refusing a response from an unchecked hop.",
      );
    }
    const location = response?.headers?.get?.("location");
    if (!REDIRECT_STATUSES.has(response?.status) || !location || mode === "manual") {
      return { response, url: current };
    }
    if (mode === "error") {
      throw notAuthorized(`HTTP request to ${current.origin} was redirected (redirect: "error").`);
    }
    if (hop >= maxRedirects) {
      throw notAuthorized(`HTTP request exceeded ${maxRedirects} redirects.`);
    }
    try {
      await response.body?.cancel?.();
    } catch {
      // the body is discarded either way
    }
    const next = new URL(location, current);
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && method === "POST")
    ) {
      if (method !== "HEAD") method = "GET";
      body = undefined;
    }
    if (next.origin !== current.origin) {
      headers = undefined;
    }
    current = next;
  }
}

/**
 * Normalize an origin allow-list: an array of absolute http(s) URLs, reduced
 * to their origins. null/undefined stays null (the caller decides what an
 * absent list means).
 */
export function normalizeHttpOriginList(origins, label = "allowedHttpOrigins") {
  if (origins === undefined || origins === null) return null;
  if (!Array.isArray(origins)) {
    throw new TypeError(`${label} must be an array of origin strings.`);
  }
  const normalized = new Set();
  for (const origin of origins) {
    const parsed = new URL(String(origin ?? ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError(`${label} entry "${origin}" must use http: or https:.`);
    }
    normalized.add(parsed.origin);
  }
  return normalized;
}
