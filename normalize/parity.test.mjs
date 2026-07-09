// Parity test: the JS reference sn-normalize-v1 MUST match the PHP
// authoritative implementation byte-for-byte. Vectors ported verbatim from
// the plugin repo's tests/provenance-normalize.php (sn_prov_normalize_v1
// suite) — see inc/provenance-core.php for the PHP source this mirrors.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { normalizeV1 } from "./sn-normalize-v1.mjs";

describe("normalizeV1 parity with PHP sn_prov_normalize_v1", () => {
  it("vector 1: strips wp comments + tags; NBSP -> space", () => {
    const input = "<!-- wp:paragraph -->\n<p>Hello&nbsp;world.</p>\n<!-- /wp:paragraph -->";
    expect(normalizeV1(input)).toBe("Hello world.");
  });

  it("vector 2: entity decoded exactly once (no double decode)", () => {
    expect(normalizeV1("<p>A &amp; B</p>")).toBe("A & B");
    expect(normalizeV1("<p>&amp;amp; stays after one decode</p>")).toBe("&amp; stays after one decode");
  });

  it("vector 3: whitespace collapse + CRLF->LF + paragraph join", () => {
    const input = "<p>Line   one  </p>\r\n<p>  Line\ttwo</p>";
    expect(normalizeV1(input)).toBe("Line one\nLine two");
  });

  it("vector 4: blank-line collapse + trim", () => {
    const input = "\n\n<p>A</p>\n\n\n\n<p>B</p>\n\n";
    expect(normalizeV1(input)).toBe("A\n\nB");
  });

  it("vector 5: structural-only content -> empty", () => {
    const input = "<!-- wp:spacer --><div></div><!-- /wp:spacer -->";
    expect(normalizeV1(input)).toBe("");
  });

  it("vector 6: NFC composes é (combining acute -> precomposed)", () => {
    const decomposed = "é"; // e + combining acute
    const composed = "é"; // é (U+00E9, precomposed)
    expect(normalizeV1("<p>" + decomposed + "</p>")).toBe(composed);
  });
});

// --- Live-PHP oracle ---------------------------------------------------
// Shells the ACTUAL plugin implementation — not a re-derived guess — using
// the exact same wp_strip_all_tags() stub the plugin's own PHP suite
// (tests/provenance-normalize.php) uses, so every adversarial vector below
// is proven against the real sn_prov_normalize_v1(), not just this file's
// port of it. Requires a local PHP 8+ with ext-intl and a checkout of the
// plugin repo at PLUGIN_CORE_PATH — this mirrors the single-machine,
// offline dev setup this suite was authored against (see the task's
// "Reference (authoritative PHP)" note) and is intentionally NOT expected
// to run in a stripped-down CI image without that checkout.
const PLUGIN_CORE_PATH =
  "/Users/juanlentino/Projects/signal-and-noise-tools/.claude/worktrees/notes-provenance-commits-86c7c0/inc/provenance-core.php";

const phpOracleAvailable = existsSync(PLUGIN_CORE_PATH);

// Same WP-function stubs as tests/provenance-normalize.php in the plugin
// repo (wp_strip_all_tags in particular must match byte-for-byte, since it
// determines script/style-content stripping).
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
echo sn_prov_normalize_v1($argv[1]);
`;

function phpNormalize(html) {
  return execFileSync("php", ["-r", PHP_ORACLE_SOURCE, html], { encoding: "utf8" });
}

// Cross-checks a vector against BOTH the JS port's expected value AND a live
// shell-out to the real PHP implementation, so parity is proven, not
// assumed. Skips the live-PHP half (leaving the JS-only assertion in place)
// when the plugin checkout isn't present on this machine.
function expectParity(label, input, expected) {
  it(`${label}: JS matches expected value`, () => {
    expect(normalizeV1(input)).toBe(expected);
  });

  it.skipIf(!phpOracleAvailable)(`${label}: JS matches live PHP sn_prov_normalize_v1`, () => {
    const phpOutput = phpNormalize(input);
    expect(phpOutput).toBe(expected);
    expect(normalizeV1(input)).toBe(phpOutput);
  });
}

describe("adversarial entity-decode parity (verified against live PHP)", () => {
  expectParity("named: eacute", "<p>&eacute;</p>", "é");
  expectParity("named: mdash", "<p>&mdash;</p>", "—");
  expectParity("named: rarr", "<p>&rarr;</p>", "→");
  expectParity("named: euro", "<p>&euro;</p>", "€");
  expectParity("numeric decimal: rsquo (&#8217;)", "<p>&#8217;</p>", "’");

  // NOTE ON THESE THREE: the task brief that seeded this suite assumed PHP's
  // ENT_HTML5 numeric-reference decoding follows the WHATWG spec algorithm
  // verbatim — i.e. that "&#128;" decodes via the Windows-1252 C1 override
  // to U+20AC (€), and that surrogate/out-of-range references decode to
  // U+FFFD. Empirically (verified live against PHP 8.5.7 — see the
  // "*.php-verified" it.skipIf block below, and try it yourself:
  // `php -r 'echo html_entity_decode("&#128;", ENT_QUOTES|ENT_HTML5, "UTF-8");'`)
  // that assumption is WRONG for this PHP build: PHP does not apply the
  // Windows-1252 override at all, and does not substitute U+FFFD for
  // surrogates or out-of-range code points. Instead, for the full disallowed
  // set (control chars 0x00-0x08/0x0B/0x0D-0x1F/0x7F-0x9F, surrogates
  // 0xD800-0xDFFF, Unicode noncharacters, and anything > 0x10FFFF), PHP
  // leaves the ENTIRE "&#...;" reference completely unparsed in the output.
  // sn-normalize-v1.mjs's decodeEntities() mirrors that verified behavior
  // (see isDisallowedCodePoint's doc comment there) rather than the
  // spec-assumed one, because matching real PHP — not the spec — is the
  // actual trust basis for this verifier.
  expectParity("numeric C1 (&#128;) — PHP does NOT apply Windows-1252 override, leaves it literal", "<p>&#128;</p>", "&#128;");
  expectParity("numeric surrogate (&#xD800;) — PHP leaves it literal, does NOT emit U+FFFD", "<p>&#xD800;</p>", "&#xD800;");
  expectParity("numeric out-of-range (&#1114112;) — PHP leaves it literal, does NOT emit U+FFFD", "<p>&#1114112;</p>", "&#1114112;");

  expectParity("script tag: contents stripped, not just the tags", "<script>alert(1)</script>x", "x");
});

describe("live-PHP oracle availability", () => {
  it("reports whether the plugin checkout was found for the cross-checks above", () => {
    // Not a hard failure either way — this just makes the skip reason
    // visible in test output instead of a silent skip.
    if (!phpOracleAvailable) {
      console.warn(
        `[parity.test.mjs] PLUGIN_CORE_PATH not found (${PLUGIN_CORE_PATH}); live-PHP cross-checks were skipped, only JS-side expected-value assertions ran.`
      );
    }
    expect(true).toBe(true);
  });
});
