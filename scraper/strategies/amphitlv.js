// Amphi Tel Aviv (amphitlv.co.il). Its WordPress `event` post type carries no
// image (no featured media, no ACF, no og:image on the event page), but the
// homepage renders a clean card grid where each event box pairs a poster image
// with the title, date/time and a kupat.co.il ticket link. We parse those cards.
//
// Card shape (whitespace-collapsed):
//   <div class="single_performance_box" ...>
//     <div class="performance_image"><img src="POSTER"></div>
//     <div class="performance_text">
//       <h3>TITLE</h3>
//       <p>20.06 שבת 21:15</p>   (DD.MM <hebrew-day> HH:MM)
//       <p>אמפי תל אביב</p>
//       <a href="https://www.kupat.co.il/show/...">לכרטיסים &gt;&gt;</a>
//     </div>
//   </div>
import { fetchText } from "../lib/fetchPage.js";
import { israelISO, inferYear, decodeEntities, shortHash } from "../lib/util.js";

export const name = "amphitlv";

export async function scrape(source, log = console.error) {
  const html = await fetchText(source.url);
  // Split on the repeating box class; each chunk holds one card's inner markup.
  const chunks = html.split(/class=["']single_performance_box["']/i).slice(1);
  log(`  [${source.id}] amphitlv: ${chunks.length} performance boxes`);

  const events = [];
  for (const chunk of chunks) {
    // Only look within this card (cut at the next box start, already split).
    const img = chunk.match(/<div[^>]*class=["']performance_image["'][^>]*>\s*<img[^>]+src=["']([^"']+)["']/i)?.[1] || null;
    const title = decodeEntities((chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "").replace(/<[^>]+>/g, "").trim());
    if (!title) continue;

    // First <p> holds the date/time, e.g. "20.06 שבת 21:15" or "01.07 רביעי 20:30".
    const pText = (chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "").replace(/<[^>]+>/g, " ");
    const dm = pText.match(/(\d{1,2})\.(\d{1,2})/);
    const tm = pText.match(/(\d{1,2}):(\d{2})/);
    if (!dm) continue;
    const day = +dm[1], mo = +dm[2];
    const hh = tm ? +tm[1] : 20, mm = tm ? +tm[2] : 0;
    const y = inferYear(mo, day);
    const startsAt = israelISO(y, mo, day, hh, mm);
    if (!startsAt) continue;

    const link = chunk.match(/<a[^>]+href=["'](https?:\/\/[^"']*kupat\.co\.il[^"']*)["']/i)?.[1]
      || chunk.match(/<a[^>]+href=["'](https?:\/\/[^"']+)["']/i)?.[1] || source.url;

    events.push({
      occurrenceKey: shortHash(title + startsAt),
      title,
      description: null,
      startsAt,
      imageUrl: img,
      bookingUrl: link,
      eventUrl: link,
      lang: "he",
      confidence: 0.95,
    });
  }
  log(`  [${source.id}] amphitlv: parsed ${events.length} events (${events.filter(e => e.imageUrl).length} with image)`);
  return events;
}
