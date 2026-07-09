// Reference implementation of sn-normalize-v1. Authoritative for verifiers.
// MUST produce byte-identical output to inc/provenance-core.php sn_prov_normalize_v1().
//
// Ordered pipeline (mirrors the PHP byte-for-byte — DO NOT reorder without
// bumping the algo version):
//   1. remove Gutenberg block-delimiter comments
//   2. strip all HTML tags (script/style element CONTENTS removed too, same
//      as WordPress's wp_strip_all_tags())
//   3. decode HTML entities exactly once
//   4. Unicode NFC
//   5. line endings -> LF, strip leading BOM
//   6. per line: collapse [space|tab|NBSP] runs to one space, trim
//   7. collapse 2+ blank lines to one; trim overall
import { HTML5_NAMED_ENTITIES } from "./html5-entities.js";

export function normalizeV1(html) {
  let s = String(html);
  s = s.replace(/<!--\s*\/?wp:[\s\S]*?-->/g, "");                  // 1 strip block comments
  s = s.replace(/<(script|style)[^>]*?>[\s\S]*?<\/\1>/gi, "");      // 2a strip script/style + contents
  s = s.replace(/<[^>]*>/g, "");                                    // 2b strip remaining tags
  s = decodeEntities(s);                                            // 3 decode once
  s = s.normalize("NFC");                                           // 4 NFC
  s = s.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");             // 5 BOM + LF
  s = s.split("\n").map((ln) => ln.replace(/[ \t\u00A0]+/g, " ").trim()).join("\n"); // 6
  s = s.replace(/\n{3,}/g, "\n\n");                                 // 7
  return s.trim();
}

// Matches a named ("&name;") or numeric ("&#123;" / "&#x7B;") HTML entity.
// PHP's html_entity_decode() (verified empirically against PHP 8.5.7 — see
// parity.test.mjs) requires the trailing ";" for EVERY entity, named or
// numeric. It does NOT implement the ~106 legacy semicolon-optional forms
// (e.g. a bare "&amp" or "&copy") that browsers accept per the WHATWG HTML5
// parsing algorithm — those are left completely untouched by PHP, so this
// regex intentionally requires ";" unconditionally rather than modeling the
// optional-semicolon exception list.
const ENTITY_RE = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

// Code points PHP's html_entity_decode() refuses to convert for a numeric
// reference — verified empirically (see parity.test.mjs) by sweeping PHP
// 8.5.7's actual output rather than assuming the WHATWG spec algorithm
// (which, unlike PHP, DOES convert these — e.g. real browsers decode
// "&#128;" to U+20AC via a Windows-1252 remap table). PHP instead leaves the
// ENTIRE "&#...;" reference in the output completely unparsed for:
//   - out-of-range / non-finite code points (< 0 or > 0x10FFFF)
//   - C0/C1 control code points other than TAB/LF/FF (0x00-0x08, 0x0B,
//     0x0D-0x1F, 0x7F-0x9F) — notably this means PHP does NOT apply the
//     Windows-1252 override table for 0x80-0x9F; it just leaves the
//     reference as literal text.
//   - UTF-16 surrogate code points (0xD800-0xDFFF)
//   - Unicode noncharacters (0xFDD0-0xFDEF, and any code point whose low
//     16 bits are 0xFFFE or 0xFFFF, in any plane — including 0x10FFFF)
function isDisallowedCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return true;
  if (code <= 0x08 || code === 0x0b || (code >= 0x0d && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) return true;
  if (code >= 0xd800 && code <= 0xdfff) return true;
  if (code >= 0xfdd0 && code <= 0xfdef) return true;
  if ((code & 0xfffe) === 0xfffe) return true;
  return false;
}

// Single-pass HTML entity decode (named + numeric decimal/hex). Scans the
// ORIGINAL string left-to-right via a single regex .replace() call and never
// re-scans replacement text, so a literal "&amp;amp;" decodes to "&amp;"
// (one decode), not "&" (which would be a double decode). This mirrors
// PHP's html_entity_decode(), which is also a single, non-recursive pass.
export function decodeEntities(s) {
  return s.replace(ENTITY_RE, (match, body) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (isDisallowedCodePoint(code)) return match; // PHP leaves these un-decoded — see isDisallowedCodePoint
      // `code` is a validated, finite integer in [0, 0x10FFFF] that is
      // neither a surrogate half nor a noncharacter, so fromCodePoint
      // cannot throw here — the try/catch is a defensive backstop only.
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return Object.prototype.hasOwnProperty.call(HTML5_NAMED_ENTITIES, match) ? HTML5_NAMED_ENTITIES[match] : match;
  });
}
