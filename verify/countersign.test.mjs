import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalize } from "../normalize/canonical-json.mjs";
import { authorKeyDivergences, batchPayload, contentHash, countersignatureDivergences, STATEMENT } from "../countersign-checks.mjs";
import { ed25519FromSshPublicKey, parseSshSig, SSHSIG_NAMESPACE, verifySshSig } from "../sshsig.mjs";

// Real keys and real `ssh-keygen -Y sign` output: a parser tested only
// against bytes it wrote itself would agree with itself and nothing else.

const repo = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "countersign-"));
const keygen = (name, type = "ed25519") => {
  execFileSync("ssh-keygen", ["-q", "-t", type, "-N", "", "-C", name, "-f", join(dir, name)]);
  return { priv: join(dir, name), pubLine: readFileSync(join(dir, `${name}.pub`), "utf8").trim() };
};
const sign = (key, message, namespace = SSHSIG_NAMESPACE) => {
  const file = join(dir, `m-${Math.random().toString(16).slice(2)}`);
  writeFileSync(file, message);
  execFileSync("ssh-keygen", ["-Y", "sign", "-f", key.priv, "-n", namespace, file], { stdio: "ignore" });
  return readFileSync(`${file}.sig`, "utf8");
};
const author = keygen("author");
const other = keygen("other");
const raw = (k) => ed25519FromSshPublicKey(k.pubLine);
const b64 = (k) => Buffer.from(raw(k)).toString("base64");
const fp = (k) => createHash("sha256").update(raw(k)).digest("hex");

describe("SSH signatures", () => {
  const message = Buffer.from("the canonical payload");
  const sig = sign(author, message);
  it("verifies a real ssh-keygen signature", async () => {
    expect((await verifySshSig({ message, sig, publicKey: raw(author) })).ok).toBe(true);
  });
  it("refuses a changed message, another key, another namespace, garbage", async () => {
    expect((await verifySshSig({ message: Buffer.from("the canonical payloaD"), sig, publicKey: raw(author) })).reason).toBe("signature does not verify");
    expect((await verifySshSig({ message, sig, publicKey: raw(other) })).reason).toBe("signed by a different key");
    expect((await verifySshSig({ message, sig: sign(author, message, "git"), publicKey: raw(author) })).reason).toMatch(/namespace/);
    expect((await verifySshSig({ message, sig: "not a signature", publicKey: raw(author) })).ok).toBe(false);
  });
  it("refuses a key that is not ssh-ed25519", async () => {
    const ecdsa = keygen("ecdsa", "ecdsa");
    expect(() => parseSshSig(sign(ecdsa, message))).toThrow(/unsupported/);
  });
});

// A batch over two real ledger records, signed for real.
const records = [
  { path: "notes/024d8307-1ab3-4fa3-9be5-6ae5634bf124/v1.json" },
  { path: "pages/01cea10c-9ad3-4f8b-9d74-d0e7e90dbd1d/v1.json" },
].map((r) => ({ ...r, content_hash: JSON.parse(readFileSync(join(repo, r.path), "utf8")).content_hash }));
const ledger = new Map(records.map((r) => [r.path, r.content_hash]));
const lookup = (path) => (ledger.has(path) ? { content_hash: ledger.get(path) } : { reason: "not a ledger record that passes the offline checks" });
const authorKeys = new Map([["sn-author-ed25519-2026-10", { id: "sn-author-ed25519-2026-10", public_key_base64: b64(author) }]]);
const batch = (mutate = (p) => p, signer = author) => {
  const payload = mutate(batchPayload("2026-10-05-1", "sn-author-ed25519-2026-10", records));
  return { payload, content_hash: contentHash(payload), signature_format: "sshsig", signature: sign(signer, canonicalize(payload)), pubkey_id: "sn-author-ed25519-2026-10", ots: { status: "pending" } };
};
const rules = async (record, id = "2026-10-05-1") => [...new Set((await countersignatureDivergences(record, { id, authorKeys, lookup })).map(([k]) => k))];

describe("countersignature batches", () => {
  it("accept a batch the author signed", async () => {
    expect(await rules(batch())).toEqual([]);
  });
  it("refuse each broken rule by name", async () => {
    expect(await rules(batch((p) => ({ ...p, statement: "Something else." })))).toEqual(["statement"]);
    expect(await rules(batch(), "2026-10-05-2")).toEqual(["batch"]);
    expect(await rules(batch(undefined, other))).toEqual(["signature"]);
    expect(await rules(batch((p) => ({ ...p, records: [...p.records].reverse() })))).toEqual(["records"]);
    expect(await rules(batch((p) => ({ ...p, records: [] })))).toEqual(["records"]);
    expect(await rules(batch((p) => ({ ...p, records: [{ ...p.records[0], content_hash: "0".repeat(64) }, p.records[1]] })))).toEqual(["records"]);
    expect(await rules(batch((p) => ({ ...p, records: [...p.records, { path: "pages/ffffffff-0000-4000-8000-000000000000/v1.json", content_hash: "1".repeat(64) }] })))).toEqual(["records"]); // sorted, so only the lookup can refuse it
    expect(await rules(batch((p) => ({ ...p, records: [{ path: "../keys/x.json", content_hash: "1".repeat(64) }] })))).toEqual(["records"]);
    expect(await rules({ ...batch(), content_hash: "f".repeat(64) })).toEqual(["hash"]);
    expect(await rules({ ...batch(), pubkey_id: "sn-ed25519-2026-07" })).toEqual(expect.arrayContaining(["signer", "key"]));
    expect(await rules({ ...batch(), signature_format: "ed25519" })).toEqual(["format"]);
    expect(await rules({ ...batch(), payload: { ...batch().payload, kind: "note" } })).toEqual(["kind"]);
  });
  it("hold the statement fixed", () => {
    expect(STATEMENT).toBe("The author of juanlentino.com attests each listed record, identified by its content hash.");
  });
});

