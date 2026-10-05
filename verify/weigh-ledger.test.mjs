import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ledgerEvents } from "../weigh/ledger-events.mjs";
import { loadPolicy } from "../weigh/policy.mjs";
import { explain, report, ZERO_WORDING } from "../weigh.mjs";

// The adapter runs on copies of this repository so a record can be broken
// without touching the real one. Nothing here pins a weight: the ledger grows
// hourly, and the properties hold for any state of it.

const repo = fileURLToPath(new URL("..", import.meta.url));
const policy = loadPolicy(JSON.parse(readFileSync(join(repo, "policy/example.json"), "utf8")));
const GENESIS_HEIGHT = 957359n;
const DIRS = ["keys", "genesis", "notes", "pages", "rights-evidence", "retractions"];

const copy = (dirs = DIRS) => {
  const root = mkdtempSync(join(tmpdir(), "weigh-"));
  for (const dir of dirs) cpSync(join(repo, dir), join(root, dir), { recursive: true });
  cpSync(join(repo, "retired-subjects.json"), join(root, "retired-subjects.json"));
  return root;
};
const edit = (root, path, change) => {
  const value = JSON.parse(readFileSync(join(root, path), "utf8"));
  change(value);
  writeFileSync(join(root, path), JSON.stringify(value));
};
const ids = (ledger) => ledger.events.map((e) => `${e.class}:${e.uid}:v${e.version}@${e.height}`).sort();

