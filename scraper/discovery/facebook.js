// Facebook discovery via Apify's facebook-events-scraper. Facebook blocks direct
// access, but this actor returns STRUCTURED events (name, date, image, location,
// tickets) — so no AI needed, just map the fields.
import { runActor } from "../lib/apify.js";

export const platform = "facebook";

const firstUrl = (v) => {
  const s = JSON.stringify(v ?? "");
  const m = s.match(/https?:\/\/[^"\\\s]+/);
  return m ? m[0] : null;
};

export async function discover(source, log = console.error) {
  // handle may be a page slug or numeric id; scrape its events page
  const startUrls = [`https://www.facebook.com/${source.handle}/upcoming_hosted_events`];
  const items = await runActor("apify/facebook-events-scraper", { startUrls, maxEvents: 40 });
  log(`  [${source.id}] facebook events: ${items.length}`);

  const out = [];
  for (const e of items) {
    if (e.isPast || e.isCanceled || !e.name) continue;
    const iso = e.utcStartDate || e.startTime; // ISO UTC
    if (!iso || Number.isNaN(Date.parse(iso))) continue;
    const ticket =
      firstUrl(e.ticketsInfo) ||
      firstUrl(e.externalLinks) ||
      e.url; // fall back to the FB event page
    out.push({
      occurrenceKey: String(e.id || e.url),
      title: e.name.slice(0, 200),
      description: (e.description || "").slice(0, 600) || null,
      startsAt: new Date(iso).toISOString(),
      where: e.location?.name || e.address || null,
      priceText: null,
      isFree: null,
      bookingUrl: ticket,
      eventUrl: e.url,
      imageUrl: e.imageUrl || null,
      lang: "he",
      confidence: 0.75,
    });
  }
  log(`  [${source.id}] facebook upcoming: ${out.length}`);
  return out;
}
