// Netlify function: save a manually-added event (from the screenshot uploader).
// Hosts the uploaded poster in Supabase Storage and inserts the event row, using
// the service-role key (server-side only). Password-gated by ADMIN_PW.
//
// Required Netlify env vars: ADMIN_PW, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
const BUCKET = "event-images";

export async function handler(event) {
  if (event.httpMethod !== "POST") return resp(405, { error: "method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return resp(400, { error: "bad json" }); }

  if (!process.env.ADMIN_PW || body.secret !== process.env.ADMIN_PW)
    return resp(401, { error: "wrong password" });

  const SUPA = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPA || !KEY) return resp(500, { error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on Netlify" });

  const f = body.fields || {};
  const title = (f.title || "").trim();
  const date = (f.date || "").trim();
  const time = (f.time || "20:00").trim();
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return resp(400, { error: "title and a valid date (YYYY-MM-DD) are required" });

  // deterministic id so re-saving the same event updates it
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  const id = `manual-${slug}-${date}`.slice(0, 120);
  const startsAt = `${date}T${time}:00+03:00`;

  // 1. host the uploaded poster (data URL) in Storage
  let imageUrl = null;
  if (body.imageData) {
    const m = String(body.imageData).match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!m) return resp(400, { error: "imageData must be a data URL" });
    const ext = m[1].includes("png") ? "png" : m[1].includes("webp") ? "webp" : m[1].includes("gif") ? "gif" : "jpg";
    const bytes = Buffer.from(m[2], "base64");
    const path = `${id}.${ext}`;
    const up = await fetch(`${SUPA}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": m[1], "x-upsert": "true" },
      body: bytes,
    });
    if (!up.ok) return resp(502, { error: `image upload failed: ${up.status} ${(await up.text()).slice(0, 150)}` });
    imageUrl = `${SUPA}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(path)}`;
  }

  // 2. insert / update the event row
  const link = (body.eventUrl || "").trim() || null; // FB/IG link — opens when tapping the card/picture
  const row = {
    id, source_id: "manual", title,
    starts_at: startsAt,
    category: f.category || "other",
    venue: (f.venue || "").trim() || null,
    city: (f.city || "").trim() || null,
    description: (f.description || "").trim() || null,
    price_text: (f.price_text || "").trim() || null,
    is_free: typeof f.is_free === "boolean" ? f.is_free : null,
    booking_url: (f.booking_url || "").trim() || null,
    event_url: link,
    image_url: imageUrl,
    confidence: 1.0, lang: "he",
    last_seen_at: new Date().toISOString(),
  };
  const ins = await fetch(`${SUPA}/rest/v1/events?on_conflict=id`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!ins.ok) return resp(502, { error: `db insert failed: ${ins.status} ${(await ins.text()).slice(0, 200)}` });

  return resp(200, { ok: true, id, image_url: imageUrl });
}

const resp = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});
