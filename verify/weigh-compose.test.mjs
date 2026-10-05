import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compose, eventContribution } from "../weigh/compose.mjs";
import { loadPolicy } from "../weigh/policy.mjs";
import { cmp, rat, show } from "../weigh/rational.mjs";
import { parseArgs } from "../weigh.mjs";

// Each test pins a property Provenance Without Institutions (SSRN 7456638)
// states in Section 6. The policies here are synthetic: this ledger holds no
// recognition attestation, so the attestation term is exercised only here.

const raw = (over = {}) => ({
  schema: "sn-weigh-policy-v1",
  description: "test policy",
  recognition_set: ["union-a", "society-b", "peer-c", "peer-d"],
  partition: { institutions: ["union-a", "society-b"], peers: ["peer-c", "peer-d"] },
  attestation_coefficients: { membership: "1", peer: "1/2" },
  delta: 2,
  gamma: "1/2",
  d_table: ["1/2", "3/4", "1"],
  decay: { form: "epoch-retain", epoch_blocks: 100, retain: { work: "9/10", revision: "3/4" } },
  ...over,
});
const events = [
  { class: "work", height: 1000n },
  { class: "work", height: 1150n },
  { class: "revision", height: 1210n },
];
const att = (type, issuer, n = 1) => Array.from({ length: n }, () => ({ type, issuer }));
const W = (attestations, over = {}, at = 1300n) => compose({ events, attestations }, loadPolicy(raw(over)), at);

describe("the composition", () => {
  it("persistence decays on the epoch grid, exactly", () => {
    // work@1000: 9/10^3; work@1150: 9/10^1; revision@1210: 3/4^0
    expect(show(W([]).persistenceSum)).toBe(show(rat(729n + 900n + 1000n, 1000n)));
  });
  it("changing the recognition set or the partition leaves the persistence sum unchanged", () => {
    const a = [...att("membership", "union-a"), ...att("peer", "peer-c", 3)];
    const base = show(W(a).persistenceSum);
    expect(show(W(a, { recognition_set: [], partition: {} }).persistenceSum)).toBe(base);
    expect(show(W(a, { partition: { all: ["union-a", "society-b", "peer-c", "peer-d"] } }).persistenceSum)).toBe(base);
  });
  it("with an empty recognition set, W equals the persistence sum exactly", () => {
    const r = W([...att("membership", "union-a"), ...att("peer", "peer-c", 5)], { recognition_set: [], partition: {} });
    expect(show(r.W)).toBe(show(r.persistenceSum));
  });
  it("counts past delta add nothing", () => {
    expect(show(W(att("peer", "peer-c", 2)).W)).toBe(show(W(att("peer", "peer-c", 9)).W));
  });
  it("one category yields gamma times the counted sum", () => {
    const r = W([...att("peer", "peer-c"), ...att("peer", "peer-d")]);
    expect(r.attest.C).toBe(1);
    expect(show(r.attest.term)).toBe(show(rat(1n, 2n))); // (1/2 * 2) * 1/2
  });
  it("adding a category never lowers the result", () => {
    const one = W(att("peer", "peer-c", 2)).W;
    const two = W([...att("peer", "peer-c", 2), ...att("membership", "union-a")]).W;
    expect(cmp(two, one)).toBeGreaterThanOrEqual(0);
  });
  it("an unrecognized issuer counts for nothing", () => {
    expect(show(W(att("membership", "stranger", 3)).W)).toBe(show(W([]).W));
  });
  it("a later --at never raises an existing event's contribution", () => {
    const p = loadPolicy(raw());
    for (const e of events) {
      let prior = eventContribution(e, p, e.height);
      for (let at = e.height; at < e.height + 1000n; at += 37n) {
        const now = eventContribution(e, p, at);
        expect(cmp(now, prior)).toBeLessThanOrEqual(0);
        prior = now;
      }
    }
  });
  it("an event anchored after --at contributes nothing", () => {
    expect(show(eventContribution({ class: "work", height: 2000n }, loadPolicy(raw()), 1999n))).toBe("0");
  });
});

// Mutation checks: one change to a sound policy, refused under the rule it breaks.
describe("the policy loader", () => {
  const refused = (over) => {
    try { loadPolicy(raw(over)); } catch (error) { return error.rule; }
    return "accepted";
  };
  it("accepts the sound policy and the shipped example", () => {
    expect(refused({})).toBe("accepted");
    expect(() => loadPolicy(JSON.parse(readFileSync(new URL("../policy/example.json", import.meta.url), "utf8")))).not.toThrow();
  });
  it("rejects a D table that breaks any of the four properties", () => {
    expect(refused({ d_table: ["1/2", "3/4", "5/4"] })).toBe("d-bounded");
    expect(refused({ d_table: ["3/4", "1"] })).toBe("d-floor");
    expect(refused({ d_table: ["1/2", "1", "3/4"] })).toBe("d-non-decreasing");
    expect(refused({ d_table: { form: "by-issuer-size" } })).toBe("d-form");
    expect(refused({ d_table: [] })).toBe("d-form");
  });
  it("rejects an unknown field or an unknown decay form", () => {
    expect(refused({ threshold: 10 })).toBe("fields");
    expect(refused({ decay: { form: "exponential", epoch_blocks: 100, retain: { work: "9/10" } } })).toBe("decay-form");
    expect(refused({ decay: { form: "epoch-retain", epoch_blocks: 100, retain: { work: "9/10" }, floor: "1" } })).toBe("decay");
  });
  it("rejects every other broken input", () => {
    expect(refused({ gamma: 0.5 })).toBe(undefined); // a float is refused before any rule is named
    expect(() => loadPolicy(raw({ gamma: 0.5 }))).toThrow(/rational/);
    expect(refused({ gamma: "0" })).toBe("gamma");
    expect(refused({ delta: 0 })).toBe("delta");
    expect(refused({ partition: { peers: ["peer-c"] } })).toBe("partition");
    expect(refused({ decay: { form: "epoch-retain", epoch_blocks: 100, retain: { retraction: "1/2" } } })).toBe("persistence-type");
    expect(refused({ decay: { form: "epoch-retain", epoch_blocks: 100, retain: { work: "3/2" } } })).toBe("decay");
    expect(refused({ schema: "other" })).toBe("schema");
    expect(refused({ description: "" })).toBe("description");
  });
  it("there is no default policy", () => {
    expect(() => parseArgs([])).toThrow(/--policy is required/);
    expect(() => parseArgs(["--policy", "p.json", "--at", "2026-10-01"])).toThrow(/block height/);
  });
});
