// Post-scrape QA "checking agent" + escalation. Runs after scrape + discover.
//   1. ESCALATION ladder to rescue missing images, per event:
//        a. og:image / twitter:image / first content <img> from the event page
//        b. if that page is the event's OWN page, render it and grab the poster
//      (events whose only link is the source homepage are skipped — there is no
//       per-event image to find, and the shared banner is rejected upstream.)
//   2. AUDIT every upcoming event for completeness (image / date / link / desc).
//   3. QC GATE: per-source image coverage with pass/warn/fail markers, so a
//      regression (a source that used to have posters and suddenly doesn't)
//      surfaces loudly instead of shipping placeholders silently.
// Usage: node scraper/check.js
import { dbConfigured, upcomingEvents, updateEvent, logRun } from "./lib/db.js";
import { fetchOgImage } from "./lib/fetchPage.js";
import { renderPage, closeBrowser } from "./lib/render.js";

if (!dbConfigured()) { console.error("check: no SUPABASE config"); process.exit(0); }

const events = await upcomingEvents();

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
  if (img) { await updateEvent(e.id, { image_url: img }); e.image_url = img; fixedOg++; }
  else needRender.push(e);
}
// Rung b: render the still-missing individual pages (capped — rendering is slow).
for (const e of needRender) {
  if (triedRender >= 15) break;
  triedRender++;
  const img = await renderPoster(e.event_url);
  if (img) { await updateEvent(e.id, { image_url: img }); e.image_url = img; fixedRender++; }
}
await closeBrowser();
const fixed = fixedOg + fixedRender;

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
console.log(`images: ${events.length - noImg.length}/${events.length} (${noImg.length} missing; rescued ${fixedOg} og + ${fixedRender} render)`);
console.log(`missing date: ${noDate.length} | missing link: ${noLink.length} | past leaking: ${past.length}`);
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

const summary = `${events.length} events · ${noImg.length} no-image · ${fails.length} src FAIL · ${warns.length} src WARN · rescued ${fixed}`;
await logRun({ source_id: "health-check", strategy: "check", events_found: events.length, events_upserted: events.length - noImg.length, ok: fails.length === 0, duration_ms: 0, error: summary });
console.log(`\n${fails.length === 0 ? "✓ QC pass (no source below 50% images)" : `✗ QC: ${fails.length} source(s) below 50% images`}`);
