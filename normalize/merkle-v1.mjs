import { createHash } from "node:crypto";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest();
const asBuffer = (hex) => {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`invalid SHA-256 hex: ${hex}`);
  return Buffer.from(hex, "hex");
};

/** Historical genesis leaf: SHA-256(0x00 || sorted-canonical v0 payload). */
export function leafHash(data) {
  return sha256(Buffer.concat([Buffer.from([0]), Buffer.from(data)])).toString("hex");
}

/** Historical internal node: SHA-256(0x01 || left || right), lone nodes promoted. */
export function nodeHash(leftHex, rightHex) {
  return sha256(Buffer.concat([Buffer.from([1]), asBuffer(leftHex), asBuffer(rightHex)])).toString("hex");
}

export function rootFromLeafHashes(leafHashes) {
  if (leafHashes.length === 0) return sha256(Buffer.alloc(0)).toString("hex");
  let level = leafHashes.map((hex) => asBuffer(hex).toString("hex"));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0];
}

export function auditPath(leafHashes, index) {
  if (!Number.isInteger(index) || index < 0 || index >= leafHashes.length) throw new Error("leaf index out of range");
  let level = leafHashes.map((hex) => asBuffer(hex).toString("hex"));
  let cursor = index;
  const path = [];
  while (level.length > 1) {
    if (cursor % 2 === 1) path.push({ sibling_hash: level[cursor - 1], side: "left" });
    else if (cursor + 1 < level.length) path.push({ sibling_hash: level[cursor + 1], side: "right" });
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
    cursor = Math.floor(cursor / 2);
    level = next;
  }
  return path;
}

export function verifyAuditPath(leafHex, path, expectedRoot) {
  let hash = asBuffer(leafHex).toString("hex");
  for (const step of path) {
    hash = step.side === "left" ? nodeHash(step.sibling_hash, hash) : nodeHash(hash, step.sibling_hash);
  }
  return hash === expectedRoot;
}
