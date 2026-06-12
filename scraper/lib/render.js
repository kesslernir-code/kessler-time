// Headless-browser rendering via the machine's installed Chrome (puppeteer-core,
// no browser download). Used for JS-shell pages: ticket platforms, SPA sites.
// One shared browser per run; callers must call closeBrowser() at the end.
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

/** Render a page and return its visible text (innerText) and HTML. */
export async function renderPage(url, { timeoutMs = 45000, settleMs = 1200 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 1024 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    await new Promise((r) => setTimeout(r, settleMs)); // let late XHRs paint
    const text = await page.evaluate(() => document.body?.innerText || "");
    const html = await page.content();
    return { text, html };
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
