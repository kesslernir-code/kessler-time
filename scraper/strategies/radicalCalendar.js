// Strategy: Radical's /calendar/ page. The WP API hides the event date in a
// private ACF field, but the calendar's HTML cards print everything:
//   <a href='.../events/slug/'><img src=...>
//   <div class="ue_p_title">TITLE</div>
//   <div class="uc_post_meta_date"><span>שישי | 12.06 | 10:00</span></div>
//   <span class="price_normal">₪35</span> / "חינם לחברי רדיקל"
import { fetchText, fetchJson } from "../lib/fetchPage.js";
import { decodeEntities, inferYear, israelISO, reconcilePrice, stripHtml } from "../lib/util.js";

export const name = "radical-calendar";

/** slug -> short description, from the WP API's ready-made excerpts. */
async function excerptsBySlug() {
  try {
    const items = await fetchJson("https://radical.org.il/wp-json/wp/v2/events?per_page=100&orderby=date&order=desc");
    return new Map(items.map((it) => [it.slug, stripHtml(it.excerpt?.rendered || "").slice(0, 400)]));
  } catch {
    return new Map(); // descriptions are nice-to-have; never fail the scrape over them
  }
}

export async function scrape(source) {
  const html = await fetchText(source.url);
  const excerpts = await excerptsBySlug();
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

    const slug = link.replace(/\/$/, "").split("/").pop();
    events.push({
      occurrenceKey: slug,
      title: decodeEntities(title).trim(),
      description: excerpts.get(slug) || null,
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
