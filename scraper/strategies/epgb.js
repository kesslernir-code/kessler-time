// Radio EPGB (epgb.co.il). JS-rendered "השבוע ב-EPGB" weekly grid: each card is
// an <a> with a poster <img class="card-photo">, a title, and a date/time.
//   <a href="event.html?id=UUID" class="card has-photo day-thu">
//     <img class="card-photo" src="https://…supabase…/event-UUID.png">
//     <div class="pi-title">THURSDAY RADIO E.P.G.B</div>
//     <div class="pi-date" dir="ltr">18.6 <span class="pi-time">23:00</span></div>
//     <div class="pi-meta">LIX · YAZZ · HIP-HOP</div>
import { renderPage, closeBrowser } from "../lib/render.js";
import { israelISO, inferYear, decodeEntities, shortHash } from "../lib/util.js";

export const name = "epgb";

export async function scrape(source, log = console.error) {
  let html;
  try {
    ({ html } = await renderPage(source.url, { timeoutMs: 50000, settleMs: 2500, scroll: true }));
  } finally {
    await closeBrowser();
  }
  if (!html) throw new Error("render returned no HTML");

  const events = [];
  // Each event is an <a class="card …">…</a> (no nested anchors inside a card).
  for (const m of html.matchAll(/<a\b[^>]*class=["'][^"']*\bcard\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const card = m[0];
    const inner = m[1];
    const href = card.match(/href=["']([^"']+)["']/i)?.[1];
    const img = inner.match(/class=["']card-photo["'][^>]*src=["']([^"']+)["']/i)?.[1]
      || inner.match(/src=["']([^"']+)["'][^>]*class=["']card-photo["']/i)?.[1];
    const title = decodeEntities((inner.match(/class=["']pi-title["'][^>]*>([\s\S]*?)<\//i)?.[1] || "").replace(/<[^>]+>/g, "").trim());
    const dm = inner.match(/class=["']pi-date["'][^>]*>\s*(\d{1,2})\.(\d{1,2})/i);
    const tm = inner.match(/class=["']pi-time["'][^>]*>\s*(\d{1,2}):(\d{2})/i);
    if (!title || !dm) continue;

    const d = +dm[1], mo = +dm[2];
    const hh = tm ? +tm[1] : 22, mm = tm ? +tm[2] : 0;
    const startsAt = israelISO(inferYear(mo, d), mo, d, hh, mm);
    if (!startsAt) continue;

    const eventUrl = href ? new URL(href, source.url).href : source.url;
    events.push({
      occurrenceKey: shortHash(title + startsAt),
      title,
      description: decodeEntities((inner.match(/class=["']pi-meta["'][^>]*>([\s\S]*?)<\//i)?.[1] || "").replace(/<[^>]+>/g, "").trim()) || null,
      startsAt,
      imageUrl: img || null,
      bookingUrl: eventUrl,
      eventUrl,
      lang: "he",
      confidence: 0.95,
    });
  }
  log(`  [${source.id}] epgb: ${events.length} events parsed (${events.filter(e => e.imageUrl).length} with image)`);
  return events;
}
