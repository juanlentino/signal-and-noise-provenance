#!/usr/bin/env node
/**
 * Maintenance-only builder for the committed offline genesis derivations.
 * It reads only public WordPress artifacts and refuses to write unless every
 * reconstructed leaf matches the already anchored 2026-07-09 manifest.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "../normalize/canonical-json.mjs";
import { leafHash } from "../normalize/merkle-v1.mjs";
import { normalizeV1 } from "../normalize/sn-normalize-v1.mjs";

const here = join(dirname(fileURLToPath(import.meta.url)), "..");
const genesis = JSON.parse(readFileSync(join(here, "genesis/2026-07-09-root.json"), "utf8"));
const response = await fetch("https://juanlentino.com/wp-json/wp/v2/posts?per_page=100&_fields=date,slug,link,title,content");
if (!response.ok) throw new Error(`WordPress REST failed: HTTP ${response.status}`);
const posts = await response.json();
const byUid = new Map();

for (const post of posts) {
  const pageResponse = await fetch(post.link);
  if (!pageResponse.ok) throw new Error(`page fetch failed for ${post.slug}: HTTP ${pageResponse.status}`);
  const pageHtml = await pageResponse.text();
  const uid = pageHtml.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/)?.[0];
  const published = pageHtml.match(/<meta\s+property="article:published_time"\s+content="([^"]+)"/i)?.[1];
  if (!uid || !published) throw new Error(`public provenance metadata missing for ${post.slug}`);
  byUid.set(uid, { post, pageHtml, published: new Date(published).toISOString().replace(".000Z", "Z") });
}

const derivations = genesis.payload.notes.map((expected) => {
  const source = byUid.get(expected.note_uid);
  if (!source) throw new Error(`no public note for ${expected.note_uid}`);
  const payload = {
    algo: "sn-normalize-v1",
    author: "Juan Lentino",
    // The public REST representation preserves the source block whitespace
    // that an HTML optimizer may collapse inside inline SVG diagrams.
    content: normalizeV1(source.post.content.rendered.replace(/<\/(p|h[1-6]|blockquote|li|ul|ol|figure)>/gi, "</$1>\n\n")),
    note_uid: expected.note_uid,
    parent: null,
    published_at: source.published,
    title: source.post.title.rendered,
    version: 0,
  };
  const actual = leafHash(canonicalize(payload));
  if (actual !== expected.leaf_hash) throw new Error(`refusing to write: leaf mismatch for ${expected.note_uid}`);
  return { note_uid: expected.note_uid, slug: source.post.slug, leaf_hash: actual, payload };
});

writeFileSync(join(here, "genesis/2026-07-09-leaves.json"), `${JSON.stringify(derivations, null, 2)}\n`);
console.log(`wrote ${derivations.length} exact public derivations`);
