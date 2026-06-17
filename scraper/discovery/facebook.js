// Facebook discovery via mbasic.facebook.com — free, no Apify.
// Two paths:
//   1. /{handle}/events page — parse structured event listings (no AI needed)
//   2. /{handle} posts page — extract text, triage with AI for event announcements
import { renderPage } from "../lib/render.js";
import { stripHtml, israelISO, reconcilePrice, todayISODate } from "../lib/util.js";
import { extractSocialEvents, aiConfigured } from "../lib/ai.js";
import { knownEventUrls } from "../lib/db.js";

export const platform = "facebook";

const MBASIC = "https://mbasic.facebook.com";

/**
 * Parse a date string from mbasic event page text.
 * Handles:
 *   - ISO: "2025-06-18" or "2025-06-18T20:00"
 *   - English month: "June 18, 2025 at 8:00 PM"
 *   - Numeric: "18/06/2025" or "18.06.2025"
 * Returns an Israel-timezone ISO string or null.
 */
function parseMbasicDate(text) {
  // ISO date: 2025-06-18[T HH:MM]
  let m = text.match(/(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (m) {
    return israelISO(+m[1], +m[2], +m[3], m[4] ? +m[4] : 20, m[5] ? +m[5] : 0);
  }

  // English month name: "June 18, 2025 at 8:00 PM"
  const MONTHS = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
  m = text.match(/(\w+)\s+(\d{1,2}),?\s*(\d{4})(?:\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm))?/i);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo) {
      let hh = m[4] ? +m[4] : 20;
      const mm = m[5] ? +m[5] : 0;
      if (m[6] && m[6].toLowerCase() === "pm" && hh < 12) hh += 12;
      if (m[6] && m[6].toLowerCase() === "am" && hh === 12) hh = 0;
      return israelISO(+m[3], mo, +m[2], hh, mm);
    }
  }

  // Numeric: 18/06/2025 or 18.06.2025
  m = text.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    return israelISO(+m[3], +m[2], +m[1], m[4] ? +m[4] : 20, m[5] ? +m[5] : 0);
  }

  return null;
}

/** Parse mbasic /{handle}/events HTML into event objects. */
function parseEventsPage(html) {
  const events = [];
  const todayPrefix = new Date().toISOString().slice(0, 10);

  // mbasic event links look like: href="/events/123456789..."
  // Each is followed by the event title as link text, and date info in the surrounding block
  const eventBlockRe = /<a href="\/events\/(\d+)[^"]*"[^>]*>([^<]+)<\/a>([\s\S]*?)(?=<a href="\/events\/\d+|<div\b|<\/ul>|$)/g;
  let m;
  while ((m = eventBlockRe.exec(html)) !== null) {
    const [, eventId, rawTitle, rest] = m;
    const title = rawTitle.trim();
    if (!title) continue;

    const dateText = stripHtml(rest).trim().slice(0, 400);
    const startsAt = parseMbasicDate(dateText);
    if (!startsAt) continue;

    // Skip past events
    if (startsAt.slice(0, 10) < todayPrefix) continue;

    events.push({
      occurrenceKey: `fb-${eventId}`,
      title: title.slice(0, 200),
      description: dateText.slice(0, 600) || null,
      startsAt,
      where: null,
      priceText: null,
      isFree: null,
      bookingUrl: `${MBASIC}/events/${eventId}`,
      eventUrl: `https://www.facebook.com/events/${eventId}`,
      imageUrl: null,
      lang: "he",
      confidence: 0.75,
    });
  }
  return events;
}

async function structuredEvents(handle, log, id) {
  const url = `${MBASIC}/${handle}/events`;
  log(`  [${id}] fb mbasic events: ${url}`);
  try {
    const { html } = await renderPage(url, { timeoutMs: 30000, settleMs: 800 });
    const events = parseEventsPage(html);
    log(`  [${id}] fb mbasic structured events: ${events.length}`);
    return events;
  } catch (err) {
    log(`  [${id}] fb mbasic events error: ${err.message}`);
    return [];
  }
}

async function eventsFromPosts(handle, source, log) {
  if (!aiConfigured()) return [];
  const url = `${MBASIC}/${handle}`;
  log(`  [${source.id}] fb mbasic posts: ${url}`);
  let html;
  try {
    ({ html } = await renderPage(url, { timeoutMs: 30000, settleMs: 800 }));
  } catch (err) {
    log(`  [${source.id}] fb mbasic posts error: ${err.message}`);
    return [];
  }

  const known = await knownEventUrls(source.id);
  const posts = [];

  // mbasic posts have permalink-style links; extract the surrounding text block
  const storyRe = /<div[^>]*role="article"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = storyRe.exec(html)) !== null && posts.length < 25) {
    const block = m[1];
    const postText = stripHtml(block).trim();
    if (postText.length < 20) continue;
    // find a permalink URL in the block
    const urlMatch = block.match(/href="(https?:\/\/www\.facebook\.com\/[^"?]+\/(?:posts|permalink)\/[^"?]+)/);
    const postUrl = urlMatch ? urlMatch[1] : null;
    if (!postUrl || known.has(postUrl)) continue;
    posts.push({ url: postUrl, text: postText, image: null, posted: "" });
  }

  // Second-pass fallback: mbasic story_fbid links
  if (!posts.length) {
    const fbidRe = /href="(https?:\/\/mbasic\.facebook\.com\/story\.php[^"]*)"[^>]*>([\s\S]*?)(?=href="https?:\/\/mbasic\.facebook\.com\/story\.php|$)/g;
    while ((fbidRe.exec(html)) !== null && posts.length < 25) {
      // We just need text blobs — use the page text split by visual separators
    }
    log(`  [${source.id}] fb posts: 0 posts extracted via regex`);
    return [];
  }

  const fields = await extractSocialEvents(
    posts.map((p, i) => ({
      key: String(i),
      posted: p.posted,
      text: p.text,
      links: [...p.text.matchAll(/https?:\/\/[^\s]+/g)].map((mm) => mm[0]),
    })),
    todayISODate()
  );

  const out = [];
  posts.forEach((p, i) => {
    const f = fields.get(String(i));
    if (!f?.is_event || !f.date) return;
    const [y, mo, d] = f.date.split("-").map(Number);
    const [hh, mm] = (f.time || "20:00").split(":").map(Number);
    const { priceText, isFree } = reconcilePrice(f.price_text, f.is_free);
    out.push({
      occurrenceKey: p.url,
      title: (f.title || p.text.split("\n")[0]).slice(0, 200),
      description: p.text.slice(0, 600),
      startsAt: israelISO(y, mo, d, hh, mm),
      where: f.where || null,
      priceText,
      isFree,
      bookingUrl: f.booking_url || p.url,
      eventUrl: p.url,
      imageUrl: p.image,
      lang: "he",
      confidence: 0.55,
    });
  });
  log(`  [${source.id}] fb events from posts: ${out.length}`);
  return out;
}

export async function discover(source, log = console.error) {
  const events = await structuredEvents(source.handle, log, source.id);
  if (events.length) return events;
  // no structured upcoming events — try recent posts (how active venues announce now)
  return eventsFromPosts(source.handle, source, log);
}
