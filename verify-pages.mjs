#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPageRecord } from "./verify.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
const restResponse = await fetch("https://juanlentino.com/wp-json/wp/v2/posts?per_page=100&_fields=slug,content");
if (!restResponse.ok) throw new Error(`public REST collection fetch failed: HTTP ${restResponse.status}`);
const restBySlug = new Map((await restResponse.json()).map((post) => [post.slug, post.content?.rendered]));
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
    const restRendered = restBySlug.get(entry.slug);
    if (typeof restRendered !== "string") throw new Error(`public REST rendering missing for ${entry.slug}`);
    result = await verifyPageRecord({ record, pageHtml, restRendered });
  }
  if (!result.ok) throw new Error(`served-page drift for ${entry.slug} (content=${result.contentOk}, hash=${result.hashOk}, pageText=${result.pageTextOk})`);
  if (result.source === "public-rest+served-page") restFallbacks += 1;
  checked += 1;
}
console.log(`${checked}/${checked} served pages reproduce their standalone records (${restFallbacks} public-REST whitespace fallback(s))`);
