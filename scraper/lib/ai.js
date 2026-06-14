// Claude API via plain fetch. Used only where structured strategies can't get a field.
const MODEL = "claude-haiku-4-5-20251001"; // cheap + plenty for extraction

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

async function ask(prompt, maxTokens = 4000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.content.map((b) => b.text || "").join("");
}

function parseJsonArray(text) {
  const stripped = text.replace(/^```(json)?/m, "").replace(/```\s*$/m, "");
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error(`Claude returned no JSON array: ${text.slice(0, 200)}`);
  return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * Batch field extraction: given event texts (often Hebrew), return per-key
 * { key, date: "YYYY-MM-DD"|null, time: "HH:MM"|null, end_time, price_text, is_free }.
 * One API call for the whole batch keeps cost negligible.
 */
export async function extractFieldsBatch(items, todayISO) {
  const list = items
    .map(
      (it) =>
        `### key: ${it.key}\nTITLE: ${it.title}\n` +
        (it.links?.length ? `LINKS: ${it.links.slice(0, 5).join(" , ")}\n` : "") +
        `TEXT:\n${it.text.slice(0, 900)}`
    )
    .join("\n\n");
  const prompt = `Today is ${todayISO} (Israel). Below are event announcements, mostly in Hebrew, scraped from venue websites.
For EACH item, find the event's actual date and start time from the text. Hebrew date formats like "19.6", "יום שישי 13.6", "שבת 14/6", times like "19:30 דלתות" (doors) or "20:00 התחלה" (start) are common — prefer the start time over doors time. If a year is missing, choose the year that makes the date today or in the future. Also extract price if mentioned (e.g. "35 ש״ח", "₪50", "כניסה חופשית" = free).

Return ONLY a JSON array, one object per item:
[{"key": "...", "date": "YYYY-MM-DD" or null if no real date in the text, "time": "HH:MM" or null, "end_time": "HH:MM" or null, "price_text": "..." or null, "is_free": true/false/null, "booking_url": one of the item's LINKS only if its clear purpose is buying tickets or registering for THIS event (never articles, reviews, press, social media or general info pages — when unsure use null)}]

${list}`;
  const out = parseJsonArray(await ask(prompt, 8000));
  return new Map(out.map((o) => [o.key, o]));
}

/**
 * Relevance filter for the autonomous discovery feed. FB event search is broad
 * and drags in noise (religious services, kids classes, business promos). Keep
 * only genuine under-radar culture/nightlife happenings.
 * Returns Map(key -> true/false).
 */
export async function filterUnderRadar(items) {
  if (!items.length) return new Map();
  const list = items.map((it) => `### ${it.key}\n${it.title}\n@ ${it.where || "?"}`).join("\n\n");
  const prompt = `Below are events found by searching Facebook. Keep ONLY genuine culture / nightlife / arts happenings that fit an "under the radar" events guide: parties, raves, DJ nights, club nights, live music, concerts, gigs, gallery openings, art exhibitions, performances, theater, dance, film screenings, festivals, special bar/cultural events.

REJECT (keep=false): religious services/prayers/minyan, kids' or children's classes, language courses, lessons/workshops that are courses, business/marketing promos, food/restaurant/bakery promotions, real-estate, sports games, networking/business meetups, generic recurring non-events, anything not a cultural/nightlife happening.

Return ONLY a JSON array: [{"key":"...","keep":true/false}]

${list}`;
  const out = parseJsonArray(await ask(prompt, 4000));
  return new Map(out.map((o) => [o.key, o.keep === true]));
}

/**
 * Social-post triage + extraction. Social feeds are noisy (announcements, memes,
 * recaps). For each post decide if it announces a SPECIFIC upcoming event and, if
 * so, pull the details. Returns Map(key -> {is_event, title, date, time, where, price_text, is_free, booking_url}).
 */
export async function extractSocialEvents(items, todayISO) {
  const list = items
    .map((it) => `### key: ${it.key}\nPOSTED: ${it.posted}\n${it.links?.length ? `LINKS: ${it.links.slice(0, 4).join(" , ")}\n` : ""}TEXT:\n${it.text.slice(0, 1100)}`)
    .join("\n\n");
  const prompt = `Today is ${todayISO} (Israel). Below are social-media posts (mostly Hebrew) from culture/nightlife channels. Many are NOT event announcements (general updates, photos, memes, recaps of past events, calls for artists). For EACH post decide whether it announces ONE specific UPCOMING event with a real date, and if so extract its details.

Rules:
- is_event=false for: past events, recaps, general info, merch, multiple-unrelated-events digests, anything without a concrete future date.
- The post date (POSTED) is when it was written, NOT the event date — find the event date in the text ("מחר", "שישי הקרוב", "14.6", "במוצ״ש"). Resolve relative dates against today; pick the next future occurrence.
- "where" = the venue/location named in the text (free text, may be a place, address, or "סוד/יודיע בהמשך").
- booking_url = a registration/tickets link from LINKS if clearly for this event, else null.

Return ONLY a JSON array, one object per post:
[{"key":"...","is_event":true/false,"title":"short event title","date":"YYYY-MM-DD" or null,"time":"HH:MM" or null,"where":"..." or null,"price_text":"..." or null,"is_free":true/false/null,"booking_url":"..." or null}]

${list}`;
  const out = parseJsonArray(await ask(prompt, 8000));
  return new Map(out.map((o) => [o.key, o]));
}

/**
 * Generic last-resort extractor: whole-page text -> events. Used by the auto
 * ladder for future sources that have no structured data.
 */
export async function extractEventsFromPage({ sourceName, url, text }, todayISO) {
  const prompt = `Today is ${todayISO} (Israel). The text below is from the events page of "${sourceName}" (${url}).
Extract every distinct upcoming event that has a real, parseable date. Return ONLY a JSON array:
[{"title": "...", "description": "..." (short, optional), "date": "YYYY-MM-DD", "time": "HH:MM" or null, "price_text": "..." or null, "is_free": true/false/null, "event_url": "..." or null, "image_url": "..." or null, "confidence": 0.0-1.0}]
If a year is missing assume the next future occurrence. Do not invent events or dates.

PAGE TEXT:
${text.slice(0, 28000)}`;
  return parseJsonArray(await ask(prompt, 8000));
}
