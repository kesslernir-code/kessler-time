// Orchestrator: run every source through its strategy, normalize, upsert, log.
// Usage: node scraper/index.js [--dry-run] [--source=<id>]
import { mkdirSync, writeFileSync } from "node:fs";
import { sources as fileSources } from "./sources.js";
import { shortHash, jerusalemOffset, canonTitle, titlesSimilar, isJunkImageUrl } from "./lib/util.js";
import { dbConfigured, upsertEvents, logRun, getSources, eventsMissingPrice, updateEvent, updateSourceRow, deleteSourceEvents, pruneStaleEvents, knownImages } from "./lib/db.js";
import { enrichPrices } from "./lib/enrichPrice.js";
import { closeBrowser } from "./lib/render.js";
import { fetchOgImage, fetchPageInfo } from "./lib/fetchPage.js";
import { getCostUSD } from "./lib/ai.js";

// "Directory" categories: shown as info cards (image/phone/name/description/link),
// NOT scraped for events.
const DIRECTORY_CATS = new Set(["bars", "restaurants", "festival"]);

/** An image reused across many events in one source is a banner/logo, not a
 *  per-event poster — null it so a real image (or clean placeholder) takes over. */
function dropSharedImages(events) {
  const freq = new Map();
  for (const e of events) if (e.image_url) freq.set(e.image_url, (freq.get(e.image_url) || 0) + 1);
  for (const e of events) if (e.image_url && freq.get(e.image_url) >= 3) e.image_url = null;
}

/** Generic image backfill: events with no image but a REAL event page get its
 *  og:image. Skips events whose link is just the source homepage (no per-event image). */
async function backfillImages(events, source, cap = 12) {
  let n = 0;
  for (const e of events) {
    if (e.image_url || !e.event_url || e.event_url === source.url) continue;
    if (n >= cap) break;
    n++;
    const img = await fetchOgImage(e.event_url);
    if (img) e.image_url = img;
  }
}
import * as wpEventsApi from "./strategies/wpEventsApi.js";
import * as radicalCalendar from "./strategies/radicalCalendar.js";
import * as wpApiAi from "./strategies/wpApiAi.js";
import * as autoLadder from "./strategies/autoLadder.js";
import * as listingDetailAi from "./strategies/listingDetailAi.js";
import * as wpMetaEvents from "./strategies/wpMetaEvents.js";
import * as jaffaCinema from "./strategies/jaffaCinema.js";
import * as wpAuto from "./strategies/wpAuto.js";
import * as amphitlv from "./strategies/amphitlv.js";
import * as cinema from "./strategies/cinema.js";
import * as epgb from "./strategies/epgb.js";
import * as tribeEvents from "./strategies/tribeEvents.js";
import * as smarticket from "./strategies/smarticket.js";
import * as shopify from "./strategies/shopify.js";
import * as batshevaSchedule from "./strategies/batshevaSchedule.js";
import * as solTherapyCloud from "./strategies/solTherapyCloud.js";

const strategies = {
  [wpEventsApi.name]: wpEventsApi,
  [radicalCalendar.name]: radicalCalendar,
  [wpApiAi.name]: wpApiAi,
  [autoLadder.name]: autoLadder,
  [listingDetailAi.name]: listingDetailAi,
  [wpMetaEvents.name]: wpMetaEvents,
  [jaffaCinema.name]: jaffaCinema,
  [wpAuto.name]: wpAuto,
  [amphitlv.name]: amphitlv,
  [cinema.name]: cinema,
  [epgb.name]: epgb,
  [tribeEvents.name]: tribeEvents,
  [smarticket.name]: smarticket,
  [shopify.name]: shopify,
  [batshevaSchedule.name]: batshevaSchedule,
  [solTherapyCloud.name]: solTherapyCloud,
};

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run") || !dbConfigured();
const only = args.find((a) => a.startsWith("--source="))?.split("=")[1];

// Cities are displayed in Hebrew. Map common English names to Hebrew; pass
// already-Hebrew (or unknown) values through unchanged.
const CITY_HE = {
  "tel aviv": "תל אביב", "tel aviv-yafo": "תל אביב", "tel-aviv": "תל אביב", "telaviv": "תל אביב",
  jaffa: "יפו", "tel aviv jaffa": "תל אביב", jerusalem: "ירושלים", haifa: "חיפה",
  "beer sheva": "באר שבע", "be'er sheva": "באר שבע", "ramat gan": "רמת גן", herzliya: "הרצליה",
};
const normCity = (c) => {
  if (c == null) return null;
  const t = String(c).trim();
  return CITY_HE[t.toLowerCase()] || t;
};

const ilDay = (iso) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date(iso));

/** Roughly "how much do we know about this event" — used to pick the best duplicate. */
const completeness = (e) =>
  (e.booking_url && e.booking_url !== e.event_url ? 4 : 0) +
  (e.price_text ? 2 : 0) +
  (e.image_url ? 1 : 0) +
  (e.description ? 1 : 0);

