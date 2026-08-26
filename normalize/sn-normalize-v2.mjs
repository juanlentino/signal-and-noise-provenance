// Reference implementation of sn-normalize-v2. Authoritative for verifiers.
// MUST produce byte-identical output to inc/provenance-core.php
// sn_prov_normalize_v2() in the plugin repo.
//
// v2 = expandBlockText (step 0) + the UNCHANGED v1 pipeline:
//
//   0. expand signal-noise/* VOID block delimiters: every TOP-LEVEL
//      string-typed attribute value in the delimiter's own serialized JSON,
//      in the JSON's order, empty strings skipped, joined as paragraphs
//      ("\n\n") in place of the delimiter. Self-describing from the
//      post_content bytes alone — no registry, no block.json, no WordPress.
//   1..7. sn-normalize-v1 (normalize/sn-normalize-v1.mjs), byte-for-byte.
//
// WHY: signal-noise/sidenote and signal-noise/pull-quote are dynamic blocks
// whose text lives entirely in attributes; v1's step 1 removed it with the
// delimiter, so their words were outside the signed record AND broke
// byte-equality page verification (render.php emits that text into the
// served page). v2 signs exactly the text the page shows.
//
// Boundaries (deliberate, mirrored in the PHP docblock): core/* void blocks
// are NOT expanded (string attrs there are settings, not prose); non-void
// signal-noise blocks are NOT expanded; nested values are not walked;
// malformed attrs JSON expands to nothing (v1's removal, unchanged). Real
// serialized attrs \u-escape `--`, `<`, `>`, `&`, `"` (core's
// serialize_block_attributes), so the non-greedy JSON grab cannot be
// truncated by a literal `-->`, and the trailing `/-->` anchor forces the
// correct extent past any `}` inside string values.
import { normalizeV1 } from "./sn-normalize-v1.mjs";

const VOID_SN_BLOCK_RE = /<!--\s+wp:signal-noise\/[a-z][a-z0-9-]*(\s+(\{[\s\S]*?\}))?\s+\/-->/g;

export function expandBlockText(content) {
  return String(content).replace(VOID_SN_BLOCK_RE, (match, g1, g2) => {
    if (!g2) return "";
    let attrs;
    try {
      attrs = JSON.parse(g2);
    } catch {
      return "";
    }
    if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return "";
    const parts = [];
    for (const key of Object.keys(attrs)) {
      const value = attrs[key];
      if (typeof value === "string" && value !== "") parts.push(value);
    }
    return parts.join("\n\n");
  });
}

export function normalizeV2(html) {
  return normalizeV1(expandBlockText(html));
}
