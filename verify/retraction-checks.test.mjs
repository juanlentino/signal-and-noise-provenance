import { describe, expect, it } from "vitest";
import { retractionDivergences } from "../retraction-checks.mjs";

const UID = "3f7c2a10-9d4e-4b6f-8a21-5e0c9b7d1f42";
const ctx = (over = {}) => ({
  uid: UID,
  file: "v2.json",
  exists: (path) => path === `notes/${UID}/v2.json`,
  publishedKeyIds: ["sn-ed25519-2026-07"],
  ...over,
});
const rec = (over = {}) => ({
  pubkey_id: "sn-ed25519-2026-07",
  payload: {
    kind: "retraction",
    note_uid: UID,
    version: 2,
    retracted_path: `notes/${UID}/v2.json`,
    what_was_wrong: "the hash covered pre-normalization bytes",
    ...(over.payload || {}),
  },
  ...(over.pubkey_id !== undefined ? { pubkey_id: over.pubkey_id } : {}),
});

describe("retractionDivergences", () => {
  it("passes a well-formed retraction whose subject is still published", () => {
    expect(retractionDivergences(rec(), ctx())).toEqual([]);
  });

  it("REFUSES a retraction whose subject is gone — the erasure case", () => {
    // The property this whole surface exists to protect. Retracting is not
    // deleting; if the subject can vanish, a retraction becomes a delete button
    // with a justification attached.
    const out = retractionDivergences(rec(), ctx({ exists: () => false }));
    expect(out.map(([k]) => k)).toContain("retracted_path");
    expect(JSON.stringify(out)).toMatch(/never removes its subject/);
  });

  it("refuses a retraction filed against a different record than it names", () => {
    const out = retractionDivergences(rec(), ctx({ file: "v9.json" }));
    expect(out.map(([k]) => k)).toContain("path");
  });

  it("refuses a withdrawal with no stated reason", () => {
    const out = retractionDivergences(rec({ payload: { what_was_wrong: "  " } }), ctx());
    expect(out.map(([k]) => k)).toContain("what_was_wrong");
  });

  it("refuses one signed by a key the history does not publish", () => {
    const out = retractionDivergences(rec({ pubkey_id: "sn-ed25519-2099-01" }), ctx());
    expect(out.map(([k]) => k)).toContain("pubkey_id");
  });

  it("does not mistake a non-retraction record for a valid one", () => {
    const out = retractionDivergences({ payload: { kind: "note" } }, ctx());
    expect(out.map(([k]) => k)).toEqual(["kind"]);
  });
});
