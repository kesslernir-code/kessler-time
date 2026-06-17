// Probe image availability per event page for problem sources.
// For each event: does its event_url yield a poster via og:image / first <img>,
// and (for already-stored images) does the stored URL actually load?
import { getSources } from "./lib/db.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const BAD = /logo|placeholder|sprite|favicon|blank/i;

async function pageImage(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (!r.ok) return `HTTP ${r.status}`;
    const html = await r.text();
    const og = html.match(/<meta[^>]+property=["']og:image[^>]*content=["']([^"']+)/i)?.[1]
      || html.match(/content=["']([^"']+)["'][^>]+property=["']og:image/i)?.[1];
    if (og && !BAD.test(og)) return "og:" + og.slice(0, 70);
    const tw = html.match(/<meta[^>]+name=["']twitter:image[^>]*content=["']([^"']+)/i)?.[1];
    if (tw && !BAD.test(tw)) return "tw:" + tw.slice(0, 70);
    for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
      if (m[1].startsWith("http") && !BAD.test(m[1]) && !/icon|avatar|pixel/i.test(m[1])) return "img:" + m[1].slice(0, 70);
    }
    return "(no image on page)";
  } catch (e) { return "ERR " + e.message; }
}

const url = process.env.SUPABASE_URL.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

for (const sid of ["cinema", "fb-artportlv", "epgb", "gagarin"]) {
  const evs = await (await fetch(`${url}/rest/v1/events?source_id=eq.${sid}&image_url=is.null&select=title,event_url&order=starts_at.asc&limit=4`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })).json();
  console.log(`\n===== ${sid}: ${evs.length} imageless sampled =====`);
  for (const e of evs) {
    console.log(`- ${e.title?.slice(0, 40)}`);
    console.log(`  url: ${e.event_url}`);
    console.log(`  → ${await pageImage(e.event_url)}`);
  }
}
console.log("\n=== DONE ===");
