// Netlify function: receive a screenshot (base64) + admin password,
// call Claude Vision to extract event details, return structured fields.
export async function handler(event) {
  if (event.httpMethod !== "POST") return resp(405, { error: "method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return resp(400, { error: "bad json" }); }

  if (!process.env.ADMIN_PW || body.secret !== process.env.ADMIN_PW)
    return resp(401, { error: "wrong password" });

  const { imageData } = body; // base64 data URL: "data:image/jpeg;base64,..."
  if (!imageData) return resp(400, { error: "imageData required" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return resp(500, { error: "ANTHROPIC_API_KEY not configured" });

  // Extract base64 and media type from data URL
  const m = imageData.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) return resp(400, { error: "imageData must be a data URL" });
  const [, mediaType, b64] = m;

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }); // YYYY-MM-DD

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: b64 },
          },
          {
            type: "text",
            text: `Today is ${today} (Israel). This is a screenshot of a Facebook/Instagram event announcement (likely in Hebrew). Extract the event details and return ONLY a JSON object:
{"title":"...","date":"YYYY-MM-DD or null","time":"HH:MM or null","venue":"venue/place name or null","city":"city in Hebrew or null","description":"short 1-2 sentence summary or null","price_text":"price string or null","is_free":true/false/null,"booking_url":"ticket/registration URL if visible or null"}
If no real future event date is visible, return {"title":null}.`,
          },
        ],
      }],
    }),
  });

  if (!res.ok) return resp(502, { error: `Claude API ${res.status}` });
  const data = await res.json();
  const text = data.content?.map(b => b.text || "").join("") || "";

  // Parse the JSON from Claude's response
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return resp(502, { error: "no JSON in response", raw: text.slice(0, 200) });
  try {
    const fields = JSON.parse(text.slice(start, end + 1));
    return resp(200, { ok: true, fields });
  } catch {
    return resp(502, { error: "invalid JSON from Claude", raw: text.slice(0, 200) });
  }
}

const resp = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});
