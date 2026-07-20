/**
 * Recover the provenance-bearing post body from a rendered WordPress page.
 *
 * WordPress removes Gutenberg's source newlines when it renders blocks.  The
 * normalizer intentionally does not invent whitespace, so we restore a
 * deterministic double newline after the block elements whose closing tags
 * correspond to raw post_content boundaries.  This makes the result
 * normalization-equivalent to the public post_content without trusting a
 * private WordPress export.
 */
export function extractPostContent(pageHtml) {
  const html = String(pageHtml);
  const opening = findPostContentOpeningTag(html);
  if (!opening) throw new Error("post content div not found");

  const bodyStart = opening.index + opening.tag.length;
  const divEnd = findMatchingDivEnd(html, opening.index);
  let bodyEnd = divEnd;

  const boundary = /<(?:[a-z][^>]*\bclass=(?:"[^"]*\b(?:sn-prov|sn-note-share)[^\"]*"|'[^']*\b(?:sn-prov|sn-note-share)[^']*')|footer\b)/gi;
  boundary.lastIndex = bodyStart;
  const match = boundary.exec(html);
  if (match && match.index < bodyEnd) bodyEnd = match.index;

  return html
    .slice(bodyStart, bodyEnd)
    // HTML optimizers collapse source whitespace inside inline diagrams.
    // Re-expand element boundaries, and preserve section breaks carried by
    // the diagram's heading class, before tags are stripped by normalize-v1.
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, (svg) => svg
      .replace(/>\s*</g, ">\n<")
      .replace(/(<text\b[^>]*\bclass=(?:"[^"]*heading[^"]*"|'[^']*heading[^']*')[^>]*>)/gi, "\n$1")
      .replace(/(<text\b[^>]*\bfont-style=(?:"italic"|'italic')[^>]*>)/gi, "\n$1"))
    .replace(/<\/(p|h[1-6]|blockquote|li|ul|ol|figure|svg)>/gi, "</$1>\n\n");
}

function findPostContentOpeningTag(html) {
  const re = /<div\b[^>]*>/gi;
  for (const match of html.matchAll(re)) {
    const classMatch = match[0].match(/\bclass=(?:"([^"]*)"|'([^']*)')/i);
    if (!classMatch) continue;
    const classes = (classMatch[1] ?? classMatch[2]).split(/\s+/);
    if (classes.includes("entry-content") && classes.includes("wp-block-post-content")) {
      return { index: match.index, tag: match[0] };
    }
  }
  return null;
}

function findMatchingDivEnd(html, openingIndex) {
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = openingIndex;
  let depth = 0;
  for (let match = tags.exec(html); match; match = tags.exec(html)) {
    if (/^<\/div/i.test(match[0])) {
      depth -= 1;
      if (depth === 0) return match.index;
    } else {
      depth += 1;
    }
  }
  throw new Error("post content div is not balanced");
}
