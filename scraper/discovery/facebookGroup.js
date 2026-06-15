// Facebook GROUP discovery via Apify — group posts are a great under-radar source
// (party crews, scene groups announce events there). Posts → AI triage.
import { runActor } from "../lib/apify.js";
import { stripHtml, israelISO, reconcilePrice, todayISODate } from "../lib/util.js";
import { extractSocialEvents, aiConfigured } from "../lib/ai.js";
import { knownEventUrls } from "../lib/db.js";

export const platform = "fb-group";

export async function discover(source, log = console.error) {
  const newer = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const items = await runActor("apify/facebook-groups-scraper", {
    startUrls: [{ url: `https://www.facebook.com/groups/${source.handle}` }],
    resultsLimit: 30,
    onlyPostsNewerThan: newer,
  });
  log(`  [${source.id}] fb-group posts: ${items.length}`);

  const known = await knownEventUrls(source.id);
  const posts = items
    .filter((p) => (p.text || p.message) && (p.url || p.postUrl) && !known.has(p.url || p.postUrl))
    .map((p) => ({
      url: p.url || p.postUrl,
      text: stripHtml(p.text || p.message || ""),
      image: (JSON.stringify(p.media ?? "").match(/https?:\/\/[^"\\\s]+\.(?:jpe?g|png|webp)/) || [])[0] || null,
      posted: String(p.time || p.timestamp || p.date || "").slice(0, 10),
    }));
  if (!posts.length) return [];
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY missing — group discovery needs AI");

  const fields = await extractSocialEvents(
    posts.map((p, i) => ({ key: String(i), posted: p.posted, text: p.text, links: [...p.text.matchAll(/https?:\/\/[^\s]+/g)].map((m) => m[0]) })),
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
      title: (f.title || p.text.split("\n")[0]).slice(0, 200),
      description: p.text.slice(0, 600),
      startsAt: israelISO(y, mo, d, hh, mm),
      where: f.where || null, priceText, isFree,
      bookingUrl: f.booking_url || p.url, eventUrl: p.url,
      imageUrl: p.image, lang: "he", confidence: 0.55,
    });
  });
  log(`  [${source.id}] fb-group events: ${out.length}`);
  return out;
}
