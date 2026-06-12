// Strategy: WP REST API gives the event list (title, image, link) but the date
// only exists inside the Hebrew announcement text (Matmon works this way).
// Claude reads date/time/price out of the text — in ONE batched call, and only
// for events we haven't seen before, so the AI cost is near zero per run.
import { fetchJson } from "../lib/fetchPage.js";
import { stripHtml, decodeEntities, israelISO, reconcilePrice, todayISODate, findTicketLink } from "../lib/util.js";
import { extractFieldsBatch, aiConfigured } from "../lib/ai.js";
import { knownEventUrls } from "../lib/db.js";

export const name = "wp-api+ai-date";

export async function scrape(source) {
  const { apiBase, restBase } = source.config;
  // Most recently published first — venues announce upcoming events, so 60 covers the future window.
  const items = await fetchJson(
    `${apiBase}/wp-json/wp/v2/${restBase}?per_page=60&orderby=date&order=desc&_embed=wp:featuredmedia`
  );

  const known = await knownEventUrls(source.id);
  // Skip announcements older than 60 days: venues announce shortly before the
  // event, and without this every run re-sends long-past posts to Claude.
  const cutoff = Date.now() - 60 * 864e5;
  const fresh = items.filter(
    (it) => !known.has(it.link) && Date.parse((it.date_gmt || it.date) + "Z") > cutoff
  );
  if (!fresh.length) return [];
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY missing — this source needs AI date extraction");

  const batch = fresh.map((it) => ({
    key: String(it.id),
    title: decodeEntities(it.title?.rendered || ""),
    text: stripHtml(it.content?.rendered || ""),
    links: [...(it.content?.rendered || "").matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]),
  }));
  const fields = await extractFieldsBatch(batch, todayISODate());

  const events = [];
  for (const it of fresh) {
    const f = fields.get(String(it.id));
    if (!f?.date) continue; // no real date in the announcement — skip rather than guess
    const [y, mo, d] = f.date.split("-").map(Number);
    const [hh, mm] = (f.time || "20:00").split(":").map(Number);
    const { priceText, isFree } = reconcilePrice(f.price_text, f.is_free);
    events.push({
      occurrenceKey: String(it.id),
      title: decodeEntities(it.title?.rendered || "").trim(),
      description: stripHtml(it.content?.rendered || "").slice(0, 600),
      startsAt: israelISO(y, mo, d, hh, mm),
      priceText,
      isFree,
      // prefer a ticketing-platform link, then Claude's pick of a registration link, then the event page
      bookingUrl: findTicketLink(it.content?.rendered) || f.booking_url || it.link,
      eventUrl: it.link,
      imageUrl:
        it._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
        it.yoast_head_json?.og_image?.[0]?.url ||
        null,
      lang: "he",
      confidence: 0.8,
    });
  }
  return events;
}
