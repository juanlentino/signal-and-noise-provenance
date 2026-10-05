#!/usr/bin/env node
// Weigh the key: equation (1) of Provenance Without Institutions (Lentino,
// SSRN 7456638, Section 6), computed from this repository's records under a
// policy the verifier states.
//
//   node weigh.mjs --policy policy/example.json
//   node weigh.mjs --policy policy/example.json --at 967020 --explain
//
// Offline and read-only. The same repository state and the same policy give
// byte-identical output: every quantity is an exact fraction and the clock is
// a Bitcoin block height, never the wall clock.

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compose } from "./weigh/compose.mjs";
import { ledgerEvents } from "./weigh/ledger-events.mjs";
import { loadPolicy } from "./weigh/policy.mjs";
import { decimal, show } from "./weigh/rational.mjs";

export const ATTESTATION_REASON = "No recognition attestation exists in this record: no issuer holding its own key has signed a scoped claim about this key, and the ledger has no record format for one. The ORCID identifier, the WebFinger subject and the did:web document are the author's own statements and are not counted. The institutional track has nothing to read.";
export const ZERO_WORDING = "Nothing has accumulated in the record.";

export function parseArgs(argv) {
  const args = { explain: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--explain") args.explain = true;
    else if (flag === "--policy" || flag === "--at") {
      if (argv[i + 1] === undefined) throw new Error(`${flag} needs a value`);
      args[flag.slice(2)] = argv[++i];
    } else throw new Error(`unknown argument ${JSON.stringify(flag)}`);
  }
  if (!args.policy) throw new Error("--policy is required: the policy is the verifier's to state, and there is no default");
  if (args.at !== undefined && !/^(0|[1-9]\d*)$/.test(args.at)) throw new Error("--at is a Bitcoin block height");
  return args;
}

/** The whole report, as plain data. Pure given the ledger and the policy. */
export function report(ledger, policy, at, atSource) {
  const { P, persistenceSum, attest, W } = compose({ events: ledger.events, attestations: [] }, policy, at);
  const persistence = Object.fromEntries([...P].map(([type, slot]) => [type, { events: slot.events, P: show(slot.P), P_decimal: decimal(slot.P) }]));
  const unnamed = {};
  for (const event of ledger.events) if (!policy.retain.has(event.class)) unnamed[event.class] = (unnamed[event.class] ?? 0) + 1;
  return {
    computation: "weight of one key under the stated policy; Provenance Without Institutions, equation (1)",
    key: ledger.key,
    at: Number(at),
    at_source: atSource,
    policy: { sha256: policy.sha256, description: policy.description },
    persistence: { ...persistence, sum: show(persistenceSum), sum_decimal: decimal(persistenceSum) },
    attestations: { counts: Object.fromEntries([...attest.counts].map(([t, n]) => [t, Number(n)])), C: attest.C, D_of_C: show(attest.D), term: show(attest.term), reason: ATTESTATION_REASON },
    W: show(W),
    W_decimal: decimal(W),
    ...(W.n === 0n ? { reading: ZERO_WORDING } : {}),
    record: {
      anchored_after_at: ledger.events.filter((e) => e.height > at).length,
      classes_this_policy_does_not_name: unnamed,
      excluded: ledger.excluded,
      withdrawn: ledger.withdrawn,
      retired: ledger.retired,
    },
  };
}

export function explain(r) {
  const lines = [
    `Key ${r.key.id} (SHA-256 fingerprint ${r.key.sha256_fingerprint}), weighed at Bitcoin block ${r.at} (${r.at_source}).`,
    `Policy ${r.policy.sha256}: ${r.policy.description}`,
  ];
  for (const [type, slot] of Object.entries(r.persistence)) {
    if (type === "sum" || type === "sum_decimal") continue;
    lines.push(`${slot.events} ${type} event(s) in the record contribute ${slot.P} (about ${slot.P_decimal}) of persistence under this policy.`);
  }
  lines.push(`Persistence sums to ${r.persistence.sum}. It takes no recognition set and no partition, and no multiplier touches it.`);
  lines.push(`Attestation term: ${r.attestations.term}. ${r.attestations.reason}`);
  lines.push(`The weight under this policy is ${r.W} (about ${r.W_decimal}).${r.reading ? ` ${r.reading} That is a statement about the record, not about a person.` : ""}`);
  if (r.record.anchored_after_at) lines.push(`${r.record.anchored_after_at} event(s) anchored after block ${r.at} are not yet in the record at that height.`);
  for (const [cls, n] of Object.entries(r.record.classes_this_policy_does_not_name)) lines.push(`${n} ${cls} record(s) are not counted because this policy names no decay for that class.`);
  for (const x of r.record.excluded) lines.push(`Not counted: ${x.path}, ${x.reason}.`);
  if (r.record.withdrawn.length) lines.push(`Withdrawn subjects whose original signed events still count: ${r.record.withdrawn.join(", ")}.`);
  if (r.record.retired.length) lines.push(`Retired subjects whose original signed events still count: ${r.record.retired.join(", ")}.`);
  lines.push("No threshold applies. What a weight is good for is the verifier's decision.");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = loadPolicy(JSON.parse(readFileSync(args.policy, "utf8")));
  const ledger = await ledgerEvents(dirname(fileURLToPath(import.meta.url)));
  const at = args.at === undefined ? ledger.highest : BigInt(args.at);
  const r = report(ledger, policy, at, args.at === undefined ? "highest confirmed height among the records this tool checks" : "--at");
  process.stdout.write(args.explain ? explain(r) : `${JSON.stringify(r, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
