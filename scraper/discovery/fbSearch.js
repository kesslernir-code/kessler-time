// AUTONOMOUS discovery — the treasure hunter. Instead of following a fixed page,
// it SEARCHES Facebook events for under-radar happenings (parties, raves,
// galleries, performances, club nights) and keeps the upcoming Israeli ones.
// Finds events from organizers we don't even know about.
import { runActor } from "../lib/apify.js";

export const platform = "fb-search";

// Curated under-radar search terms per city (Hebrew + English). Mainstream
// arena/stadium shows rarely surface here; this targets the off-grid scene.
// Keep the list short — each query adds runtime and the sync run must finish in
// the actor timeout. These few cover parties/raves/shows/galleries broadly.
const QUERIES = {
  "Tel Aviv": ["Tel Aviv party", "Tel Aviv rave", "תל אביב מסיבה"],
  Jerusalem: ["Jerusalem party", "ירושלים מסיבה"],
};

// keep only events that are clearly in Israel (search leaks foreign results)
const ISRAELI = /israel|ישראל|תל.?אביב|tel.?aviv|jaffa|יפו|ירושלים|jerusalem|חיפה|haifa|באר.?שבע|be.?er.?sheva/i;

const firstUrl = (v) => {
  const m = JSON.stringify(v ?? "").match(/https?:\/\/[^"\\\s]+/);
  return m ? m[0] : null;
};

export async function discover(source, log = console.error) {
  const queries = QUERIES[source.city] || QUERIES["Tel Aviv"];
  const items = await runActor(
    "apify/facebook-events-scraper",
    { searchQueries: queries, maxEvents: 20 },
    { timeoutSecs: 240 }
  );
  log(`  [${source.id}] fb-search raw: ${items.length}`);

  const seen = new Set();
  const out = [];
  for (const e of items) {
    if (e.isPast || e.isCanceled || !e.name) continue;
    const iso = e.utcStartDate || e.startTime;
    if (!iso || Number.isNaN(Date.parse(iso)) || Date.parse(iso) < Date.now()) continue;
    const place = `${e.location?.name || ""} ${e.address || ""}`;
    if (!ISRAELI.test(place)) continue; // drop foreign false-positives
    const key = String(e.id || e.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      occurrenceKey: key,
      title: e.name.slice(0, 200),
      description: (e.description || "").slice(0, 600) || null,
      startsAt: new Date(iso).toISOString(),
      where: e.location?.name || e.address || null,
      priceText: null,
      isFree: null,
      bookingUrl: firstUrl(e.ticketsInfo) || firstUrl(e.externalLinks) || e.url,
      eventUrl: e.url,
      imageUrl: e.imageUrl || null,
      lang: "he",
      confidence: 0.7,
    });
  }
  log(`  [${source.id}] fb-search upcoming Israeli: ${out.length}`);
  return out;
}