/**
 * Strategy output -> events table row. Drops past events and obvious garbage.
 * The id is a fingerprint of title+day, so the same event announced in several
 * posts (or re-scraped tomorrow) collapses into one row; the most complete
 * duplicate wins.
 */
// Strip control characters (incl. NUL bytes that PostgreSQL rejects, seen in
// some scraped HTML) so the upsert body is always valid for the DB.
const clean = (s) =>
  typeof s === "string"
    ? s
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") // C0 controls + DEL
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "") // lone surrogates PG rejects
        .trim()
    : s;

function normalize(raw, source) {
  const byId = new Map();
  const cutoff = Date.now() - 3 * 3600_000; // keep events started <3h ago
  for (const e of raw) {
    const startsAt = e.startsAt ?? (e.localDateTime ? e.localDateTime + jerusalemOffset(new Date(e.localDateTime)) : null);
    if (!e.title || !startsAt) continue;
    const t = Date.parse(startsAt);
    if (Number.isNaN(t) || t > Date.now() + 400 * 864e5) continue;
    // Drop only if it has already STARTED and (for multi-day runs) already ENDED.
    // An exhibition that opened last month but closes next month stays visible.
    const endT = e.endsAt ? Date.parse(e.endsAt) : null;
    if (t < cutoff && !(endT && endT >= cutoff)) continue;
    const row = {
      id: `${source.id}_${shortHash(canonTitle(e.title) + "_" + ilDay(startsAt))}`,
      source_id: source.id,
      title: clean(e.title).slice(0, 300),
      description: clean(e.description) || null,
      starts_at: startsAt,
      ends_at: e.endsAt || null,
      venue: source.venue,
      city: normCity(source.city),
      // present only once the DB has the category column (sources row carries it)
      category: source.category || undefined,
      price_text: e.priceText || null,
      is_free: e.isFree ?? null,
      booking_url: e.bookingUrl || null,
      event_url: e.eventUrl || null,
      image_url: isJunkImageUrl(e.imageUrl) ? null : e.imageUrl || null, // drop FB pixels/post links
      lang: e.lang || "he",
      confidence: e.confidence ?? 0.7,
    };
    const existing = byId.get(row.id);
    if (!existing || completeness(row) > completeness(existing)) byId.set(row.id, row);
  }

  // Second pass: collapse the same event scraped under slightly different titles.
  // Two rows merge only when they start at the EXACT same time AND their titles
  // overlap heavily — so distinct films at different times (cinema) are kept, but
  // "FOREVER YOUNG" / "FOREVER YOUNG - 80s Party" style duplicates fold into one
  // (the most complete wins, so an imaged copy beats a placeholder one).
  const byTime = new Map(); // starts_at -> kept rows
  for (const row of byId.values()) {
    const arr = byTime.get(row.starts_at) || [];
    const dup = arr.find((r) => titlesSimilar(r.title, row.title));
    if (!dup) arr.push(row);
    else if (completeness(row) > completeness(dup)) arr[arr.indexOf(dup)] = row;
    byTime.set(row.starts_at, arr);
  }
  return [...byTime.values()].flat();
}

if (DRY) console.error(dbConfigured() ? "-- DRY RUN --" : "-- DRY RUN (no SUPABASE_URL configured) --");

// Source list lives in the DB (editable from admin.html); sources.js is the fallback/seed.
const dbSources = await getSources();
const sources = dbSources ?? fileSources;
console.error(`sources: ${sources.map((s) => s.id).join(", ")} (${dbSources ? "from db" : "from file"})`);

let failures = 0;
const costBySource = new Map(); // source_id -> estimated USD this run (AI calls only)