describe("the author key", () => {
  const publisher = JSON.parse(readFileSync(join(repo, "keys/key-history.json"), "utf8")).keys[0];
  const keyFor = (k) => ({ id: "sn-author-ed25519-2026-10", role: "author", public_key_base64: b64(k), sha256_fingerprint: fp(k), introduction: { type: "author-key" } });
  const anchorFor = (k, signer = k, mutate = (p) => p) => {
    const payload = mutate({ kind: "key-fingerprint", role: "author", pubkey_id: "sn-author-ed25519-2026-10", public_key_base64: b64(k), sha256_fingerprint: fp(k), attests_publisher: { pubkey_id: publisher.id, sha256_fingerprint: publisher.sha256_fingerprint } });
    return { payload, content_hash: contentHash(payload), signature_format: "sshsig", signature: sign(signer, canonicalize(payload)), pubkey_id: "sn-author-ed25519-2026-10" };
  };
  const rulesFor = async (key, anchor) => (await authorKeyDivergences(key, anchor, publisher)).map(([k]) => k);
  it("accepts a self-signed fingerprint record that names the publisher key", async () => {
    expect(await rulesFor(keyFor(author), anchorFor(author))).toEqual([]);
  });
  it("refuses an author key that is the publisher key", async () => {
    const same = { ...keyFor(author), public_key_base64: publisher.public_key_base64, sha256_fingerprint: publisher.sha256_fingerprint };
    expect(await rulesFor(same, anchorFor(author))).toContain("distinct");
  });
  it("refuses another signer, a missing binding, a wrong role or fingerprint", async () => {
    expect(await rulesFor(keyFor(author), anchorFor(author, other))).toEqual(["anchor"]);
    expect(await rulesFor(keyFor(author), anchorFor(author, author, (p) => ({ ...p, attests_publisher: { pubkey_id: "x", sha256_fingerprint: "y" } })))).toEqual(["binding"]);
    expect(await rulesFor({ ...keyFor(author), role: "publisher" }, anchorFor(author))).toEqual(["role"]);
    expect(await rulesFor({ ...keyFor(author), sha256_fingerprint: "0".repeat(64) }, anchorFor(author))).toEqual(expect.arrayContaining(["fingerprint"]));
  });
});

