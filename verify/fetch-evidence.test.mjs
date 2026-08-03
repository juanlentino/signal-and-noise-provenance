// A green CI run used to be ambiguous: it could mean "the retry absorbed a
// bot challenge" or "no challenge happened", and those produced IDENTICAL
// output. That ambiguity is why five consecutive green runs were weak evidence
// that the 2026-08-02 fix worked. These tests pin the telemetry that separates
// the two, so every future run states which one it was.
import { describe, it, expect, beforeEach } from "vitest";
import { fetchSite, fetchStats, resetFetchStats, fetchEvidenceLine } from "../fetch-site.mjs";

const INTERSTITIAL = `<!DOCTYPE html><html><head><title>One moment, please...</title></head><body>verifying</body></html>`;
const REAL = `<!DOCTYPE html><html><head><title>A Note</title></head><body>${"x".repeat(400)}</body></html>`;

const reply = (status, contentType, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n) => ({ "content-type": contentType, ...headers }[n.toLowerCase()] ?? null) },
  text: async () => body,
});

const scripted = (...replies) => {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)];
};

const noSleep = async () => {};
const opts = (fetchImpl) => ({ expect: "html", fetchImpl, sleep: noSleep });

beforeEach(() => resetFetchStats());

describe("fetch evidence — an unchallenged run is distinguishable from an absorbed one", () => {
  it("records a clean fetch as zero challenges", async () => {
    await fetchSite("https://juanlentino.com/a", opts(scripted(reply(200, "text/html", REAL))));
    const s = fetchStats();
    expect(s.requests).toBe(1);
    expect(s.attempts).toBe(1);
    expect(s.challenges).toBe(0);
    expect(s.recovered).toBe(0);
  });

  it("records a challenge that the retry absorbed, and says which attempt won", async () => {
    await fetchSite("https://juanlentino.com/a", opts(scripted(reply(200, "text/html", INTERSTITIAL), reply(200, "text/html", REAL))));
    const s = fetchStats();
    expect(s.requests).toBe(1);
    expect(s.attempts).toBe(2);
    expect(s.challenges).toBe(1);
    expect(s.recovered).toBe(1); // <-- the whole point: green, but NOT unchallenged
    expect(s.events[0].recoveredOnAttempt).toBe(2);
  });

  it("counts every challenged attempt when the retry budget is exhausted", async () => {
    await fetchSite("https://juanlentino.com/a", opts(scripted(reply(200, "text/html", INTERSTITIAL)))).catch(() => {});
    const s = fetchStats();
    expect(s.challenges).toBe(3);
    expect(s.recovered).toBe(0);
    expect(s.failed).toBe(1);
  });

  it("keeps the cf-ray and title of each challenge as evidence", async () => {
    const fetchImpl = scripted(
      reply(200, "text/html", INTERSTITIAL, { "cf-ray": "a250c3d3eadbcf1a-SJC" }),
      reply(200, "text/html", REAL),
    );
    await fetchSite("https://juanlentino.com/a", opts(fetchImpl));
    const [event] = fetchStats().events;
    expect(event.ray).toBe("a250c3d3eadbcf1a-SJC");
    expect(event.pop).toBe("SJC");
    expect(event.title).toBe("One moment, please...");
    expect(event.bytes).toBe(INTERSTITIAL.length);
  });

  it("accumulates across many fetches, as a verifier leg makes", async () => {
    for (let i = 0; i < 3; i++) await fetchSite(`https://juanlentino.com/${i}`, opts(scripted(reply(200, "text/html", REAL))));
    await fetchSite("https://juanlentino.com/x", opts(scripted(reply(200, "text/html", INTERSTITIAL), reply(200, "text/html", REAL))));
    const s = fetchStats();
    expect(s.requests).toBe(4);
    expect(s.challenges).toBe(1);
    expect(s.recovered).toBe(1);
  });
});

describe("fetchEvidenceLine — the claim a run is allowed to make", () => {
  it("states plainly that nothing was challenged, rather than implying immunity", async () => {
    await fetchSite("https://juanlentino.com/a", opts(scripted(reply(200, "text/html", REAL))));
    const line = fetchEvidenceLine("verify:pages");
    expect(line).toContain("1 fetch");
    expect(line).toMatch(/no challenge|0 challenges/i);
    expect(line).not.toMatch(/absorbed/i);
  });

  it("reports an absorbed challenge as positive evidence the retry works", async () => {
    await fetchSite("https://juanlentino.com/a", opts(scripted(reply(200, "text/html", INTERSTITIAL), reply(200, "text/html", REAL))));
    const line = fetchEvidenceLine("verify:pages");
    expect(line).toMatch(/absorbed/i);
    expect(line).toContain("1 challenge");
  });

  it("pluralises the noun a 29-page leg actually produces", async () => {
    for (let i = 0; i < 3; i++) await fetchSite(`https://juanlentino.com/${i}`, opts(scripted(reply(200, "text/html", REAL))));
    expect(fetchEvidenceLine("verify:pages")).toContain("3 fetches");
  });

  it("names the PoP so a pattern across runs is visible", async () => {
    const fetchImpl = scripted(reply(200, "text/html", INTERSTITIAL, { "cf-ray": "abc-SJC" }), reply(200, "text/html", REAL));
    await fetchSite("https://juanlentino.com/a", opts(fetchImpl));
    expect(fetchEvidenceLine("verify:pages")).toContain("SJC");
  });
});
