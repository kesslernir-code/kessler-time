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

/** Read a page's og:image (poster). Generic fallback when an API gives no image. */
export async function fetchOgImage(url) {
  try {
    const html = await fetchText(url, { retries: 0, timeoutMs: 15000 });
    const m =
      html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const url2 = m && m[1];
    if (!url2 || /logo|placeholder|sprite|favicon|default|blank/i.test(url2)) return null;
    return url2.replace(/&amp;/g, "&");
  } catch {
    return null;
  }
}
