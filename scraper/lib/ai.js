// Claude API via plain fetch. Used only where structured strategies can't get a field.
const MODEL = "claude-haiku-4-5-20251001"; // cheap + plenty for extraction
const VISION_MODEL = "claude-sonnet-4-6"; // reads event posters — Sonnet for accurate Hebrew OCR

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

async function askVision(content, maxTokens = 4000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: VISION_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) throw new Error(`Claude vision ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).content.map((b) => b.text || "").join("");
}

/**
 * Read event POSTER images (Wix galleries, flyers) with Claude vision and
 * extract the event from each. Returns [{imageUrl, title, date, time, where, price_text, is_free}].
 */
export async function extractEventsFromImages(imageUrls, { sourceName, todayISO }) {
  if (!imageUrls.length) return [];
  const content = [{
    type: "text",
    text: `Today is ${todayISO} (Israel). The following are event POSTER images from "${sourceName}" (mostly Hebrew). Read each poster and extract the event it advertises. Return ONLY a JSON array, one object per image by its index:
[{"i":0,"is_event":true/false,"title":"...","date":"YYYY-MM-DD" or null,"time":"HH:MM" or null,"where":"..." or null,"price_text":"..." or null,"is_free":true/false/null}]
Set is_event=false for logos, decorations, or images that are not a specific event with a real future date.`,
  }];
  imageUrls.forEach((url, i) => {
    content.push({ type: "text", text: `IMAGE ${i}:` });
    content.push({ type: "image", source: { type: "url", url } });
  });
  const out = parseJsonArray(await askVision(content, 6000));
  return out
    .filter((o) => o.is_event && /^\d{4}-\d{2}-\d{2}$/.test(o.date || "") && imageUrls[o.i])
    .map((o) => ({ ...o, imageUrl: imageUrls[o.i] }));
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
  // returns a boolean[] aligned to `items` (true = keep). Uses short numeric
  // keys so the model echoes them back reliably.
  if (!items.length) return [];
  const list = items.map((it, i) => `### ${i}\n${it.title}\n@ ${it.where || "?"}`).join("\n\n");
  const prompt = `Below are events found by searching Facebook. This is an "under the radar" culture guide with a WIDE scope — keep anything that is a real happening a person can show up to and attend: parties, raves, DJ/club nights, live music, concerts, gigs, gallery openings, art exhibitions, performances, theater, dance, film screenings, festivals, lectures, talks, workshops, D&D / tabletop / board-game nights, jams, open mics, markets/fairs, community & social meetups, special bar/cultural events, courses with a specific date.

REJECT (keep=false) ONLY clear non-events: religious prayer services (minyan/shul/mass), classes for young children, pure product/retail/food promotions (e.g. a bakery opening), real-estate, business/B2B sales or networking, sports matches, and generic always-open / no-real-date listings.

When unsure, KEEP it (wide scope).

Return ONLY a JSON array with one object per item, by its number:
[{"i":0,"keep":true/false}, ...]

${list}`;
  const out = parseJsonArray(await ask(prompt, 4000));
  const map = new Map(out.map((o) => [Number(o.i), o.keep === true]));
  return items.map((_, i) => map.get(i) !== false); // default keep if model omitted one
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
Extract the next 30 distinct upcoming events that has a real, parseable date. Return ONLY a JSON array:
[{"title": "...", "description": "..." (short, optional), "date": "YYYY-MM-DD", "time": "HH:MM" or null, "price_text": "..." or null, "is_free": true/false/null, "event_url": "..." or null, "image_url": "..." or null, "confidence": 0.0-1.0}]
If a year is missing assume the next future occurrence. Do not invent events or dates.

PAGE TEXT:
${text.slice(0, 15000)}`;
  return parseJsonArray(await ask(prompt, 8000));
}
