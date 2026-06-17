// Facebook discovery via Graph API — free, no login wall.
// Fetches upcoming events from a public Facebook Page using an App Access Token.

export const platform = "facebook";

const GRAPH = "https://graph.facebook.com/v20.0";
const TOKEN = process.env.FACEBOOK_APP_TOKEN;
const FIELDS = "id,name,description,start_time,end_time,place,cover";

export async function discover(source, log = console.error) {
  if (!TOKEN) {
    log(`  [${source.id}] facebook: skipped (no FACEBOOK_APP_TOKEN)`);
    return [];
  }

  const handle = source.handle;
  const url = `${GRAPH}/${handle}/events?access_token=${TOKEN}&fields=${FIELDS}&time_filter=upcoming&limit=50`;

  let data;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Graph API ${res.status}: ${body.slice(0, 200)}`);
    }
    data = await res.json();
  } catch (err) {
    log(`  [${source.id}] facebook graph error: ${err.message}`);
    return [];
  }

  const items = data.data || [];
  log(`  [${source.id}] facebook graph events: ${items.length}`);

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const out = [];

  for (const ev of items) {
    if (!ev.start_time) continue;
    const startsAt = ev.start_time.includes("T")
      ? ev.start_time
      : `${ev.start_time}T20:00:00+03:00`;

    if (startsAt.slice(0, 10) < todayPrefix) continue;

    const where = ev.place?.name || ev.place?.location?.city || null;
    const imageUrl = ev.cover?.source || null;

    out.push({
      occurrenceKey: `fb-${ev.id}`,
      title: (ev.name || "").slice(0, 200),
      description: (ev.description || "").slice(0, 600) || null,
      startsAt,
      where,
      priceText: null,
      isFree: null,
      bookingUrl: `https://www.facebook.com/events/${ev.id}`,
      eventUrl: `https://www.facebook.com/events/${ev.id}`,
      imageUrl,
      lang: "he",
      confidence: 0.85,
    });
  }

  log(`  [${source.id}] facebook: ${out.length} upcoming events`);
  return out;
}
