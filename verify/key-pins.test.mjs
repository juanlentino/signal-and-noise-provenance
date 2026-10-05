// The key-mirror comparison had NO test, which is how a schema bump shipped
// past it: the plugin moved the served document to sn-provenance-keys-v2 on
// 2026-07 (key history with validity windows), this repo kept asserting v1, and
// nothing noticed until the mirror went live and every push run went red with
// the key material itself byte-identical.
//
// The lesson the assertions below encode: acknowledging a schema version is not
// covering it. v2's whole contribution is the validity window, so a verifier
// that only updates the version string trades a loud failure for a blind spot.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { authorPinDivergences, keyPinDivergences, pinTxt, KEY_MIRROR_SCHEMA } from "../key-pins.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const history = JSON.parse(readFileSync(join(root, "keys/key-history.json"), "utf8"));
const current = history.keys.find((key) => key.id === history.current);

/** The document the live mirror serves today, as fetched 2026-08-11. */
const served = () => ({
  schema: KEY_MIRROR_SCHEMA,
  domain: "juanlentino.com",
  keys: [{
    id: current.id,
    algorithm: current.algorithm,
    public_key_base64: current.public_key_base64,
    sha256_fingerprint: current.sha256_fingerprint,
    status: "active",
    introduced_at: current.introduced_at,
    valid_from: current.introduced_at,
    valid_until: null,
  }],
});

describe("keyPinDivergences", () => {
  it("accepts the document the mirror actually serves", () => {
    expect(keyPinDivergences(served(), current)).toEqual([]);
  });

  it("pins the v2 schema — a v1 document is a divergence, not a tolerated elder", () => {
    const doc = served();
    doc.schema = "sn-provenance-keys-v1";
    expect(keyPinDivergences(doc, current).map(([field]) => field)).toContain("schema");
  });

  it("reports the current key as ABSENT rather than silently passing an empty mirror", () => {
    const doc = served();
    doc.keys = [];
    const fields = keyPinDivergences(doc, current).map(([field]) => field);
    expect(fields).toContain(`keys[id=${current.id}]`);
  });

  it("catches substituted key material", () => {
    const doc = served();
    doc.keys[0].public_key_base64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    expect(keyPinDivergences(doc, current).map(([field]) => field)).toContain("public_key_base64");
  });

  // The two assertions v2 exists for. Without these the version string is
  // updated and the window it introduced is unverified.
  it("requires valid_from to agree with the key history's introduced_at", () => {
    const doc = served();
    doc.keys[0].valid_from = "2020-01-01";
    expect(keyPinDivergences(doc, current).map(([field]) => field)).toContain("valid_from");
  });

  it("rejects a closed window on the key we are still signing with", () => {
    const doc = served();
    doc.keys[0].valid_until = "2026-08-01";
    expect(keyPinDivergences(doc, current).map(([field]) => field)).toContain("valid_until");
  });

  it("treats an ABSENT valid_until as a divergence, not as null", () => {
    const doc = served();
    delete doc.keys[0].valid_until;
    expect(keyPinDivergences(doc, current).map(([field]) => field)).toContain("valid_until");
  });

  it("survives a null document without throwing", () => {
    expect(keyPinDivergences(null, current).length).toBeGreaterThan(0);
  });
});

// keys/provenance-keys.json is a committed COPY of what the mirror serves, and
// until now nothing read it: no script imports it, only prose points at the
// live URL. So it sat at schema v1 long after the mirror moved to v2 — a stale
// claim inside the trust repo, which is the one place a stale claim costs most.
// An artifact with no reader has no guard; this is its reader.
describe("the committed mirror snapshot", () => {
  const snapshot = JSON.parse(readFileSync(join(root, "keys/provenance-keys.json"), "utf8"));

  it("would pass the same comparison the live mirror is held to", () => {
    expect(keyPinDivergences(snapshot, current)).toEqual([]);
  });
});

describe("an author key in the mirror", () => {
  const author = { id: "sn-author-ed25519-2026-10", algorithm: "Ed25519", role: "author", public_key_base64: "AAAA", sha256_fingerprint: "ff", status: "active", introduced_at: "2026-10-05" };
  const withAuthor = (over = {}) => ({ ...served(), keys: [...served().keys, { id: author.id, algorithm: "Ed25519", role: "author", public_key_base64: "AAAA", sha256_fingerprint: "ff", status: "active", introduced_at: "2026-10-05", valid_from: "2026-10-05", valid_until: null, ...over }] });
  it("passes when mirrored with its role", () => {
    expect(keyPinDivergences(withAuthor(), author)).toEqual([]);
  });
  it("fails when the mirror drops the role or the key", () => {
    expect(keyPinDivergences(withAuthor({ role: undefined }), author).map(([f]) => f)).toEqual(["role"]);
    expect(keyPinDivergences(served(), author).map(([f]) => f)).toEqual([`keys[id=${author.id}]`]);
  });
  it("holds when the pins and the history agree, in either state", () => {
    expect(authorPinDivergences(withAuthor(), [pinTxt(author)], [author])).toEqual([]);
    expect(authorPinDivergences(served(), [], [])).toEqual([]);
  });
  it("fails when the history drops a key the pins still advertise", () => {
    expect(authorPinDivergences(withAuthor(), [pinTxt(author)], [])).toEqual([
      `the mirror carries author key ${author.id}, which the key history does not hold`,
      `DNS pins an author key the key history does not hold: ${pinTxt(author)}`,
    ]);
    expect(authorPinDivergences(served(), [pinTxt(author)], [])).toHaveLength(1);
  });
  it("fails when a pin is missing for a key the history holds", () => {
    expect(authorPinDivergences(withAuthor(), [], [author])).toEqual([`DNS author-key pin missing for ${author.id}`]);
    expect(authorPinDivergences(served(), [pinTxt(author)], [author])[0]).toMatch(/the mirror's .* keys\[id=/);
  });
});
