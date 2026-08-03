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

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "1.0";
const USER_AGENT = `sn-ledger-verify/${VERSION} (+https://github.com/juanlentino/signal-and-noise-provenance)`;
const ATTEMPTS = 3;
// Worst case 16s per URL. Deliberately not longer: if the edge is challenging
// this runner persistently rather than transiently, 29 pages must still fail
// inside the job's 15-minute timeout instead of hanging to it.
const BACKOFF_MS = [4000, 12000];
const SNIPPET_CHARS = 220;

// A bot-challenge interstitial is served as HTTP 200 text/html, so neither the
// status nor the content-type can see it. Observed on run 30771742915
// (2026-08-02, cf-ray …-SJC): 12,015 bytes titled "One moment, please..." in
// place of a ~119,000-byte Note. Match on the title, which is unambiguous, and
// on cf-mitigated, which Cloudflare sets when it acts on a request.
const CHALLENGE_TITLES = [
  /one moment,? please/i,
  /just a moment/i,
  /checking your browser/i,
  /attention required/i,
  /you have been blocked/i,
  /please wait\.\.\./i,
  /verifying you are human/i,
];

// HTML pages ask for `*/*` — the default undici has always sent — ON PURPOSE.
// Narrowing it to `text/html` measurably changes the response (119,540 vs
// 119,181 bytes for the same Note), so `Accept` participates in the edge cache
// key here; a politeness header would quietly move every page fetch onto a
// different, colder cache variant. We validate the content-type we RECEIVE
// either way, so nothing is lost by asking broadly. JSON keeps an explicit
// Accept: that is the request shape verify-key-pins has used since 2026-07-29.
const ACCEPT = { json: "application/json", html: "*/*" };
const CONTENT_TYPE_PATTERN = { json: /^application\/(?:[\w.+-]+\+)?json\b/i, html: /^text\/html\b/i };

// ---------------------------------------------------------------------------
// Evidence.
//
// Before this existed, a green CI run was AMBIGUOUS: "the retry absorbed a bot
// challenge" and "no challenge happened" produced byte-identical output. That
// is precisely why five consecutive green runs were weak evidence that the
// 2026-08-02 fix worked — they were consistent with the fix never having been
// exercised at all. Counting challenges turns every run into a statement about
// which of the two occurred, and builds the record needed to answer the two
// questions the fix currently assumes: how often is CI challenged, and does
// retrying the SAME request actually clear it inside the 16s budget?
// ---------------------------------------------------------------------------
const stats = { requests: 0, attempts: 0, challenges: 0, recovered: 0, failed: 0, events: [] };

// The unit tests drive dozens of SYNTHETIC challenges through this module. If
// those printed, a CI log would show ~50 "[challenge] … RECOVERED" lines and a
// reader would reasonably conclude the edge had challenged the run — the
// evidence channel would be reporting its own fixtures as findings. Under
// vitest, count silently; the assertions read the counters directly.
const announce = (line) => { if (!process.env.VITEST) console.warn(line); };

/** Snapshot of this process's fetch telemetry. */
export const fetchStats = () => ({ ...stats, events: stats.events.map((event) => ({ ...event })) });
export const resetFetchStats = () => Object.assign(stats, { requests: 0, attempts: 0, challenges: 0, recovered: 0, failed: 0, events: [] });

/**
 * One line stating what this leg is entitled to claim. Printed by every
 * verifier leg, green or red, so the CI log always says whether the edge
 * interfered — never leaving a pass to be read as immunity.
 */
export function fetchEvidenceLine(label) {
  const { requests, attempts, challenges, recovered, failed, events } = stats;
  const plural = (n, word) => `${n} ${n === 1 ? word : (word === "fetch" ? "fetches" : `${word}s`)}`;
  const head = `[evidence] ${label}: ${plural(requests, "fetch")}, ${plural(attempts, "attempt")}`;
  if (!challenges) return `${head}, no challenge from the edge (this run did not exercise the retry)`;
  const pops = [...new Set(events.map((event) => event.pop).filter(Boolean))].join(",") || "unknown PoP";
  const worst = Math.max(...events.map((event) => event.recoveredOnAttempt || ATTEMPTS));
  return `${head}, ${plural(challenges, "challenge")} from the edge at ${pops} — `
    + `${recovered} absorbed by retry (worst case: attempt ${worst}), ${failed} exhausted the budget`;
}

/**
 * Print the evidence line when the process exits — on success AND on throw.
 * A summary at the bottom of a script is exactly the code that does not run
 * when the script dies, which is the run you most need the evidence from.
 * Also appends to the GitHub step summary so it is on the run page, not buried
 * in a log. Call once, at the top of a verifier leg.
 */
