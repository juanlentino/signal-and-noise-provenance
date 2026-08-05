// Is a not-yet-confirmed anchor a failure, or just young?
//
// An OTS anchor is not instant: the aggregator batches, Bitcoin confirms, and a
// freshly published Note is legitimately `pending` for hours. Treating that as a
// failure reds the build on every publication and trains the maintainer to
// ignore the one check whose job is to notice real trouble. That happened on
// 2026-08-05 — the-pen-is-not-the-notary was published at 11:28 and CI failed at
// 11:35 with "anchor is not confirmed", seven minutes into a wait that normally
// takes hours.
//
// So pending is a STATE, not a verdict — while it is young. Past the window a
// stuck anchor is exactly what this check should catch, and it should say how
// long it has been stuck rather than repeating a binary "not confirmed".
//
// Extracted from verify-coverage.mjs so the decision is unit-testable with an
// injected clock; the script itself is a CLI with top-level side effects.

export const DEFAULT_GRACE_HOURS = 24;

/**
 * Hours between an ISO timestamp and `now`.
 *
 * Returns null when the input is absent or unparseable. Null is deliberately
 * NOT "young": an entry whose age cannot be established is unknown, and unknown
 * must never pass as recently published. Absent and zero are different answers.
 *
 * @param {unknown} iso ISO 8601 timestamp.
 * @param {number} now Epoch ms.
 * @returns {number|null}
 */
export function hoursSince(iso, now = Date.now()) {
  if (typeof iso !== "string" || iso === "") return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (now - t) / 3_600_000;
}

/**
 * Decide whether an index entry whose anchor is not confirmed may pass.
 *
 * @param {object} entry Index row (needs `ots_status` and `published_at`).
 * @param {{graceHours?: number, now?: number}} opts
 * @returns {{ok: boolean, hours: number|null, reason: string|null}}
 *   ok:false carries a reason naming WHY — never a bare "not confirmed".
 */
export function pendingVerdict(entry, { graceHours = DEFAULT_GRACE_HOURS, now = Date.now() } = {}) {
  const status = entry?.ots_status;
  const hours = hoursSince(entry?.published_at, now);

  // Only "pending" is a waiting state. Any other value — failed, missing,
  // misspelled — is a fault regardless of age.
  if (status !== "pending") {
    return { ok: false, hours, reason: `status is ${status ?? "missing"}` };
  }
  if (hours === null) {
    return { ok: false, hours: null, reason: "pending, and published_at is missing or unparseable so its age cannot be established" };
  }
  // A future-dated published_at is also unknown territory — a scheduled post or
  // a clock problem, either way not evidence the anchor is progressing.
  if (hours < 0) {
    return { ok: false, hours, reason: `pending, and published_at is ${Math.abs(hours).toFixed(1)}h in the future` };
  }
  if (hours > graceHours) {
    return { ok: false, hours, reason: `pending for ${hours.toFixed(1)}h, past the ${graceHours}h grace window` };
  }
  return { ok: true, hours, reason: null };
}
