// Orchestrator: run every source through its strategy, normalize, upsert, log.
// Usage: node scraper/index.js [--dry-run] [--source=<id>]
import { mkdirSync, writeFileSync } from "node:fs";
import { sources as fileSources } from "./sources.js";
import { shortHash, jerusalemOffset } from "./lib/util.js";
import { dbConfigured, upsertEvents, logRun, getSources } from "./lib/db.js";
import * as wpEventsApi from "./strategies/wpEventsApi.js";
import * as radicalCalendar from "./strategies/radicalCalendar.js";
import * as wpApiAi from "./strategies/wpApiAi.js";
import * as autoLadder from "./strategies/autoLadder.js";

const strategies = {
  [wpEventsApi.name]: wpEventsApi,
  [radicalCalendar.name]: radicalCalendar,
  [wpApiAi.name]: wpApiAi,
  [autoLadder.name]: autoLadder,
};

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run") || !dbConfigured();
const only = args.find((a) => a.startsWith("--source="))?.split("=")[1];

/** Strategy output -> events table row. Drops past events and obvious garbage. */
function normalize(raw, source) {
  const out = [];
  const cutoff = Date.now() - 3 * 3600_000; // keep events started <3h ago
  for (const e of raw) {
    const startsAt = e.startsAt ?? (e.localDateTime ? e.localDateTime + jerusalemOffset(new Date(e.localDateTime)) : null);
    if (!e.title || !startsAt) continue;
    const t = Date.parse(startsAt);
    if (Number.isNaN(t) || t < cutoff || t > Date.now() + 400 * 864e5) continue;
    out.push({
      id: `${source.id}_${shortHash(e.occurrenceKey || e.title + startsAt)}`,
      source_id: source.id,
      title: e.title.slice(0, 300),
      description: e.description || null,
      starts_at: startsAt,
      ends_at: e.endsAt || null,
      venue: source.venue,
      city: source.city,
      price_text: e.priceText || null,
      is_free: e.isFree ?? null,
      booking_url: e.bookingUrl || null,
      event_url: e.eventUrl || null,
      image_url: e.imageUrl || null,
      lang: e.lang || "he",
      confidence: e.confidence ?? 0.7,
    });
  }
  return out;
}

if (DRY) console.error(dbConfigured() ? "-- DRY RUN --" : "-- DRY RUN (no SUPABASE_URL configured) --");

// Source list lives in the DB (editable from admin.html); sources.js is the fallback/seed.
const dbSources = await getSources();
const sources = dbSources ?? fileSources;
console.error(`sources: ${sources.map((s) => s.id).join(", ")} (${dbSources ? "from db" : "from file"})`);

let failures = 0;

for (const source of sources) {
  if (only && source.id !== only) continue;
  const strategy = strategies[source.strategy];
  const t0 = Date.now();
  const run = { source_id: source.id, strategy: source.strategy, ok: false, events_found: 0, events_upserted: 0, error: null };

  try {
    if (!strategy) throw new Error(`unknown strategy "${source.strategy}"`);
    const raw = await strategy.scrape(source);
    const events = normalize(raw, source);
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
    failures++;
    run.error = String(e.message || e).slice(0, 500);
    console.error(`${source.id} FAILED: ${run.error}`);
    // Save what we saw for post-mortem (uploaded as a CI artifact on failure)
    try {
      mkdirSync("artifacts", { recursive: true });
      writeFileSync(`artifacts/${source.id}-error.txt`, `${new Date().toISOString()}\n${e.stack || e}`);
    } catch {}
  }

  run.duration_ms = Date.now() - t0;
  if (!DRY) await logRun(run).catch((e) => console.error(`logRun failed: ${e.message}`));
}

if (failures) {
  console.error(`\n${failures} source(s) failed`);
  process.exitCode = 1;
}
