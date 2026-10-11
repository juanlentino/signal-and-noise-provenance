import { readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The attested release tarball is a hand-written list in release-attest.yml.
// A verifier that gains a local import keeps working in the repo and breaks
// in the tarball (verify-key-history.mjs did, on #41). Walk every listed
// script's relative imports and require each one to be in the list.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(join(root, ".github/workflows/release-attest.yml"), "utf8");
const tar = workflow.slice(workflow.indexOf("tar -czf"), workflow.indexOf("- name:", workflow.indexOf("tar -czf")));
const listed = tar.split(/\s+/).filter((t) => t && !t.startsWith("-") && !t.includes("$") && !["tar", "\\"].includes(t) && !t.startsWith('"'));
const covered = (file) => listed.some((entry) => file === entry || file.startsWith(`${entry}/`));
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

function imports(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = readFileSync(join(root, file), "utf8");
  for (const [, spec] of src.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g).map((m) => [m[0], m[1] ?? m[2]])) {
    const target = normalize(relative(root, join(root, dirname(file), spec)));
    if (isFile(join(root, target))) imports(target, seen);
  }
  return seen;
}

describe("the release tarball", () => {
  it("carries every local module its verifiers import", () => {
    const scripts = listed.filter((f) => f.endsWith(".mjs") && isFile(join(root, f)));
    expect(scripts.length).toBeGreaterThan(5);
    const missing = [...new Set(scripts.flatMap((s) => [...imports(s)]))].filter((f) => !covered(f));
    expect(missing).toEqual([]);
  });
  it("carries every script package.json and VERIFY.md tell a reader to run", () => {
    // The import walk starts from listed scripts, so it cannot see an entry
    // point that was never listed (verify-rights-evidence.mjs and
    // verify-retractions.mjs, 2026-10-11). The author's signing tool and the
    // maintainer's index rebuild are not verifiers.
    const notVerifiers = ["countersign.mjs", "scripts/build-index.mjs"];
    const scripts = Object.values(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {});
    const docs = readFileSync(join(root, "VERIFY.md"), "utf8");
    const named = [...scripts.join("\n").matchAll(/\bnode\s+([\w./-]+\.mjs)/g), ...docs.matchAll(/\bnode\s+([\w./-]+\.mjs)/g)].map((m) => normalize(m[1]));
    const missing = [...new Set(named)].filter((f) => !notVerifiers.includes(f) && isFile(join(root, f)) && !covered(f));
    expect(named.length).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });
});