export function installEvidenceReport(label) {
  process.on("exit", () => {
    const line = fetchEvidenceLine(label);
    console.log(line);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (!summary || !stats.requests) return;
    try { appendFileSync(summary, `- ${line}\n`); } catch { /* evidence is best-effort */ }
  });
}

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
  let firstChallenge = null;
  stats.requests += 1;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    stats.attempts += 1;
    const outcome = await attemptOnce(target, expect, tolerate, fetchImpl);

    if (outcome.challenge) {
      stats.challenges += 1;
      const event = { url: target, attempt, ...outcome.challenge };
      stats.events.push(event);
      firstChallenge ??= event;
      // Say it AT THE MOMENT it happens, not only in the summary: if the run
      // later dies for an unrelated reason, this line still records that the
      // edge interfered.
      announce(`[challenge] ${target} attempt ${attempt}/${ATTEMPTS} — ${outcome.challenge.title ? JSON.stringify(outcome.challenge.title) : outcome.challenge.why}, ${outcome.challenge.bytes} bytes, cf-ray ${outcome.challenge.ray || "(none)"}`);
      captureChallengeBody(target, attempt, outcome.challenge);
    }

    if (outcome.ok) {
      if (firstChallenge) {
        stats.recovered += 1;
        firstChallenge.recoveredOnAttempt = attempt;
        announce(`[challenge] ${target} — RECOVERED on attempt ${attempt}; the retry did its job`);
      }
      return { response: outcome.response, body: outcome.body, raw: outcome.raw };
    }
    lastFailure = outcome;
    if (attempt < ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1]);
  }

  stats.failed += 1;
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

  if (tolerate.includes(response.status)) return { ok: true, response, body: null, raw: "" };
  if (!response.ok) return { ok: false, detail: { ...detail, body: await safeText(response), reason: "site fetch failed" } };

  const body = await safeText(response);
  const challenge = challengeVerdict(response, body);
  if (challenge) {
    return {
      ok: false,
      challenge: { ...challenge, ray, pop: ray?.split("-").at(-1) ?? null, bytes: body.length, body },
      detail: { ...detail, body, reason: `edge served a bot challenge (${challenge.why})` },
    };
  }
  if (!CONTENT_TYPE_PATTERN[expect].test(contentType || "")) {
    // The 2026-08-02 shape: a 200 the transport check happily accepts, carrying
    // an interstitial/error page instead of the API.
    return { ok: false, detail: { ...detail, body, reason: `edge served ${expect === "json" ? "non-JSON" : "non-HTML"} where ${expect.toUpperCase()} was expected` } };
  }

  if (expect === "html") return { ok: true, response, body, raw: body };
  try {
    return { ok: true, response, body: JSON.parse(body), raw: body };
  } catch {
    return { ok: false, detail: { ...detail, body, reason: "JSON content-type but unparseable body" } };
  }
}

/**
 * Name the challenge if this response is one, else null. Title-based, so it
 * cannot fire on a real Note whose body merely happens to be short.
 */
function challengeVerdict(response, body) {
  const title = body.match(/<title[^>]*>([^<]{0,120})/i)?.[1]?.trim() ?? null;
  const mitigated = response.headers.get("cf-mitigated");
  if (mitigated) return { why: `cf-mitigated: ${mitigated}`, title };
  if (!title) return null;
  return CHALLENGE_TITLES.some((pattern) => pattern.test(title)) ? { why: `title ${JSON.stringify(title)}`, title } : null;
}

/**
 * Persist the challenge body when SN_CHALLENGE_CAPTURE_DIR is set (CI does).
 * We cannot reproduce a challenge from a residential IP — it is ASN-based — so
 * the only way to get a REAL interstitial to test against, rather than one
 * hand-written from a log line, is to have CI keep the one it was served.
 * Best-effort by design: failing to write evidence must never fail a run.
 */
function captureChallengeBody(url, attempt, challenge) {
  captureEvidence(`challenge-a${attempt}-${challenge.ray || "noray"}`, url, challenge.body, "html");
}

/**
 * Persist an unexpected payload when SN_CHALLENGE_CAPTURE_DIR is set (CI does).
 * The edge's odd answers are IP-based and cannot be reproduced from a
 * residential IP, so the runner keeping the bytes is the only way to see them.
 * Best-effort by design: failing to write evidence must never fail a run.
 */
export function captureEvidence(tag, url, body, ext = "txt") {
  const dir = process.env.SN_CHALLENGE_CAPTURE_DIR;
  // Same reason `announce` is silent under vitest, and missed here the first
  // time: the suite drives dozens of SYNTHETIC interstitials through this
  // module, and run 30775705768 duly uploaded 20 of them alongside the single
  // real one. An evidence artifact full of fixtures is worse than no artifact
  // — a reader cannot tell which body the edge actually served.
  if (!dir || process.env.VITEST) return;
  try {
    mkdirSync(dir, { recursive: true });
    const safe = String(url).replace(/[^a-z0-9]+/gi, "-").slice(-60);
    writeFileSync(join(dir, `${tag}-${safe}.${ext}`), String(body ?? ""));
  } catch { /* evidence is best-effort; never let it break verification */ }
}

const safeText = async (response) => {
  try { return await response.text(); } catch (cause) { return `(body unreadable: ${cause.message})`; }
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Convenience wrappers — the two shapes every caller in this repo needs. */
export const fetchSiteJson = async (url, options = {}) => (await fetchSite(url, { ...options, expect: "json" })).body;
export const fetchSiteHtml = async (url, options = {}) => (await fetchSite(url, { ...options, expect: "html" })).body;
