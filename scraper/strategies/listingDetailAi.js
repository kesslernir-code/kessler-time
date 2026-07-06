// Strategy: a listing page links to per-event detail pages (href contains
// "/event"), optionally with ?sd=<unix>&ed=<unix> timestamps (common WP
// calendar plugins — Levontin 7 works this way). The listing gives URL + date;
// each NEW event's detail page is fetched once and a single batched Claude
// call extracts time / price / ticket link from its focused text.
import { fetchText } from "../lib/fetchPage.js";
import { renderPage } from "../lib/render.js";
import { stripHtml, decodeEntities, israelISO, reconcilePrice, todayISODate, findTicketLink, isJunkImageUrl, titlesSimilar } from "../lib/util.js";
import { extractFieldsBatch, aiConfigured } from "../lib/ai.js";
import { knownEventUrls, touchEvents } from "../lib/db.js";

export const name = "listing-detail-ai";

const ilDateOf = (epochSec) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(epochSec * 1000));

// Template images (logos, icons, sponsors) must never become an event poster
const IMG_BLACKLIST = /logo|icon|favicon|placeholder|blank|spinner|loading|sponsor|footer|header/i;
const IMG_SRC = /(?:data-lazy-src|data-src|src)="\s*(https?:\/\/[^"\s]+\.(?:jpe?g|png|webp)[^"\s]*)"/g;

/** Poster candidate printed on the listing just before this event's link.
 *  `minIdx` bounds the lookback at the previous event link's position, so a
 *  compact grid (cards closer together than 2200 chars) can't bleed the
 *  PREVIOUS card's image into this one — a real bug on hamecarer's tight
 *  "now showing" grid, where the wrong exhibition's poster got picked. */
function listingImageNear(listing, linkRaw, minIdx = 0) {
  const idx = listing.indexOf(linkRaw);
  if (idx === -1) return null;
  const seg = listing.slice(Math.max(0, idx - 2200, minIdx), idx);
  const imgs = [...seg.matchAll(IMG_SRC)].map((m) => m[1]).filter((u) => !IMG_BLACKLIST.test(u));
  return imgs.pop() || null; // nearest one above the link
}

/** A detail page's own JSON-LD Event, when present (Wix event pages have one):
 *  exact start/end (with timezone) and poster image — free, no AI needed. */
function jsonLdEvent(html) {
  for (const m of html.matchAll(/<script[^>]+ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j;
    try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes = Array.isArray(j) ? j : [j, ...(j["@graph"] || [])];
    for (const n of nodes) {
      if (!n || !/Event/i.test(String(n["@type"])) || !n.startDate) continue;
      const img = typeof n.image === "string" ? n.image : n.image?.url || (Array.isArray(n.image) ? n.image[0] : null);
      return { start: String(n.startDate), end: n.endDate ? String(n.endDate) : null, image: img || null };
    }
  }
  return null;
}

export async function scrape(source, log = console.error) {
  const listing = await fetchText(source.url);
  const base = new URL(source.url).origin;

  // Which detail-page path segment links to the per-item pages. Defaults to
  // "event" (Levontin 7's /events/<slug>); set config.linkPath (e.g.
  // "exhibition") for sites that use a different segment.
  const linkPath = source.config?.linkPath || "event";
  const linkRe = new RegExp(`href="(https?://[^"]*/${linkPath}[^"]*)"`, "g");
  // Some sites (WPML/artport) 500 on the bare detail URL and need their query
  // string (?lang=en) kept; others (Levontin 7) put a per-occurrence sd= stamp
  // in the query that must be stripped so occurrences dedupe. config.keepQuery
  // toggles which behaviour applies.
  const keepQuery = Boolean(source.config?.keepQuery);
  // Some sites inject the actual event date into the DOM via client-side JS (React/
  // Vue) — a static fetch of the detail page never shows it. config.renderDetail
  // renders each detail page in a headless browser instead (batsheva's repertory
  // pages show "המופע הקרוב: <date>" only after hydration).
  const renderDetail = Boolean(source.config?.renderDetail);
  // Evergreen detail pages (a permanent page per repertory work, not per-occurrence)
  // keep the same URL forever while their "next performance" date changes over
  // time — the normal known-URL skip would freeze the date at whatever it was on
  // first scrape. config.alwaysRefresh re-fetches every listed page every run so a
  // new date is caught; occurrenceKey (url+date) still dedupes same-date reruns.
  const alwaysRefresh = Boolean(source.config?.alwaysRefresh);

  // Collect event links (+ sd date hint and nearby poster), newest occurrence wins.
  // A nav link back to the listing page itself can share the linkPath segment
  // (e.g. a "תערוכות" menu item pointing at /exhibitions/), and so can its own
  // pagination (/exhibitions/page/2/) — both get treated as bogus "detail pages"
  // otherwise, one of which produces a fake event titled after the listing itself.
  const listingPath = new URL(source.url).pathname.replace(/\/$/, "");
  const listingPagingRe = new RegExp(`^${listingPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/page/\\d+$`);
  const isListingOwnUrl = (pathname) => {
    const p = pathname.replace(/\/$/, "");
    return p === listingPath || listingPagingRe.test(p);
  };
  const found = new Map(); // cleanUrl -> { sd, listImg }
  let prevLinkEnd = 0;
  for (const m of listing.matchAll(linkRe)) {
    const raw = decodeEntities(m[1]);
    if (!raw.startsWith(base)) continue;
    const u = new URL(raw);
    if (isListingOwnUrl(u.pathname)) continue;
    const sd = Number(u.searchParams.get("sd")) || null;
    const clean = u.origin + u.pathname + (keepQuery ? u.search : "");
    const prev = found.get(clean) || {};
    found.set(clean, { sd: prev.sd || sd, listImg: prev.listImg || listingImageNear(listing, m[1], prevLinkEnd) });
    prevLinkEnd = m.index + m[0].length;
  }
  log(`  [${source.id}] listing links: ${found.size}`);

  const known = await knownEventUrls(source.id);
  const fresh = alwaysRefresh ? [...found] : [...found].filter(([url]) => !known.has(url));
  // Events we already have but are still on the listing: refresh their last_seen_at
  // so the stale-prune keeps them. (We skip re-fetching/AI for them to save cost,
  // but they must not be treated as gone.) Skipped for alwaysRefresh sources since
  // every listed page is re-fetched anyway.
  if (!alwaysRefresh) {
    const stillListed = [...found.keys()].map((u) => known.get(u)).filter(Boolean);
    await touchEvents(stillListed);
  }
  if (!fresh.length) return [];
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY missing — this source needs AI extraction");

  // Fetch each new detail page (politely)
  const details = [];
  for (const [url, { sd, listImg }] of fresh) {
    try {
      let html, renderImages = [];
      if (renderDetail) {
        const r = await renderPage(url, { timeoutMs: 30000, scroll: true });
        html = r.html; renderImages = r.images;
      } else {
        html = await fetchText(url, { retries: 0, timeoutMs: 20000 });
      }
      // decode FIRST so "&#8211;" becomes "–" before we split the site-name suffix off.
      // A bare "-" only counts as a separator surrounded by spaces (WordPress's
      // default "Title - Site Name") so a hyphenated word inside a real title
      // (rare, but possible) isn't chopped in half.
      const title = decodeEntities(html.match(/<title>([^<]+)<\/title>/)?.[1] || "")
        .split(/\s[-–]\s|\|/)[0]
        .trim();
      const ogImg = (html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i) || [])[1] || null;
      details.push({
        url, sd, html, title, listImg, ogImg, renderImages,
        ld: jsonLdEvent(html),
        text: stripHtml(html).slice(0, 1400),
        detailImgs: [...html.matchAll(IMG_SRC)].map((m) => m[1]).filter((u) => !IMG_BLACKLIST.test(u)),
      });
      if (!renderDetail) await new Promise((r) => setTimeout(r, 250));
    } catch (e) {
      log(`  [${source.id}] detail fetch failed: ${url} (${e.message})`);
    }
  }

  // An image appearing on many detail pages is site template (logo, sponsors) —
  // never an event poster. The listing's per-event poster wins; then the page's
  // own og:image / JSON-LD image (reliable, single per page); then a content <img>.
  const freq = new Map();
  for (const d of details) for (const u of new Set(d.detailImgs)) freq.set(u, (freq.get(u) || 0) + 1);
  const isCommon = (u) => details.length >= 3 && (freq.get(u) || 0) > details.length * 0.4;
  const ogShared = new Map(); // an og:image repeated across pages is a site banner, not a poster
  for (const d of details) if (d.ogImg) ogShared.set(d.ogImg, (ogShared.get(d.ogImg) || 0) + 1);
  const ogOk = (u) => u && !isJunkImageUrl(u) && !IMG_BLACKLIST.test(u) && !(details.length >= 3 && (ogShared.get(u) || 0) > details.length * 0.4);
  // A "related posts" widget can put another event's thumbnail earlier in the DOM
  // than the page's own content image (hamecarer's exhibition pages do this) — so
  // among non-common candidates, prefer one whose filename (WordPress usually names
  // uploads after the post title) actually matches this event's title.
  const filenameMatchesTitle = (url, title) => {
    const name = decodeURIComponent(url).split("/").pop().replace(/\.\w+$/, "").replace(/-\d+x\d+$/, "");
    return titlesSimilar(name.replace(/[-_]/g, " "), title);
  };
  for (const d of details) {
    // A title match is checked against ALL of the page's images, not just the
    // non-common ones: a "related exhibitions" widget can make a page's OWN photo
    // repeat across every other exhibition's page too (hamecarer does this),
    // which would otherwise get it wrongly flagged as a shared template image.
    d.image = d.listImg || (ogOk(d.ogImg) ? d.ogImg : null) || d.renderImages?.[0] ||
      d.detailImgs.find((u) => filenameMatchesTitle(u, d.title)) ||
      d.detailImgs.find((u) => !isCommon(u)) || d.ld?.image || null;
  }

  // Detail pages with a JSON-LD Event give the date for free; only the rest need
  // a Claude call to read the date out of the Hebrew text. Keyed by short numeric
  // index, NOT the url — long percent-encoded Hebrew URLs (e.g. batsheva's
  // /repertory/%d7%a4%d7%a8...) are opaque enough that the model can echo one back
  // slightly wrong, silently dropping that item's date on the url.get() miss.
  const needAi = details.filter((d) => !d.ld?.start);
  const needAiIndex = new Map(needAi.map((d, i) => [d, i]));
  const fields = new Map(); // index -> extracted fields
  for (let i = 0; i < needAi.length; i += 20) {
    const chunk = needAi.slice(i, i + 20);
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
  for (const d of details) {
    const f = needAiIndex.has(d) ? fields.get(String(needAiIndex.get(d))) || {} : {};
    // Prefer the page's own JSON-LD date (exact, timezone-aware); fall back to the
    // AI-read date, then the listing's sd= stamp.
    let startsAt = null, endsAt = null;
    if (d.ld?.start) {
      startsAt = d.ld.start;
      endsAt = d.ld.end;
    } else {
      const date = f.date || (d.sd ? ilDateOf(d.sd) : null);
      if (!date) continue;
      const [y, mo, day] = date.split("-").map(Number);
      const [hh, mm] = (f.time || "20:00").split(":").map(Number);
      startsAt = israelISO(y, mo, day, hh, mm);
      // Exhibitions/multi-day runs: keep the closing date so the event stays
      // visible until it actually ends (normalize keeps future-ending events).
      if (/^\d{4}-\d{2}-\d{2}$/.test(f.end_date || "")) {
        const [ey, emo, ed] = f.end_date.split("-").map(Number);
        endsAt = israelISO(ey, emo, ed, 23, 59);
      }
    }
    if (!d.title || !startsAt) continue;
    const { priceText, isFree } = reconcilePrice(f.price_text, f.is_free);
    // The longest paragraph of a detail page is almost always the event description
    const description =
      d.text.split("\n").reduce((a, b) => (b.trim().length > a.length ? b.trim() : a), "").slice(0, 400) || null;
    events.push({
      occurrenceKey: d.url + "_" + startsAt.slice(0, 10),
      title: d.title,
      description: description && description.length > 60 ? description : null,
      startsAt,
      endsAt,
      priceText,
      isFree,
      bookingUrl: findTicketLink(d.html) || f.booking_url || d.url,
      eventUrl: d.url,
      imageUrl: d.image,
      lang: "he",
      confidence: d.ld?.start ? 1.0 : 0.85,
    });
  }
  return events;
}
