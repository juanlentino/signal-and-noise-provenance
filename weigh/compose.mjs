// Equation (1) of Provenance Without Institutions, Section 6:
//
//   W(K, t, V) = [ sum_i a_i * min(A_i(K, V), delta) ] * D(C)  +  sum_j P_j(K, t)
//
// Pure: no file, no clock, no network. The ledger adapter feeds it events and
// an empty attestation list; the tests feed it synthetic attestations so the
// cap, the multiplier and the floor are exercised even though this ledger
// holds no recognition attestation.

import { add, mul, pow, rat, sum, ZERO } from "./rational.mjs";

/**
 * One persistence event's contribution at height `at`:
 * retain ^ floor((at - height) / epoch_blocks). An event anchored after `at`
 * has not happened yet at `at` and contributes nothing.
 */
export function eventContribution(event, policy, at) {
  const retain = policy.retain.get(event.class);
  if (retain === undefined || event.height > at) return ZERO;
  return pow(retain, (at - event.height) / policy.epochBlocks);
}

/** P_j per persistence type the policy names. Takes no argument in V. */
export function persistence(events, policy, at) {
  const byType = new Map([...policy.retain.keys()].map((type) => [type, { events: 0, P: ZERO }]));
  for (const event of events) {
    const slot = byType.get(event.class);
    if (!slot || event.height > at) continue;
    slot.events += 1;
    slot.P = add(slot.P, eventContribution(event, policy, at));
  }
  return byType;
}

/** The attestation term: counts per type, the uniform cap, C and D(C). */
export function attestationTerm(attestations, policy) {
  // Every type the policy names is reported, a zero included.
  const counts = new Map([...policy.coefficients.keys()].map((type) => [type, 0n]));
  const categories = new Set();
  for (const { type, issuer } of attestations) {
    if (!policy.recognized.has(issuer)) continue;
    if (!policy.coefficients.has(type)) throw new Error(`attestation type ${JSON.stringify(type)} has no coefficient in this policy`);
    counts.set(type, (counts.get(type) ?? 0n) + 1n);
    categories.add(policy.categoryOf.get(issuer));
  }
  const C = categories.size;
  const D = policy.d[Math.min(Math.max(C, 1), policy.d.length) - 1];
  const counted = sum([...counts].map(([type, A]) => mul(policy.coefficients.get(type), rat(A < policy.delta ? A : policy.delta))));
  return { counts, C, D, counted, term: mul(counted, D) };
}

export function compose({ events, attestations }, policy, at) {
  const P = persistence(events, policy, at);
  const persistenceSum = sum([...P.values()].map((slot) => slot.P));
  const attest = attestationTerm(attestations, policy);
  return { P, persistenceSum, attest, W: add(attest.term, persistenceSum) };
}
