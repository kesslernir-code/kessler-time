// Strategy for sources with no hand-tuned recipe: climb the extraction ladder.
//   1. JSON-LD Event objects (free, perfect when present)
//   2. Whole-page AI extraction (handles any layout)
//   3. (optional rung) Puppeteer render -> AI, if puppeteer is installed —
//      for JS-shell sites that return an empty HTML skeleton.
import { fetchText } from "../lib/fetchPage.js";
import { stripHtml, israelISO, reconcilePrice, todayISODate, shortHash } from "../lib/util.js";
import { extractEventsFromPage, aiConfigured } from "../lib/ai.js";

export const name = "auto-ladder";

function jsonLdEvents(html, source) {
  const blocks = [...html.matchAll(/<script type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)];
  const out = [];
  for (const b of blocks) {
    let j;
    try { j = JSON.parse(b[1]); } catch { continue; }
    const nodes = [j, ...(j["@graph"] || []), ...(Array.isArray(j) ? j : [])];
    for (const n of nodes) {
      if (!n || !/Event/i.test(String(n["@type"]))) continue;
      if (!n.name || !n.startDate) continue;
      const { priceText, isFree } = reconcilePrice(
        n.offers?.price ? `${n.offers.price} ${n.offers.priceCurrency || ""}` : null
      );
      out.push({
        occurrenceKey: shortHash(n.name + n.startDate),
        title: n.name,
        description: (n.description || "").slice(0, 600),
        startsAt: n.startDate,
        endsAt: n.endDate || null,
        priceText,
        isFree,
        bookingUrl: n.offers?.url || n.url || null,
        eventUrl: n.url || source.url,
        imageUrl: typeof n.image === "string" ? n.image : n.image?.url || null,
        lang: "he",
        confidence: 1.0,
      });
    }
  }
  return out;
}

function looksLikeJsShell(html) {
  const text = stripHtml(html);
  return html.length > 5000 && text.length < 400;
}

async function renderWithPuppeteer(url) {
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer")).default; // optional dep — only if installed
  } catch {
    return null;
  }
  const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

export async function scrape(source, log = console.error) {
  let html = await fetchText(source.url);

  // Rung 1: JSON-LD
  let events = jsonLdEvents(html, source);
  if (events.length) { log(`  [${source.id}] ladder rung: json-ld (${events.length})`); return events; }

  // Rung 2.5: JS shell? render first
  if (looksLikeJsShell(html)) {
    const rendered = await renderWithPuppeteer(source.url);
    if (rendered) {
      html = rendered;
      events = jsonLdEvents(html, source);
      if (events.length) { log(`  [${source.id}] ladder rung: puppeteer+json-ld (${events.length})`); return events; }
    } else {
      log(`  [${source.id}] page looks like a JS shell and puppeteer is not installed (npm i puppeteer)`);
    }
  }

  // Rung 3: AI over the page text
  if (!aiConfigured()) throw new Error("no structured data found and ANTHROPIC_API_KEY missing");
  const raw = await extractEventsFromPage(
    { sourceName: source.name, url: source.url, text: stripHtml(html) },
    todayISODate()
  );
  log(`  [${source.id}] ladder rung: ai-extraction (${raw.length})`);
  return raw
    .filter((e) => e.title && e.date)
    .map((e) => {
      const [y, mo, d] = e.date.split("-").map(Number);
      const [hh, mm] = (e.time || "20:00").split(":").map(Number);
      const { priceText, isFree } = reconcilePrice(e.price_text, e.is_free);
      return {
        occurrenceKey: shortHash(e.title + e.date),
        title: e.title,
        description: e.description || null,
        startsAt: israelISO(y, mo, d, hh, mm),
        priceText,
        isFree,
        bookingUrl: e.event_url || source.url,
        eventUrl: e.event_url || source.url,
        imageUrl: e.image_url || null,
        lang: "he",
        confidence: Math.min(e.confidence ?? 0.7, 0.85),
      };
    });
}
