// Post-scrape QA "checking agent" + escalation. Runs after scrape + discover.
//   0. DROP junk image_urls (FB pixels / social post links) and VERIFY every
//      remaining poster actually loads through the same proxy the site uses — a
//      stored image_url that 404s shows a broken-image placeholder to visitors,
//      so "has an image_url" is not the same as "shows a poster".
//   1. ESCALATION ladder to rescue missing images, per event:
//        a. og:image / twitter:image / first content <img> from the event page
//        b. if that page is the event's OWN page, render it and grab the poster
//        c. VISION — events sharing one listing page (no individual page): render
//           the listing, read its posters with Claude vision, match to events.
//      Images the proxy can't fetch (hotlink-blocked venues) are re-hosted to Storage.
//   2. AUDIT every upcoming event for completeness (image / date / link / desc).
//   3. QC GATE: per-source image coverage with pass/warn/fail markers, so a
//      regression surfaces loudly instead of shipping placeholders silently.
// Usage: node scraper/check.js
import { dbConfigured, upcomingEvents, updateEvent, deleteEventById, logRun } from "./lib/db.js";
import { fetchOgImage } from "./lib/fetchPage.js";
import { renderPage, closeBrowser } from "./lib/render.js";
import { isJunkImageUrl, titlesSimilar, todayISODate } from "./lib/util.js";
import { rehostImage, ensureBucket, isRehosted } from "./lib/storage.js";
import { extractEventsFromImages, aiConfigured } from "./lib/ai.js";
import { fetchCatalog } from "./lib/catalog.js";

if (!dbConfigured()) { console.error("check: no SUPABASE config"); process.exit(0); }

let events = await upcomingEvents();

