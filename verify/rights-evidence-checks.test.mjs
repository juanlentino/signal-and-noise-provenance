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

// Schema 2 (plugin PR #1810): the reservation in force during the month, the
// reads split by purpose. Shaped as the plugin composes it
// (sn_rights_evidence_compose), with August's openai id so only the rules
// under test can speak.
const H1 = "a645697a9b30edf738270a6351e2765b29048a69f882e81473e3f056c0a0f417";
const H2 = "7d2c712340f63795c0000000000000000000000000000000000000000000000a";
const reads = (purpose, over = {}) => ({ reads: 2, by_purpose: { [purpose]: 2 }, by_path: { [purpose]: { "/license.xml": 2 } }, first: "2026-08-03T09:00:00Z", last: "2026-08-20T10:00:00Z", complete: true, ...over });
const v2 = (over = {}) => ({
  schema: 2,
  kind: "rights-evidence",
  family: "openai",
  month: "2026-08",
  site: "https://juanlentino.com",
  composed_at: "2026-09-01T14:00:00+00:00",
  reservation: {
    window: { start: "2026-08-01T00:00:00Z", end: "2026-08-31T23:59:59Z" },
    signals: {
      "license-xml": [
        { block: 961766, content_hash: H1, valid_from: "2026-07-20T10:00:00Z", valid_to: "2026-08-12T08:00:00Z", version: 1 },
        { block: 963662, content_hash: H2, valid_from: "2026-08-12T08:00:00Z", valid_to: null, version: 2 },
      ],
    },
  },
  crawling: { reads: 50, train: 41, by_day: {}, by_surface: { train: { html: 41 }, search: { html: 9 } }, complete: true },
  rights_reads: reads("train"),
  retrieval_reads: reads("search"),
  unlabelled_reads: { reads: 0, by_purpose: {}, by_path: {}, first: "", last: "", complete: true },
  sensor: { version: "1.29.0", taxonomy: "1.4" },
  ...over,
});
const kinds = async (payload) => (await evidenceDivergences({ payload }, ctx())).map(([k]) => k);
const details = async (payload) => (await evidenceDivergences({ payload }, ctx())).map(([, d]) => d).join(" | ");
const withSignal = (entries) => v2({ reservation: { ...v2().reservation, signals: { "license-xml": entries } } });
const sig = (over = {}) => ({ block: 961766, content_hash: H1, valid_from: "2026-07-20T10:00:00Z", valid_to: null, version: 1, ...over });