for (const source of sources) {
  if (only && source.id !== only) continue;

  // Directory place (bar/restaurant/festival): refresh its info card, no events.
  if (DIRECTORY_CATS.has(source.category)) {
    if (DRY) { console.log(`\n=== ${source.name} [directory:${source.category}] — info card, no events`); continue; }
    try {
      const info = await fetchPageInfo(source.url);
      await updateSourceRow(source.id, info);
      await deleteSourceEvents(source.id); // drop any stale events from before it was a directory
      console.log(`${source.id}: directory info refreshed (img:${!!info.image} phone:${!!info.phone})`);
      await logRun({ source_id: source.id, strategy: "directory", ok: true, events_found: 0, events_upserted: 0, duration_ms: 0, error: null });
    } catch (e) {
      console.error(`${source.id} directory FAILED: ${e.message}`);
    }
    continue;
  }

  const strategy = strategies[source.strategy];
  const t0 = Date.now();
  const costBefore = getCostUSD();
  const run = { source_id: source.id, strategy: source.strategy, ok: false, events_found: 0, events_upserted: 0, error: null };

  try {
    if (!strategy) throw new Error(`unknown strategy "${source.strategy}"`);
    const raw = await strategy.scrape(source);
    const events = normalize(raw, source);
    dropSharedImages(events); // strip reused banners/logos before backfilling
    // Keep a poster the QA agent already found: if this scrape produced no image
    // for an event we already know, don't clobber the stored one back to null.
    if (!DRY) {
      const knownImg = await knownImages(source.id);
      for (const e of events) if (!e.image_url && knownImg.has(e.id)) e.image_url = knownImg.get(e.id);
    }
    await backfillImages(events, source); // og:image fallback when the API/feed gave no picture
    await enrichPrices(events); // fills prices from ticket pages when the venue page omits them
    run.events_found = raw.length;
    run.events_upserted = events.length;

    if (DRY) {
      console.log(`\n=== ${source.name} [${source.strategy}]: ${raw.length} raw -> ${events.length} upcoming`);
      for (const e of events.slice(0, 8)) {
        console.log(`  ${e.starts_at}  ${e.title}  ${e.price_text ?? ""}`);
      }
      if (events.length > 8) console.log(`  ... +${events.length - 8} more`);
    } else {
      await upsertEvents(events);
      console.log(`${source.id}: ${events.length} events upserted (${raw.length} found) via ${source.strategy}`);
    }
    run.ok = true;
  } catch (e) {
    run.error = String(e.message || e).slice(0, 500);
    // Don't fail the CI run for one-off venue/API hiccups that self-recover
    // next run and don't reflect a real code problem: server down (5xx), rate
    // limiting (429) or bot-blocking (403) a venue applies inconsistently
    // (e.g. only from the CI runner's IP that hour), a WAF/rate-limit page
    // served as HTML where JSON was expected (SyntaxError on the parse), or
    // Anthropic's API being temporarily over capacity.
    const transient = /HTTP 5\d\d|HTTP 429|HTTP 403|is not valid JSON|overloaded_error/.test(run.error);
    if (!transient) failures++;
    console.error(`${source.id} ${transient ? "WARN" : "FAILED"}: ${run.error}`);
    // Save what we saw for post-mortem (uploaded as a CI artifact on failure)
    try {
      mkdirSync("artifacts", { recursive: true });
      writeFileSync(`artifacts/${source.id}-error.txt`, `${new Date().toISOString()}\n${e.stack || e}`);
    } catch {}
  }

  run.duration_ms = Date.now() - t0;
  costBySource.set(source.id, getCostUSD() - costBefore);
  if (!DRY) await logRun(run).catch((e) => console.error(`logRun failed: ${e.message}`));
}

// Backfill pass: stored events that still lack a price (e.g. saved before
// enrichment existed, or past a run's render cap) converge over the next runs.
if (!DRY && !only) {
  try {
    const missing = await eventsMissingPrice(25);
    if (missing.length) {
      await enrichPrices(missing);
      let updated = 0;
      for (const e of missing) {
        if (e.price_text || e.is_free != null) {
          await updateEvent(e.id, { price_text: e.price_text, is_free: e.is_free });
          updated++;
        }
      }
      console.error(`price backfill: ${updated}/${missing.length} events updated`);
    }
  } catch (e) {
    console.error(`price backfill failed: ${e.message}`);
  }
}

await closeBrowser();

// Remove events no source has re-seen in 48h (stale duplicates / dropped listings).
// Skipped for single-source runs so a --source scan can't prune everyone else.
if (!DRY && !only) {
  try { await pruneStaleEvents(48); } catch (e) { console.error(`prune failed: ${e.message}`); }
}

// Per-source AI cost report + overcharge alert. If one source's estimated AI
// spend this run is disproportionate (a strategy needing far more Claude calls
// than its value justifies, or something looping), fail the job so the
// existing GitHub Actions failure email names it and you can flip it off
// (sources.enabled = false, editable from admin.html) before it runs again.
const OVERCHARGE_THRESHOLD_USD = 0.15;
const costLines = [...costBySource].filter(([, c]) => c > 0.001).sort((a, b) => b[1] - a[1]);
if (!DRY && costLines.length) {
  console.error(`\nAI cost this run: $${getCostUSD().toFixed(4)} total (estimated, list price)`);
  for (const [id, c] of costLines) console.error(`  ${id}: $${c.toFixed(4)}`);
  const overcharging = costLines.filter(([, c]) => c > OVERCHARGE_THRESHOLD_USD);
  if (overcharging.length) {
    console.error(`\n⚠ COST ALERT: source(s) over $${OVERCHARGE_THRESHOLD_USD}/run — consider disabling in admin.html:`);
    for (const [id, c] of overcharging) console.error(`  ${id}: $${c.toFixed(4)} this run`);
    process.exitCode = 1;
  }
}

if (failures) {
  console.error(`\n${failures} source(s) failed`);
  process.exitCode = 1;
}
