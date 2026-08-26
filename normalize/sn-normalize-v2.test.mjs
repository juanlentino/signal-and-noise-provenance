// Parity suite for sn-normalize-v2: the JS reference impl MUST match the
// PHP authoritative sn_prov_normalize_v2() byte-for-byte. Same harness
// shape as parity.test.mjs (JS expected value + a live-PHP oracle shelling
// the REAL plugin implementation when the checkout is present).
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeV1 } from "./sn-normalize-v1.mjs";
import { normalizeV2, expandBlockText } from "./sn-normalize-v2.mjs";

const PLUGIN_CORE_PATH = fileURLToPath(new URL("../../signal-and-noise-tools/inc/provenance-core.php", import.meta.url));

const PHP_ORACLE_SOURCE = String.raw`
if (!defined('ABSPATH')) { define('ABSPATH', '/'); }
if (!function_exists('add_action')) { function add_action() { return true; } }
if (!function_exists('add_filter')) { function add_filter() { return true; } }
if (!function_exists('apply_filters')) { function apply_filters($t, $v) { return $v; } }
if (!function_exists('wp_json_encode')) { function wp_json_encode($d, $f = 0, $depth = 512) { return json_encode($d, $f, $depth); } }
if (!function_exists('wp_strip_all_tags')) {
  function wp_strip_all_tags($s, $rb = false) {
    $s = preg_replace('@<(script|style)[^>]*?>.*?</\\1>@si', '', (string) $s);
    return trim(strip_tags($s));
  }
}
require ${JSON.stringify(PLUGIN_CORE_PATH)};
if (!function_exists('sn_prov_normalize_v2')) { fwrite(STDERR, 'NO_V2'); exit(3); }
echo sn_prov_normalize_v2($argv[1]);
`;

function phpV2Available() {
  if (!existsSync(PLUGIN_CORE_PATH)) return false;
  try {
    execFileSync("php", ["-r", PHP_ORACLE_SOURCE, "probe"], { encoding: "utf8" });
    return true;
  } catch {
    return false; // checkout predates v2 (exit 3) or php missing
  }
}
const oracleV2 = phpV2Available();

function phpNormalizeV2(html) {
  return execFileSync("php", ["-r", PHP_ORACLE_SOURCE, html], { encoding: "utf8" });
}

function expectParityV2(label, input, expected) {
  it(`${label}: JS matches expected value`, () => {
    expect(normalizeV2(input)).toBe(expected);
  });
  it.skipIf(!oracleV2)(`${label}: JS matches live PHP sn_prov_normalize_v2`, () => {
    const phpOutput = phpNormalizeV2(input);
    expect(phpOutput).toBe(expected);
    expect(normalizeV2(input)).toBe(phpOutput);
  });
}

describe("normalizeV2 — dynamic-block attribute text becomes signed prose", () => {
  expectParityV2(
    "sidenote content signs at the block's position",
    '<!-- wp:paragraph -->\n<p>Before the note.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:signal-noise/sidenote {"content":"Tufte set his notes in the margin."} /-->\n\n<!-- wp:paragraph -->\n<p>After the note.</p>\n<!-- /wp:paragraph -->',
    "Before the note.\n\nTufte set his notes in the margin.\n\nAfter the note."
  );
  expectParityV2(
    "pull-quote: body then attribution, JSON order, each a paragraph",
    '<!-- wp:signal-noise/pull-quote {"body":"The pen is not the notary.","attribution":"Notes, 2026"} /-->',
    "The pen is not the notary.\n\nNotes, 2026"
  );
  expectParityV2(
    "empty attribute skipped (render slot omission mirrored)",
    '<!-- wp:signal-noise/pull-quote {"body":"The pen is not the notary.","attribution":""} /-->',
    "The pen is not the notary."
  );
  expectParityV2(
    "attr-embedded inline markup stripped + entities decoded once",
    '<!-- wp:signal-noise/sidenote {"content":"<em>Emphasis</em> &amp; more."} /-->',
    "Emphasis & more."
  );
  expectParityV2(
    "a } inside a string value never truncates (trailing /--> anchors the extent)",
    '<!-- wp:signal-noise/sidenote {"content":"a } b stays whole."} /-->',
    "a } b stays whole."
  );
  expectParityV2("malformed attrs JSON expands to nothing", '<!-- wp:signal-noise/sidenote {"content":broken} /-->', "");
  expectParityV2(
    "non-string top-level values skipped; strings sign",
    '<!-- wp:signal-noise/future-block {"count":3,"flag":true,"text":"Only the words."} /-->',
    "Only the words."
  );
});

describe("normalizeV2 == normalizeV1 wherever no signal-noise attr block exists (nothing re-signs)", () => {
  for (const [label, input] of [
    ["plain prose", "<!-- wp:paragraph -->\n<p>Plain prose only.</p>\n<!-- /wp:paragraph -->"],
    ["core void block with a string attr (spacer height is a setting, not prose)", '<!-- wp:spacer {"height":"20px"} /-->\n\n<!-- wp:paragraph --><p>Text.</p><!-- /wp:paragraph -->'],
    ["attribute-less signal-noise void block (pillar-essays, page 1490's real usage)", "<!-- wp:signal-noise/pillar-essays /-->"],
    ["empty content", ""],
  ]) {
    it(`${label}: v2 output is byte-identical to v1`, () => {
      expect(normalizeV2(input)).toBe(normalizeV1(input));
    });
  }
});

describe("expandBlockText mechanics", () => {
  it("leaves non-void signal-noise blocks alone (step 1 removes their delimiters as before)", () => {
    const input = "<!-- wp:signal-noise/something -->\n<p>Inner.</p>\n<!-- /wp:signal-noise/something -->";
    expect(expandBlockText(input)).toBe(input);
  });
  it("is a no-op on content with no signal-noise void delimiters (identity, byte-for-byte)", () => {
    const input = "<!-- wp:paragraph --><p>Untouched — literally.</p><!-- /wp:paragraph -->";
    expect(expandBlockText(input)).toBe(input);
  });
});

describe("live-PHP v2 oracle availability", () => {
  it("reports whether the plugin checkout with sn_prov_normalize_v2 was found", () => {
    console.log(oracleV2 ? "v2 oracle: LIVE (plugin checkout found, v2 present)" : "v2 oracle: SKIPPED (no checkout or pre-v2)");
    expect(typeof oracleV2).toBe("boolean");
  });
});
