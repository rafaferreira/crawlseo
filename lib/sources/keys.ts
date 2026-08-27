/**
 * Match keys used to line the same query or page up across sources.
 *
 * Sources spell things differently and there is no shared id, so the key has
 * to absorb the differences that are notation rather than meaning - and only
 * those. "laudo tecnico" and "laudo técnico" stay separate: people really do
 * type both, and each engine reports them as distinct searches.
 */

/**
 * Accents can arrive composed (NFC) or decomposed (NFD) depending on the
 * source, and the two look identical while comparing unequal. Internal runs of
 * whitespace are collapsed for the same reason.
 */
export function normaliseQueryKey(query: string): string {
  return query.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * A site's properties are often different URL forms of each other (measured:
 * Bing knows periciatecnica.eng.br, Search Console knows www.periciatecnica…),
 * so scheme and www cannot be part of the key. Percent encoding is decoded
 * because only one source usually applies it.
 *
 * What stays significant: path case, because URLs are case sensitive, and the
 * trailing slash, because sources report `/page` and `/page/` as two rows and
 * they really are two URLs - folding them here would merge two rows a
 * single-source install can see today, and hide exactly the duplicate the
 * crawler exists to find.
 */
export function normaliseUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let path = parsed.pathname;
    try {
      path = decodeURI(path);
    } catch {
      // Leave a malformed escape sequence as it came.
    }
    return `${host}${path.normalize("NFC")}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}
