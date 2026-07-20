// Minimal, dependency-free OpenTimestamps READER — just enough to pull the
// Bitcoin block a proof commits to. Vendored from the sn-provenance Worker's
// ots.mjs (the write/upgrade half is omitted; a verifier only reads). Web Crypto
// + typed arrays only, so it runs in Node and the browser with no install.
//
// Format refs: python-opentimestamps timestamp.py / op.py / notary.py.

const enc = new TextEncoder();

export const HEADER_MAGIC = new Uint8Array([
  0x00, ...enc.encode("OpenTimestamps"), 0x00, 0x00,
  ...enc.encode("Proof"), 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94,
]); // 31 bytes

const OP_SHA256  = 0x08;
const OP_APPEND  = 0xf0;
const OP_PREPEND = 0xf1;
export const ATT_BITCOIN = "0588960d73d71901";

const concatBytes = (arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
export const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const bytesEqual = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

/** Return the SHA-256 digest named in the detached proof header. */
export function stampedDigest(otsBytes) {
  if (otsBytes.length < HEADER_MAGIC.length + 34) throw new Error("truncated OTS proof");
  if (!bytesEqual(otsBytes.slice(0, HEADER_MAGIC.length), HEADER_MAGIC)) throw new Error("invalid OTS header");
  const version = otsBytes[HEADER_MAGIC.length];
  const fileHashOp = otsBytes[HEADER_MAGIC.length + 1];
  if (version !== 1 || fileHashOp !== OP_SHA256) throw new Error("unsupported OTS version or file-hash operation");
  return otsBytes.slice(HEADER_MAGIC.length + 2, HEADER_MAGIC.length + 34);
}

function readVaruint(buf, cur) {
  let result = 0, shift = 0, b;
  do { b = buf[cur.i++]; result += (b & 0x7f) * Math.pow(2, shift); shift += 7; } while (b & 0x80);
  return result;
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function applyOp(opTag, arg, msg) {
  if (opTag === OP_APPEND)  return concatBytes([msg, arg]);
  if (opTag === OP_PREPEND) return concatBytes([arg, msg]);
  throw new Error(`unsupported op 0x${opTag.toString(16)}`);
}

// Walk the serialized Timestamp, collecting every attestation as
// { attTag, commitment } — the running message at each attestation node.
async function parseAttestations(otsBytes) {
  const digest = stampedDigest(otsBytes);
  let i = HEADER_MAGIC.length + 34;
  const cur = { i };
  const attestations = [];

  async function walk(msg) {
    let tag = otsBytes[cur.i++];
    for (;;) {
      const terminal = tag !== 0xff;
      const marker = terminal ? tag : otsBytes[cur.i++];
      if (marker === 0x00) {
        const attTag = toHex(otsBytes.slice(cur.i, cur.i + 8)); cur.i += 8;
        const len = readVaruint(otsBytes, cur);
        const payload = otsBytes.slice(cur.i, cur.i + len); cur.i += len;
        attestations.push({ attTag, commitment: msg, payload });
      } else {
        let arg = new Uint8Array(0);
        if (marker === OP_APPEND || marker === OP_PREPEND) {
          const len = readVaruint(otsBytes, cur);
          arg = otsBytes.slice(cur.i, cur.i + len); cur.i += len;
        }
        const next = marker === OP_SHA256 ? await sha256(msg) : applyOp(marker, arg, msg);
        await walk(next);
      }
      if (terminal) break;
      tag = otsBytes[cur.i++];
    }
  }

  await walk(digest);
  return attestations;
}

// The Bitcoin block a proof commits to: { height, merkleRoot } where merkleRoot
// is display (big-endian) hex — directly comparable to a block explorer's
// `merkle_root`. The OTS running message at the attestation is the merkle root
// in Bitcoin's internal little-endian order, so it's byte-reversed here. Returns
// null when the proof carries no BitcoinBlockHeaderAttestation yet (pending).
export async function bitcoinAttestation(otsBytes) {
  const atts = await parseAttestations(otsBytes);
  const btc = atts.find((a) => a.attTag === ATT_BITCOIN);
  if (!btc) return null;
  const height = readVaruint(btc.payload, { i: 0 });
  const merkleRoot = toHex(btc.commitment.slice().reverse()); // internal LE → display BE
  return { height, merkleRoot };
}
