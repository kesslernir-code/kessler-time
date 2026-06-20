// Strategy: smarticket.co.il ticketing venues (e.g. Shablul Jazz). Shows are
// rendered client-side as ".show_cube" cards — each has a poster, a date
// (day + Hebrew month), a title, a short blurb and a per-show link. We render the
// page and parse the cards. Handles any <venue>.smarticket.co.il site.
import { renderPage } from "../lib/render.js";
import { decodeEntities, israelISO, inferYear, shortHash } from "../lib/util.js";

export const name = "smarticket";

const HE_MONTHS = {
  "ינואר": 1, "פברואר": 2, "מרץ": 3, "אפריל": 4, "מאי": 5, "יוני": 6,
  "יולי": 7, "אוגוסט": 8, "ספטמבר": 9, "אוקטובר": 10, "נובמבר": 11, "דצמבר": 12,
};

export async function scrape(source, log = console.error) {
  const base = new URL(source.url).origin;
  const { html } = await renderPage(source.url, { timeoutMs: 60000, scroll: true });

  const events = [];
  const cards = html.split('<div class="show_cube').slice(1); // one chunk per show card
  for (const c of cards) {
    const title = decodeEntities((c.match(/<div class="h3">([^<]+)/) || [])[1] || "").trim();
    const day = (c.match(/<span class="date">\s*(\d{1,2})/) || [])[1];
    const mon = (c.match(/<span class="date">\s*\d{1,2}\s*<span[^>]*>\s*([^<]+?)\s*</) || [])[1];
    if (!title || !day || !mon) continue;
    const mo = HE_MONTHS[(mon || "").trim()];
    if (!mo) continue;
    const y = inferYear(mo, +day);
    const time = (c.match(/\b(\d{1,2}:\d{2})\b/) || [])[1] || "20:00";
    const [hh, mm] = time.split(":").map(Number);

    const imgRaw = (c.match(/<img[^>]+src="([^"]+)"/) || [])[1] || null;
    const imageUrl = imgRaw ? (imgRaw.startsWith("http") ? imgRaw : base + imgRaw) : null;
    const href = (c.match(/<a[^>]+href="([^"]+)"/) || [])[1] || null;
    const eventUrl = href ? (href.startsWith("http") ? href : base + "/" + href.replace(/^\//, "")) : source.url;
    const brief = decodeEntities((c.match(/<div class="brief">([^<]+)/) || [])[1] || "").trim();

    events.push({
      occurrenceKey: shortHash(title + "_" + y + "-" + mo + "-" + day),
      title,
      description: brief.length > 40 ? brief : null,
      startsAt: israelISO(y, mo, +day, hh, mm),
      bookingUrl: eventUrl,
      eventUrl,
      imageUrl,
      lang: "he",
      confidence: 0.9,
    });
  }
  log(`  [${source.id}] smarticket: ${events.length} shows (${events.filter((e) => e.imageUrl).length} with image)`);
  return events;
}
