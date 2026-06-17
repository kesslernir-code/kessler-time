// Strategy: "The Events Calendar" (Tribe) WordPress plugin REST API.
// Endpoint /wp-json/tribe/events/v1/events returns fully structured events —
// title, start_date (local wall-clock), url, image, cost, description.
// Used by gagarin.co.il and any other Tribe-powered venue.
import { fetchJson } from "../lib/fetchPage.js";
import { stripHtml, decodeEntities, reconcilePrice, todayISODate } from "../lib/util.js";

export const name = "tribe-events";

export async function scrape(source, log = console.error) {
  const base = source.config?.apiBase || new URL(source.url).origin;
  const events = [];

  for (let page = 1; page <= 5; page++) {
    let data;
    try {
      data = await fetchJson(
        `${base}/wp-json/tribe/events/v1/events?per_page=50&page=${page}&start_date=${todayISODate()}`
      );
    } catch (e) {
      if (page > 1) break; // past the last page (Tribe 400s beyond total_pages)
      throw e;
    }
    const list = data?.events || [];
    if (!list.length) break;

    for (const ev of list) {
      const title = decodeEntities(ev.title || "").trim();
      if (!title || !ev.start_date) continue;
      const { priceText, isFree } = reconcilePrice(ev.cost || null);
      events.push({
        occurrenceKey: String(ev.id ?? ev.url),
        title,
        description: stripHtml(ev.description || "").slice(0, 600) || null,
        // "2026-06-20 21:00:00" local Israel wall-clock; offset added in normalize
        localDateTime: String(ev.start_date).replace(" ", "T"),
        priceText,
        isFree,
        bookingUrl: ev.website || ev.url || null,
        eventUrl: ev.url || null,
        imageUrl: ev.image?.url || ev.image || null,
        lang: "he",
        confidence: 1.0,
      });
    }
    if (data.total_pages && page >= data.total_pages) break;
  }
  log(`  [${source.id}] tribe-events: ${events.length} events (${events.filter(e => e.imageUrl).length} with image)`);
  return events;
}
