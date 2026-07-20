#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPageRecord } from "./verify.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
let checked = 0;
for (const entry of index.entries) {
  if (entry.version < 1) throw new Error(`no standalone record for ${entry.slug}`);
  const record = JSON.parse(readFileSync(join(root, `notes/${entry.note_uid}/v${entry.version}.json`), "utf8"));
  const response = await fetch(`https://juanlentino.com/notes/${entry.slug}/`);
  if (!response.ok) throw new Error(`page fetch failed for ${entry.slug}`);
  const result = await verifyPageRecord({ record, pageHtml: await response.text() });
  if (!result.ok) throw new Error(`served-page drift for ${entry.slug} (content=${result.contentOk}, hash=${result.hashOk})`);
  checked += 1;
}
console.log(`${checked}/${checked} served pages reproduce their standalone records`);
