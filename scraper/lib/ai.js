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
    .map((it) => `### key: ${it.key}\nTITLE: ${it.title}\nTEXT:\n${it.text.slice(0, 900)}`)
    .join("\n\n");
  const prompt = `Today is ${todayISO} (Israel). Below are event announcements, mostly in Hebrew, scraped from venue websites.
For EACH item, find the event's actual date and start time from the text. Hebrew date formats like "19.6", "יום שישי 13.6", "שבת 14/6", times like "19:30 דלתות" (doors) or "20:00 התחלה" (start) are common — prefer the start time over doors time. If a year is missing, choose the year that makes the date today or in the future. Also extract price if mentioned (e.g. "35 ש״ח", "₪50", "כניסה חופשית" = free).

Return ONLY a JSON array, one object per item:
[{"key": "...", "date": "YYYY-MM-DD" or null if no real date in the text, "time": "HH:MM" or null, "end_time": "HH:MM" or null, "price_text": "..." or null, "is_free": true/false/null}]

${list}`;
  const out = parseJsonArray(await ask(prompt));
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
