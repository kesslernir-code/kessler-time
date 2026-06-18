// Headless-browser rendering via the machine's installed Chrome (puppeteer-core,
// no browser download). Used for JS-shell pages: ticket platforms, SPA sites.
// One shared browser per run; callers must call closeBrowser() at the end.
import { isJunkImageUrl } from "./util.js";

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = (await import("puppeteer-core")).default;
      return puppeteer.launch({
        channel: "chrome", // installed Chrome on Windows / GitHub's ubuntu runners
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=he-IL"],
      });
    })();
  }
  return browserPromise;
}

/** Render a page and return its visible text (innerText) and HTML.
 *  `scroll: true` pages down to trigger lazy-loaded images (galleries, posters). */
export async function renderPage(url, { timeoutMs = 45000, settleMs = 1200, scroll = false } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 1024 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    await new Promise((r) => setTimeout(r, settleMs)); // let late XHRs paint
    if (scroll) {
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 800) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 250));
        }
        window.scrollTo(0, 0);
      });
      await new Promise((r) => setTimeout(r, 1500)); // let lazy images load
    }
    const text = await page.evaluate(() => document.body?.innerText || "");
    const html = await page.content();
    // Large content images (likely posters), biggest first — from the live DOM
    // so we get real rendered sizes and resolved lazy srcs.
    const images = await page.evaluate(() => {
      return [...document.querySelectorAll("img")]
        .map((im) => ({ src: im.currentSrc || im.src, w: im.naturalWidth || im.width, h: im.naturalHeight || im.height }))
        .filter((x) => x.src && x.src.startsWith("http") && x.w >= 200 && x.h >= 200 && !/logo|icon|avatar|sprite/i.test(x.src))
        .sort((a, b) => b.w * b.h - a.w * a.h)
        .map((x) => x.src);
    });
    return { text, html, images: [...new Set(images)].filter((u) => !isJunkImageUrl(u)) };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    await b?.close().catch(() => {});
    browserPromise = null;
  }
}
