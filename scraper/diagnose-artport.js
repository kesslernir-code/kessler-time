// Diagnose artport.art image state: what does the source produce, and are the
// stored image URLs actually loadable (not 403/hotlink-blocked)?
import { getSources } from "./lib/db.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// 1. Show the artport source row
const sources = (await getSources()) || [];
const art = sources.find((s) => /artport/i.test(s.id) || /artport\.art/i.test(s.url || ""));
console.log("ARTPORT SOURCE:", JSON.stringify(art, null, 1));

// 2. Pull its events from the DB and test each image_url
const url = process.env.SUPABASE_URL.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const evs = await (await fetch(`${url}/rest/v1/events?source_id=eq.${art.id}&select=title,image_url,event_url,starts_at&order=starts_at.asc`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
})).json();
console.log(`\n${evs.length} events in DB for ${art.id}`);

for (const e of evs) {
  let imgStatus = "(no image_url)";
  if (e.image_url) {
    try {
      const r = await fetch(e.image_url, { method: "GET", headers: { "User-Agent": UA, Referer: "https://www.artport.art/" }, signal: AbortSignal.timeout(12000) });
      const ct = r.headers.get("content-type") || "";
      imgStatus = `HTTP ${r.status} ${ct}`;
    } catch (err) { imgStatus = "ERR " + err.message; }
  }
  console.log(`\n- ${e.title?.slice(0, 45)}`);
  console.log(`  img: ${e.image_url || "(none)"}`);
  console.log(`  load: ${imgStatus}`);
  console.log(`  event_url: ${e.event_url}`);
}
console.log("\n=== DONE ===");
