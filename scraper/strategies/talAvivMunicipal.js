// Strategy: tel-aviv.gov.il community-center pages (Herzl 107 and presumably
// other "בית הצעירים"/community venues on the same municipal CMS) render their
// events via a shared AngularJS "EventsAndBenefitsLobby" widget (`li.evBenItem`
// cards). No JSON-LD, no plain <img> tags — the poster is a CSS
// background-image set by ng-style, invisible to every generic image-scraping
// path in this codebase, which is why auto-ladder's vision rung always came up
// empty (it was reading unrelated venue photos, not these cards' own posters).
// Title, price, date+time and the detail link are all in the rendered listing
// itself — no per-event page visit or AI call needed.
import { renderPage } from "../lib/render.js";
import { decodeEntities, israelISO, reconcilePrice } from "../lib/util.js";

export const name = "tel-aviv-municipal";

export async function scrape(source, log = console.error) {
  const { data: rows } = await renderPage(source.url, {
    timeoutMs: 45000,
    scroll: true,
    extract: () => {
      return [...document.querySelectorAll("li.evBenItem")].map((li) => {
        const a = li.querySelector(".itemTitleWithArrow");
        const bg = getComputedStyle(li.querySelector(".evBenItemImage")).backgroundImage;
        const img = (bg.match(/url\("([^"]+)"\)/) || [])[1] || null;
        return {
          title: a?.textContent.trim() || "",
          href: a?.href || null,
          price: li.querySelector(".divMautEv")?.textContent.trim() || "",
          dateText: li.querySelector(".itemDateTime span")?.textContent.trim() || "",
          image: img,
        };
      });
    },
  });
  if (!rows?.length) throw new Error("no event cards found (li.evBenItem)");

  const events = [];
  for (const r of rows) {
    // "היום 19:00 8.7.26" / "מחר 19:30 9.7.26" / "20:00 16.7.26"
    const m = r.dateText.match(/(\d{1,2}):(\d{2})[\s ]+(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (!m || !r.title || !r.href) continue;
    const [, hh, mm, d, mo, yRaw] = m;
    const y = Number(yRaw) < 100 ? Number(yRaw) + 2000 : Number(yRaw);
    const { priceText, isFree } = reconcilePrice(decodeEntities(r.price));
    events.push({
      occurrenceKey: r.href,
      title: decodeEntities(r.title),
      startsAt: israelISO(y, Number(mo), Number(d), Number(hh), Number(mm)),
      priceText,
      isFree,
      bookingUrl: r.href,
      eventUrl: r.href,
      imageUrl: r.image,
      lang: "he",
      confidence: 0.95,
    });
  }
  log(`  [${source.id}] tel-aviv-municipal: ${rows.length} cards -> ${events.length} events (${events.filter((e) => e.imageUrl).length} imaged)`);
  return events;
}
