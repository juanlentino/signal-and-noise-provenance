import { describe, it, expect } from "vitest";
import { otsMatches } from "../index-parity.mjs";

// The 2026-08-11 red was `record says pending/null, index says pending/undefined`.
// It was fixed where it was NOTICED — the page-row comparison — and the two
// note-row comparisons kept the old asymmetric shape. Line 58 then reddened CI
// again on 2026-08-14 with the identical message. The layer, not the site, is
// what these tests pin: absent and explicit-null are the SAME answer on EITHER
// side, because the worker omits the key and the index writes null.
describe("otsMatches — absent and null are the same answer", () => {
  it("matches when the record omits the block and the row writes null", () => {
    expect(otsMatches({ status: "pending" }, { ots_status: "pending", bitcoin_block: null })).toBe(true);
  });

  it("matches when the row omits the block and the record writes null", () => {
    // The direction line 58 got wrong: the row side was left un-normalized, so
    // `null !== undefined` threw and printed "index says pending/undefined".
    expect(otsMatches({ status: "pending", bitcoin_block: null }, { ots_status: "pending" })).toBe(true);
  });

  it("matches when BOTH sides omit the block", () => {
    expect(otsMatches({ status: "pending" }, { ots_status: "pending" })).toBe(true);
  });

  it("matches when both carry the same confirmed block", () => {
    expect(otsMatches({ status: "confirmed", bitcoin_block: 860123 }, { ots_status: "confirmed", bitcoin_block: 860123 })).toBe(true);
  });
});

describe("otsMatches — real disagreement still fails", () => {
  it("rejects a differing status", () => {
    expect(otsMatches({ status: "confirmed", bitcoin_block: 1 }, { ots_status: "pending", bitcoin_block: 1 })).toBe(false);
  });

  it("rejects a differing block height", () => {
    expect(otsMatches({ status: "confirmed", bitcoin_block: 860123 }, { ots_status: "confirmed", bitcoin_block: 860124 })).toBe(false);
  });

  it("rejects a row claiming an anchor the record does not have", () => {
    // The case that matters for trust: the index advertises a confirmed block
    // while the record is still pending. Absent-equals-null must NOT soften it.
    expect(otsMatches({ status: "pending" }, { ots_status: "confirmed", bitcoin_block: 860123 })).toBe(false);
  });

  it("rejects a confirmed record against a row with no block at all", () => {
    expect(otsMatches({ status: "confirmed", bitcoin_block: 860123 }, { ots_status: "confirmed" })).toBe(false);
  });

  it("does not treat 0 as absent", () => {
    // `??` and `||` differ exactly here. Block 0 is not a real height, but a
    // comparison that collapses it to null would hide a corrupt row.
    expect(otsMatches({ status: "confirmed", bitcoin_block: 0 }, { ots_status: "confirmed", bitcoin_block: null })).toBe(false);
  });
});

// The Worker's OTS sweep rewrites a record in place ([skip ci]) and leaves the
// index until the next live run. Offline coverage tolerates exactly that, and
// nothing else (2026-10-11, review of #48).
import { sweptAhead } from "../index-parity.mjs";
describe("sweptAhead — a record confirmed ahead of its index row", () => {
  it("is the sweep: record confirmed with a block, row still pending with none", () => {
    expect(sweptAhead({ status: "confirmed", bitcoin_block: 970960 }, { ots_status: "pending", bitcoin_block: null })).toBe(true);
  });
  it("is not a row that claims MORE than its record (row confirmed, record pending)", () => {
    expect(sweptAhead({ status: "pending", bitcoin_block: null }, { ots_status: "confirmed", bitcoin_block: 970960 })).toBe(false);
  });
  it("is not two different confirmed blocks", () => {
    expect(sweptAhead({ status: "confirmed", bitcoin_block: 970960 }, { ots_status: "confirmed", bitcoin_block: 970961 })).toBe(false);
  });
  it("is not a confirmed record without a block", () => {
    expect(sweptAhead({ status: "confirmed", bitcoin_block: null }, { ots_status: "pending", bitcoin_block: null })).toBe(false);
  });
  it("is not a pending row that already names a block", () => {
    expect(sweptAhead({ status: "confirmed", bitcoin_block: 970960 }, { ots_status: "pending", bitcoin_block: 970960 })).toBe(false);
  });
});
