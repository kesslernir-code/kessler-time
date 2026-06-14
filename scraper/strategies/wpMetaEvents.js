// Strategy: WordPress custom event post type whose date lives in a meta field
// (e.g. "The Events Calendar"-style plugins). ozentelaviv: tc_events with
// meta.event_date_time = "YYYY-MM-DD HH:MM". Fully structured incl. image.
import { fetchJson } from "../lib/fetchPage.js";
import { stripHtml, decodeEntities, israelISO, todayISODate } from "../lib/util.js";

export const name = "wp-meta-events";

export async function scrape(source) {
  const { apiBase, restBase, dateField } = source.config;
  const items = await fetchJson(
    `${apiBase}/wp-json/wp/v2/${restBase}?per_page=100&orderby=date&order=desc&_embed=wp:featuredmedia`
  );
  const out = [];
  for (const it of items) {
    const raw = it.meta?.[dateField]; // "2026-06-14 21:30"
    const m = String(raw || "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) continue;
    const [, y, mo, d, hh, mm] = m.map(Number);
    out.push({
      occurrenceKey: String(it.id),
      title: decodeEntities(it.title?.rendered || "").trim(),
      description: stripHtml(it.content?.rendered || "").slice(0, 600) || null,
      startsAt: israelISO(y, mo, d, hh, mm),
      bookingUrl: it.link,
      eventUrl: it.link,
      imageUrl:
        it._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
        it.yoast_head_json?.og_image?.[0]?.url ||
        null,
      lang: "he",
      confidence: 1.0,
    });
  }
  return out;
}
