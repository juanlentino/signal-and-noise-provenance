// The decision that decides whether CI is red on the day you publish.
//
// Context: on 2026-08-05 the-pen-is-not-the-notary was published at 11:28 and
// verify:coverage failed at 11:35 with "anchor is not confirmed" — seven
// minutes into a wait that normally takes hours. A check that fails every time
// you publish is a check people learn to ignore, which defeats the point of
// having a trust repo notice things.
//
// The clock is injected in every case here: a grace window tested against the
// real wall clock would pass today and fail at some future hour, which is the
// kind of test that erodes trust in the suite.
import { describe, it, expect } from "vitest";
import { hoursSince, pendingVerdict, DEFAULT_GRACE_HOURS } from "../anchor-grace.mjs";

const NOW = Date.parse("2026-08-05T12:00:00Z");
const at = (iso, over = {}) => ({ ots_status: "pending", published_at: iso, ...over });

describe("hoursSince", () => {
  it("measures elapsed hours against the injected clock", () => {
    expect(hoursSince("2026-08-05T11:00:00Z", NOW)).toBe(1);
    expect(hoursSince("2026-08-04T12:00:00Z", NOW)).toBe(24);
  });

  it("returns null for absent, empty, or unparseable input", () => {
    // Null is not zero and not young: an age that cannot be established must
    // never read as "just published".
    expect(hoursSince(undefined, NOW)).toBeNull();
    expect(hoursSince("", NOW)).toBeNull();
    expect(hoursSince("not a date", NOW)).toBeNull();
    expect(hoursSince(1785961052, NOW)).toBeNull();
    expect(hoursSince(null, NOW)).toBeNull();
  });

  it("returns a negative number for a future timestamp rather than clamping", () => {
    expect(hoursSince("2026-08-05T13:00:00Z", NOW)).toBe(-1);
  });
});

describe("pendingVerdict", () => {
  it("passes a freshly published Note — the live 2026-08-05 case", () => {
    // Published 11:28, CI ran 11:35.
    const v = pendingVerdict(at("2026-08-05T11:28:00Z"), { now: Date.parse("2026-08-05T11:35:00Z") });
    expect(v.ok).toBe(true);
    expect(v.reason).toBeNull();
    expect(v.hours).toBeCloseTo(0.116, 2);
  });

  it("passes right up to the window and fails past it", () => {
    expect(pendingVerdict(at("2026-08-04T12:00:00Z"), { now: NOW }).ok).toBe(true);   // exactly 24h
    expect(pendingVerdict(at("2026-08-04T11:59:00Z"), { now: NOW }).ok).toBe(false);  // 24.02h
  });

  it("names the age when it fails, so the report is actionable", () => {
    const v = pendingVerdict(at("2026-08-04T00:00:00Z"), { now: NOW }); // 36h before NOW
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("36.0h");
    expect(v.reason).toContain("24h grace window");
  });

  it("honours a custom window", () => {
    const entry = at("2026-08-05T06:00:00Z"); // 6h old
    expect(pendingVerdict(entry, { now: NOW, graceHours: 12 }).ok).toBe(true);
    expect(pendingVerdict(entry, { now: NOW, graceHours: 4 }).ok).toBe(false);
  });

  it("fails any status that is not pending, regardless of age", () => {
    // Only "pending" is a waiting state. A failed or missing status is a fault
    // even one second after publication — widening this would let a genuinely
    // broken anchor ride the grace window.
    for (const status of ["failed", "unknown", undefined, "", "confirmed-ish"]) {
      const v = pendingVerdict(at("2026-08-05T11:59:00Z", { ots_status: status }), { now: NOW });
      expect(v.ok).toBe(false);
      expect(v.reason).toContain("status is");
    }
  });

  it("fails when the age cannot be established", () => {
    // The failure mode this protects against: an entry with no usable
    // published_at passing forever because "we could not tell how old it is".
    for (const ts of [undefined, "", "yesterday", null]) {
      const v = pendingVerdict(at(ts), { now: NOW });
      expect(v.ok).toBe(false);
      expect(v.reason).toContain("age cannot be established");
    }
  });

  it("fails a future-dated publication instead of treating it as young", () => {
    const v = pendingVerdict(at("2026-08-06T12:00:00Z"), { now: NOW });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("in the future");
  });

  it("never returns ok:false without a reason", () => {
    // The invariant: a red build always says why. Mirrors the same rule applied
    // to the companion plugin's purge record the same day.
    const cases = [
      at("2026-08-01T00:00:00Z"),
      at(undefined),
      at("2026-08-06T12:00:00Z"),
      at("2026-08-05T11:59:00Z", { ots_status: "failed" }),
      {},
    ];
    for (const entry of cases) {
      const v = pendingVerdict(entry, { now: NOW });
      expect(v.ok).toBe(false);
      expect(typeof v.reason).toBe("string");
      expect(v.reason.length).toBeGreaterThan(0);
    }
  });

  it("defaults to a 24h window", () => {
    expect(DEFAULT_GRACE_HOURS).toBe(24);
  });
});
