// Strategy: batsheva.co.il's performance schedule. Its /repertory/ catalog only
// lists evergreen "works" (no reliable date — see CLAUDE.md), but /schedule/
// renders a proper table of actual dated occurrences via a WP calendar plugin:
// each <tr data-run-id data-show data-location data-month> carries a stable
// per-occurrence id, title, day+Hebrew-month, time, venue and ticket/info links.
// The table itself has no poster image, so each show's poster is fetched once
// (cached by slug) from its /repertory/<slug>/ page's WP REST record.
import { renderPage } from "../lib/render.js";
import { fetchJson } from "../lib/fetchPage.js";
import { decodeEntities, israelISO, inferYear, HE_MONTHS } from "../lib/util.js";

export const name = "batsheva-schedule";

const posterCache = new Map(); // slug -> image url | null

async function posterFor(origin, infoUrl) {
  if (!infoUrl) return null;
  const slug = decodeURIComponent(new URL(infoUrl).pathname.split("/").filter(Boolean).pop() || "");
  if (!slug) return null;
  if (posterCache.has(slug)) return posterCache.get(slug);
  let img = null;
  try {
    const rows = await fetchJson(`${origin}/wp-json/wp/v2/show?slug=${encodeURIComponent(slug)}&_embed=wp:featuredmedia`);
    const s = rows?.[0];
    img = s?._embedded?.["wp:featuredmedia"]?.[0]?.source_url || s?.yoast_head_json?.og_image?.[0]?.url || null;
  } catch { /* leave null */ }
  posterCache.set(slug, img);
  return img;
}

export async function scrape(source, log = console.error) {
  const origin = new URL(source.url).origin;
  const { data: rows } = await renderPage(source.url, {
    timeoutMs: 45000,
    scroll: true,
    extract: () => {
      const trs = [...document.querySelectorAll("table tr[data-run-id]")];
      return trs.map((tr) => ({
        runId: tr.getAttribute("data-run-id"),
        show: tr.getAttribute("data-show") || "",
        location: tr.getAttribute("data-location") || "",
        month: tr.getAttribute("data-month") || "",
        day: (tr.cells[0]?.innerText.match(/\d{1,2}/) || [])[0] || null,
        time: (tr.cells[3]?.innerText.match(/\d{1,2}:\d{2}/) || [])[0] || (tr.cells[5]?.innerText.match(/\d{1,2}:\d{2}/) || [])[0] || null,
        credit: (tr.cells[2]?.innerText || "").split("\n").slice(1).join(" ").trim() || null,
        ticketUrl: tr.querySelector('a[href*="/tickets/"]')?.href || null,
        infoUrl: [...tr.querySelectorAll("a")].map((a) => a.href).find((h) => h.includes("/repertory/")) || null,
      }));
    },
  });
  if (!rows?.length) throw new Error("no schedule rows found");

  // A sold-out row often drops its "מידע נוסף" link entirely, leaving no way to
  // find that occurrence's poster — fall back to another row of the same show
  // (e.g. a later date still on sale) that does have one.
  const infoUrlByTitle = new Map();
  for (const r of rows) if (r.infoUrl && !infoUrlByTitle.has(r.show)) infoUrlByTitle.set(r.show, r.infoUrl);

  const events = [];
  for (const r of rows) {
    const title = decodeEntities(r.show).trim();
    const mo = HE_MONTHS[r.month.trim()];
    const day = Number(r.day);
    if (!title || !mo || !day) continue;
    const y = inferYear(mo, day);
    const [hh, mm] = (r.time || "20:00").split(":").map(Number);
    const image = await posterFor(origin, r.infoUrl || infoUrlByTitle.get(r.show));
    events.push({
      occurrenceKey: r.runId || `${title}_${y}-${mo}-${day}-${r.time}`,
      title,
      description: r.credit,
      startsAt: israelISO(y, mo, day, hh, mm),
      bookingUrl: r.ticketUrl || r.infoUrl || source.url,
      eventUrl: r.infoUrl || source.url,
      imageUrl: image,
      lang: "he",
      confidence: 0.95,
    });
  }
  log(`  [${source.id}] batsheva-schedule: ${rows.length} rows -> ${events.length} events (${events.filter((e) => e.imageUrl).length} imaged)`);
  return events;
}
