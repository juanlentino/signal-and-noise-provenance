#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
const entries = index.entries || [];
const uids = new Set(entries.map((entry) => entry.note_uid));
const slugs = new Set(entries.map((entry) => entry.slug));
if (uids.size !== entries.length || slugs.size !== entries.length) throw new Error("coverage index contains duplicate UID or slug");
for (const entry of entries) {
  if (!/^[0-9a-f-]{36}$/.test(entry.note_uid)) throw new Error(`invalid UID for ${entry.slug}`);
  if (!['genesis', 'per-note'].includes(entry.anchor)) throw new Error(`invalid anchor for ${entry.slug}`);
  if (entry.ots_status !== "confirmed" || !Number.isInteger(entry.bitcoin_block)) throw new Error(`anchor is not confirmed for ${entry.slug}`);
  if (entry.anchor === "genesis" && !/^[0-9a-f]{64}$/.test(entry.leaf_hash || "")) throw new Error(`genesis leaf missing for ${entry.slug}`);
  if (entry.version >= 1 && !/^[0-9a-f]{64}$/.test(entry.content_hash || "")) throw new Error(`standalone hash missing for ${entry.slug}`);
}

if (!process.argv.includes("--offline")) {
  const response = await fetch("https://juanlentino.com/wp-json/wp/v2/posts?per_page=100&_fields=slug");
  if (!response.ok) throw new Error(`WordPress REST failed: HTTP ${response.status}`);
  const live = await response.json();
  const gaps = live.map((post) => post.slug).filter((slug) => !slugs.has(slug));
  const stale = entries.map((entry) => entry.slug).filter((slug) => !live.some((post) => post.slug === slug));
  if (gaps.length || stale.length) throw new Error(`coverage drift: gaps=${gaps.join(",") || "none"}; stale=${stale.join(",") || "none"}`);
  console.log(`${live.length}/${live.length} anchored, 0 gaps`);
} else {
  console.log(`${entries.length}/${entries.length} indexed with confirmed anchors (offline)`);
}
