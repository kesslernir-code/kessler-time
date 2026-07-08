// Claude API via plain fetch. Used only where structured strategies can't get a field.
const MODEL = "claude-haiku-4-5-20251001"; // cheap + plenty for extraction
const VISION_MODEL = "claude-sonnet-4-6"; // reads event posters — Sonnet for accurate Hebrew OCR

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

// Approximate list-price USD per token, for cost tracking / the per-source
// overcharge alert only — not exact (ignores prompt-cache discounts etc).
const PRICE_PER_TOKEN = {
  [MODEL]: { in: 1 / 1e6, out: 5 / 1e6 },
  [VISION_MODEL]: { in: 3 / 1e6, out: 15 / 1e6 },
};
let totalCostUSD = 0;
function trackUsage(model, usage) {
  const p = PRICE_PER_TOKEN[model];
  if (!p || !usage) return;
  totalCostUSD += (usage.input_tokens || 0) * p.in + (usage.output_tokens || 0) * p.out;
}
/** Running total of estimated AI spend since process start (or the last resetCostUSD()). */
export const getCostUSD = () => totalCostUSD;
export const resetCostUSD = () => { totalCostUSD = 0; };

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
  trackUsage(MODEL, data.usage);
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
  const data = await res.json();
  trackUsage(VISION_MODEL, data.usage);
  return data.content.map((b) => b.text || "").join("");
}

/**
 * Read event POSTER images (Wix galleries, flyers) with Claude vision and
 * extract the event from each. Returns [{imageUrl, title, date, time, where, price_text, is_free}].
 */
export async function extractEventsFromImages(imageUrls, { sourceName, todayISO }) {
  if (!imageUrls.length) return [];
  // Download each poster server-side and send it as base64 — sending a URL fails
  // for venues whose servers block Anthropic's image fetcher (hotlink protection).
  const OK_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
  const fetched = [];
  for (const url of imageUrls) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; kessler-time/1.0)" }, signal: AbortSignal.timeout(15000) });
      const mediaType = (r.headers.get("content-type") || "").split(";")[0].trim();
      if (!r.ok || !OK_TYPES.has(mediaType)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 2000 || buf.length > 4_500_000) continue; // skip tiny errors / oversized
      fetched.push({ url, mediaType, data: buf.toString("base64") });
    } catch { /* skip unreachable images */ }
  }
  if (!fetched.length) return [];
  const content = [{
    type: "text",
    text: `Today is ${todayISO} (Israel). The following are event POSTER images from "${sourceName}" (mostly Hebrew). Read each poster and extract the event it advertises. Return ONLY a JSON array, one object per image by its index:
[{"i":0,"is_event":true/false,"title":"...","date":"YYYY-MM-DD" or null,"time":"HH:MM" or null,"where":"..." or null,"price_text":"..." or null,"is_free":true/false/null}]
Set is_event=false for logos, decorations, or images that are not a specific event with a real future date.`,
  }];
  fetched.forEach((f, i) => {
    content.push({ type: "text", text: `IMAGE ${i}:` });
    content.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.data } });
  });
  const out = parseJsonArray(await askVision(content, 6000));
  return out
    .filter((o) => o.is_event && /^\d{4}-\d{2}-\d{2}$/.test(o.date || "") && fetched[o.i])
    .map((o) => ({ ...o, imageUrl: fetched[o.i].url }));
}

function parseJsonArray(text) {
  const stripped = text.replace(/^```(json)?/m, "").replace(/```\s*$/m, "");
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  // Claude sometimes answers a plain-language refusal instead of the requested
  // array when the source text genuinely has nothing extractable (e.g. a
  // rendered page that's just nav/UI chrome, or a bot-check interstitial) —
  // that's a valid "0 events this batch", not a scrape failure worth crashing
  // the whole source over. A malformed array between real brackets is still a
  // real error and throws below.
  if (start === -1 || end === -1) {
    console.error(`  no JSON array in Claude's response (treating as 0 events): ${text.slice(0, 200)}`);
    return [];
  }
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
For exhibitions or multi-day events shown as a date RANGE (e.g. "23.10.25 – 7.3.26", "עד 7.3"), put the opening/first day in "date" and the closing/last day in "end_date".

Return ONLY a JSON array, one object per item:
[{"key": "...", "date": "YYYY-MM-DD" or null if no real date in the text, "end_date": "YYYY-MM-DD" or null (closing date for an exhibition/multi-day run), "time": "HH:MM" or null, "end_time": "HH:MM" or null, "price_text": "..." or null, "is_free": true/false/null, "booking_url": one of the item's LINKS only if its clear purpose is buying tickets or registering for THIS event (never articles, reviews, press, social media or general info pages — when unsure use null)}]

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
