import { describe, expect, it } from "vitest";
import { extractPostContent } from "./extract-content.mjs";
import { normalizeV1 } from "./sn-normalize-v1.mjs";

describe("extractPostContent", () => {
  it("isolates the post, restores block breaks, and excludes provenance UI", () => {
    const page = '<header>noise</header><div class="entry-content wp-block-post-content"><p>One.</p><div><p>Two &amp; three.</p></div><aside class="sn-prov-panel">unsigned</aside></div><footer>noise</footer>';
    expect(normalizeV1(extractPostContent(page))).toBe("One.\n\nTwo & three.");
  });

  it("supports class reordering and a share boundary", () => {
    const page = "<div class='wp-block-post-content x entry-content'><h2>A</h2><p>B</p><div class='sn-note-share'>share</div></div>";
    expect(normalizeV1(extractPostContent(page))).toBe("A\n\nB");
  });

  it("removes only the generated article table of contents", () => {
    const page = '<div class="entry-content wp-block-post-content"><nav class="sn-article-toc" aria-label="Table of contents"><p class="sn-article-toc__label">Contents</p><ol><li><a href="#one">One</a></li></ol></nav><p>Body.</p></div>';
    expect(normalizeV1(extractPostContent(page))).toBe("Body.");
  });

  it("fails closed when no provenance-bearing region exists", () => {
    expect(() => extractPostContent("<main><p>no match</p></main>")).toThrow(/not found/);
  });
});
