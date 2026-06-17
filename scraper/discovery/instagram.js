// Instagram discovery via Apify's instagram-scraper. IG posts are unstructured
// (caption + image, no event fields), so we fetch recent posts then let Claude
// triage which are real upcoming events — same approach as Telegram.
import { runActor } from "../lib/apify.js";
import { stripHtml, israelISO, reconcilePrice, todayISODate } from "../lib/util.js";
import { extractSocialEvents, aiConfigured } from "../lib/ai.js";
import { knownEventUrls } from "../lib/db.js";

export const platform = "instagram";

export async function discover(source, log = console.error) {
  if (!process.env.APIFY_TOKEN) {
    log(`  [${source.id}] instagram: skipped (no APIFY_TOKEN)`);
    return [];
  }
  const newerThan = new Date(Date.now() - 35 * 864e5).toISOString().slice(0, 10); // YYYY-MM-DD
  const items = await runActor("apify/instagram-scraper", {
    directUrls: [`https://www.instagram.com/${source.handle}/`],
    resultsType: "posts",
    resultsLimit: 30,
    onlyPostsNewerThan: newerThan,
  });
  log(`  [${source.id}] instagram posts: ${items.length}`);

  const known = await knownEventUrls(source.id);
  const posts = items
    .filter((p) => (p.caption || "").trim() && p.url && !known.has(p.url))
    .map((p) => ({
      url: p.url,
      caption: stripHtml(p.caption || ""),
      image: p.displayUrl || p.images?.[0] || null,
      posted: (p.timestamp || "").slice(0, 10),
    }));
  if (!posts.length) return [];
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY missing — IG discovery needs AI");

  const fields = await extractSocialEvents(
    posts.map((p, i) => ({ key: String(i), posted: p.posted, text: p.caption, links: [...p.caption.matchAll(/https?:\/\/[^\s]+/g)].map((m) => m[0]) })),
    todayISODate()
  );

  const out = [];
  posts.forEach((p, i) => {
    const f = fields.get(String(i));
    if (!f?.is_event || !f.date) return;
    const [y, mo, d] = f.date.split("-").map(Number);
    const [hh, mm] = (f.time || "20:00").split(":").map(Number);
    const { priceText, isFree } = reconcilePrice(f.price_text, f.is_free);
    out.push({
      occurrenceKey: p.url,
      title: (f.title || p.caption.split("\n")[0]).slice(0, 200),
      description: p.caption.slice(0, 600),
      startsAt: israelISO(y, mo, d, hh, mm),
      where: f.where || null,
      priceText,
      isFree,
      bookingUrl: f.booking_url || p.url,
      eventUrl: p.url,
      imageUrl: p.image,
      lang: "he",
      confidence: 0.55,
    });
  });
  log(`  [${source.id}] instagram events: ${out.length}`);
  return out;
}
