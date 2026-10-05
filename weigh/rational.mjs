// Exact rationals for the weight computation.
//
// The paper's determinism claim is for any party who runs the computation, in
// any language. A float `exp` does not reproduce bit for bit across runtimes;
// a reduced BigInt fraction does. Every quantity in weigh.mjs is one of these,
// and the decimal printed beside it is for reading only.

const RATIONAL = /^(0|[1-9]\d*)(?:\/([1-9]\d*))?$/;

const gcd = (a, b) => {
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

/** A reduced fraction; the denominator is always positive. */
export function rat(n, d = 1n) {
  if (d === 0n) throw new Error("zero denominator");
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return Object.freeze({ n: n / g, d: d / g });
}

export const ZERO = rat(0n);
export const ONE = rat(1n);

/**
 * Parse a policy rational. Only strings of the form "n" or "n/d" with
 * non-negative integers are accepted: a JSON float such as 0.9 is refused,
 * because the value a reader sees would not be the value computed.
 */
export function parseRational(value, where) {
  const match = typeof value === "string" ? value.match(RATIONAL) : null;
  if (!match) throw new Error(`${where} must be a rational written as a string "n" or "n/d", got ${JSON.stringify(value)}`);
  return rat(BigInt(match[1]), BigInt(match[2] ?? 1));
}

export const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
export const cmp = (a, b) => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};
export const sum = (list) => list.reduce(add, ZERO);

/** a ** k for a non-negative integer k (a BigInt), exactly. */
export function pow(a, k) {
  if (k < 0n) throw new Error("negative exponent");
  return rat(a.n ** k, a.d ** k);
}

/** "n/d", or "n" when the denominator is one. */
export const show = (a) => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);

/** Rounded half up to `places` decimals, for reading only. */
export function decimal(a, places = 6) {
  const scale = 10n ** BigInt(places);
  const scaled = (a.n * scale * 2n + a.d) / (2n * a.d);
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(places, "0");
  return places === 0 ? `${whole}` : `${whole}.${frac}`;
}
