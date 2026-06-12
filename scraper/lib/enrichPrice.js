// Price enrichment: many venue pages omit the price — it lives on the ticket
// platform (eventer, tickchak, ...). For events that have a ticket link but no
// price, render the ticket page in headless Chrome and read the prices off it.
// Generic by design: works for any platform that displays "₪" amounts.
import { renderPage } from "./render.js";

const TICKET_HOST = /eventer\.co\.il|tickchak\.co\.il|tixwise|smarticket|go-out\.co|tic\.li|tickel\.co/i;

/** All ₪ amounts in a text, deduped, sorted. */
function pricesIn(text) {
  const amounts = new Set();
  for (const m of text.matchAll(/(?:₪\s*(\d{1,4})|(\d{1,4})\s*₪|(\d{1,4})\s*(?:ש"ח|שח|ils))/gi) ) {
    const n = Number(m[1] || m[2] || m[3]);
    if (n >= 10 && n <= 2000) amounts.add(n); // ignore junk like years/quantities
  }
  return [...amounts].sort((a, b) => a - b);
}

/**
 * Mutates `events` in place: fills price_text / is_free where missing.
 * Caps the number of renders per run to keep scheduled runs fast.
 */
export async function enrichPrices(events, log = console.error, cap = 25) {
  const targets = events.filter(
    (e) => !e.price_text && e.is_free == null && e.booking_url && TICKET_HOST.test(e.booking_url)
  );
  let rendered = 0;
  for (const e of targets) {
    if (rendered >= cap) { log(`  price-enrich: cap reached (${cap}), rest next run`); break; }
    try {
      const { text } = await renderPage(e.booking_url);
      rendered++;
      if (/חינם|כניסה חופשית|free entrance|free entry/i.test(text)) {
        e.is_free = true;
        continue;
      }
      const prices = pricesIn(text);
      if (prices.length) {
        e.price_text = prices.length === 1 ? `₪${prices[0]}` : `₪${prices[0]}–${prices[prices.length - 1]}`;
        e.is_free = false;
      }
    } catch (err) {
      log(`  price-enrich failed for ${e.booking_url}: ${err.message}`);
    }
  }
  if (rendered) log(`  price-enrich: rendered ${rendered} ticket pages`);
}
