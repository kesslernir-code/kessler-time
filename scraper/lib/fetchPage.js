const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

/** Polite fetch: browser UA, Hebrew Accept-Language, timeout, one retry. */
export async function fetchPage(url, { retries = 1, timeoutMs = 30000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.5",
          // must match what a real browser sends for a page — some strict servers
          // (openresty/WAF) return 415 if "application/json" appears here
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

export const fetchJson = async (url, opts) => (await fetchPage(url, opts)).json();
export const fetchText = async (url, opts) => (await fetchPage(url, opts)).text();

/** Directory info for a place page: { image, description, phone } (best-effort). */
export async function fetchPageInfo(url) {
  try {
    const html = await fetchText(url, { retries: 0, timeoutMs: 15000 });
    const og = (p) => html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)`, "i"))?.[1];
    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1];
    const image = og("image") || null;
    const rawDesc = (og("description") || metaDesc || "").slice(0, 400);
    const phone =
      (html.match(/href=["']tel:([+0-9\-\s().]{7,})["']/i)?.[1] ||
        html.match(/\b0\d{1,2}-?\d{7}\b/)?.[0] ||
        html.match(/\+972[-\s]?\d[-\s]?\d{7}/)?.[0] ||
        "").trim();
    const { decodeEntities } = await import("./util.js");
    return {
      image: image && !/logo|placeholder|sprite/i.test(image) ? image.replace(/&amp;/g, "&") : null,
      description: rawDesc ? decodeEntities(rawDesc) : null,
      phone: phone || null,
    };
  } catch {
    return {};
  }
}

/** Read a page's best image (og:image → twitter:image → first large img). */
export async function fetchOgImage(url) {
  try {
    const html = await fetchText(url, { retries: 0, timeoutMs: 15000 });
    const BAD = /logo|placeholder|sprite|favicon|blank|default\.(png|jpg|gif|webp)/i;

    // og:image (both attribute orders)
    const og =
      html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
    if (og && !BAD.test(og)) return og.replace(/&amp;/g, "&");

    // twitter:image fallback
    const tw =
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)?.[1];
    if (tw && !BAD.test(tw)) return tw.replace(/&amp;/g, "&");

    // first <img> that looks like a content image (not tiny icons)
    for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)) {
      const src = m[1];
      if (!src.startsWith("http")) continue;
      if (BAD.test(src)) continue;
      if (/icon|avatar|pixel|spacer|1x1|logo/i.test(src)) continue;
      return src;
    }
    return null;
  } catch {
    return null;
  }
}
