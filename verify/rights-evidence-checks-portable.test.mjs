import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evidenceDivergences, evidenceUuid } from "../rights-evidence-checks.mjs";

// The provenance worker runs evidenceDivergences() before it signs a
// rights-evidence record, on Cloudflare Workers without nodejs_compat. So the
// module may import nothing and may lean on no Node global: only what Workers
// and browsers share (crypto.subtle, URL, TextEncoder).
const source = readFileSync(new URL("../rights-evidence-checks.mjs", import.meta.url), "utf8");

describe("rights-evidence-checks.mjs runs outside Node", () => {
  it("imports nothing and names no Node global", () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
    expect(source).not.toMatch(/\b(Buffer|process|__dirname|__filename)\b/);
  });

  it("derives ids and checks a record with Buffer gone", async () => {
    const saved = globalThis.Buffer;
    globalThis.Buffer = undefined;
    try {
      expect(await evidenceUuid("https://juanlentino.com", "openai", "2026-08")).toBe("0f9d8fcc-d83b-5f41-ae47-2e4643f9f800");
      const payload = {
        kind: "rights-evidence", family: "openai", month: "2026-08", site: "https://juanlentino.com",
        reservation: { as_of: "2026-09-19T14:00:00+00:00", signals: [{ slug: "tdmrep-json", content_hash: "421f88383938eeaf8882474c747d1f3cfcd7e51c5d89711fd3df98fc0071ec80" }] },
        rights_reads: { reads: 3, by_path: {}, first: "", last: "", complete: true },
        crawling: { reads: 50, train: 41, by_day: {}, by_surface: {}, complete: true },
      };
      expect(await evidenceDivergences({ payload }, { uid: "0f9d8fcc-d83b-5f41-ae47-2e4643f9f800", version: 1, host: "juanlentino.com" })).toEqual([]);
    } finally {
      globalThis.Buffer = saved;
    }
  });
});
