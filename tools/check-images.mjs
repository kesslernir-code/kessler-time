// Test every upcoming event's image_url through the same wsrv.nl proxy the page uses.
// Read-only audit: prints which posters actually load, broken by source.
const SUPA = "https://asutadmanyftptvbrbku.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzdXRhZG1hbnlmdHB0dmJyYmt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNjMyNTQsImV4cCI6MjA5NjgzOTI1NH0.wZhhQWGFijWRASC1Tx3ke_A-1ZknrCiKMJQ4RxW953k";

const res = await fetch(`${SUPA}/rest/v1/events?select=id,source_id,title,starts_at,image_url&order=starts_at.asc`, {
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
});
const all = await res.json();
const fut = all.filter((e) => new Date(e.starts_at) >= new Date(Date.now() - 3 * 3600e3) && e.image_url);

const proxy = (u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=320&h=320&fit=cover&output=webp`;
async function head(u) {
  try { const r = await fetch(proxy(u), { method: "GET", signal: AbortSignal.timeout(25000) }); return r.status; } catch { return 0; }
}

const results = [];
let i = 0;
async function worker() { while (i < fut.length) { const e = fut[i++]; results.push({ ...e, status: await head(e.image_url) }); } }
await Promise.all(Array.from({ length: 8 }, worker));

const bad = results.filter((r) => r.status !== 200);
const bySrc = {};
for (const r of results) { const s = (bySrc[r.source_id] ||= { ok: 0, bad: 0 }); if (r.status === 200) s.ok++; else s.bad++; }
console.log(`tested ${results.length} upcoming events with image_url`);
console.log(`OK: ${results.length - bad.length}  BROKEN: ${bad.length}\n`);
console.log("per source (ok / broken):");
for (const [k, v] of Object.entries(bySrc).sort((a, b) => b[1].bad - a[1].bad)) {
  console.log(`  ${k.padEnd(24)} ${v.ok} / ${v.bad}${v.bad ? "  <-- BROKEN" : ""}`);
}
if (bad.length) { console.log("\nALL broken:"); for (const r of bad) console.log(`  [${r.source_id}] ${r.image_url}`); }
