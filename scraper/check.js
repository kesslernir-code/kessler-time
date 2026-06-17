// Post-scrape QA "checking agent". Runs after scrape + discover. It:
//   1. tries to fill missing images (og:image from the event page, where reachable)
//   2. audits every upcoming event for completeness (image / date / link / desc)
//   3. prints a clear report and logs a health summary (shown on /status)
// Usage: node scraper/check.js
import { dbConfigured, upcomingEvents, updateEvent, logRun } from "./lib/db.js";
import { fetchOgImage } from "./lib/fetchPage.js";

if (!dbConfigured()) { console.error("check: no SUPABASE config"); process.exit(0); }

const events = await upcomingEvents();

// 1. auto-fix: backfill missing images from the event page's og:image, where the
//    page is reachable (Facebook/Instagram are login-walled, so skip those).
// Skip URLs shared by 3+ events (listing pages, not individual event pages).
const urlFreq = new Map();
for (const e of events) if (e.event_url) urlFreq.set(e.event_url, (urlFreq.get(e.event_url) || 0) + 1);

let fixed = 0, tried = 0;
for (const e of events) {
  if (e.image_url || !e.event_url) continue;
  if (/facebook\.com|instagram\.com/.test(e.event_url)) continue;
  if ((urlFreq.get(e.event_url) || 1) >= 3) continue; // shared listing URL — skip
  if (tried >= 80) break;
  tried++;
  const img = await fetchOgImage(e.event_url);
  if (img) { await updateEvent(e.id, { image_url: img }); e.image_url = img; fixed++; }
}

// 2. audit
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

// 3. report
console.log(`\n=== HEALTH CHECK ===`);
console.log(`upcoming events: ${events.length}`);
console.log(`images: ${events.length - noImg.length}/${events.length} (${noImg.length} missing, ${fixed} auto-fixed)`);
console.log(`missing date: ${noDate.length} | missing link: ${noLink.length} | past leaking: ${past.length}`);
console.log(`per source (events · image · desc · link):`);
for (const [k, s] of Object.entries(bySrc).sort()) console.log(`  ${k.padEnd(22)} ${s.n}·${s.img}·${s.desc}·${s.link}`);
if (noImg.length) { console.log(`missing image:`); noImg.slice(0, 40).forEach((e) => console.log(`  [${e.source_id}] ${(e.title || "").slice(0, 45)}`)); }

const clean = !noImg.length && !noDate.length && !past.length && !noLink.length;
const summary = `${events.length} events · ${noImg.length} no-image · ${noDate.length} no-date · ${past.length} past · ${noLink.length} no-link · ${fixed} fixed`;
await logRun({ source_id: "health-check", strategy: "check", events_found: events.length, events_upserted: events.length - noImg.length, ok: clean, duration_ms: 0, error: summary });
console.log(clean ? "✓ all good" : "⚠ issues above");
