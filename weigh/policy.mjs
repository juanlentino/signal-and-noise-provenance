// The verifier's policy: the seven inputs Provenance Without Institutions
// (Section 6, "Who Sets the Policy") says are chosen rather than derived.
//
//   recognition_set            the issuers V recognizes
//   partition                  category -> issuers, declared by V
//   attestation_coefficients   a_i per attestation type
//   delta                      the one uniform cap
//   gamma                      the multiplier floor, in (0, 1]
//   decay                      lambda_j per persistence type
//   d_table                    the admissible form of D, as an explicit table
//
// Nothing here has a default. An unknown field, an unknown decay form or a D
// that breaks one of the paper's four properties is refused, never ignored:
// a policy this loader half-understood would yield a weight under a policy
// nobody stated.

import { createHash } from "node:crypto";
import { canonicalize } from "../normalize/canonical-json.mjs";
import { cmp, ONE, parseRational } from "./rational.mjs";

export const SCHEMA = "sn-weigh-policy-v1";
export const DECAY_FORMS = ["epoch-retain"];
// The record classes the ledger adapter can produce (weigh/ledger-events.mjs).
export const RECORD_CLASSES = ["work", "revision", "rights-evidence", "retraction"];
const FIELDS = ["schema", "description", "recognition_set", "partition", "attestation_coefficients", "delta", "gamma", "d_table", "decay"];
const DECAY_FIELDS = ["form", "epoch_blocks", "retain"];

const fail = (rule, detail) => {
  const error = new Error(`policy refused (${rule}): ${detail}`);
  error.rule = rule;
  throw error;
};
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const positiveInt = (v) => Number.isSafeInteger(v) && v > 0;
const exactKeys = (obj, allowed, rule) => {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) fail(rule, `unknown field ${extra.map((k) => JSON.stringify(k)).join(", ")}`);
  const missing = allowed.filter((k) => !(k in obj));
  if (missing.length) fail(rule, `missing field ${missing.map((k) => JSON.stringify(k)).join(", ")}`);
};

/** SHA-256 of the policy's canonical JSON, so an output names exactly what it ran under. */
export const policyHash = (raw) => createHash("sha256").update(canonicalize(raw)).digest("hex");

/**
 * The four properties of D (Section 6), checked on the table as given.
 * Index 0 is D(1); C beyond the table reads its last entry, which keeps every
 * property, and C = 0 reads D(1), where the attestation sum is zero anyway.
 */
function loadD(table, gamma) {
  if (!Array.isArray(table) || table.length === 0) fail("d-form", "d_table must be a non-empty list of rationals indexed by C, a function of the category count alone");
  const d = table.map((v, i) => parseRational(v, `d_table[${i}]`));
  d.forEach((v, i) => {
    if (cmp(v, gamma) < 0 || cmp(v, ONE) > 0) fail("d-bounded", `D(${i + 1}) is outside [gamma, 1]`);
    if (i > 0 && cmp(v, d[i - 1]) < 0) fail("d-non-decreasing", `D(${i + 1}) is below D(${i})`);
  });
  if (cmp(d[0], gamma) !== 0) fail("d-floor", "D(1) must equal gamma");
  return d;
}

export function loadPolicy(raw) {
  if (!isPlain(raw)) fail("shape", "a policy is a JSON object");
  exactKeys(raw, FIELDS, "fields");
  if (raw.schema !== SCHEMA) fail("schema", `schema must be "${SCHEMA}"`);
  if (typeof raw.description !== "string" || raw.description.trim() === "") fail("description", "a policy says what it is in its own description");

  if (!Array.isArray(raw.recognition_set) || raw.recognition_set.some((v) => typeof v !== "string") || new Set(raw.recognition_set).size !== raw.recognition_set.length) {
    fail("recognition-set", "recognition_set is a list of distinct issuer ids");
  }
  const recognized = new Set(raw.recognition_set);
  if (!isPlain(raw.partition)) fail("partition", "partition maps a category to its issuers");
  const categoryOf = new Map();
  for (const [category, issuers] of Object.entries(raw.partition)) {
    if (!Array.isArray(issuers)) fail("partition", `category ${JSON.stringify(category)} must list issuers`);
    for (const issuer of issuers) {
      if (!recognized.has(issuer)) fail("partition", `issuer ${JSON.stringify(issuer)} is partitioned but not in recognition_set`);
      if (categoryOf.has(issuer)) fail("partition", `issuer ${JSON.stringify(issuer)} is in two categories`);
      categoryOf.set(issuer, category);
    }
  }
  const uncategorized = raw.recognition_set.filter((issuer) => !categoryOf.has(issuer));
  if (uncategorized.length) fail("partition", `recognized issuer ${JSON.stringify(uncategorized[0])} has no category`);

  if (!isPlain(raw.attestation_coefficients)) fail("coefficients", "attestation_coefficients maps a type to a_i");
  const coefficients = new Map(Object.entries(raw.attestation_coefficients).map(([type, v]) => [type, parseRational(v, `attestation_coefficients.${type}`)]));
  if (!positiveInt(raw.delta)) fail("delta", "delta is one positive integer cap for every type");
  const gamma = parseRational(raw.gamma, "gamma");
  if (gamma.n === 0n || cmp(gamma, ONE) > 0) fail("gamma", "gamma is in (0, 1]");
  const d = loadD(raw.d_table, gamma);

  if (!isPlain(raw.decay)) fail("decay", "decay is an object");
  if (!DECAY_FORMS.includes(raw.decay.form)) fail("decay-form", `unknown decay form ${JSON.stringify(raw.decay.form)}; known: ${DECAY_FORMS.join(", ")}`);
  exactKeys(raw.decay, DECAY_FIELDS, "decay");
  if (!positiveInt(raw.decay.epoch_blocks)) fail("decay", "epoch_blocks is a positive integer count of blocks");
  if (!isPlain(raw.decay.retain) || Object.keys(raw.decay.retain).length === 0) fail("decay", "retain names at least one persistence type");
  const retain = new Map();
  for (const [type, v] of Object.entries(raw.decay.retain)) {
    if (!RECORD_CLASSES.includes(type)) fail("persistence-type", `unknown record class ${JSON.stringify(type)}; known: ${RECORD_CLASSES.join(", ")}`);
    const r = parseRational(v, `decay.retain.${type}`);
    if (r.n === 0n || cmp(r, ONE) > 0) fail("decay", `retain for ${type} is in (0, 1]`);
    retain.set(type, r);
  }

  return Object.freeze({
    description: raw.description,
    recognized,
    categoryOf,
    coefficients,
    delta: BigInt(raw.delta),
    gamma,
    d,
    epochBlocks: BigInt(raw.decay.epoch_blocks),
    retain,
    sha256: policyHash(raw),
  });
}
