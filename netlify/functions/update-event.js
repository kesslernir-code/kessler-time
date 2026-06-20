// Netlify function: edit a manually-added event (change its category) or delete it.
// Password-gated (ADMIN_PW); writes with the service-role key. Scoped to
// source_id='manual' so it can only touch hand-added events, never scraped ones.
// Body: { secret, id, category }  or  { secret, id, delete: true }
export async function handler(event) {
  try { return await run(event); }
  catch (e) { console.error("update-event crashed:", e); return resp(500, { error: "update-event crashed: " + (e?.message || String(e)) }); }
}

async function run(event) {
  if (event.httpMethod !== "POST") return resp(405, { error: "method not allowed" });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return resp(400, { error: "bad json" }); }
  if (!process.env.ADMIN_PW || body.secret !== process.env.ADMIN_PW) return resp(401, { error: "wrong password" });

  const envVal = (v, name) => String(v || "").replace(new RegExp("^\\s*" + name + "\\s*=\\s*"), "").trim();
  const SUPA = envVal(process.env.SUPABASE_URL, "SUPABASE_URL").replace(/\/$/, "");
  const KEY = envVal(process.env.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPA || !KEY) return resp(500, { error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on Netlify" });

  const id = (body.id || "").trim();
  if (!id) return resp(400, { error: "id required" });
  // only manual events are editable here
  const q = `${SUPA}/rest/v1/events?id=eq.${encodeURIComponent(id)}&source_id=eq.manual`;
  const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" };

  let r;
  if (body.delete === true) {
    r = await fetch(q, { method: "DELETE", headers: hdr });
  } else {
    const category = (body.category || "").trim();
    if (!category) return resp(400, { error: "category required" });
    r = await fetch(q, { method: "PATCH", headers: hdr, body: JSON.stringify({ category }) });
  }
  if (!r.ok) return resp(502, { error: `db ${body.delete ? "delete" : "update"} failed: ${r.status} ${(await r.text()).slice(0, 200)}` });
  return resp(200, { ok: true });
}

const resp = (statusCode, obj) => ({ statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
