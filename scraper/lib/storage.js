// Re-host posters into Supabase Storage so the public page can show them.
// Needed for venues that block the wsrv proxy and/or hotlinking (e.g. levontin7
// serves a "This image was hotlinked" placeholder to browsers). We fetch the
// real image server-side (no Referer) and serve our own copy, which the page
// loads through the normal proxy without any block.
const url = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "event-images";

/** Create the public event-images bucket if missing (idempotent). */
export async function ensureBucket() {
  if (!url() || !key()) return;
  await fetch(`${url()}/storage/v1/bucket`, {
    method: "POST",
    headers: { apikey: key(), Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  }).catch(() => {});
}

/** Download an image server-side and store it under a stable key; returns the
 *  public Storage URL, or null if the source didn't return a real image. */
export async function rehostImage(imageUrl, storageKey) {
  if (!url() || !key() || !imageUrl) return null;
  try {
    const r = await fetch(imageUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; kessler-time/1.0)" }, // no Referer → real image, not a hotlink block
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const ct = r.headers.get("content-type") || "";
    if (!r.ok || !ct.startsWith("image/")) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 3000) return null; // a few hundred bytes/tiny = error or 1x1, not a poster
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

/** True for our own re-hosted Storage URLs (already proxy-safe). */
export const isRehosted = (u) => /\/storage\/v1\/object\/public\/event-images\//.test(u || "");
