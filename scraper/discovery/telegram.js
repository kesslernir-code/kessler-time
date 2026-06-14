// Telegram discovery: read a public channel's web preview (t.me/s/<handle>) —
// free, no auth — then let Claude decide which posts are real upcoming events
// and extract their details. Returns discovery events (kind = "social").
import { fetchText } from "../lib/fetchPage.js";
import { stripHtml, decodeEntities, israelISO, reconcilePrice, todayISODate } from "../lib/util.js";
import { extractSocialEvents, aiConfigured } from "../lib/ai.js";
import { knownEventUrls } from "../lib/db.js";

export const platform = "telegram";

// Parse the channel preview HTML into {id, link, text, image, posted}
function parsePosts(html, handle) {
  const blocks = html.split('class="tgme_widget_message ').slice(1);
  const posts = [];
  for (const b of blocks) {
    const id = b.match(new RegExp(`data-post="${handle}/(\\d+)"`, "i"))?.[1];
    const textHtml = b.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
    const text = stripHtml(textHtml.replace(/<br\s*\/?>/gi, "\n"));
    const posted = b.match(/datetime="([^"]+)"/)?.[1] || null;
    const image = b.match(/tgme_widget_message_photo_wrap[^>]*background-image:url\(['"]?(https:\/\/[^'")]+)/)?.[1] || null;
    if (!id || !text) continue;
    posts.push({ id, link: `https://t.me/${handle}/${id}`, text, image, posted });
  }
  return posts;
}

export async function discover(source, log = console.error) {
  const handle = source.handle;
  const html = await fetchText(`https://t.me/s/${handle}`);
  const posts = parsePosts(html, handle);
  log(`  [${source.id}] telegram posts: ${posts.length}`);

  // Only recent posts (events are announced shortly before), and unseen ones
  const cutoff = Date.now() - 35 * 864e5;
  const known = await knownEventUrls(source.id);
  const fresh = posts.filter(
    (p) => !known.has(p.link) && (!p.posted || Date.parse(p.posted) > cutoff)
  );
  if (!fresh.length) return [];
  if (!aiConfigured()) throw new Error("ANTHROPIC_API_KEY missing — discovery needs AI");

  const fields = await extractSocialEvents(
    fresh.map((p) => ({
      key: p.id,
      posted: (p.posted || "").slice(0, 10),
      text: p.text,
      links: [...p.text.matchAll(/https?:\/\/[^\s]+/g)].map((m) => m[0]),
    })),
    todayISODate()
  );

  const events = [];
  for (const p of fresh) {
    const f = fields.get(p.id);
    if (!f?.is_event || !f.date) continue;
    const [y, mo, d] = f.date.split("-").map(Number);
    const [hh, mm] = (f.time || "20:00").split(":").map(Number);
    const { priceText, isFree } = reconcilePrice(f.price_text, f.is_free);
    events.push({
      occurrenceKey: p.id,
      title: (f.title || p.text.split("\n")[0]).slice(0, 200),
      description: p.text.slice(0, 600),
      startsAt: israelISO(y, mo, d, hh, mm),
      where: f.where || null, // free-text location for social events
      priceText,
      isFree,
      bookingUrl: f.booking_url || p.link, // ticket link if found, else the post
      eventUrl: p.link,
      imageUrl: p.image,
      lang: "he",
      confidence: 0.6, // discovery is best-effort
    });
  }
  log(`  [${source.id}] telegram events: ${events.length}`);
  return events;
}
