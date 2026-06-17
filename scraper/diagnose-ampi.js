// One-off diagnostic: figure out how amphitlv.co.il exposes its events + images.
// Run in CI (the runner has open network); read the output from the Actions log.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "he-IL,he;q=0.9,en;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  return { status: res.status, ok: res.ok, text: res.ok ? await res.text() : "" };
}

function show(label, v) { console.log(`\n========== ${label} ==========\n${v}`); }

const ROOT = "https://amphitlv.co.il";

// 1. Homepage
const home = await get(ROOT + "/");
console.log(`HOME status=${home.status} bytes=${home.text.length}`);
console.log(`isWix=${/wixsite|_wix_|wix-warmup-data|parastorage/i.test(home.text)}`);
console.log(`isWP=${/wp-content|wp-json|\/wp\//i.test(home.text)}`);

// 2. og:image on homepage
const og = home.text.match(/<meta[^>]+property=["']og:image[^>]*content=["']([^"']+)/i)?.[1]
  || home.text.match(/content=["']([^"']+)["'][^>]+property=["']og:image/i)?.[1];
console.log(`HOME og:image = ${og || "(none)"}`);

// 3. JSON-LD blocks
const ld = [...home.text.matchAll(/<script type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
console.log(`HOME json-ld blocks: ${ld.length}`);
ld.slice(0, 3).forEach((b, i) => show(`json-ld[${i}] (first 500)`, b[1].slice(0, 500)));

// 4. WP REST API probe
try {
  const types = await get(ROOT + "/wp-json/wp/v2/types");
  if (types.ok) {
    const j = JSON.parse(types.text);
    show("WP types", Object.keys(j).join(", "));
    // try common event rest bases
    for (const rb of Object.values(j).map(t => t?.rest_base).filter(Boolean)) {
      if (!/event|show|מופע|אירוע|program|gig/i.test(rb)) continue;
      const items = await get(`${ROOT}/wp-json/wp/v2/${rb}?per_page=3&_embed=wp:featuredmedia`);
      if (!items.ok) { console.log(`  ${rb}: HTTP ${items.status}`); continue; }
      const arr = JSON.parse(items.text);
      console.log(`\n  REST ${rb}: ${arr.length} items`);
      arr.forEach(it => {
        const feat = it._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
        const contentImg = (it.content?.rendered || "").match(/<img[^>]+src=["']([^"']+)/i)?.[1];
        console.log(`    - "${(it.title?.rendered||"").slice(0,40)}" feat=${feat||"-"} contentImg=${contentImg||"-"} link=${it.link}`);
      });
    }
  } else {
    console.log(`WP types: HTTP ${types.status} (not WordPress, or REST disabled)`);
  }
} catch (e) { console.log(`WP probe error: ${e.message}`); }

// 5. Candidate <img> tags on homepage (large, non-icon)
const imgs = [...home.text.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)]
  .map(m => m[1]).filter(s => s.startsWith("http") && !/logo|icon|sprite|favicon/i.test(s));
show("HOME <img> candidates (first 15)", [...new Set(imgs)].slice(0, 15).join("\n"));

// 6. Look for an events listing page link
const eventLinks = [...home.text.matchAll(/href=["']([^"']*(?:event|מופע|show|לוח-מופעים|tickets)[^"']*)["']/gi)]
  .map(m => m[1]);
show("event-ish links (first 15)", [...new Set(eventLinks)].slice(0, 15).join("\n"));

console.log("\n========== DONE ==========");