describe("evidenceDivergences, schema 2", () => {
  it("passes a well-formed schema-2 record, with no as_of", async () => {
    expect(await kinds(v2())).toEqual([]);
  });
  it("refuses a schema it does not know", async () => {
    for (const schema of [1, 3, "2", null]) expect(await kinds(v2({ schema }))).toEqual(["schema"]);
  });
  it("keeps the version rule: a schema-2 month is minted once too", async () => {
    expect((await evidenceDivergences({ payload: v2() }, ctx({ version: 2 }))).map(([k]) => k)).toEqual(["version"]);
  });
  it("names every missing read block and key", async () => {
    expect(await details(v2({ retrieval_reads: undefined }))).toContain("payload.retrieval_reads is missing");
    const { by_purpose, ...noPurpose } = reads("train");
    expect(await details(v2({ rights_reads: noPurpose }))).toContain("payload.rights_reads.by_purpose is missing");
  });
  it("refuses read blocks whose fields have the wrong type", async () => {
    expect(await details(v2({ unlabelled_reads: reads("unlabelled", { reads: -1 }) }))).toContain("unlabelled_reads.reads is not a count");
    expect(await details(v2({ rights_reads: reads("train", { by_purpose: [] }) }))).toContain("rights_reads.by_purpose is not purpose to count");
    expect(await details(v2({ rights_reads: reads("train", { by_purpose: { train: "2" } }) }))).toContain("rights_reads.by_purpose is not purpose to count");
    expect(await details(v2({ rights_reads: reads("train", { by_path: { "/license.xml": 2 } }) }))).toContain("rights_reads.by_path is not purpose, then path, to count");
    expect(await details(v2({ rights_reads: reads("train", { by_path: { train: { "/license.xml": -1 } } }) }))).toContain("rights_reads.by_path is not purpose, then path, to count");
    expect(await details(v2({ rights_reads: reads("train", { first: null }) }))).toContain("rights_reads.first is not a string");
    expect(await details(v2({ rights_reads: reads("train", { complete: "yes" }) }))).toContain("rights_reads.complete is not a boolean");
  });
  it("keeps each purpose in its own block", async () => {
    expect(await details(v2({ rights_reads: reads("search") }))).toContain("rights_reads.by_purpose carries search; it may carry only train");
    expect(await details(v2({ unlabelled_reads: reads("train") }))).toContain("unlabelled_reads.by_purpose carries train; it may carry only unlabelled");
    for (const p of ["train", "unlabelled", "ops", "dev"]) expect(await details(v2({ retrieval_reads: reads(p) }))).toContain(`retrieval_reads.by_purpose carries ${p}`);
  });
  it("refuses crawling counts that are not counts, a training share above the reads, a flat by_surface", async () => {
    expect(await kinds(v2({ crawling: { ...v2().crawling, train: 90 } }))).toEqual(["crawling"]);
    expect(await details(v2({ crawling: { ...v2().crawling, reads: "50" } }))).toContain("crawling.reads is not a count");
    expect(await details(v2({ crawling: { ...v2().crawling, by_surface: { html: 50 } } }))).toContain("by_surface is not keyed by purpose, then surface");
    expect(await details(v2({ crawling: { reads: 1, train: 0, by_day: {}, by_surface: {} } }))).toContain("crawling.complete is missing");
  });
  it("refuses a reservation that is missing, empty, an array, or has an empty slug", async () => {
    expect(await details(v2({ reservation: undefined }))).toContain("payload.reservation is missing");
    expect(await details(v2({ reservation: { ...v2().reservation, signals: {} } }))).toContain("signals is empty");
    expect(await details(v2({ reservation: { ...v2().reservation, signals: [sig()] } }))).toContain("signals is empty");
    expect(await details(withSignal([]))).toContain("signal license-xml lists no version in force");
  });
  it("refuses a window that is not a span", async () => {
    expect(await details(v2({ reservation: { ...v2().reservation, window: { start: "2026-08-31T23:59:59Z", end: "2026-08-01T00:00:00Z" } } }))).toContain("window is not a {start, end} span");
    expect(await details(v2({ reservation: { ...v2().reservation, window: undefined } }))).toContain("window is not a {start, end} span");
  });
  it("refuses a window that is not the record's month", async () => {
    const win = (start, end) => v2({ reservation: { ...v2().reservation, window: { start, end } } });
    expect(await details(win("2026-07-01T00:00:00Z", "2026-07-31T23:59:59Z"))).toContain("is not the month 2026-08");
    expect(await details(win("2026-08-02T00:00:00Z", "2026-08-31T23:59:59Z"))).toContain("is not the month 2026-08");
    expect(await details(win("2026-08-01T00:00:00Z", "2026-08-30T23:59:59Z"))).toContain("is not the month 2026-08");
    expect(await details(win("2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z"))).toContain("is not the month 2026-08");
    // Compared as times: the same instants under another offset agree.
    expect(await kinds(win("2026-08-01T02:00:00+02:00", "2026-08-31T23:59:59+00:00"))).toEqual([]);
    // February, and a leap year, end where the calendar says.
    expect(await details(v2({ month: "2026-02", reservation: { ...v2().reservation, window: { start: "2026-02-01T00:00:00Z", end: "2026-02-28T23:59:59Z" } } }))).not.toContain("is not the month");
    expect(await details(v2({ month: "2028-02", reservation: { ...v2().reservation, window: { start: "2028-02-01T00:00:00Z", end: "2028-02-28T23:59:59Z" } } }))).toContain("is not the month 2028-02");
  });
  it("refuses versions that are not positive, repeated, or out of order", async () => {
    expect(await details(withSignal([sig({ version: 0 })]))).toContain("not a positive integer");
    expect(await details(withSignal([sig({ version: 2 }), sig({ version: 2 })]))).toContain("out of order");
    expect(await details(withSignal([sig({ version: 2, valid_to: "2026-08-12T08:00:00Z" }), sig({ version: 1 })]))).toContain("out of order");
  });
  it("refuses a version without a sha256 hash, a block, or a valid_from", async () => {
    expect(await details(withSignal([sig({ content_hash: "short" })]))).toContain("has no sha256 content_hash");
    expect(await details(withSignal([sig({ block: "961766" })]))).toContain("names no anchor block");
    expect(await details(withSignal([sig({ valid_from: "" })]))).toContain("has no valid_from time");
    expect(await details(withSignal([sig({ valid_to: undefined })]))).toContain("valid_to that is neither a time nor null");
  });
  it("refuses a version that ends before it starts", async () => {
    expect(await details(withSignal([sig({ valid_from: "2026-08-10T00:00:00Z", valid_to: "2026-08-09T00:00:00Z" })]))).toContain("ends (2026-08-09T00:00:00Z) before it starts");
  });
  it("refuses a version not in force during the window, and accepts one that overlaps its edges", async () => {
    expect(await details(withSignal([sig({ valid_from: "2026-09-01T00:00:01Z" })]))).toContain("was not in force during");
    expect(await details(withSignal([sig({ valid_from: "2026-06-01T00:00:00Z", valid_to: "2026-07-31T23:59:59Z" })]))).toContain("was not in force during");
    expect(await kinds(withSignal([sig({ valid_from: "2026-08-31T23:59:59Z" })]))).toEqual([]);
    // valid_to is the NEXT version's anchor: ending exactly at the window's
    // first instant means it never held inside it (the plugin's rule).
    expect(await details(withSignal([sig({ valid_from: "2026-06-01T00:00:00Z", valid_to: "2026-08-01T00:00:00Z" })]))).toContain("was not in force during");
    expect(await kinds(withSignal([sig({ valid_from: "2026-06-01T00:00:00Z", valid_to: "2026-08-01T00:00:01Z" })]))).toEqual([]);
    // Offsets compare as times, not as strings: 01:00+02:00 on the 1st is
    // 23:00Z on the 31st, inside the window, though it sorts after its end.
    expect(await kinds(withSignal([sig({ valid_from: "2026-09-01T01:00:00+02:00" })]))).toEqual([]);
  });
  it("refuses a sensor that names no taxonomy", async () => {
    expect(await kinds(v2({ sensor: { version: "1.29.0", taxonomy: "" } }))).toEqual(["sensor"]);
    expect(await kinds(v2({ sensor: { version: "1.29.0" } }))).toEqual(["sensor"]);
    expect(await kinds(v2({ sensor: undefined }))).toEqual(["sensor", "sensor"]);
  });
});

describe("evidenceDivergences, schema 1 unchanged", () => {
  it("still refuses a schema-1 record missing as_of, and ignores a missing sensor", async () => {
    const out = await evidenceDivergences({ payload: payload({ reservation: { signals: payload().reservation.signals } }) }, ctx());
    expect(out).toEqual([["reservation", "payload.reservation.as_of is missing"]]);
    expect(await evidenceDivergences({ payload: payload({ sensor: undefined }) }, ctx())).toEqual([]);
  });
  it("does not read schema-2 rules into a schema-1 record: a flat by_surface and no read split pass", async () => {
    expect(await evidenceDivergences({ payload: payload({ crawling: { reads: 5, train: 1, by_day: {}, by_surface: { html: 5 }, complete: true } }) }, ctx())).toEqual([]);
  });
});
