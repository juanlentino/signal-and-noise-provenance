#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPageRecord } from "./verify.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
// Whitespace fallback source (2026-07-28): the plugin's REST hardening
// (signal-and-noise-tools PR #373) deliberately empties content.rendered for
// anonymous callers, killing the old public-REST fallback site-wide. The
// sanctioned machine-readable copy is the Note's .json twin, whose
// content_html carries the same rendered markup with source whitespace.
async function twinRendered(slug) {
  const response = await fetch(`https://juanlentino.com/notes/${slug}.json`);
  if (!response.ok) return null;
  const doc = await response.json();
  return typeof doc.content_html === "string" ? doc.content_html : null;
}
let checked = 0;
let restFallbacks = 0;
for (const entry of index.entries) {
  if (entry.version < 1) throw new Error(`no standalone record for ${entry.slug}`);
  const record = JSON.parse(readFileSync(join(root, `notes/${entry.note_uid}/v${entry.version}.json`), "utf8"));
  const response = await fetch(`https://juanlentino.com/notes/${entry.slug}/`);
  if (!response.ok) throw new Error(`page fetch failed for ${entry.slug}`);
  const pageHtml = await response.text();
  let result = await verifyPageRecord({ record, pageHtml });
  if (!result.ok) {
    const restRendered = await twinRendered(entry.slug);
    if (typeof restRendered !== "string") throw new Error(`twin content_html missing for ${entry.slug}`);
    result = await verifyPageRecord({ record, pageHtml, restRendered });
  }
  if (!result.ok) throw new Error(`served-page drift for ${entry.slug} (content=${result.contentOk}, hash=${result.hashOk}, pageText=${result.pageTextOk})`);
  if (result.source === "public-rest+served-page") restFallbacks += 1;
  checked += 1;
}
console.log(`${checked}/${checked} served pages reproduce their standalone records (${restFallbacks} twin whitespace fallback(s))`);
