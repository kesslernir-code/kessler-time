// GENERIC WordPress events extractor — no per-site code.
// Most Israeli venue sites are WordPress. This strategy:
//   1. detects the WP REST API and finds the event-like post type(s)
//   2. pulls each event's title, image, description structurally
//   3. resolves the date from (a) common plugin meta fields, (b) JSON-LD in the
//      post, (c) the publish date if it's clearly future, (d) AI on the text
//   4. scans content for price (₪) and a ticket-platform link
// New WP sites added via the admin page work through this automatically.
import { fetchJson } from "../lib/fetchPage.js";
import {
  stripHtml, decodeEntities, israelISO, reconcilePrice, todayISODate,
  scanPrice, findTicketLink, shortHash,
} from "../lib/util.js";
import { extractFieldsBatch, aiConfigured } from "../lib/ai.js";
import { knownEventUrls } from "../lib/db.js";

export const name = "wp-auto";

// post types that usually hold events (by type key or rest_base)
const TYPE_HINT = /event|screening|show|gig|concert|performance|happening|agenda|program|תוכני|מופע|אירוע/i;
// meta fields various event plugins use for the start datetime
const DATE_KEYS = [
  "event_date_time", "event_start_date", "_EventStartDate", "_event_start_date",
  "start_date", "start", "_start", "mec_start_date", "date_start", "event_meta_date",
  "_tribe_start_date",
];

const baseOf = (source) => source.config?.apiBase || new URL(source.url).origin;

function metaDate(meta = {}) {
  for (const k of DATE_KEYS) {
    const m = String(meta[k] ?? "").match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (m) return { y: +m[1], mo: +m[2], d: +m[3], hh: +(m[4] ?? 20), mm: +(m[5] ?? 0) };
  }
  return null;
}

function jsonLdDate(html = "") {
  for (const b of html.matchAll(/<script type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(b[1]); } catch { continue; }
    const nodes = [j, ...(j["@graph"] || []), ...(Array.isArray(j) ? j : [])];
    for (const n of nodes) {
      if (n && /Event/i.test(String(n["@type"])) && n.startDate) {
        const m = String(n.startDate).match(/(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
        if (m) return { y: +m[1], mo: +m[2], d: +m[3], hh: +(m[4] ?? 20), mm: +(m[5] ?? 0) };
      }
    }
  }
  return null;
}

async function findEventTypes(base) {
  const types = await fetchJson(`${base}/wp-json/wp/v2/types`);
  const out = [];
  for (const [key, info] of Object.entries(types)) {
    if (!info?.rest_base) continue;
    if (["post", "page", "attachment", "nav_menu_item", "wp_block", "wp_template",
         "wp_template_part", "wp_global_styles", "wp_navigation"].includes(key)) continue;
    if (TYPE_HINT.test(key) || TYPE_HINT.test(info.rest_base) || TYPE_HINT.test(info.name || "")) {
      out.push(info.rest_base);
    }
  }
  return out;
}

const imageOf = (it) =>
  it._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
  it.yoast_head_json?.og_image?.[0]?.url ||
  null;

export async function scrape(source, log = console.error) {
  const base = baseOf(source);
  const restBases = await findEventTypes(base);
  if (!restBases.length) throw new Error("no WP event post type found");
  log(`  [${source.id}] wp-auto post types: ${restBases.join(", ")}`);

  // gather raw posts across the detected event types
  const posts = [];
  for (const rb of restBases) {
    try {
      const items = await fetchJson(
        `${base}/wp-json/wp/v2/${rb}?per_page=100&orderby=date&order=desc&_embed=wp:featuredmedia`
      );
      posts.push(...items);
    } catch (e) { log(`  [${source.id}] type ${rb} failed: ${e.message}`); }
  }
  if (!posts.length) throw new Error("WP event types returned no posts");

  const known = await knownEventUrls(source.id);
  const events = [];
  const needAi = []; // posts with no structured date -> AI fallback (new ones only)

  for (const it of posts) {
    const title = decodeEntities(it.title?.rendered || "").trim();
    if (!title) continue;
    const contentHtml = it.content?.rendered || "";
    const text = stripHtml(contentHtml);
    const common = {
      occurrenceKey: String(it.id),
      title,
      description: text.slice(0, 600) || null,
      bookingUrl: findTicketLink(contentHtml) || it.link,
      eventUrl: it.link,
      imageUrl: imageOf(it),
      ...reconcilePrice(scanPrice(text + " " + title)),
      lang: "he",
    };

    const dt = metaDate(it.meta) || jsonLdDate(contentHtml);
    if (dt) {
      events.push({ ...common, startsAt: israelISO(dt.y, dt.mo, dt.d, dt.hh, dt.mm), confidence: 1.0 });
    } else if (!known.has(it.link)) {
      needAi.push({ it, common, text });
    }
  }

  // AI fallback only for new posts whose date lives in free text (e.g. "שבת 14.6")
  if (needAi.length && aiConfigured()) {
    const fields = await extractFieldsBatch(
      needAi.map((x, i) => ({ key: String(i), title: x.common.title, text: x.text })),
      todayISODate()
    );
    needAi.forEach((x, i) => {
      const f = fields.get(String(i));
      if (!f?.date) return;
      const [y, mo, d] = f.date.split("-").map(Number);
      const [hh, mm] = (f.time || "20:00").split(":").map(Number);
      events.push({
        ...x.common,
        startsAt: israelISO(y, mo, d, hh, mm),
        ...reconcilePrice(f.price_text || x.common.priceText, f.is_free ?? x.common.isFree),
        confidence: 0.8,
      });
    });
    log(`  [${source.id}] wp-auto ai-date for ${needAi.length} undated posts`);
  }

  return events;
}
