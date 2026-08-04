import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contiguousFromV1, expectedParent, latestRecordVersion, recordVersions } from "../ledger-records.mjs";

// A note directory holds vN.json + vN.ots per version. These helpers are the
// single place that answers "which record is current?", so every consumer
// (index builder, coverage guard, offline record verifier) agrees.
let root;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "sn-ledger-"));
  const note = (uid, files) => {
    mkdirSync(join(root, uid), { recursive: true });
    for (const name of files) writeFileSync(join(root, uid, name), "{}");
  };
  note("single", ["v1.json", "v1.ots"]);
  note("edited", ["v1.json", "v1.ots", "v2.json", "v2.ots"]);
  // Ten versions is where a string sort silently returns v9: "v9" > "v10".
  note("long-lived", Array.from({ length: 10 }, (_, i) => `v${i + 1}.json`));
  note("noisy", ["v1.json", "v1.ots", "README.md", "v2.json.bak", "vX.json"]);
  note("empty", []);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("recordVersions", () => {
  it("returns every committed version in ascending order", () => {
    expect(recordVersions(root, "edited")).toEqual([1, 2]);
  });

  it("orders numerically, not lexicographically, past v9", () => {
    expect(recordVersions(root, "long-lived")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("counts only vN.json records, never proofs or stray files", () => {
    expect(recordVersions(root, "noisy")).toEqual([1]);
  });

  it("returns nothing for a directory with no records", () => {
    expect(recordVersions(root, "empty")).toEqual([]);
  });

  it("returns nothing for a note that does not exist rather than throwing", () => {
    expect(recordVersions(root, "absent")).toEqual([]);
  });
});

describe("latestRecordVersion", () => {
  it("is 1 for a note that has never been edited", () => {
    expect(latestRecordVersion(root, "single")).toBe(1);
  });

  // The bug this suite exists for: the index pinned every note to v1, so an
  // edited Note's served page was compared against its superseded record and
  // reported as drift for as long as the edit stood (start-here, 2026-08-04).
  it("advances to the newest record once a note is edited", () => {
    expect(latestRecordVersion(root, "edited")).toBe(2);
  });

  it("orders numerically past v9", () => {
    expect(latestRecordVersion(root, "long-lived")).toBe(10);
  });

  it("is 0 when a note has no records at all", () => {
    expect(latestRecordVersion(root, "empty")).toBe(0);
    expect(latestRecordVersion(root, "absent")).toBe(0);
  });
});

// Both ledgers append and never rewrite, so a gap means a record was removed.
// Stated once because two verifiers now depend on it.
describe("contiguousFromV1", () => {
  it("accepts a single record", () => {
    expect(contiguousFromV1([1])).toBe(true);
  });

  it("accepts an unbroken run of any length", () => {
    expect(contiguousFromV1([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toBe(true);
  });

  it("rejects a run that does not start at v1", () => {
    expect(contiguousFromV1([2, 3])).toBe(false);
  });

  it("rejects a gap in the middle", () => {
    expect(contiguousFromV1([1, 2, 4])).toBe(false);
  });

  it("rejects an empty ledger directory", () => {
    expect(contiguousFromV1([])).toBe(false);
  });
});

// `parent` is inside the signed payload, so a tampered link fails the hash and
// signature checks before the chain rule is ever consulted. The rule only fires
// on a validly signed record naming the wrong predecessor — unconstructible
// without the signing key. These cases are what keep it falsifiable.
describe("expectedParent", () => {
  const LEAF = "7e84f5668fb1179dad3bb697143064bc099919134d93d7e18afc05ed40059951";
  const V1_HASH = "ede6aea2d9c9bca42adde016c2069565a1d9e26e90a1a44bd9ead5d89b7b134c";

  it("binds v1 of a genesis-anchored note to its genesis leaf", () => {
    expect(expectedParent({ version: 1, genesisLeaf: LEAF })).toBe(LEAF);
  });

  it("gives v1 of a note anchored on its own no predecessor", () => {
    expect(expectedParent({ version: 1, genesisLeaf: null })).toBeNull();
  });

  it("binds an edit to the content_hash of the record it supersedes", () => {
    expect(expectedParent({ version: 2, genesisLeaf: LEAF, previousContentHash: V1_HASH })).toBe(V1_HASH);
  });

  // The genesis leaf anchors the note's FIRST state only. If a later record
  // kept pointing at it, an edit could be swapped for any other edit of the
  // same note and the chain would still read as intact.
  it("never lets a later record fall back to the genesis leaf", () => {
    expect(expectedParent({ version: 3, genesisLeaf: LEAF, previousContentHash: V1_HASH })).not.toBe(LEAF);
  });
});