describe("the whole flow, on a copy of the ledger", () => {
  it("introduces a key, countersigns every passing record, and the verifiers agree", () => {
    const root = mkdtempSync(join(tmpdir(), "countersign-ledger-"));
    for (const d of ["keys", "genesis", "notes", "pages", "rights-evidence", "retractions", "normalize", "verify", "weigh"]) cpSync(join(repo, d), join(root, d), { recursive: true });
    for (const f of ["countersign.mjs", "countersign-checks.mjs", "countersign-ledger.mjs", "sshsig.mjs", "verify-countersignatures.mjs", "verify-key-history.mjs", "verify.mjs", "fetch-site.mjs", "ledger-records.mjs", "retraction-checks.mjs", "rights-evidence-checks.mjs", "retired-subjects.json", "pending.json", "package.json", "anchor-grace.mjs"]) cpSync(join(repo, f), join(root, f));
    const run = (...args) => execFileSync(process.execPath, args, { cwd: root }).toString();
    run("countersign.mjs", "key-prepare", "--id", "sn-author-ed25519-2026-10", "--ssh-pub", `${author.priv}.pub`);
    execFileSync("ssh-keygen", ["-Y", "sign", "-f", author.priv, "-n", SSHSIG_NAMESPACE, ".countersign/key-sn-author-ed25519-2026-10.msg"], { cwd: root, stdio: "ignore" });
    run("countersign.mjs", "key-finish", "--id", "sn-author-ed25519-2026-10");
    expect(run("verify-key-history.mjs")).toContain("1 author key(s)");
    const out = run("countersign.mjs", "prepare");
    const id = out.match(/Batch (\S+):/)[1];
    execFileSync("ssh-keygen", ["-Y", "sign", "-f", author.priv, "-n", SSHSIG_NAMESPACE, `.countersign/${id}.msg`], { cwd: root, stdio: "ignore" });
    run("countersign.mjs", "finish", id);
    expect(run("verify-countersignatures.mjs")).toMatch(/1 countersignature batch\(es\) hold, \d+ record\(s\) attested/);
    const pending = JSON.parse(readFileSync(join(root, "pending.json"), "utf8")).entries.map((e) => e.kind);
    expect(pending).toEqual(expect.arrayContaining(["key-fingerprint", "countersignature"]));
    // Nothing is countersigned twice: prepare offers only unattested records.
    expect(() => run("countersign.mjs", "prepare")).toThrow(/nothing new to countersign/);
    // A second author key is refused before anything is staged.
    expect(() => run("countersign.mjs", "key-prepare", "--id", "sn-author-ed25519-2026-11", "--ssh-pub", `${author.priv}.pub`)).toThrow(/rotation is not built/);
    // The author key can never become the current key.
    const historyPath = join(root, "keys", "key-history.json");
    const history = JSON.parse(readFileSync(historyPath, "utf8"));
    writeFileSync(historyPath, JSON.stringify({ ...history, current: "sn-author-ed25519-2026-10" }));
    expect(() => run("verify-key-history.mjs")).toThrow(/author key cannot be current/);
    writeFileSync(historyPath, JSON.stringify(history));
    // The author key never signs a publisher record: a note claiming it is
    // refused by role before any signature is checked.
    const note = join(root, "notes/024d8307-1ab3-4fa3-9be5-6ae5634bf124/v1.json");
    const original = readFileSync(note, "utf8");
    writeFileSync(note, JSON.stringify({ ...JSON.parse(original), pubkey_id: "sn-author-ed25519-2026-10" }));
    expect(run("-e", 'import("./weigh/ledger-events.mjs").then(async (m) => console.log(JSON.stringify((await m.ledgerEvents(".")).excluded)))')).toContain("which only countersigns");
    expect(() => run("-e", 'import("./ledger-records.mjs").then((m) => m.assertPublisherKey(".", "sn-author-ed25519-2026-10", "a note"))')).toThrow(/only countersigns/);
    writeFileSync(note, original);
    // A file planted elsewhere with a copied content_hash is not a passing record.
    const planted = join(root, "notes/0f000000-0000-4000-8000-000000000000");
    cpSync(join(root, "notes/024d8307-1ab3-4fa3-9be5-6ae5634bf124"), planted, { recursive: true });
    expect(run("-e", 'import("./countersign-ledger.mjs").then(async (m) => console.log((await m.ledgerLookup(".")).lookup("notes/0f000000-0000-4000-8000-000000000000/v1.json").reason))')).toContain("not a ledger record");
    rmSync(planted, { recursive: true });
    // A record signed by a key the history does not declare is refused.
    expect(() => run("-e", 'import("./ledger-records.mjs").then((m) => m.assertPublisherKey(".", "sn-ed25519-alias", "a note"))')).toThrow(/absent from the key history/);
    // The author key takes no part in a publisher transition.
    writeFileSync(historyPath, JSON.stringify({ ...history, transitions: [{ signed_by: "sn-author-ed25519-2026-10", introduces: "sn-ed25519-2026-07", statement: {}, signature: "" }] }));
    expect(() => run("verify-key-history.mjs")).toThrow(/takes no part in publisher transitions/);
    // Only one active, pinned author key is supported: a retired one would
    // verify batches without ever being pinned, so it is refused everywhere.
    writeFileSync(historyPath, JSON.stringify({ ...history, keys: history.keys.map((k) => (k.role === "author" ? { ...k, status: "retired" } : k)) }));
    expect(() => run("verify-key-history.mjs")).toThrow(/retirement is not supported yet/);
    expect(() => run("verify-countersignatures.mjs")).toThrow(/not an author key/);
    expect(() => run("countersign.mjs", "prepare")).toThrow();
    const second = history.keys.find((k) => k.role === "author");
    writeFileSync(historyPath, JSON.stringify({ ...history, keys: [...history.keys, { ...second, id: "sn-author-ed25519-2026-11" }] }));
    expect(() => run("verify-key-history.mjs")).toThrow(/only one active author key/);
    writeFileSync(historyPath, JSON.stringify(history));
    // Pending is bounded: past the grace window, or not queued at all, it fails.
    const pendingPath = join(root, "pending.json");
    const queue = JSON.parse(readFileSync(pendingPath, "utf8"));
    const stale = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    writeFileSync(pendingPath, JSON.stringify({ entries: queue.entries.map((e) => (e.kind === "countersignature" ? { ...e, queued_at: stale } : e)) }));
    expect(() => run("verify-countersignatures.mjs")).toThrow(/grace window/);
    writeFileSync(pendingPath, JSON.stringify({ entries: queue.entries.filter((e) => e.kind !== "countersignature") }));
    expect(() => run("verify-countersignatures.mjs")).toThrow(/not queued/);
    writeFileSync(pendingPath, JSON.stringify(queue));
    // Edit one listed hash after signing: the verifier refuses the batch.
    const path = join(root, "countersignatures", `${id}.json`);
    const record = JSON.parse(readFileSync(path, "utf8"));
    record.payload.records[0].content_hash = "0".repeat(64);
    writeFileSync(path, JSON.stringify(record));
    expect(() => run("verify-countersignatures.mjs")).toThrow();
  }, 60_000);
});
