// Strategy: Shopify venues that sell events as products (e.g. Lauter). The store's
// collection exposes a public products.json with title, images, body and handle —
// we read that and let Claude pull the date out of the title/description text.
// source.url should be the collection page (…/collections/<name>[?…]).
import { fetchJson } from "../lib/fetchPage.js";
import { stripHtml, decodeEntities, israelISO, reconcilePrice, todayISODate, shortHash } from "../lib/util.js";
import { extractFieldsBatch, aiConfigured } from "../lib/ai.js";

export const name = "shopify";

export async function scrape(source, log = console.error) {
  const u = new URL(source.url);
  const base = u.origin;
  const collection = u.pathname.replace(/\/$/, ""); // /collections/monthly_events
  let products = [];
  try {
    products = (await fetchJson(`${base}${collection}/products.json?limit=250`)).products || [];
  } catch (e) {
    // fall back to the whole store if the collection path isn't a JSON endpoint
    products = (await fetchJson(`${base}/products.json?limit=250`)).products || [];
  }
  if (!products.length) throw new Error("no Shopify products found");

  const items = products.map((p) => ({
    title: decodeEntities(p.title || "").trim(),
    body: stripHtml(p.body_html || "").slice(0, 900),
    image: p.images?.[0]?.src || null,
    handle: p.handle,
    price: p.variants?.[0]?.price || null,
    url: `${base}/products/${p.handle}`,
  })).filter((p) => p.title && p.image);

  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY missing — Shopify events need AI for the date");

  const events = [];
  for (let i = 0; i < items.length; i += 20) {
    const chunk = items.slice(i, i + 20);
    const fields = await extractFieldsBatch(
      chunk.map((p, j) => ({ key: String(i + j), title: p.title, text: p.body })),
      todayISODate()
    );
    chunk.forEach((p, j) => {
      const f = fields.get(String(i + j));
      if (!f?.date) return; // no real date in the text → skip (recurring/undated products)
      const [y, mo, d] = f.date.split("-").map(Number);
      const [hh, mm] = (f.time || "20:00").split(":").map(Number);
      const { priceText, isFree } = reconcilePrice(f.price_text || (p.price && p.price !== "0.00" ? `₪${Math.round(+p.price)}` : null), f.is_free);
      const description = p.body.split("\n").reduce((a, b) => (b.trim().length > a.length ? b.trim() : a), "").slice(0, 400) || null;
      events.push({
        occurrenceKey: p.handle + "_" + f.date,
        title: p.title,
        description: description && description.length > 40 ? description : null,
        startsAt: israelISO(y, mo, d, hh, mm),
        priceText, isFree,
        bookingUrl: p.url,
        eventUrl: p.url,
        imageUrl: p.image,
        lang: "he",
        confidence: 0.85,
      });
    });
  }
  log(`  [${source.id}] shopify: ${products.length} products -> ${events.length} dated events (${events.filter((e) => e.imageUrl).length} imaged)`);
  return events;
}
