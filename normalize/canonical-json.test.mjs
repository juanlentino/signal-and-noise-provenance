// Parity test: canonicalize() MUST byte-match PHP's sn_prov_canonical_json()
// (inc/provenance-core.php) — recursively sorted object keys, compact,
// unescaped slashes + unicode. Vectors 1-2 are ported verbatim from the
// plugin repo's tests/provenance-normalize.php "Canonical JSON" section.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./canonical-json.mjs";

describe("canonicalize", () => {
  it("vector 1: sorted keys, unescaped slash + unicode, compact", () => {
    const out = canonicalize({ title: "a/b é", algo: "sn-normalize-v1", author: "Juan" });
    expect(out).toBe('{"algo":"sn-normalize-v1","author":"Juan","title":"a/b é"}');
  });

  it("vector 2: recursive key sort; list order preserved", () => {
    const out = canonicalize({ outer: { b: [3, 2, 1], a: 1 } });
    expect(out).toBe('{"outer":{"a":1,"b":[3,2,1]}}');
  });

  it("vector 3: null/bool/float pass through untouched, keys still sort", () => {
    const out = canonicalize({ z: null, a: true, b: false, n: 1.5, arr: [] });
    expect(out).toBe('{"a":true,"arr":[],"b":false,"n":1.5,"z":null}');
  });
});

// --- Live-PHP oracle ---------------------------------------------------
// Same rationale/setup as normalize/parity.test.mjs: shells the actual
// plugin implementation rather than a re-derived guess, so a JS-side pure
// verifier can be trusted to fully self-serve (see VERIFY.md). Requires a
// local PHP 8+ and a checkout of the plugin repo at PLUGIN_CORE_PATH.
const PLUGIN_CORE_PATH = fileURLToPath(new URL("../../signal-and-noise-tools/inc/provenance-core.php", import.meta.url));

const phpOracleAvailable = existsSync(PLUGIN_CORE_PATH);

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
$data = json_decode($argv[1], true);
echo sn_prov_canonical_json($data);
`;

function phpCanonicalize(payload) {
  return execFileSync("php", ["-r", PHP_ORACLE_SOURCE, JSON.stringify(payload)], { encoding: "utf8" });
}

const samplePayloads = [
  { algo: "sn-normalize-v1", author: "Juan", content: "a/b é — “quoted”", note_uid: "abc-123", parent: null, published_at: "2026-07-09T00:00:00Z", title: "a/b é", version: 2 },
  { outer: { b: [3, 2, 1], a: 1 }, z: null, list: [{ y: 2, x: 1 }, { b: 2, a: 1 }] },
  { kind: "genesis", root: "ab".repeat(32), date: "2026-07-09", count: 1, notes: [{ note_uid: "abc", leaf_hash: "cd".repeat(32) }] },
];

describe("canonicalize byte-matches live PHP sn_prov_canonical_json", () => {
  for (const [i, payload] of samplePayloads.entries()) {
    it.skipIf(!phpOracleAvailable)(`sample payload ${i + 1}`, () => {
      const phpOutput = phpCanonicalize(payload);
      const jsOutput = canonicalize(payload);
      expect(jsOutput).toBe(phpOutput);
    });
  }

  it("reports whether the plugin checkout was found for the cross-checks above", () => {
    if (!phpOracleAvailable) {
      console.warn(
        `[canonical-json.test.mjs] PLUGIN_CORE_PATH not found (${PLUGIN_CORE_PATH}); live-PHP cross-checks were skipped.`
      );
    }
    expect(true).toBe(true);
  });
});
