// Full image audit: per source, count upcoming events, how many have an image_url,
// and how many actually LOAD through the wsrv proxy (the real test).
const SUPA = "https://asutadmanyftptvbrbku.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzdXRhZG1hbnlmdHB0dmJyYmt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNjMyNTQsImV4cCI6MjA5NjgzOTI1NH0.wZhhQWGFijWRASC1Tx3ke_A-1ZknrCiKMJQ4RxW953k";
const since = new Date(Date.now() - 3 * 3600e3).toISOString();
const s = encodeURIComponent(since);
const r = await fetch(`${SUPA}/rest/v1/events?select=source_id,title,image_url,starts_at&or=(starts_at.gte.${s},ends_at.gte.${s},starts_at.is.null)&limit=2000`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
const events = await r.json();

const proxy = (u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=320&h=320&fit=cover&output=webp`;
async function loads(u) { try { const x = await fetch(proxy(u), { signal: AbortSignal.timeout(20000) }); return x.ok && (x.headers.get("content-type") || "").startsWith("image/"); } catch { return false; } }

// validate every image with limited concurrency
const withUrl = events.filter((e) => e.image_url);
const okSet = new Set();
let i = 0;
async function worker() { while (i < withUrl.length) { const e = withUrl[i++]; if (await loads(e.image_url)) okSet.add(e); } }
await Promise.all(Array.from({ length: 10 }, worker));

const bySrc = {};
for (const e of events) {
  const b = (bySrc[e.source_id] ||= { total: 0, url: 0, loads: 0 });
  b.total++; if (e.image_url) b.url++; if (okSet.has(e)) b.loads++;
}
const rows = Object.entries(bySrc).map(([id, b]) => ({ id, ...b, pct: Math.round((b.loads / b.total) * 100) }));
rows.sort((a, b) => a.pct - b.pct || (b.total - b.loads) - (a.total - a.loads));

console.log(`\n=== FULL IMAGE REVIEW (${events.length} upcoming events, ${new Date().toISOString().slice(0,10)}) ===`);
console.log(`source                 shown/total   (url but broken)`);
for (const r of rows) {
  const broken = r.url - r.loads;
  const flag = r.loads === r.total ? "OK" : r.loads / r.total < 0.5 ? "✗ FAIL" : "⚠ WARN";
  console.log(`  ${r.id.padEnd(20)} ${String(r.loads).padStart(3)}/${String(r.total).padEnd(3)}  ${flag.padEnd(7)} ${broken ? `(${broken} stored-but-broken)` : (r.total - r.url ? `(${r.total - r.url} no url)` : "")}`);
}
const totLoads = rows.reduce((a, r) => a + r.loads, 0), tot = events.length;
console.log(`\nTOTAL: ${totLoads}/${tot} events show a poster (${tot - totLoads} missing)`);
const bad = rows.filter((r) => r.loads < r.total);
console.log(bad.length ? `Sources needing attention: ${bad.map((r) => r.id).join(", ")}` : "All sources fully imaged ✓");
