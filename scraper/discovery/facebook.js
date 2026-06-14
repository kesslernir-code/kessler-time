// Facebook discovery via Apify. Two paths, because venues use FB inconsistently:
//   1. facebook-events-scraper on /events — structured FB Event objects (no AI)
//   2. if none upcoming, facebook-posts-scraper + AI triage — many venues now
//      announce events as regular posts, not Event objects
import { runActor } from "../lib/apify.js";
import { stripHtml, israelISO, reconcilePrice, todayISODate } from "../lib/util.js";
import { extractSocialEvents, aiConfigured } from "../lib/ai.js";
import { knownEventUrls } from "../lib/db.js";

export const platform = "facebook";

const firstUrl = (v) => {
  const m = JSON.stringify(v ?? "").match(/https?:\/\/[^"\\\s]+/);
  return m ? m[0] : null;
};

async function structuredEvents(handle, log, id) {
  const items = await runActor("apify/facebook-events-scraper", {
    startUrls: [`https://www.facebook.com/${handle}/events`],
    maxEvents: 40,
  });
  const out = [];
  for (const e of items) {
    if (e.isPast || e.isCanceled || !e.name) continue;
    const iso = e.utcStartDate || e.startTime;
    if (!iso || Number.isNaN(Date.parse(iso))) continue;
    out.push({
      occurrenceKey: String(e.id || e.url),
      title: e.name.slice(0, 200),
      description: (e.description || "").slice(0, 600) || null,
      startsAt: new Date(iso).toISOString(),
      where: e.location?.name || e.address || null,
      priceText: null, isFree: null,
      bookingUrl: firstUrl(e.ticketsInfo) || firstUrl(e.externalLinks) || e.url,
      eventUrl: e.url,
      imageUrl: e.imageUrl || null,
      lang: "he", confidence: 0.8,
    });
  }
  log(`  [${id}] fb structured events: ${out.length}`);
  return out;
}

async function eventsFromPosts(handle, source, log) {
  const newer = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const items = await runActor("apify/facebook-posts-scraper", {
    startUrls: [{ url: `https://www.facebook.com/${handle}` }],
    resultsLimit: 25,
    onlyPostsNewerThan: newer,
  });
  const known = await knownEventUrls(source.id);
  const posts = items
    .filter((p) => (p.text || p.message) && (p.url || p.postUrl) && !known.has(p.url || p.postUrl))
    .map((p) => ({
      url: p.url || p.postUrl,
      text: stripHtml(p.text || p.message || ""),
      image: firstUrl(p.media) || p.imageUrl || p.photoUrl || null,
      posted: String(p.time || p.timestamp || p.date || "").slice(0, 10),
    }));
  if (!posts.length) { log(`  [${source.id}] fb posts: 0 recent`); return []; }
  if (!aiConfigured()) return [];

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
  log(`  [${source.id}] fb events from posts: ${out.length}`);
  return out;
}

export async function discover(source, log = console.error) {
  const events = await structuredEvents(source.handle, log, source.id);
  if (events.length) return events;
  // no structured upcoming events — try recent posts (how active venues announce now)
  return eventsFromPosts(source.handle, source, log);
}
