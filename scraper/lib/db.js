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

/** Map of event id -> image_url for one source — lets a re-scrape keep a poster
 *  the QA agent already found, instead of clobbering it back to null. */
export async function knownImages(sourceId) {
  if (!dbConfigured()) return new Map();
  const rows = await rest(`events?source_id=eq.${sourceId}&image_url=not.is.null&select=id,image_url`);
  return new Map(rows.map((r) => [r.id, r.image_url]));
}

/** Enabled sources from the DB, or null if unavailable (caller falls back to the file list). */
export async function getSources() {
  if (!dbConfigured()) return null;
  try {
    const rows = await rest("sources?enabled=eq.true&select=*&order=added_at.asc");
    return rows.length ? rows : null;
  } catch {
    return null; // table not created yet
  }
}

/** Upcoming events still missing price info but having a booking link. */
export async function eventsMissingPrice(limit = 25) {
  if (!dbConfigured()) return [];
  const now = encodeURIComponent(new Date().toISOString());
  return rest(
    `events?price_text=is.null&is_free=is.null&booking_url=not.is.null&starts_at=gte.${now}&select=id,booking_url,price_text,is_free&limit=${limit}`
  );
}

export async function updateEvent(id, patch) {
  await rest(`events?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

/** Delete one event by id (used by the QC dedup pass). */
export async function deleteEventById(id) {
  await rest(`events?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}

/** Refresh last_seen_at for events we know are still listed but skip re-scraping
 *  (listing-detail-ai), so the stale-prune doesn't delete them. */
export async function touchEvents(ids) {
  if (!dbConfigured() || !ids.length) return;
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).map(encodeURIComponent).join(",");
    await rest(`events?id=in.(${chunk})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_seen_at: now }) });
  }
}

/** Patch a source row (e.g. directory info: image/description/phone). */
export async function updateSourceRow(id, patch) {
  if (!dbConfigured() || !Object.keys(patch).length) return;
  await rest(`sources?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
}

/** Delete all events for a source (used when a place becomes a directory listing). */
export async function deleteSourceEvents(id) {
  if (!dbConfigured()) return;
  await rest(`events?source_id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}

/** Remove UPCOMING events that haven't been re-seen by any scrape in `hours`
 *  (stale: de-duplicated title variants, removed listings). Time-based so a
 *  source that merely varies or fails one run never loses data — an event must
 *  be missing for the whole window. Manual entries are never pruned. */
export async function pruneStaleEvents(hours = 48) {
  if (!dbConfigured()) return;
  const cutoff = encodeURIComponent(new Date(Date.now() - hours * 3600e3).toISOString());
  const now = encodeURIComponent(new Date(Date.now() - 3 * 3600e3).toISOString());
  await rest(`events?last_seen_at=lt.${cutoff}&starts_at=gte.${now}&source_id=neq.manual`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

/** All upcoming events with the fields the QA checker needs. */
export async function upcomingEvents() {
  if (!dbConfigured()) return [];
  const now = encodeURIComponent(new Date(Date.now() - 3 * 3600e3).toISOString());
  return rest(
    `events?starts_at=gte.${now}&select=id,source_id,kind,title,starts_at,image_url,description,booking_url,event_url,price_text,is_free,venue,city&order=starts_at.asc&limit=2000`
  );
}

export async function logRun(run) {
  if (!dbConfigured()) return;
  await rest("scrape_runs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(run),
  });
}
