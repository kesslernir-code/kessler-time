// Strategy: WordPress REST API with a real event post type whose post date IS the
// event date (Mazkeka works this way). Fully structured — no AI needed.
import { fetchJson } from "../lib/fetchPage.js";
import { stripHtml, decodeEntities, reconcilePrice, todayISODate } from "../lib/util.js";

export const name = "wp-events-api";

export async function scrape(source) {
  const { apiBase, restBase, langFilter } = source.config;
  const after = `${todayISODate()}T00:00:00`;
  const events = [];

  for (let page = 1; page <= 5; page++) {
    let items;
    try {
      items = await fetchJson(
        `${apiBase}/wp-json/wp/v2/${restBase}?per_page=100&page=${page}&after=${after}&orderby=date&order=asc&_embed=wp:featuredmedia`
      );
    } catch (e) {
      if (page > 1 && /HTTP 400/.test(e.message)) break; // past the last page
      throw e;
    }
    if (!items.length) break;

    for (const it of items) {
      if (langFilter && it.lang && it.lang !== langFilter) continue;
      const meta = it; // mazkeka exposes event_meta_* at the top level
      const { priceText, isFree } = reconcilePrice(meta.event_meta_price, meta.event_meta_free === "1" || undefined);
      events.push({
        occurrenceKey: String(it.id),
        title: decodeEntities(it.title?.rendered || "").trim(),
        description: stripHtml(meta.event_meta_description || it.content?.rendered || "").slice(0, 600),
        // it.date is local Israel wall-clock (e.g. "2026-08-01T21:00:00"); offset added in normalize
        localDateTime: it.date,
        priceText,
        isFree,
        bookingUrl: meta.event_meta_tickets || null,
        eventUrl: it.link,
        imageUrl:
          it._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
          it.yoast_head_json?.og_image?.[0]?.url ||
          null,
        lang: it.lang || "he",
        confidence: 1.0,
      });
    }
    if (items.length < 100) break;
  }
  return events;
}
