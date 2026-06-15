// Discovery runner: scrape social channels for events that live ONLY on social
// media (the "treasure hunter"). Stores them as kind="social", shown on the
// separate /social page. Runs after the main venue scrape.
// Usage: node scraper/discover.js [--dry-run] [--source=<id>]
import { mkdirSync, writeFileSync } from "node:fs";
import { shortHash } from "./lib/util.js";
import { dbConfigured, upsertEvents, logRun, getSocialSources } from "./lib/db.js";
import * as telegram from "./discovery/telegram.js";
import * as facebook from "./discovery/facebook.js";
import * as instagram from "./discovery/instagram.js";
import * as fbSearch from "./discovery/fbSearch.js";
import * as facebookGroup from "./discovery/facebookGroup.js";

const platforms = {
  [telegram.platform]: telegram,
  [facebook.platform]: facebook,
  [instagram.platform]: instagram,
  [fbSearch.platform]: fbSearch,
  [facebookGroup.platform]: facebookGroup,
};

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run") || !dbConfigured();
const only = args.find((a) => a.startsWith("--source="))?.split("=")[1];

function normalize(raw, source) {
  const byId = new Map();
  const cutoff = Date.now() - 3 * 3600_000;
  for (const e of raw) {
    if (!e.title || !e.startsAt) continue;
    const t = Date.parse(e.startsAt);
    if (Number.isNaN(t) || t < cutoff || t > Date.now() + 400 * 864e5) continue;
    const row = {
      id: `${source.id}_${shortHash(e.occurrenceKey || e.title + e.startsAt)}`,
      source_id: source.id,
      kind: "social",
      title: e.title.slice(0, 300),
      description: e.description || null,
      starts_at: e.startsAt,
      venue: e.where || null, // free-text "where" for social events
      city: source.city || null,
      price_text: e.priceText || null,
      is_free: e.isFree ?? null,
      booking_url: e.bookingUrl || null,
      event_url: e.eventUrl || null,
      image_url: e.imageUrl || null,
      lang: e.lang || "he",
      confidence: e.confidence ?? 0.6,
    };
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

const sources = (await getSocialSources()).filter((s) => !only || s.id === only);
if (!sources.length) {
  console.error("no social_sources configured (run schema5-social.sql + add channels)");
  process.exit(0);
}
console.error(`discovery sources: ${sources.map((s) => s.id).join(", ")}${DRY ? " (DRY)" : ""}`);

let failures = 0;
for (const source of sources) {
  const mod = platforms[source.platform];
  const t0 = Date.now();
  const run = { source_id: source.id, strategy: `discover:${source.platform}`, ok: false, events_found: 0, events_upserted: 0, error: null };
  try {
    if (!mod) throw new Error(`no discovery module for platform "${source.platform}" (Apify FB/IG coming)`);
    const raw = await mod.discover(source);
    const events = normalize(raw, source);
    run.events_found = raw.length;
    run.events_upserted = events.length;
    if (DRY) {
      console.log(`\n=== ${source.id}: ${raw.length} raw -> ${events.length} upcoming`);
      events.slice(0, 10).forEach((e) => console.log(`  ${e.starts_at.slice(0, 16)} | ${e.title} | ${e.venue || "?"} | ${e.price_text ?? ""}`));
    } else {
      await upsertEvents(events);
      console.log(`${source.id}: ${events.length} social events upserted (${raw.length} found)`);
    }
    run.ok = true;
  } catch (e) {
    failures++;
    run.error = String(e.message || e).slice(0, 500);
    console.error(`${source.id} FAILED: ${run.error}`);
    try { mkdirSync("artifacts", { recursive: true }); writeFileSync(`artifacts/${source.id}-error.txt`, `${e.stack || e}`); } catch {}
  }
  run.duration_ms = Date.now() - t0;
  if (!DRY) await logRun(run).catch(() => {});
}
if (failures) process.exitCode = 1;
