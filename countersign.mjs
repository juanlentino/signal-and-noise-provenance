#!/usr/bin/env node
// Countersign the ledger with the author's own SSH key.
//
// The private key never reaches this script: it writes the exact bytes to
// sign, prints the `ssh-keygen -Y sign` command, and on `finish` checks the
// signature that came back before it writes a record. Working files live in
// .countersign/ (git-ignored). The Worker's hourly sweep stamps and anchors
// what this writes, through pending.json.
//
//   node countersign.mjs key-prepare --id <key-id> --ssh-pub <path to .pub>
//   node countersign.mjs key-finish --id <key-id>
//   node countersign.mjs prepare
//   node countersign.mjs finish <batch-id>

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize } from "./normalize/canonical-json.mjs";
import { authorKeyDivergences, batchPayload, BATCH_ID, contentHash, countersignatureDivergences } from "./countersign-checks.mjs";
import { authorKeys, batchIds, BATCH_DIR, ledgerLookup, readBatch, readHistory } from "./countersign-ledger.mjs";
import { ed25519FromSshPublicKey, SSHSIG_NAMESPACE } from "./sshsig.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const work = join(root, ".countersign");
const KEY_ID = /^sn-author-ed25519-\d{4}-\d{2}$/;
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
const fail = (message) => { console.error(message); process.exit(1); };
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const signCommand = (pub, msg) => `ssh-keygen -Y sign -f ${pub} -n ${SSHSIG_NAMESPACE} ${msg}`;

function writePending(entry) {
  const path = join(root, "pending.json");
  const index = JSON.parse(readFileSync(path, "utf8"));
  if (!index.entries.some((e) => e.path === entry.path)) index.entries.push({ ...entry, queued_at: new Date().toISOString() });
  writeFileSync(path, json(index));
}

function stage(name, payload, state) {
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, `${name}.msg`), canonicalize(payload));
  writeFileSync(join(work, `${name}.state.json`), json({ ...state, payload }));
  return join(".countersign", `${name}.msg`);
}

function staged(name) {
  const msg = join(work, `${name}.msg`);
  if (!existsSync(msg) || !existsSync(`${msg}.sig`)) fail(`no signed ${name}: run the prepare step, then the ssh-keygen command it printed`);
  const state = JSON.parse(readFileSync(join(work, `${name}.state.json`), "utf8"));
  if (readFileSync(msg, "utf8") !== canonicalize(state.payload)) fail(`${msg} changed after it was prepared`);
  return { state, signature: readFileSync(`${msg}.sig`, "utf8").trim() };
}

async function keyPrepare() {
  const id = arg("--id");
  const pubPath = arg("--ssh-pub");
  if (!KEY_ID.test(String(id)) || !pubPath) fail("usage: key-prepare --id sn-author-ed25519-YYYY-MM --ssh-pub <path to the .pub>");
  const history = readHistory(root);
  // One author key is all the ledger supports: rotating or retiring it needs
  // pinned retired keys with closed windows, which is not built.
  if (history.keys.some((k) => k.role === "author")) fail("refused: the key history already has an author key, and rotation is not built");
  const raw = ed25519FromSshPublicKey(readFileSync(pubPath, "utf8"));
  const publisher = history.keys.find((k) => k.id === history.current);
  const payload = {
    kind: "key-fingerprint",
    role: "author",
    pubkey_id: id,
    public_key_base64: Buffer.from(raw).toString("base64"),
    sha256_fingerprint: createHash("sha256").update(raw).digest("hex"),
    attests_publisher: { pubkey_id: publisher.id, sha256_fingerprint: publisher.sha256_fingerprint },
  };
  const msg = stage(`key-${id}`, payload, { id, ssh_public_key: readFileSync(pubPath, "utf8").trim() });
  // Where the author's key lives on this machine, so later batches print a
  // command that works. Local only: .countersign/ is git-ignored.
  writeFileSync(join(work, "signing-key.json"), json({ id, pub: pubPath }));
  console.log(`Sign the key record, then run key-finish:\n\n  ${signCommand(pubPath, msg)}\n  node countersign.mjs key-finish --id ${id}`);
}

