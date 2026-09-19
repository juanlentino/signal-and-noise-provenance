import { describe, expect, it } from "vitest";
import { evidenceDivergences, evidenceUuid } from "../rights-evidence-checks.mjs";

// Known answers from the plugin's own derivation (sn_rights_evidence_uuid,
// plugin 17.0.0), so the two sides cannot drift apart unnoticed.
const OPENAI_AUG = "0f9d8fcc-d83b-5f41-ae47-2e4643f9f800";
const ANTHROPIC_AUG = "e52701af-38fd-5775-ac84-ba94e87ee6b3";

const payload = (over = {}) => ({
  kind: "rights-evidence",
  family: "openai",
  month: "2026-08",
  site: "https://juanlentino.com",
  composed_at: "2026-09-19T14:00:00+00:00",
  reservation: { as_of: "2026-09-19T14:00:00+00:00", signals: [{ slug: "tdmrep-json", version: 1, content_hash: "421f88383938eeaf8882474c747d1f3cfcd7e51c5d89711fd3df98fc0071ec80", ots_status: "confirmed", bitcoin_block: 959348 }] },
  rights_reads: { reads: 3, by_path: { "/license.xml": 1 }, first: "2026-08-03T09:00:00Z", last: "2026-08-20T10:00:00Z", complete: true },
  crawling: { reads: 50, train: 41, by_day: {}, by_surface: {}, complete: true },
  sensor: { version: "1.25.4", taxonomy: "1.4" },
  ...over,
});
const ctx = (over = {}) => ({ uid: OPENAI_AUG, version: 1, host: "juanlentino.com", ...over });

describe("evidenceUuid", () => {
  it("derives the plugin's ids, trailing slash or not", async () => {
    expect(await evidenceUuid("https://juanlentino.com/", "openai", "2026-08")).toBe(OPENAI_AUG);
    expect(await evidenceUuid("https://juanlentino.com", "openai", "2026-08")).toBe(OPENAI_AUG);
    expect(await evidenceUuid("https://juanlentino.com", "anthropic", "2026-08")).toBe(ANTHROPIC_AUG);
  });
});

describe("evidenceDivergences", () => {
  it("passes a well-formed record filed under its own id", async () => {
    expect(await evidenceDivergences({ payload: payload() }, ctx())).toEqual([]);
  });
  it("refuses a record filed under another id", async () => {
    const out = await evidenceDivergences({ payload: payload() }, ctx({ uid: ANTHROPIC_AUG }));
    expect(out.map(([k]) => k)).toEqual(["id"]);
    expect(out[0][1]).toContain(OPENAI_AUG);
  });
  it("refuses another site, another kind, a bad month, a v2", async () => {
    expect((await evidenceDivergences({ payload: payload({ site: "https://example.com" }) }, ctx())).map(([k]) => k)).toEqual(["site"]);
    expect((await evidenceDivergences({ payload: payload({ kind: "note" }) }, ctx())).map(([k]) => k)).toEqual(["kind"]);
    expect((await evidenceDivergences({ payload: payload({ month: "2026-13" }) }, ctx())).map(([k]) => k)).toEqual(["month"]);
    expect((await evidenceDivergences({ payload: payload() }, ctx({ version: 2 }))).map(([k]) => k)).toEqual(["version"]);
  });
  it("refuses a record without the reservation, or with a signal lacking a hash", async () => {
    expect((await evidenceDivergences({ payload: payload({ reservation: { as_of: "x", signals: [] } }) }, ctx())).map(([k]) => k)).toEqual(["reservation"]);
    expect((await evidenceDivergences({ payload: payload({ reservation: { as_of: "x", signals: [{ slug: "robots-txt", content_hash: "short" }] } }) }, ctx())).map(([k]) => k)).toEqual(["reservation"]);
  });
  it("refuses counts that are not counts, or a training share above the reads", async () => {
    expect((await evidenceDivergences({ payload: payload({ crawling: { reads: 5, train: 9, by_day: {}, by_surface: {}, complete: true } }) }, ctx())).map(([k]) => k)).toEqual(["crawling"]);
    expect((await evidenceDivergences({ payload: payload({ crawling: { reads: "5", train: 1, by_day: {}, by_surface: {}, complete: true } }) }, ctx())).map(([k]) => k)).toEqual(["crawling"]);
  });
  it("names every missing block and key", async () => {
    const out = await evidenceDivergences({ payload: payload({ rights_reads: { reads: 1 }, crawling: undefined }) }, ctx());
    expect(out.map(([k, d]) => d)).toEqual(expect.arrayContaining([expect.stringContaining("rights_reads.by_path"), expect.stringContaining("payload.crawling is missing")]));
  });
});
