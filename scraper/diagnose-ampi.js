// Diagnostic #2: where does the amphitlv `event` post type keep its poster image?
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000) });
  return { status: res.status, ok: res.ok, text: res.ok ? await res.text() : "" };
}
const ROOT = "https://amphitlv.co.il";

// 1. Full JSON of one event, with everything embedded
const r = await get(`${ROOT}/wp-json/wp/v2/event?per_page=1&_embed`);
const ev = JSON.parse(r.text)[0];
console.log("=== EVENT KEYS ===");
console.log(Object.keys(ev).join(", "));
console.log("\n=== meta ===");
console.log(JSON.stringify(ev.meta, null, 1)?.slice(0, 1500));
console.log("\n=== acf (if any) ===");
console.log(JSON.stringify(ev.acf, null, 1)?.slice(0, 1500));
console.log("\n=== yoast_head_json.og_image ===");
console.log(JSON.stringify(ev.yoast_head_json?.og_image));
console.log("\n=== _embedded keys ===");
console.log(Object.keys(ev._embedded || {}).join(", "));
console.log("featuredmedia:", JSON.stringify(ev._embedded?.["wp:featuredmedia"]?.[0]?.source_url));
console.log("featured_media id:", ev.featured_media);

// 2. Scan the whole event JSON for any wp-content/uploads image URL
const blob = JSON.stringify(ev);
const uploads = [...blob.matchAll(/https?:\\?\/\\?\/[^"]*wp-content\/uploads[^"]*?\.(?:jpg|jpeg|png|webp)/gi)].map(m => m[0].replace(/\\\//g, "/"));
console.log("\n=== uploads URLs found anywhere in event JSON ===");
console.log([...new Set(uploads)].slice(0, 10).join("\n") || "(none)");

// 3. Fetch the individual event page and read its og:image
console.log("\n=== individual event page og:image ===");
const page = await get(ev.link);
const og = page.text.match(/<meta[^>]+property=["']og:image[^>]*content=["']([^"']+)/i)?.[1]
  || page.text.match(/content=["']([^"']+)["'][^>]+property=["']og:image/i)?.[1];
console.log("status", page.status, "og:image =", og || "(none)");
const tw = page.text.match(/<meta[^>]+name=["']twitter:image[^>]*content=["']([^"']+)/i)?.[1];
console.log("twitter:image =", tw || "(none)");
console.log("\n=== DONE ===");
