// How does cinema.co.il (Tel Aviv Cinematheque) expose films + posters?
// The scraper stored event_url=homepage for every film, so posters are lost.
import { getSources } from "./lib/db.js";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
async function get(u){const r=await fetch(u,{headers:{"User-Agent":UA},redirect:"follow",signal:AbortSignal.timeout(30000)});return{ok:r.ok,status:r.status,text:r.ok?await r.text():""};}

const sources = (await getSources()) || [];
const c = sources.find(s => s.id === "cinema") || sources.find(s => /cinema\.co\.il/.test(s.url||""));
console.log("CINEMA SOURCE:", JSON.stringify(c));

const ROOT = "https://www.cinema.co.il";
const home = await get(ROOT + "/");
console.log(`\nhome status=${home.status} bytes=${home.text.length} isWP=${/wp-json|wp-content/.test(home.text)}`);

// WP REST types
const types = await get(ROOT + "/wp-json/wp/v2/types");
if (types.ok) {
  const j = JSON.parse(types.text);
  console.log("WP types:", Object.keys(j).join(", "));
  for (const [k, info] of Object.entries(j)) {
    const rb = info?.rest_base; if (!rb) continue;
    if (!/film|movie|screening|event|show|סרט|הקרנ|מופע/i.test(k+rb+(info.name||""))) continue;
    const items = await get(`${ROOT}/wp-json/wp/v2/${rb}?per_page=3&_embed=wp:featuredmedia`);
    if (!items.ok) { console.log(`  ${rb}: HTTP ${items.status}`); continue; }
    const arr = JSON.parse(items.text);
    console.log(`\n  REST ${rb}: ${arr.length} items`);
    for (const it of arr) {
      const feat = it._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
      const cimg = (it.content?.rendered||"").match(/<img[^>]+src=["']([^"']+)/i)?.[1];
      console.log(`    - "${(it.title?.rendered||"").slice(0,35)}" feat=${feat||"-"} contentImg=${(cimg||"-").slice(0,60)} link=${it.link}`);
    }
  }
} else {
  console.log("WP types: HTTP", types.status);
}

// Look at how films link on the homepage: find individual film/event page links
const links = [...home.text.matchAll(/href=["'](https?:\/\/[^"']*(?:film|movie|event|screening|הקרנה|\/movie\/|\/film\/)[^"']*)["']/gi)].map(m=>m[1]);
console.log("\nfilm-ish links (first 10):");
console.log([...new Set(links)].slice(0,10).join("\n") || "(none)");
console.log("\n=== DONE ===");
