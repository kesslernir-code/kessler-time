// Strategy: Jaffa Cinema. The WP "calendar" post type holds each showtime with
// the date in its title ("DD/MM/YYYY HH:MM | Film Name"); the poster image lives
// on the "screening" post type (the film), joined by film name.
import { fetchJson } from "../lib/fetchPage.js";
import { decodeEntities, israelISO, canonTitle } from "../lib/util.js";

export const name = "jaffa-cinema";

export async function scrape(source) {
  const base = source.config.apiBase;

  // Map film name -> poster image, from the screening post type
  const posters = new Map();
  for (let page = 1; page <= 4; page++) {
    let films;
    try {
      films = await fetchJson(
        `${base}/wp-json/wp/v2/screening?per_page=100&page=${page}&orderby=date&order=desc&_embed=wp:featuredmedia`
      );
    } catch { break; }
    if (!films.length) break;
    for (const f of films) {
      const img =
        f._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
        f.yoast_head_json?.og_image?.[0]?.url ||
        null;
      const key = canonTitle(decodeEntities(f.title?.rendered || ""));
      if (key && img && !posters.has(key)) posters.set(key, img);
    }
    if (films.length < 100) break;
  }

  // Showtimes from the calendar post type (recently published ≈ upcoming)
  const cal = await fetchJson(
    `${base}/wp-json/wp/v2/calendar?per_page=100&orderby=date&order=desc`
  );
  const out = [];
  for (const c of cal) {
    const title = decodeEntities(c.title?.rendered || "");
    // "14/06/2026 19:00 | ממלכת אור הירח"
    const m = title.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*[|\-–]\s*(.+)$/);
    if (!m) continue;
    const [, d, mo, y, hh, mm] = m.map(Number);
    const film = m[6].trim();
    out.push({
      occurrenceKey: String(c.id),
      title: film,
      description: null,
      startsAt: israelISO(y, mo, d, hh, mm),
      bookingUrl: c.link,
      eventUrl: c.link,
      imageUrl: posters.get(canonTitle(film)) || null,
      lang: "he",
      confidence: 1.0,
    });
  }
  return out;
}
