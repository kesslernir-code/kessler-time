// Strategy: Radical's /calendar/ page. The WP API hides the event date in a
// private ACF field, but the calendar's HTML cards print everything:
//   <a href='.../events/slug/'><img src=...>
//   <div class="ue_p_title">TITLE</div>
//   <div class="uc_post_meta_date"><span>שישי | 12.06 | 10:00</span></div>
//   <span class="price_normal">₪35</span> / "חינם לחברי רדיקל"
import { fetchText } from "../lib/fetchPage.js";
import { decodeEntities, inferYear, israelISO, reconcilePrice } from "../lib/util.js";

export const name = "radical-calendar";

export async function scrape(source) {
  const html = await fetchText(source.url);
  const cards = html.split(/class="uc_post_grid_style_one_item/).slice(1);
  const events = [];

  for (const card of cards) {
    const link = card.match(/href='(https?:\/\/radical\.org\.il\/events\/[^']+)'/)?.[1];
    const title = card.match(/class="ue_p_title">([\s\S]*?)<\/div>/)?.[1];
    const dateLine = card.match(/uc_post_meta_date">\s*<span>([^<]+)<\/span>/)?.[1];
    if (!link || !title || !dateLine) continue;

    // "שישי | 12.06 | 10:00" — day name | DD.MM | HH:MM
    const m = dateLine.match(/(\d{1,2})\.(\d{1,2})\s*\|\s*(\d{1,2}):(\d{2})/);
    if (!m) continue;
    const [, dd, mo, hh, mm] = m.map(Number);
    const year = inferYear(mo, dd);

    const img =
      card.match(/data-src="([^"]+)"/)?.[1] || card.match(/src="\s*([^"\s]+)"/)?.[1] || null;
    const priceRaw = card.match(/price_normal">([^<]+)</)?.[1];
    const freeNote = card.match(/<span>(חינם[^<]*)<\/span>/)?.[1];
    const { priceText, isFree } = reconcilePrice(
      [priceRaw, freeNote].filter(Boolean).join(" / "),
      undefined
    );

    events.push({
      occurrenceKey: link.replace(/\/$/, "").split("/").pop(),
      title: decodeEntities(title).trim(),
      description: null,
      startsAt: israelISO(year, mo, dd, hh, mm),
      priceText,
      isFree,
      bookingUrl: link,
      eventUrl: link,
      imageUrl: img,
      lang: "he",
      confidence: 1.0,
    });
  }
  return events;
}
