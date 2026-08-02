// Guards the edge-interception failure mode. Twice now the juanlentino.com
// edge has answered a bare default-UA fetch from a GitHub runner with
// something that is not the API: HTTP 415 on 2026-07-29, and HTTP 200 with an
// HTML body on 2026-08-02 (which sailed past `response.ok` and died as an
// unreadable `SyntaxError: Unexpected token '<'` inside JSON.parse, discarding
// every byte of evidence about what the edge actually served).
//
// These tests are offline — `fetch` and the retry sleep are injected.
import { describe, it, expect } from "vitest";
import { fetchSite, SiteFetchError } from "../fetch-site.mjs";

const CHALLENGE_HTML = `<!DOCTYPE html>\n<html><head><title>Just a moment...</title></head>\n<body>checking your browser</body></html>`;

/** Build a Response-alike. `body` is returned verbatim by .text(). */
const reply = (status, contentType, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => ({ "content-type": contentType, ...headers }[name.toLowerCase()] ?? null) },
  text: async () => body,
});

/** A fetch stub that returns each scripted reply in turn and records calls. */
const scripted = (...replies) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    return replies[Math.min(calls.length - 1, replies.length - 1)];
  };
  impl.calls = calls;
  return impl;
};

const noSleep = async () => {};

describe("fetchSite — identification", () => {
  it("sends a named User-Agent and an Accept matching the expected payload", async () => {
    const fetchImpl = scripted(reply(200, "application/json; charset=UTF-8", "[]"));
    await fetchSite("https://juanlentino.com/wp-json/wp/v2/posts", { expect: "json", fetchImpl, sleep: noSleep });

    const { init } = fetchImpl.calls[0];
    expect(init.headers["User-Agent"]).toMatch(/^sn-ledger-verify\/[\d.]+ \(\+https:\/\/github\.com\//);
    expect(init.headers.Accept).toBe("application/json");
  });

  // Regression guard (2026-08-02): narrowing Accept to text/html changed the
  // served bytes for the same Note (119,540 vs 119,181), i.e. Accept is part
  // of the edge cache key for pages. Page fetches must keep asking for */* —
  // the shape that has worked for months — and rely on validating the
  // content-type they RECEIVE instead.
  it("does not narrow Accept on page fetches, to leave the cache variant alone", async () => {
    const fetchImpl = scripted(reply(200, "text/html; charset=UTF-8", "<html></html>"));
    await fetchSite("https://juanlentino.com/notes/x/", { expect: "html", fetchImpl, sleep: noSleep });
    expect(fetchImpl.calls[0].init.headers.Accept).toBe("*/*");
  });

  it("still rejects a non-HTML payload even though it asked for */*", async () => {
    const fetchImpl = scripted(reply(200, "application/json", "{}"));
    await expect(fetchSite("https://juanlentino.com/notes/x/", { expect: "html", fetchImpl, sleep: noSleep }))
      .rejects.toBeInstanceOf(SiteFetchError);
  });
});

describe("fetchSite — payload validation", () => {
  it("returns parsed JSON on a clean JSON reply", async () => {
    const fetchImpl = scripted(reply(200, "application/json", '[{"slug":"a"}]'));
    const { body } = await fetchSite("https://juanlentino.com/wp-json/wp/v2/posts", { expect: "json", fetchImpl, sleep: noSleep });
    expect(body).toEqual([{ slug: "a" }]);
  });

  it("rejects a 200 that carries HTML where JSON was expected", async () => {
    const fetchImpl = scripted(reply(200, "text/html; charset=UTF-8", CHALLENGE_HTML));
    await expect(fetchSite("https://juanlentino.com/wp-json/wp/v2/posts", { expect: "json", fetchImpl, sleep: noSleep }))
      .rejects.toBeInstanceOf(SiteFetchError);
  });

  it("rejects a 200 that carries JSON where HTML was expected", async () => {
    const fetchImpl = scripted(reply(200, "application/json", '{"error":"blocked"}'));
    await expect(fetchSite("https://juanlentino.com/notes/x/", { expect: "html", fetchImpl, sleep: noSleep }))
      .rejects.toBeInstanceOf(SiteFetchError);
  });

  it("rejects a JSON content-type whose body will not parse", async () => {
    const fetchImpl = scripted(reply(200, "application/json", "not json at all"));
    await expect(fetchSite("https://juanlentino.com/wp-json/wp/v2/posts", { expect: "json", fetchImpl, sleep: noSleep }))
      .rejects.toBeInstanceOf(SiteFetchError);
  });
});

describe("fetchSite — the error is the diagnosis", () => {
  it("names the status, the content-type, the cf-ray and a body snippet", async () => {
    const fetchImpl = scripted(reply(200, "text/html; charset=UTF-8", CHALLENGE_HTML, { "cf-ray": "a250af4148af3198-MIA" }));
    const error = await fetchSite("https://juanlentino.com/wp-json/wp/v2/posts", { expect: "json", fetchImpl, sleep: noSleep })
      .catch((caught) => caught);

    expect(error.message).toContain("HTTP 200");
    expect(error.message).toContain("text/html");
    expect(error.message).toContain("a250af4148af3198-MIA");
    expect(error.message).toContain("<!DOCTYPE html>");
    expect(error.message).toContain("https://juanlentino.com/wp-json/wp/v2/posts");
  });

  it("keeps the snippet on one line and bounded, so CI logs stay readable", async () => {
    const fetchImpl = scripted(reply(200, "text/html", "<!DOCTYPE html>\n".concat("x".repeat(5000))));
    const error = await fetchSite("https://juanlentino.com/wp-json/wp/v2/posts", { expect: "json", fetchImpl, sleep: noSleep })
      .catch((caught) => caught);

    expect(error.message).not.toContain("\n");
    expect(error.message.length).toBeLessThan(600);
  });

  it("reports the status when the edge answers 415, as it did on 2026-07-29", async () => {
    const fetchImpl = scripted(reply(415, "text/html", "unsupported"));
    const error = await fetchSite("https://juanlentino.com/.well-known/provenance-keys.json", { expect: "json", fetchImpl, sleep: noSleep })
      .catch((caught) => caught);
    expect(error.message).toContain("HTTP 415");
  });
});

// Captured verbatim from run 30771742915 (2026-08-02, cf-ray …-SJC): the edge
// answered a GitHub runner's Note-page request with HTTP 200, content-type
// text/html, 12,015 bytes and this title, where the real page is ~119,000
// bytes. A content-type guard cannot see it — the challenge IS html.
const INTERSTITIAL = `<!DOCTYPE html><html><head><title>One moment, please...</title></head><body>Please wait while your request is being verified...</body></html>`;

describe("fetchSite — bot-challenge interstitials", () => {
  it("rejects the 'One moment, please...' interstitial even though it is valid HTML", async () => {
    const fetchImpl = scripted(reply(200, "text/html; charset=UTF-8", INTERSTITIAL));
    const error = await fetchSite("https://juanlentino.com/notes/x/", { expect: "html", fetchImpl, sleep: noSleep })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(SiteFetchError);
    expect(error.message).toMatch(/challenge|interstitial/i);
  });

  it("retries past a transient challenge and returns the real page", async () => {
    const realPage = `<!DOCTYPE html><html><head><title>A Note</title></head><body>${"x".repeat(2000)}</body></html>`;
    const fetchImpl = scripted(reply(200, "text/html", INTERSTITIAL), reply(200, "text/html", realPage));
    const { body } = await fetchSite("https://juanlentino.com/notes/x/", { expect: "html", fetchImpl, sleep: noSleep });
    expect(body).toBe(realPage);
  });

  it("recognises the other known interstitial titles", async () => {
    for (const title of ["Just a moment...", "Checking your browser before accessing", "Attention Required! | Cloudflare", "Sorry, you have been blocked"]) {
      const fetchImpl = scripted(reply(200, "text/html", `<html><head><title>${title}</title></head><body>wait</body></html>`));
      await expect(fetchSite("https://juanlentino.com/notes/x/", { expect: "html", fetchImpl, sleep: noSleep }))
        .rejects.toThrow(/challenge/i);
    }
  });

  it("treats a cf-mitigated header as a challenge whatever the title says", async () => {
    const fetchImpl = scripted(reply(200, "text/html", "<html><head><title>A Note</title></head><body>x</body></html>", { "cf-mitigated": "challenge" }));
    await expect(fetchSite("https://juanlentino.com/notes/x/", { expect: "html", fetchImpl, sleep: noSleep }))
      .rejects.toThrow(/challenge/i);
  });

  it("does not mistake a real Note page for a challenge", async () => {
    const realPage = `<!DOCTYPE html><html><head><title>Provenance as a CFO problem</title></head><body>${"content ".repeat(500)}</body></html>`;
    const fetchImpl = scripted(reply(200, "text/html", realPage));
    const { body } = await fetchSite("https://juanlentino.com/notes/x/", { expect: "html", fetchImpl, sleep: noSleep });
    expect(body).toBe(realPage);
  });

  it("names the challenge in the error rather than blaming the payload", async () => {
    const fetchImpl = scripted(reply(200, "text/html", INTERSTITIAL, { "cf-ray": "a250c3d3eadbcf1a-SJC" }));
    const error = await fetchSite("https://juanlentino.com/notes/x/", { expect: "html", fetchImpl, sleep: noSleep })
      .catch((caught) => caught);
    expect(error.message).toContain("a250c3d3eadbcf1a-SJC");
    expect(error.message).toContain("One moment, please");
  });
});

describe("fetchSite — bounded retry", () => {
  it("rides out a single intercepted attempt and succeeds on the retry", async () => {
    const fetchImpl = scripted(
      reply(200, "text/html", CHALLENGE_HTML),
      reply(200, "application/json", '[{"slug":"a"}]'),
    );
    const { body } = await fetchSite("https://juanlentino.com/wp-json/wp/v2/posts", { expect: "json", fetchImpl, sleep: noSleep });
    expect(body).toEqual([{ slug: "a" }]);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it("retries a non-ok status too", async () => {
    const fetchImpl = scripted(reply(415, "text/html", "nope"), reply(200, "application/json", "[]"));
    await fetchSite("https://juanlentino.com/x", { expect: "json", fetchImpl, sleep: noSleep });
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it("gives up after exactly three attempts and fails loudly", async () => {
    const fetchImpl = scripted(reply(200, "text/html", CHALLENGE_HTML));
    await expect(fetchSite("https://juanlentino.com/x", { expect: "json", fetchImpl, sleep: noSleep })).rejects.toThrow();
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it("spaces the retries instead of hammering the edge", async () => {
    const waits = [];
    const fetchImpl = scripted(reply(200, "text/html", CHALLENGE_HTML));
    await fetchSite("https://juanlentino.com/x", { expect: "json", fetchImpl, sleep: async (ms) => void waits.push(ms) }).catch(() => {});
    // Bounded on purpose: 16s worst case per URL keeps a persistently
    // challenged run inside the job's 15-minute timeout across 29 pages.
    expect(waits).toEqual([4000, 12000]);
  });

  it("does not retry a tolerated status, and reports it as absent", async () => {
    const fetchImpl = scripted(reply(404, "text/html", "not found"));
    const { response, body } = await fetchSite("https://juanlentino.com/notes/x.json", { expect: "json", tolerate: [404], fetchImpl, sleep: noSleep });
    expect(body).toBeNull();
    expect(response.status).toBe(404);
    expect(fetchImpl.calls).toHaveLength(1);
  });
});
