import { describe, it, expect } from "vitest";
import { classifyPageFailure, describeEdge } from "../stale-edge.mjs";

describe("classifyPageFailure", () => {
  it("calls it a stale edge when the origin reproduces the record and the bare URL does not", () => {
    // the-master-never-moves, 2026-08-15.
    expect(classifyPageFailure({ bareMatches: false, freshMatches: true })).toBe("stale-edge");
  });

  it("calls it drift when neither the bare URL nor the origin reproduces the record", () => {
    expect(classifyPageFailure({ bareMatches: false, freshMatches: false })).toBe("drift");
  });

  it("defaults to drift when the cache-busted probe is inconclusive", () => {
    // An unusable probe must never downgrade a real accusation to a cache
    // excuse. Absent evidence is not evidence of a cache.
    expect(classifyPageFailure({ bareMatches: false, freshMatches: null })).toBe("drift");
    expect(classifyPageFailure({ bareMatches: false, freshMatches: undefined })).toBe("drift");
  });

  it("does not claim staleness when the bare URL already matches", () => {
    // Not a failure path at all, but the classifier must not invent one.
    expect(classifyPageFailure({ bareMatches: true, freshMatches: true })).toBe("drift");
  });
});

describe("describeEdge", () => {
  it("names the headers that make a staleness claim checkable", () => {
    const headers = new Headers({
      "cf-cache-status": "HIT",
      age: "300",
      "last-modified": "Fri, 14 Aug 2026 16:25:36 GMT",
      "cf-ray": "a2ba7fec9a4d48d8-MIA",
    });
    expect(describeEdge(headers)).toBe(
      "cf-cache-status=HIT, age=300, last-modified=Fri, 14 Aug 2026 16:25:36 GMT, cf-ray=a2ba7fec9a4d48d8-MIA"
    );
  });

  it("prints absent headers rather than dropping them", () => {
    // A CDN reporting no cache status at all is itself a finding.
    expect(describeEdge(new Headers({}))).toBe(
      "cf-cache-status=(none), age=(none), last-modified=(none), cf-ray=(none)"
    );
  });

  it("survives a missing headers object", () => {
    expect(describeEdge(null)).toContain("cf-cache-status=(none)");
  });
});
