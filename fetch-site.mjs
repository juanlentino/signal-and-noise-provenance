// One hardened way to fetch juanlentino.com from a verifier leg.
//
// Why this exists: `response.ok` validates the TRANSPORT, not the PAYLOAD. The
// edge in front of the site has twice answered a bare default-UA fetch from a
// GitHub runner with something that is not the API —
//
//   2026-07-29  HTTP 415 on the .well-known key mirror (caught by `!ok`)
//   2026-08-02  HTTP 200 with an HTML body on /wp-json/wp/v2/posts
//
// — and the second shape walked straight through `if (!response.ok)` to die as
// `SyntaxError: Unexpected token '<', "<!DOCTYPE "...` inside JSON.parse. That
// error names no status, no content-type, no cf-ray and no body, so the edge's
// actual verdict was unrecoverable after the fact. A check whose failure output
// cannot diagnose the failure is not a check.
//
// So: identify ourselves (a named UA + Accept, as verify-key-pins has done
// since the 415), assert the payload SHAPE and not just the status, retry a
// bounded number of times because both incidents were transient, and when we
// do give up, put every byte of evidence in the error message.
//
// Blockstream/esplora calls in verify.mjs deliberately do NOT use this — a
// different origin with a different failure mode, out of scope here.

const VERSION = "1.0";
const USER_AGENT = `sn-ledger-verify/${VERSION} (+https://github.com/juanlentino/signal-and-noise-provenance)`;
const ATTEMPTS = 3;
const BACKOFF_MS = [5000, 10000];
const SNIPPET_CHARS = 220;

// HTML pages ask for `*/*` — the default undici has always sent — ON PURPOSE.
// Narrowing it to `text/html` measurably changes the response (119,540 vs
// 119,181 bytes for the same Note), so `Accept` participates in the edge cache
// key here; a politeness header would quietly move every page fetch onto a
// different, colder cache variant. We validate the content-type we RECEIVE
// either way, so nothing is lost by asking broadly. JSON keeps an explicit
// Accept: that is the request shape verify-key-pins has used since 2026-07-29.
const ACCEPT = { json: "application/json", html: "*/*" };
const CONTENT_TYPE_PATTERN = { json: /^application\/(?:[\w.+-]+\+)?json\b/i, html: /^text\/html\b/i };

export class SiteFetchError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "SiteFetchError";
    Object.assign(this, detail);
  }
}

/** Collapse a response body to one bounded, single-line, log-safe snippet. */
const snippet = (body) =>
  String(body ?? "").slice(0, SNIPPET_CHARS).replace(/\s+/g, " ").trim() || "(empty body)";

const describe = ({ url, status, contentType, ray, body, reason }) =>
  `${reason} for ${url} — HTTP ${status}, content-type ${contentType || "(none)"}, cf-ray ${ray || "(none)"}; body starts: ${snippet(body)}`;

/**
 * Fetch a site URL and hand back the response plus a SHAPE-VALIDATED body.
 *
 * @param {string|URL} url
 * @param {object}   options
 * @param {"json"|"html"} options.expect  payload shape to demand — this is the guard
 * @param {number[]} [options.tolerate]   statuses that mean "legitimately absent":
 *                                        returned as `body: null`, no retry, no throw
 * @param {Function} [options.fetchImpl]  injectable for tests
 * @param {Function} [options.sleep]      injectable for tests
 * @returns {Promise<{response: Response, body: any}>}
 * @throws {SiteFetchError} with the status, content-type, cf-ray and body snippet
 */
export async function fetchSite(url, { expect, tolerate = [], fetchImpl = fetch, sleep = defaultSleep } = {}) {
  if (!ACCEPT[expect]) throw new TypeError(`fetchSite: expect must be "json" or "html", got ${JSON.stringify(expect)}`);
  const target = String(url);
  let lastFailure = null;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const outcome = await attemptOnce(target, expect, tolerate, fetchImpl);
    if (outcome.ok) return { response: outcome.response, body: outcome.body };
    lastFailure = outcome;
    if (attempt < ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1]);
  }

  throw new SiteFetchError(describe(lastFailure.detail), { url: target, ...lastFailure.detail });
}

async function attemptOnce(target, expect, tolerate, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(target, { headers: { Accept: ACCEPT[expect], "User-Agent": USER_AGENT } });
  } catch (cause) {
    // A transport error has no response to interrogate; keep the cause verbatim.
    return { ok: false, detail: { url: target, status: "(no response)", contentType: null, ray: null, body: cause.message, reason: "network error" } };
  }

  const contentType = response.headers.get("content-type");
  const ray = response.headers.get("cf-ray");
  const detail = { url: target, status: response.status, contentType, ray, body: "" };

  if (tolerate.includes(response.status)) return { ok: true, response, body: null };
  if (!response.ok) return { ok: false, detail: { ...detail, body: await safeText(response), reason: "site fetch failed" } };

  const body = await safeText(response);
  if (!CONTENT_TYPE_PATTERN[expect].test(contentType || "")) {
    // The 2026-08-02 shape: a 200 the transport check happily accepts, carrying
    // an interstitial/error page instead of the API.
    return { ok: false, detail: { ...detail, body, reason: `edge served ${expect === "json" ? "non-JSON" : "non-HTML"} where ${expect.toUpperCase()} was expected` } };
  }

  if (expect === "html") return { ok: true, response, body };
  try {
    return { ok: true, response, body: JSON.parse(body) };
  } catch {
    return { ok: false, detail: { ...detail, body, reason: "JSON content-type but unparseable body" } };
  }
}

const safeText = async (response) => {
  try { return await response.text(); } catch (cause) { return `(body unreadable: ${cause.message})`; }
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Convenience wrappers — the two shapes every caller in this repo needs. */
export const fetchSiteJson = async (url, options = {}) => (await fetchSite(url, { ...options, expect: "json" })).body;
export const fetchSiteHtml = async (url, options = {}) => (await fetchSite(url, { ...options, expect: "html" })).body;
