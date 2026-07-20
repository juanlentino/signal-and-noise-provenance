import { describe, expect, it } from "vitest";
import { auditPath, rootFromLeafHashes, verifyAuditPath } from "./merkle-v1.mjs";
import genesis from "../genesis/2026-07-09-root.json" with { type: "json" };

describe("genesis merkle-v1", () => {
  const leaves = genesis.payload.notes.map((note) => note.leaf_hash);
  it("reconstructs the published historical root", () => {
    expect(rootFromLeafHashes(leaves)).toBe(genesis.payload.root);
  });
  it("generates a valid audit path for every leaf", () => {
    leaves.forEach((leaf, index) => expect(verifyAuditPath(leaf, auditPath(leaves, index), genesis.payload.root)).toBe(true));
  });
});