// The page renders posters through wsrv.nl; if the proxy can't fetch the URL the
// visitor sees a broken-image placeholder. Verify the URL really resolves to an image.
const proxy = (u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=320&h=320&fit=cover&output=webp`;
const isImg = (r) => r.ok && (r.headers.get("content-type") || "").startsWith("image/");
async function imageLoads(u) {
  // The page renders posters through the proxy, so that's the real test. Two
  // attempts — a transient hiccup must not wipe a valid poster.
  for (let i = 0; i < 2; i++) {
    try { if (isImg(await fetch(proxy(u), { method: "GET", signal: AbortSignal.timeout(20000) }))) return true; }
    catch { /* network error — retry */ }
  }
  return false;
}
async function mapLimit(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// 0. DROP junk image_urls (no network); validate the rest load through the proxy;
//    for ones that don't (hotlink-blocked / proxy-blocked venues like levontin7),
//    re-host the real image into our Storage and use that instead of nulling.
await ensureBucket();
let junked = 0, broke = 0, rehosted = 0;
for (const e of events) {
  if (e.image_url && isJunkImageUrl(e.image_url)) { await updateEvent(e.id, { image_url: null }); e.image_url = null; junked++; }
}
// Hosts that block the proxy/hotlinking unreliably — always serve our own copy
// rather than trusting a flaky proxy check that the browser might fail later.
const REHOST_HOSTS = /levontin7\.com/i;
await mapLimit(events.filter((e) => e.image_url), 6, async (e) => {
  if (REHOST_HOSTS.test(e.image_url) && !isRehosted(e.image_url)) {
    const hosted = await rehostImage(e.image_url, e.id);
    if (hosted) { await updateEvent(e.id, { image_url: hosted }); e.image_url = hosted; rehosted++; return; }
  }
  if (await imageLoads(e.image_url)) return; // renders fine through the proxy
  if (!isRehosted(e.image_url)) {
    const hosted = await rehostImage(e.image_url, e.id); // server-side fetch dodges hotlink blocks
    if (hosted && (await imageLoads(hosted))) { await updateEvent(e.id, { image_url: hosted }); e.image_url = hosted; rehosted++; return; }
  }
  await updateEvent(e.id, { image_url: null }); e.image_url = null; broke++;
});

// URLs shared by 3+ events are listing/home pages, not individual event pages —
// their og:image is a site banner, useless as a per-event poster.
const urlFreq = new Map();
for (const e of events) if (e.event_url) urlFreq.set(e.event_url, (urlFreq.get(e.event_url) || 0) + 1);
const isIndividual = (url) => url && (urlFreq.get(url) || 1) < 3 && !/facebook\.com|instagram\.com/.test(url);

// Render fallback: grab the largest non-icon poster from the rendered DOM.
async function renderPoster(url) {
  try {
    const { images } = await renderPage(url, { timeoutMs: 30000, scroll: true });
    return images?.[0] || null; // render.js sorts biggest-first, filters logos/icons
  } catch { return null; }
}

// 1. ESCALATION
let fixedOg = 0, fixedRender = 0, triedOg = 0, triedRender = 0;
const needRender = [];
for (const e of events) {
  if (e.image_url || !isIndividual(e.event_url)) continue;
  if (triedOg >= 80) break;
  triedOg++;
  const img = await fetchOgImage(e.event_url);
  if (img && (await imageLoads(img))) { await updateEvent(e.id, { image_url: img }); e.image_url = img; fixedOg++; }
  else needRender.push(e);
}
// Rung b: render the still-missing individual pages (capped — rendering is slow).
for (const e of needRender) {
  if (triedRender >= 15) break;
  triedRender++;
  const img = await renderPoster(e.event_url);
  if (img && (await imageLoads(img))) { await updateEvent(e.id, { image_url: img }); e.image_url = img; fixedRender++; }
}

// Rung b2: CATALOG — e-commerce venues (WooCommerce / Shopify) expose a public
// product catalog where each event's poster is the product image. The date came
// from the listing, so match the catalog poster onto the dated event by title.
// Cheap (two JSON calls per site, no render/vision) and reliable — the first
// choice for any store-backed venue, existing or future.
let fixedCatalog = 0;
{
  const bySite = new Map(); // origin -> imageless events[]
  for (const e of events) {
    if (e.image_url || !e.event_url) continue;
    let origin; try { origin = new URL(e.event_url).origin; } catch { continue; }
    (bySite.get(origin) || bySite.set(origin, []).get(origin)).push(e);
  }
  for (const [origin, evs] of bySite) {
    let cat; try { cat = await fetchCatalog(origin); } catch { cat = null; }
    if (!cat) continue;
    for (const e of evs) {
      const m = cat.find((c) => titlesSimilar(c.title, e.title));
      if (!m) continue;
      let img = (await imageLoads(m.image)) ? m.image : await rehostImage(m.image, e.id);
      if (img && (await imageLoads(img))) { await updateEvent(e.id, { image_url: img }); e.image_url = img; fixedCatalog++; }
    }
  }
}

// Rung c: VISION — events that all share one listing page (no individual page to
// scrape, so rungs a/b can't help) are rescued by rendering that listing, reading
// the posters with Claude vision, and matching each poster to its event by title.
// Capped hard (vision is the costly rung): a few listings, ~12 posters each.
let fixedVision = 0;
if (aiConfigured()) {
  const byUrl = new Map();
  for (const e of events) {
    if (e.image_url || !e.event_url || isIndividual(e.event_url)) continue;
    (byUrl.get(e.event_url) || byUrl.set(e.event_url, []).get(e.event_url)).push(e);
  }
  let triedVision = 0;
  for (const [url, evs] of byUrl) {
    if (triedVision >= 3) break;     // at most 3 listings per run
    if (evs.length < 2) continue;    // only worth it for a real list of events
    triedVision++;
    let posters = [];
    try { posters = (await renderPage(url, { timeoutMs: 45000, scroll: true })).images.slice(0, 18); } catch { continue; }
    if (!posters.length) continue;
    let read = [];
    try { read = await extractEventsFromImages(posters, { sourceName: evs[0].venue || evs[0].source_id, todayISO: todayISODate() }); } catch { continue; }
    for (const e of evs) {
      const m = read.find((r) => r.imageUrl && titlesSimilar(r.title || "", e.title));
      if (!m) continue;
      let img = (await imageLoads(m.imageUrl)) ? m.imageUrl : await rehostImage(m.imageUrl, e.id);
      if (img && (await imageLoads(img))) { await updateEvent(e.id, { image_url: img }); e.image_url = img; fixedVision++; }
    }
  }
}
await closeBrowser();
const fixed = fixedOg + fixedRender + fixedCatalog + fixedVision;

// 1.5 DEDUP — collapse near-duplicate events (same source, same day, similar
// title) that accumulate across runs when a venue lists an event under slightly
// varying titles. Keep the most complete; delete the rest.
const completeness = (e) => (e.image_url ? 2 : 0) + (e.description ? 1 : 0) + (e.booking_url ? 1 : 0) + (e.price_text ? 1 : 0);
const dayOf = (iso) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(iso)); } catch { return ""; } };
const groups = new Map(); // "source|day" -> events[]
for (const e of events) { if (!e.starts_at) continue; const k = e.source_id + "|" + dayOf(e.starts_at); (groups.get(k) || groups.set(k, []).get(k)).push(e); }
const removed = new Set();
let deduped = 0;
for (const arr of groups.values()) {
  for (let i = 0; i < arr.length; i++) {
    if (removed.has(arr[i].id)) continue;
    for (let j = i + 1; j < arr.length; j++) {
      if (removed.has(arr[j].id)) continue;
      if (!titlesSimilar(arr[i].title, arr[j].title)) continue;
      const drop = completeness(arr[i]) >= completeness(arr[j]) ? arr[j] : arr[i];
      await deleteEventById(drop.id); removed.add(drop.id); deduped++;
      if (drop.id === arr[i].id) break; // current i removed → advance outer loop
    }
  }
}
if (removed.size) events = events.filter((e) => !removed.has(e.id));

// 2. AUDIT
const isBad = (e) => !e.starts_at || Number.isNaN(Date.parse(e.starts_at));
const noImg = events.filter((e) => !e.image_url);
const noDate = events.filter(isBad);
const noLink = events.filter((e) => !e.booking_url && !e.event_url);
const past = events.filter((e) => !isBad(e) && Date.parse(e.starts_at) < Date.now() - 3 * 3600e3);

const bySrc = {};
for (const e of events) {
  const s = (bySrc[e.source_id] ||= { n: 0, img: 0, desc: 0, link: 0 });
  s.n++; if (e.image_url) s.img++; if (e.description) s.desc++; if (e.booking_url || e.event_url) s.link++;
}

// 3. QC GATE — flag sources whose image coverage is too low to look good.
// A source with >=4 events should have most of them imaged. Below 50% = FAIL,
// below 80% = WARN. Tiny sources and known image-less venues are exempt.
const MIN_EVENTS = 4;
const qc = [];
for (const [id, s] of Object.entries(bySrc)) {
  if (s.n < MIN_EVENTS) continue;
  const cov = s.img / s.n;
  const mark = cov >= 0.8 ? "ok" : cov >= 0.5 ? "warn" : "fail";
  qc.push({ id, cov, n: s.n, img: s.img, mark });
}
const fails = qc.filter((q) => q.mark === "fail");
const warns = qc.filter((q) => q.mark === "warn");

// REPORT
console.log(`\n=== HEALTH CHECK ===`);
console.log(`upcoming events: ${events.length}`);
console.log(`images: ${events.length - noImg.length}/${events.length} loading (${noImg.length} missing; dropped ${junked} junk + ${broke} dead; rescued ${fixedOg} og + ${fixedRender} render + ${fixedCatalog} catalog + ${fixedVision} vision + ${rehosted} re-hosted)`);
console.log(`deduped: ${deduped} | missing date: ${noDate.length} | missing link: ${noLink.length} | past leaking: ${past.length}`);
console.log(`per source (events · image · desc · link):`);
for (const [k, s] of Object.entries(bySrc).sort()) {
  const cov = s.n ? s.img / s.n : 1;
  const flag = s.n >= MIN_EVENTS && cov < 0.5 ? " ✗" : s.n >= MIN_EVENTS && cov < 0.8 ? " ⚠" : "";
  console.log(`  ${k.padEnd(22)} ${s.n}·${s.img}·${s.desc}·${s.link}${flag}`);
}
if (fails.length) {
  console.log(`\nQC FAIL — sources with <50% image coverage (need a per-event image fix):`);
  for (const q of fails) console.log(`  ✗ ${q.id}: ${q.img}/${q.n} (${Math.round(q.cov * 100)}%)`);
}
if (warns.length) {
  console.log(`QC WARN — sources with 50-80% image coverage:`);
  for (const q of warns) console.log(`  ⚠ ${q.id}: ${q.img}/${q.n} (${Math.round(q.cov * 100)}%)`);
}
if (noImg.length) { console.log(`\nmissing image (first 40):`); noImg.slice(0, 40).forEach((e) => console.log(`  [${e.source_id}] ${(e.title || "").slice(0, 45)}`)); }

const summary = `${events.length} events · ${noImg.length} no-image · ${junked + broke} bad-img-dropped · ${rehosted} re-hosted · ${deduped} deduped · ${fails.length} src FAIL · ${warns.length} src WARN · rescued ${fixed}`;
await logRun({ source_id: "health-check", strategy: "check", events_found: events.length, events_upserted: events.length - noImg.length, ok: fails.length === 0, duration_ms: 0, error: summary });
console.log(`\n${fails.length === 0 ? "✓ QC pass (no source below 50% images)" : `✗ QC: ${fails.length} source(s) below 50% images`}`);
