// Re-host posters into Supabase Storage so the public page can show them.
// Used for sources whose images aren't directly hotlinkable — notably Facebook,
// whose poster is only served to the link-preview crawler (no login, no cost).
const url = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "event-images";

// Facebook serves og:image + the poster bytes only to its link-preview crawler.
const FB_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const isFbImage = (u) => /lookaside\.fbsbx\.com|scontent|fbcdn\.net/.test(u);

/** Public poster for a Facebook post/page URL, via the login-free crawler path.
 *  Returns a Facebook image URL (lookaside/scontent) or null. */
export async function facebookPoster(postUrl) {
  try {
    const r = await fetch(postUrl, { headers: { "User-Agent": FB_UA, "Accept-Language": "he-IL,en;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const html = await r.text();
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const u = m && m[1].replace(/&amp;/g, "&");
    return u && isFbImage(u) ? u : null;
  } catch {
    return null;
  }
}

/** Download an image (FB needs the crawler UA) and store it in the public
 *  event-images bucket under a stable key. Returns the public URL, or null. */
export async function rehostImage(imageUrl, storageKey) {
  if (!url() || !key() || !imageUrl) return null;
  try {
    const ua = isFbImage(imageUrl) ? FB_UA : "Mozilla/5.0 (compatible; kessler-time/1.0)";
    const r = await fetch(imageUrl, { headers: { "User-Agent": ua }, redirect: "follow", signal: AbortSignal.timeout(20000) });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !ct.startsWith("image/")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) return null; // a few hundred bytes = error page / 1x1, not a poster
    const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";
    const path = `${storageKey}.${ext}`;
    const up = await fetch(`${url()}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { apikey: key(), Authorization: `Bearer ${key()}`, "Content-Type": ct, "x-upsert": "true" },
      body: buf,
    });
    if (!up.ok) return null;
    return `${url()}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(path)}`;
  } catch {
    return null;
  }
}

/** Create the public event-images bucket if missing (idempotent). */
export async function ensureBucket() {
  if (!url() || !key()) return;
  await fetch(`${url()}/storage/v1/bucket`, {
    method: "POST",
    headers: { apikey: key(), Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  }).catch(() => {});
}
