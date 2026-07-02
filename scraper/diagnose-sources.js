// Audit every enabled source: does it produce events + images + info?
// Flags newly-added or poorly-reading sources (0 events, 0 images, no info).
import { getSources } from "./lib/db.js";

const url = process.env.SUPABASE_URL.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const now = new Date(Date.now() - 3 * 3600e3).toISOString();

const sources = (await getSources()) || [];
console.log(`${sources.length} enabled sources\n`);

const DIRECTORY = new Set(["bars", "restaurants", "festival"]);
const rows = [];
for (const s of sources) {
  const evs = await (await fetch(
    `${url}/rest/v1/events?source_id=eq.${s.id}&starts_at=gte.${encodeURIComponent(now)}&select=image_url`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  )).json();
  const n = evs.length, img = evs.filter((e) => e.image_url).length;
  const isDir = DIRECTORY.has(s.category);
  rows.push({ id: s.id, name: s.name, strat: s.strategy, cat: s.category, url: s.url, n, img,
    hasInfo: Boolean(s.image), isDir });
}

console.log("=== ALL SOURCES (id · category · strategy · events · images · info) ===");
for (const r of rows.sort((a,b)=>a.id.localeCompare(b.id))) {
  let flag = "";
  if (r.isDir) flag = r.hasInfo ? "" : " ⚠ no info image";
  else if (r.n === 0) flag = " ✗ NO EVENTS";
  else if (r.img === 0) flag = " ✗ no images";
  else if (r.img / r.n < 0.5) flag = " ⚠ few images";
  console.log(`  ${r.id.padEnd(20)} ${(r.cat||"?").padEnd(12)} ${(r.strat||"?").padEnd(16)} ev=${r.n} img=${r.img}${r.isDir?" [dir]":""}${flag}`);
}

console.log("\n=== PROBLEM SOURCES ===");
for (const r of rows) {
  if (r.isDir && !r.hasInfo) console.log(`  ${r.id} (${r.name}) — directory, no info image; url=${r.url}`);
  else if (!r.isDir && r.n === 0) console.log(`  ${r.id} (${r.name}) — 0 events; strat=${r.strat}; url=${r.url}`);
  else if (!r.isDir && r.img === 0) console.log(`  ${r.id} (${r.name}) — events but 0 images; strat=${r.strat}; url=${r.url}`);
}
console.log("\n=== DONE ===");