async function keyFinish() {
  const id = arg("--id");
  const { state, signature } = staged(`key-${id}`);
  const p = state.payload;
  const anchorPath = `keys/anchors/${id}.json`;
  const key = { id, algorithm: "Ed25519", role: "author", public_key_base64: p.public_key_base64, sha256_fingerprint: p.sha256_fingerprint, ssh_public_key: state.ssh_public_key, introduced_at: new Date().toISOString().slice(0, 10), status: "active", introduction: { type: "author-key", bitcoin_anchor: anchorPath } };
  const anchor = { payload: p, content_hash: contentHash(p), signature_format: "sshsig", signature, pubkey_id: id, ots: { status: "pending" } };
  const history = readHistory(root);
  // Rechecked here, not only at key-prepare: two keys staged before either
  // finished, or a finish run twice, would otherwise append a second one.
  if (history.keys.some((k) => k.role === "author")) fail("refused: the key history already has an author key, and rotation is not built");
  const publishers = history.keys.filter((k) => k.role !== "author");
  const named = publishers.find((k) => k.id === p.attests_publisher?.pubkey_id);
  if (!named) fail("refused: the staged record names no publisher key in the history");
  const problems = await authorKeyDivergences(key, anchor, named, publishers);
  if (problems.length) fail(`refused: ${problems.map(([k, d]) => `${k}: ${d}`).join("; ")}`);
  writeFileSync(join(root, `keys/${id}.pub`), `${p.public_key_base64}\n`);
  writeFileSync(join(root, anchorPath), json(anchor));
  writeFileSync(join(root, "keys/key-history.json"), json({ ...history, keys: [...history.keys, key] }));
  writePending({ note_uid: id, version: 1, path: `keys/anchors/${id}`, kind: "key-fingerprint" });
  console.log(`Wrote keys/${id}.pub, ${anchorPath} and the key-history entry; queued the anchor. Commit them in a pull request.`);
}

async function prepare() {
  const keys = [...authorKeys(readHistory(root)).values()];
  if (keys.length !== 1) fail(`expected exactly one active author key, found ${keys.length}`);
  const attested = new Set(batchIds(root).flatMap((b) => readBatch(root, b).payload.records.map((r) => r.content_hash)));
  const { passing } = await ledgerLookup(root);
  const records = passing.filter((r) => !attested.has(r.content_hash));
  if (records.length === 0) fail("nothing new to countersign");
  const today = new Date().toISOString().slice(0, 10);
  let n = 1;
  while (batchIds(root).includes(`${today}-${n}`) || existsSync(join(work, `${today}-${n}.msg`))) n += 1;
  const id = `${today}-${n}`;
  const msg = stage(id, batchPayload(id, keys[0].id, records), { id });
  // ssh-keygen -Y sign takes a .pub only when the agent holds its private
  // half (ssh-keygen(1)), so name the key file key-prepare saw and say how to
  // load it if the agent does not have it.
  const local = existsSync(join(work, "signing-key.json")) ? JSON.parse(readFileSync(join(work, "signing-key.json"), "utf8")) : null;
  const pub = local?.id === keys[0].id ? local.pub : "<path to your author key .pub>";
  const loaded = (() => { try { return execFileSync("ssh-add", ["-L"], { encoding: "utf8" }).includes(keys[0].ssh_public_key.split(/\s+/)[1]); } catch { return false; } })();
  // --apple-use-keychain is Apple's extension to ssh-add; elsewhere it fails.
  const keychain = process.platform === "darwin" ? "--apple-use-keychain " : "";
  const load = loaded ? "" : `  ssh-add ${keychain}${pub.replace(/\.pub$/, "")}\n`;
  console.log(`Batch ${id}: ${records.length} record(s). Sign it, then run finish:\n\n${load}  ${signCommand(pub, msg)}\n  node countersign.mjs finish ${id}`);
}

async function finish() {
  const id = process.argv[3];
  if (!BATCH_ID.test(String(id))) fail("usage: finish <batch-id>");
  const { state, signature } = staged(id);
  const p = state.payload;
  const record = { payload: p, content_hash: contentHash(p), signature_format: "sshsig", signature, pubkey_id: p.signer, ots: { status: "pending" } };
  // Two batches prepared before either finished can list the same records;
  // the verifier refuses a record attested twice, so refuse it here first.
  const attested = new Set(batchIds(root).flatMap((b) => readBatch(root, b).payload.records.map((r) => r.content_hash)));
  const twice = p.records.filter((r) => attested.has(r.content_hash)).map((r) => r.path);
  if (twice.length) fail(`refused: already attested in another batch: ${twice.join(", ")}; run prepare again`);
  const { lookup } = await ledgerLookup(root);
  const problems = await countersignatureDivergences(record, { id, authorKeys: authorKeys(readHistory(root)), lookup });
  if (problems.length) fail(`refused: ${problems.map(([k, d]) => `${k}: ${d}`).join("; ")}`);
  mkdirSync(join(root, BATCH_DIR), { recursive: true });
  writeFileSync(join(root, BATCH_DIR, `${id}.json`), json(record));
  writePending({ note_uid: id, version: 1, path: `${BATCH_DIR}/${id}`, kind: "countersignature" });
  console.log(`Wrote ${BATCH_DIR}/${id}.json (${p.records.length} records) and queued its anchor. Commit it in a pull request.`);
}

const commands = { "key-prepare": keyPrepare, "key-finish": keyFinish, prepare, finish };
const command = commands[process.argv[2]];
if (!command) fail("usage: countersign.mjs key-prepare | key-finish | prepare | finish (see the file header)");
await command();
