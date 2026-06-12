// Minimal Supabase PostgREST client — plain fetch, no SDK.
const url = () => process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export const dbConfigured = () => Boolean(url() && key());

async function rest(path, init = {}) {
  const res = await fetch(`${url()}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase ${init.method || "GET"} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null; // 201/204 success responses have an empty body
}

/** Upsert by id. first_seen_at is intentionally absent so it survives updates. */
export async function upsertEvents(rows) {
  if (!rows.length) return 0;
  const stamped = rows.map((r) => ({ ...r, last_seen_at: new Date().toISOString() }));
  await rest("events?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(stamped),
  });
  return rows.length;
}

/** Map of event_url -> id for one source (lets strategies skip AI work on events we already know). */
export async function knownEventUrls(sourceId) {
  if (!dbConfigured()) return new Map();
  const rows = await rest(`events?source_id=eq.${sourceId}&select=id,event_url`);
  return new Map(rows.filter((r) => r.event_url).map((r) => [r.event_url, r.id]));
}

export async function logRun(run) {
  if (!dbConfigured()) return;
  await rest("scrape_runs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(run),
  });
}
