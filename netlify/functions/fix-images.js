// Netlify function: given a list of event URLs, return the best image found
// for each (og:image → twitter:image → first large img). No DB access needed —
// the caller handles reading/writing Supabase using the anon key.
export async function handler(event) {
  if (event.httpMethod !== "POST") return resp(405, { error: "method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return resp(400, { error: "bad json" }); }

  if (!process.env.ADMIN_PW || body.secret !== process.env.ADMIN_PW)
    return resp(401, { error: "wrong password" });

  const urls = Array.isArray(body.urls) ? body.urls.slice(0, 30) : [];
  const BAD = /logo|placeholder|sprite|favicon|blank|default\.(png|jpg|gif|webp)/i;

  const results = {};
  for (const url of urls) {
    if (!url || /facebook\.com|instagram\.com/.test(url)) { results[url] = null; continue; }
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KesslerBot/1.0)" },
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      if (!res.ok) { results[url] = null; continue; }
      const html = await res.text();

      const og =
        html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
      if (og && !BAD.test(og)) { results[url] = og.replace(/&amp;/g, "&"); continue; }

      const tw =
        html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)?.[1];
      if (tw && !BAD.test(tw)) { results[url] = tw.replace(/&amp;/g, "&"); continue; }

      let found = null;
      for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
        const src = m[1];
        if (!src.startsWith("http")) continue;
        if (BAD.test(src) || /icon|avatar|pixel|spacer|1x1/i.test(src)) continue;
        found = src; break;
      }
      results[url] = found;
    } catch { results[url] = null; }
  }

  return resp(200, { ok: true, results });
}

const resp = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});
