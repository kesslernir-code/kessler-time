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

function isLoginWall(html) {
  return html.includes('login_form') || html.includes('log in to facebook') ||
    html.includes('you must log in') || (html.includes('log in') && html.length < 8000);
}

async function fetchMbasic(url, id, log) {
  try {
    const { html } = await renderPage(url, { timeoutMs: 30000, settleMs: 800 });
    const title = html.match(/<title[^>]*>([^<]+)/i)?.[1] || '';
    log(`  [${id}] fb page title: "${title.slice(0, 80)}"`);
    if (isLoginWall(html.toLowerCase())) {
      log(`  [${id}] fb login wall detected — skipping`);
      return null;
    }
    return html;
  } catch (err) {
    log(`  [${id}] fb fetch error: ${err.message}`);
    return null;
  }
}

async function structuredEvents(handle, log, id) {
  log(`  [${id}] fb events: fetching mbasic.facebook.com/${handle}/events`);
  const html = await fetchMbasic(`${MBASIC}/${handle}/events`, id, log);
  if (!html) return [];
  const events = parseEventsPage(html);
  log(`  [${id}] fb structured events: ${events.length}`);
  return events;
}

async function eventsFromPosts(handle, source, log) {
  if (!aiConfigured()) return [];
  log(`  [${source.id}] fb posts: fetching mbasic.facebook.com/${handle}`);
  const html = await fetchMbasic(`${MBASIC}/${handle}`, source.id, log);
  if (!html) return [];

  const known = await knownEventUrls(source.id);
  const posts = [];

  // Extract text blocks from mbasic — stories appear as divs with role="article"
  // or as blocks separated by <hr> or story links. Try multiple patterns.
  const pageText = stripHtml(html).trim();
  const textChunks = pageText.split(/\n{3,}/).filter(t => t.trim().length > 30);
  log(`  [${source.id}] fb posts: ${textChunks.length} text chunks`);

  // Also try to find story permalink URLs
  const permalinkRe = /href="(https?:\/\/(?:www|mbasic)\.facebook\.com\/[^"?]+\/(?:posts|permalink|story)[^"]*)/g;
  const seenUrls = new Set();
  let pm;
  while ((pm = permalinkRe.exec(html)) !== null && posts.length < 20) {
    const postUrl = pm[1].replace(/&amp;/g, '&');
    if (seenUrls.has(postUrl) || known.has(postUrl)) continue;
    seenUrls.add(postUrl);
    posts.push({ url: postUrl, text: '', image: null, posted: '' });
  }

  // Pair text chunks with posts or use as standalone
  if (!posts.length && textChunks.length) {
    textChunks.slice(0, 20).forEach((t, i) => posts.push({ url: `${MBASIC}/${handle}#chunk${i}`, text: t, image: null, posted: '' }));
  } else {
    posts.forEach((p, i) => { p.text = textChunks[i] || ''; });
  }

  const validPosts = posts.filter(p => p.text.length > 20);
  log(`  [${source.id}] fb posts: ${validPosts.length} valid posts`);

  if (!validPosts.length) return [];

  const fields = await extractSocialEvents(
    validPosts.map((p, i) => ({
      key: String(i),
      posted: p.posted,
      text: p.text,
      links: [...p.text.matchAll(/https?:\/\/[^\s]+/g)].map((mm) => mm[0]),
    })),
    todayISODate()
  );

  const out = [];
  validPosts.forEach((p, i) => {
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
