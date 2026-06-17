// Tel Aviv Cinematheque (cinema.co.il). The homepage is JS-rendered and sits
// behind a WAF that 415s plain fetches, so auto-ladder only got film titles via
// AI and stored the homepage as every film's URL — losing the posters.
//
// But each film HAS its own page (cinema.co.il/event/{slug}/) which fetches fine
// (200) and carries a proper per-film og:image. So we render the homepage once,
// read the daily schedule, and capture per screening:
//   <h6>17.06.26 ...</h6>                         ← date (DD.MM.YY), applies below
//   <li class="time-after">
//     <a href=".../event/SLUG/">                  ← the film's own page
//     <a class="cal_link" data-url="cintlv.../order/ID"><span class="time">16:15</span>
//     <span class="name"> חיים ללא כיסוי | ... </span>   ← title
// We set event_url to the /event/ page; check.js then fills the poster via og:image.
import { renderPage, closeBrowser } from "../lib/render.js";
import { israelISO, decodeEntities, shortHash } from "../lib/util.js";

export const name = "cinema";

export async function scrape(source, log = console.error) {
  // The daily-schedule widget (with the <h6> date headers we need) loads via a
  // late XHR and is sometimes absent from a single render. Retry until it shows.
  let html = "";
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await renderPage(source.url, { timeoutMs: 50000, settleMs: 2500, scroll: true });
      html = r.html || "";
      if (/<h6[^>]*>\s*\d{2}\.\d{2}\.\d{2}/.test(html)) break;
      log(`  [${source.id}] cinema: schedule not in render (attempt ${attempt}), retrying…`);
    }
  } finally {
    await closeBrowser();
  }
  if (!html) throw new Error("render returned no HTML");

  // Positions of every date header, so each screening can inherit the nearest
  // date above it. Format: "17.06.26" (DD.MM.YY).
  const dates = [...html.matchAll(/<h6[^>]*>\s*(\d{2})\.(\d{2})\.(\d{2})/g)].map((m) => ({
    idx: m.index, d: +m[1], mo: +m[2], y: 2000 + +m[3],
  }));
  const dateBefore = (pos) => {
    let best = null;
    for (const d of dates) { if (d.idx <= pos) best = d; else break; }
    return best;
  };

  const events = [];
  const seen = new Set();
  // Anchor on each film name; read its surrounding card for url/time/booking.
  for (const m of html.matchAll(/<span class=["']name["']>([\s\S]*?)<\/span>/g)) {
    const rawName = decodeEntities(m[1].replace(/<[^>]+>/g, "").trim());
    const title = rawName.split("|")[0].trim(); // drop "| יום הקולנוע..." suffix
    if (!title) continue;

    // Window from the previous </h6> region to this name holds the card's links.
    const before = html.slice(Math.max(0, m.index - 1400), m.index);
    const eventUrl = before.match(/href=["'](https:\/\/www\.cinema\.co\.il\/event\/[^"']+)["']/i)?.[1];
    if (!eventUrl) continue;

    const time = before.match(/<span class=["']time["']>\s*(\d{1,2}):(\d{2})/);
    const booking = before.match(/data-url=["'](https:\/\/cintlv\.pres\.global\/order\/\d+)["']/i)?.[1];
    const dt = dateBefore(m.index);
    if (!dt) continue;

    const hh = time ? +time[1] : 20, mm = time ? +time[2] : 0;
    const startsAt = israelISO(dt.y, dt.mo, dt.d, hh, mm);
    if (!startsAt) continue;

    // De-dupe same film+day (a film may list several show-times).
    const k = eventUrl + "|" + dt.y + dt.mo + dt.d;
    if (seen.has(k)) continue;
    seen.add(k);

    events.push({
      occurrenceKey: shortHash(title + startsAt),
      title,
      description: null,
      startsAt,
      imageUrl: null, // filled by check.js og:image from the /event/ page
      bookingUrl: booking || eventUrl,
      eventUrl,
      lang: "he",
      confidence: 0.95,
    });
  }
  log(`  [${source.id}] cinema: ${events.length} screenings parsed (${dates.length} date headers)`);
  return events;
}
