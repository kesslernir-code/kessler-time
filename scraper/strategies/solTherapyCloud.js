// Strategy: sol-therapy.com/cloud (CLOUD SPACE). The page's only structured
// Event JSON-LD is one bogus 3-month summary listing every performer at once —
// the real per-session dates only exist as plain <article class="lp-card">
// blocks (both the sound-meditation lineup and the workshops section use the
// same markup), which auto-ladder's ladder never reached once JSON-LD gave it
// "an" answer. No render needed — the data is in the static HTML.
import { fetchText } from "../lib/fetchPage.js";
import { decodeEntities, israelISO, inferYear } from "../lib/util.js";

export const name = "sol-therapy-cloud";

export async function scrape(source, log = console.error) {
  const origin = new URL(source.url).origin;
  const html = await fetchText(source.url);
  const cards = html.split('<article class="lp-card"').slice(1);

  const events = [];
  for (const c of cards) {
    const slug = (c.match(/^\s*data-slug="([^"]+)"/) || [])[1];
    const name = decodeEntities((c.match(/<h3 class="lp-card__name">([^<]+)/) || [])[1] || "").trim();
    const day = (c.match(/<span class="w-num"[^>]*>([^<]+)</) || [])[1] || "";
    const [d, mo] = day.split(".").map(Number);
    const time = (c.match(/<span class="w-time"[^>]*>([^<]+)</) || [])[1] || "20:30";
    if (!slug || !name || !d || !mo) continue;
    const y = inferYear(mo, d);
    const [hh, mm] = time.split(":").map(Number);
    const img = (c.match(/<img[^>]+src="([^"]+)"/) || [])[1];
    const bookingUrl = (c.match(/<a class="lp-card__btn[^"]*"[^>]+href="([^"]+)"/) || [])[1] || source.url;
    events.push({
      occurrenceKey: slug,
      title: name,
      startsAt: israelISO(y, mo, d, hh, mm),
      bookingUrl,
      eventUrl: source.url,
      imageUrl: img ? new URL(img, origin + "/").href : null,
      lang: "he",
      confidence: 0.95,
    });
  }
  log(`  [${source.id}] sol-therapy-cloud: ${cards.length} cards -> ${events.length} events (${events.filter((e) => e.imageUrl).length} imaged)`);
  return events;
}
