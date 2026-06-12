// Strategy: a listing page links to per-event detail pages (href contains
// "/event"), optionally with ?sd=<unix>&ed=<unix> timestamps (common WP
// calendar plugins — Levontin 7 works this way). The listing gives URL + date;
// each NEW event's detail page is fetched once and a single batched Claude
// call extracts time / price / ticket link from its focused text.
import { fetchText } from "../lib/fetchPage.js";
import { stripHtml, decodeEntities, israelISO, reconcilePrice, todayISODate, findTicketLink } from "../lib/util.js";
import { extractFieldsBatch, aiConfigured } from "../lib/ai.js";
import { knownEventUrls } from "../lib/db.js";

export const name = "listing-detail-ai";

const ilDateOf = (epochSec) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(epochSec * 1000));

// Template images (logos, icons, sponsors) must never become an event poster
const IMG_BLACKLIST = /logo|icon|favicon|placeholder|blank|spinner|loading|sponsor|footer|header/i;
const IMG_SRC = /(?:data-lazy-src|data-src|src)="\s*(https?:\/\/[^"\s]+\.(?:jpe?g|png|webp)[^"\s]*)"/g;

/** Poster candidate printed on the listing just before this event's link. */
function listingImageNear(listing, linkRaw) {
  const idx = listing.indexOf(linkRaw);
  if (idx === -1) return null;
  const seg = listing.slice(Math.max(0, idx - 2200), idx);
  const imgs = [...seg.matchAll(IMG_SRC)].map((m) => m[1]).filter((u) => !IMG_BLACKLIST.test(u));
  return imgs.pop() || null; // nearest one above the link
}

export async function scrape(source, log = console.error) {
  const listing = await fetchText(source.url);
  const base = new URL(source.url).origin;

  // Collect event links (+ sd date hint and nearby poster), newest occurrence wins
  const found = new Map(); // cleanUrl -> { sd, listImg }
  for (const m of listing.matchAll(/href="(https?:\/\/[^"]*\/event[^"]*)"/g)) {
    const raw = decodeEntities(m[1]);
    if (!raw.startsWith(base)) continue;
    const u = new URL(raw);
    const sd = Number(u.searchParams.get("sd")) || null;
    const clean = u.origin + u.pathname;
    const prev = found.get(clean) || {};
    found.set(clean, { sd: prev.sd || sd, listImg: prev.listImg || listingImageNear(listing, m[1]) });
  }
  log(`  [${source.id}] listing links: ${found.size}`);

  const known = await knownEventUrls(source.id);
  const fresh = [...found].filter(([url]) => !known.has(url));
  if (!fresh.length) return [];
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY missing — this source needs AI extraction");

  // Fetch each new detail page (politely)
  const details = [];
  for (const [url, { sd, listImg }] of fresh) {
    try {
      const html = await fetchText(url, { retries: 0, timeoutMs: 20000 });
      // decode FIRST so "&#8211;" becomes "–" before we split the site-name suffix off
      const title = decodeEntities(html.match(/<title>([^<]+)<\/title>/)?.[1] || "")
        .split(/[–|]/)[0]
        .trim();
      details.push({
        url, sd, html, title, listImg,
        text: stripHtml(html).slice(0, 1400),
        detailImgs: [...html.matchAll(IMG_SRC)].map((m) => m[1]).filter((u) => !IMG_BLACKLIST.test(u)),
      });
      await new Promise((r) => setTimeout(r, 250));
    } catch (e) {
      log(`  [${source.id}] detail fetch failed: ${url} (${e.message})`);
    }
  }

  // An image appearing on many detail pages is site template (logo, sponsors) —
  // never an event poster. The listing's per-event poster always wins.
  const freq = new Map();
  for (const d of details) for (const u of new Set(d.detailImgs)) freq.set(u, (freq.get(u) || 0) + 1);
  const isCommon = (u) => details.length >= 3 && (freq.get(u) || 0) > details.length * 0.4;
  for (const d of details) d.image = d.listImg || d.detailImgs.find((u) => !isCommon(u)) || null;

  // Short numeric keys + chunks of 20 keep each Claude response well under its size limit
  const fields = new Map();
  for (let i = 0; i < details.length; i += 20) {
    const chunk = details.slice(i, i + 20);
    const out = await extractFieldsBatch(
      chunk.map((d, j) => ({
        key: String(i + j),
        title: d.title,
        text: d.text,
        links: [...d.html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((l) => !l.startsWith(base)).slice(0, 4),
      })),
      todayISODate()
    );
    for (const [k, v] of out) fields.set(k, v);
  }

  const events = [];
  for (const [idx, d] of details.entries()) {
    const f = fields.get(String(idx)) || {};
    const date = f.date || (d.sd ? ilDateOf(d.sd) : null);
    if (!d.title || !date) continue;
    const [y, mo, day] = date.split("-").map(Number);
    const [hh, mm] = (f.time || "20:00").split(":").map(Number);
    const { priceText, isFree } = reconcilePrice(f.price_text, f.is_free);
    // The longest paragraph of a detail page is almost always the event description
    const description =
      d.text.split("\n").reduce((a, b) => (b.trim().length > a.length ? b.trim() : a), "").slice(0, 400) || null;
    events.push({
      occurrenceKey: d.url + "_" + date,
      title: d.title,
      description: description && description.length > 60 ? description : null,
      startsAt: israelISO(y, mo, day, hh, mm),
      priceText,
      isFree,
      bookingUrl: findTicketLink(d.html) || f.booking_url || d.url,
      eventUrl: d.url,
      imageUrl: d.image,
      lang: "he",
      confidence: 0.85,
    });
  }
  return events;
}