// The newest version of the note with the most versions: dropping it removes
// exactly one revision and leaves every chain intact.
const real = await ledgerEvents(repo);
const target = real.events.filter((e) => e.class === "revision").sort((a, b) => b.version - a.version || (a.uid < b.uid ? -1 : 1))[0];
const targetPath = `notes/${target.uid}/v${target.version}.json`;
const without = ids(real).filter((id) => id !== `revision:${target.uid}:v${target.version}@${target.height}`);

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("weigh, over the ledger", () => {
  it("same repository state and same policy produce byte-identical output", () => {
    const run = (...extra) => execFileSync(process.execPath, [join(repo, "weigh.mjs"), "--policy", join(repo, "policy/example.json"), ...extra]);
    expect(run().equals(run())).toBe(true);
    expect(run("--explain").equals(run("--explain"))).toBe(true);
  });
  it("genesis events use the genesis height, or an earlier standalone anchor", () => {
    // Two backlog notes were anchored on their own (blocks 957333, 957350)
    // before the genesis root confirmed; the earliest witness is the clock.
    const genesis = JSON.parse(readFileSync(join(repo, "genesis/2026-07-09-root.json"), "utf8")).payload.notes.map((n) => n.note_uid);
    const works = new Map(real.events.filter((e) => e.class === "work").map((e) => [e.uid, e.height]));
    expect(genesis.length).toBe(21);
    let atGenesis = 0;
    for (const uid of genesis) {
      const v1 = BigInt(JSON.parse(readFileSync(join(repo, `notes/${uid}/v1.json`), "utf8")).ots.bitcoin_block);
      expect(works.get(uid)).toBe(v1 < GENESIS_HEIGHT ? v1 : GENESIS_HEIGHT);
      if (works.get(uid) === GENESIS_HEIGHT) atGenesis += 1;
    }
    expect(atGenesis).toBe(19);
  });
  it("a record filed in two directories counts once", () => {
    expect(real.events.filter((e) => e.uid === "01cea10c-9ad3-4f8b-9d74-d0e7e90dbd1d" && e.version === 2)).toHaveLength(1);
  });
  it("a rights-evidence record copied under a second id counts once", async () => {
    const root = copy();
    const [first] = real.events.filter((e) => e.class === "rights-evidence");
    cpSync(join(root, "rights-evidence", first.uid), join(root, "rights-evidence", "00000000-0000-5000-8000-000000000000"), { recursive: true });
    const ledger = await ledgerEvents(root);
    expect(ids(ledger)).toEqual(ids(real));
    expect(ledger.excluded[0].reason).toContain("rights-evidence rules (id)");
  });
  it("lists retracted subjects of every class as withdrawn", () => {
    const targets = readdirSync(join(repo, "retractions")).map((uid) => JSON.parse(readFileSync(join(repo, "retractions", uid, "v1.json"), "utf8")).payload.note_uid).sort();
    expect(targets.length).toBeGreaterThan(0);
    expect(real.withdrawn.map((w) => w.uid)).toEqual(targets);
  });
  it("a withdrawal appears only once its retraction is in the record at --at", () => {
    const first = real.withdrawn.reduce((a, w) => (w.height < a ? w.height : a), real.highest);
    expect(report(real, policy, first - 1n, "test").record.withdrawn).toEqual([]);
    expect(report(real, policy, real.highest, "test").record.withdrawn).toHaveLength(real.withdrawn.length);
  });
  it("a retraction its own rules reject withdraws nothing", async () => {
    const root = copy();
    const [w] = real.withdrawn;
    rmSync(join(root, "rights-evidence", w.uid), { recursive: true });
    const ledger = await ledgerEvents(root);
    expect(ledger.withdrawn.map((x) => x.uid)).not.toContain(w.uid);
    expect(ledger.excluded).toContainEqual({ path: `retractions/${w.uid}/v1.json`, reason: expect.stringContaining("retracted_path") });
  });
  it("a note's records copied under another id are not a second history", async () => {
    const root = copy();
    cpSync(join(root, "notes", target.uid), join(root, "pages", "00000000-0000-4000-8000-000000000000"), { recursive: true });
    const ledger = await ledgerEvents(root);
    expect(ids(ledger)).toEqual(ids(real));
    expect(ledger.excluded[0].reason).toContain("payload names subject");
  });
  it("a damaged copy of a record filed twice does not hide the sound copy", async () => {
    const root = copy();
    writeFileSync(join(root, "notes/01cea10c-9ad3-4f8b-9d74-d0e7e90dbd1d/v2.ots"), "not a proof");
    expect(ids(await ledgerEvents(root))).toEqual(ids(real));
  });
  it("a missing middle version breaks contiguity for every later version", async () => {
    const root = copy();
    rmSync(join(root, `notes/${target.uid}/v2.json`));
    rmSync(join(root, `notes/${target.uid}/v2.ots`));
    const ledger = await ledgerEvents(root);
    expect(ids(ledger)).toEqual(ids(real).filter((id) => !id.startsWith(`revision:${target.uid}:`)));
    expect(ledger.excluded[0].reason).toContain("not contiguous from v1");
  });
  it("a key rotation leaves earlier-key chains whole", async () => {
    const root = copy();
    edit(root, "keys/key-history.json", (h) => {
      h.keys.push({ ...h.keys[0], id: "sn-ed25519-2099-01", public_key_base64: "AAAA", sha256_fingerprint: "00" });
      h.current = "sn-ed25519-2099-01";
    });
    const ledger = await ledgerEvents(root);
    expect(ledger.events).toEqual([]);
    expect(ledger.excluded.length).toBeGreaterThan(100);
    expect(ledger.excluded.every((x) => x.reason.includes("not the key being weighed"))).toBe(true);
  });
  it("an incomplete genesis derivation set proves no genesis event", async () => {
    const root = copy();
    edit(root, "genesis/2026-07-09-leaves.json", (leaves) => leaves.pop());
    const ledger = await ledgerEvents(root);
    expect(ledger.excluded).toEqual([{ path: "genesis/2026-07-09-leaves.json", reason: expect.stringContaining("do not reproduce") }]);
    const works = new Map(ledger.events.filter((e) => e.class === "work").map((e) => [e.uid, e.height]));
    for (const { note_uid: uid } of JSON.parse(readFileSync(join(repo, "genesis/2026-07-09-root.json"), "utf8")).payload.notes) {
      expect(works.get(uid)).toBe(BigInt(JSON.parse(readFileSync(join(repo, `notes/${uid}/v1.json`), "utf8")).ots.bitcoin_block));
    }
  });
  it("a bad signature contributes nothing", async () => {
    const root = copy();
    edit(root, targetPath, (r) => { r.signature = `${r.signature[1]}${r.signature[0]}${r.signature.slice(2)}`; });
    const ledger = await ledgerEvents(root);
    expect(ids(ledger)).toEqual(without);
    expect(ledger.excluded).toEqual([{ path: targetPath, reason: expect.stringContaining("signature=false") }]);
  });
  it("a pending anchor contributes nothing", async () => {
    const root = copy();
    edit(root, targetPath, (r) => { r.ots.status = "pending"; });
    const ledger = await ledgerEvents(root);
    expect(ids(ledger)).toEqual(without);
    expect(ledger.excluded[0].reason).toContain("not confirmed");
  });
  it("an unknown key contributes nothing", async () => {
    const root = copy();
    edit(root, targetPath, (r) => { r.pubkey_id = "sn-ed25519-1999-01"; });
    const ledger = await ledgerEvents(root);
    expect(ids(ledger)).toEqual(without);
    expect(ledger.excluded[0].reason).toContain("outside the history");
  });
  it("a failed middle version takes every later version of the subject with it", async () => {
    // verify-records.mjs halts at the first failure; nothing after one has passed.
    const root = copy();
    edit(root, `notes/${target.uid}/v2.json`, (r) => { r.ots.status = "pending"; });
    const ledger = await ledgerEvents(root);
    const gone = ids(real).filter((id) => id.startsWith(`revision:${target.uid}:`));
    expect(gone.length).toBe(target.version - 1);
    expect(ids(ledger)).toEqual(ids(real).filter((id) => !gone.includes(id)));
    expect(ledger.excluded.slice(1).every((x) => x.reason.includes("earlier record that did not pass"))).toBe(true);
  });
  it("mutating published_at can drop a record but never moves an event", async () => {
    // published_at sits inside the signed payload: changing it breaks the hash
    // and the signature, so the record stops counting. Every other event keeps
    // its height, and no event appears at a new one.
    const root = copy();
    edit(root, targetPath, (r) => { r.payload.published_at = "1999-01-01T00:00:00Z"; });
    const ledger = await ledgerEvents(root);
    expect(ids(ledger)).toEqual(without);
    expect(ledger.excluded[0].reason).toContain("hash=false");
  });
  it("nothing in the weigh code reads published_at, writes a file or calls the network", () => {
    for (const file of ["weigh.mjs", "weigh/ledger-events.mjs", "weigh/compose.mjs", "weigh/policy.mjs", "weigh/rational.mjs"]) {
      const code = readFileSync(join(repo, file), "utf8").replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/published_at|writeFile|appendFile|fetch\(|Date\.now|new Date/);
    }
  });
  it("runs to completion with the network unavailable", async () => {
    globalThis.fetch = () => { throw new Error("network call"); };
    expect(ids(await ledgerEvents(repo))).toEqual(ids(real));
  });
  it("a key with no record returns W = 0 and the empty-record wording", async () => {
    const root = mkdtempSync(join(tmpdir(), "weigh-empty-"));
    mkdirSync(join(root, "keys"));
    cpSync(join(repo, "keys/key-history.json"), join(root, "keys/key-history.json"));
    const ledger = await ledgerEvents(root);
    expect(ledger.events).toEqual([]);
    const r = report(ledger, policy, ledger.highest, "test");
    expect(r.W).toBe("0");
    expect(r.reading).toBe(ZERO_WORDING);
    expect(explain(r)).toContain("Nothing has accumulated in the record.");
  });
  it("speaks of weight under a policy, never of scores, ranks or tiers", () => {
    const r = report(real, policy, real.highest, "test");
    const verifyMd = readFileSync(join(repo, "VERIFY.md"), "utf8");
    const section = verifyMd.slice(verifyMd.indexOf("## Weigh the key"), verifyMd.indexOf("\n## ", verifyMd.indexOf("## Weigh the key") + 1));
    expect(section.length).toBeGreaterThan(200);
    for (const text of [JSON.stringify(r), explain(r), readFileSync(join(repo, "policy/example.json"), "utf8"), section]) {
      expect(text).not.toMatch(/\b(score|rank|tier|level|trusted|verified)\b/i);
    }
  });
});
