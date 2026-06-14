// Strategy: Jaffa Cinema. The WP "calendar" post type holds each showtime with
// the date in its title ("DD/MM/YYYY HH:MM | Film Name"); the poster image lives
// on the "screening" post type (the film), joined by film name.
import { fetchJson } from "../lib/fetchPage.js";
import { decodeEntities, israelISO, canonTitle, stripHtml } from "../lib/util.js";

export const name = "jaffa-cinema";

// Films carry subtitle suffixes the calendar omits ("– Heb subs", "Eng subs",
// "כתוביות אנגלית"). Strip them so titles match on the core film name.
const filmKey = (s) =>
  canonTitle(
    decodeEntities(s)
      .replace(/[–\-|]\s*(heb|eng|english|hebrew)?\s*subs?.*$/i, "")
      .replace(/כתוביות.*$/, "")
      .trim()
  );

export async function scrape(source) {
  const base = source.config.apiBase;

  // Map film name -> { img, desc } from the screening post type (the film page)
  const films = new Map(); // key -> { img, desc }
  for (let page = 1; page <= 7; page++) {
    let list;
    try {
      list = await fetchJson(
        `${base}/wp-json/wp/v2/screening?per_page=100&page=${page}&orderby=date&order=desc&_embed=wp:featuredmedia`
      );
    } catch { break; }
    if (!list.length) break;
    for (const f of list) {
      const img =
        f._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
        f.yoast_head_json?.og_image?.[0]?.url ||
        null;
      const desc = stripHtml(f.content?.rendered || "").slice(0, 600) || null;
      const key = filmKey(f.title?.rendered || "");
      if (key && !films.has(key)) films.set(key, { img, desc });
    }
    if (list.length < 100) break;
  }

  // exact key, else fuzzy: a stored key that contains (or is contained by) the film key
  const lookupFilm = (film) => {
    const k = filmKey(film);
    if (films.has(k)) return films.get(k);
    if (k.length >= 5) {
      for (const [pk, v] of films) if (pk.includes(k) || k.includes(pk)) return v;
    }
    return {};
  };

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
    const info = lookupFilm(film);
    out.push({
      occurrenceKey: String(c.id),
      title: film,
      description: info.desc || null,
      startsAt: israelISO(y, mo, d, hh, mm),
      bookingUrl: c.link,
      eventUrl: c.link,
      imageUrl: info.img || null,
      lang: "he",
      confidence: 1.0,
    });
  }
  return out;
}
