// One-shot repair of events whose image_url is junk (FB tracking pixel / social
// post link) rather than a poster. Recovers real posters where possible:
//   - levontin7: poster sits on the LISTING page next to each event link
//   - gagarin:   poster is a content <img> on the detail page
//   - everything else (login-walled FB/Wix): null -> clean placeholder
// Verifies each recovered URL actually loads through wsrv before writing.
// Note: most FB sources are better handled by check.js (crawler + re-host); this
// is the manual cleanup used to fix already-stored junk.
//
// Usage:  node tools/fix-junk-images.mjs          (dry run, prints plan)
//         node tools/fix-junk-images.mjs --apply   (writes to the DB)
import { readFileSync } from "node:fs";
import { isJunkImageUrl } from "../scraper/lib/util.js";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")])
);
const SUPA = (env.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA || !KEY) { console.error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env"); process.exit(1); }

const get = async (url) => (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "he-IL" }, signal: AbortSignal.timeout(25000) })).text();
const proxy = (u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=320&h=320&fit=cover&output=webp`;
async function loads(u) {
  try { const r = await fetch(proxy(u), { signal: AbortSignal.timeout(20000) }); return r.ok && (r.headers.get("content-type") || "").startsWith("image/"); } catch { return false; }
}

const IMG_BLACKLIST = /logo|icon|favicon|placeholder|blank|spinner|loading|sponsor|footer|header|gravatar|cropped-|tarbut_sport|לוגו|def_img|default|banner/i;
const IMG_SRC = /(?:data-lazy-src|data-src|src)="\s*(https?:\/\/[^"\s]+\.(?:jpe?g|png|webp)[^"\s]*)"/gi;

async function levontinMap() {
  const listing = await get("https://levontin7.com/");
  const near = (linkRaw) => {
    const idx = listing.indexOf(linkRaw);
    if (idx === -1) return null;
    const seg = listing.slice(Math.max(0, idx - 2500), idx);
    const imgs = [...seg.matchAll(IMG_SRC)].map((m) => m[1]).filter((u) => !IMG_BLACKLIST.test(u));
    return imgs.pop() || null;
  };
  const map = new Map();
  for (const m of listing.matchAll(/href="(https?:\/\/levontin7\.com\/event[^"]*)"/g)) {
    const raw = m[1].replace(/&amp;/g, "&");
    const clean = (() => { try { const u = new URL(raw); return u.origin + u.pathname; } catch { return raw; } })();
    if (!map.has(clean)) { const img = near(m[1]); if (img) map.set(clean, img); }
  }
  return map;
}
async function gagarinPoster(eventUrl) {
  try {
    const html = await get(eventUrl);
    const imgs = [...new Set([...html.matchAll(IMG_SRC)].map((m) => m[1]).filter((u) => !IMG_BLACKLIST.test(u)))];
    return imgs.find((u) => /cover|poster/i.test(u) && !/-\d+x\d+\./.test(u)) || imgs.find((u) => !/-\d+x\d+\./.test(u)) || imgs[0] || null;
  } catch { return null; }
}

const res = await fetch(`${SUPA}/rest/v1/events?select=id,source_id,title,event_url,image_url,starts_at`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
const all = await res.json();
const today = new Date(); today.setHours(0, 0, 0, 0);
const bad = all.filter((e) => new Date(e.starts_at) >= today && isJunkImageUrl(e.image_url));
console.log(`junk-image upcoming events: ${bad.length}\n`);

const levMap = await levontinMap();
console.log(`levontin7 listing poster map: ${levMap.size} entries\n`);

const plan = [];
for (const e of bad) {
  let candidate = null;
  if (e.source_id === "levontin7" && e.event_url) {
    const clean = (() => { try { const u = new URL(e.event_url); return u.origin + u.pathname; } catch { return e.event_url; } })();
    candidate = levMap.get(clean) || levMap.get(clean.replace(/\/$/, "")) || levMap.get(clean + "/") || null;
  } else if (e.source_id === "gagarin" && e.event_url) {
    candidate = await gagarinPoster(e.event_url);
  }
  let newImage = null, why = "null -> placeholder (unrecoverable)";
  if (candidate && !isJunkImageUrl(candidate) && (await loads(candidate))) { newImage = candidate; why = "recovered poster"; }
  plan.push({ id: e.id, source_id: e.source_id, newImage, why });
}

// A candidate reused across many events is a site banner/default, not a poster — demote.
const freq = new Map();
for (const p of plan) if (p.newImage) freq.set(p.newImage, (freq.get(p.newImage) || 0) + 1);
for (const p of plan) if (p.newImage && freq.get(p.newImage) >= 3) { p.newImage = null; p.why = "null -> placeholder (shared banner)"; }

const recovered = plan.filter((p) => p.newImage).length;
console.log(`PLAN: recover ${recovered} posters, null ${plan.length - recovered} (placeholder)\n`);
for (const p of plan) console.log(`  [${p.source_id}] ${p.why}${p.newImage ? " -> " + p.newImage.slice(0, 80) : ""}`);

if (!APPLY) { console.log(`\n(dry run — re-run with --apply to write)`); process.exit(0); }

let ok = 0;
for (const p of plan) {
  const r = await fetch(`${SUPA}/rest/v1/events?id=eq.${encodeURIComponent(p.id)}`, {
    method: "PATCH",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ image_url: p.newImage }),
  });
  if (r.ok) ok++; else console.error(`  PATCH failed ${p.id}: ${r.status} ${await r.text()}`);
}
console.log(`\napplied ${ok}/${plan.length} updates.`);
