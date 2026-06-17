import { createHash } from "node:crypto";

export const shortHash = (s) =>
  createHash("sha1").update(s, "utf8").digest("hex").slice(0, 12);

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** UTC offset string ("+03:00") of Asia/Jerusalem at a given instant — DST-aware, no libraries. */
export function jerusalemOffset(date = new Date()) {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName").value; // "GMT+03:00"
  const m = part.match(/GMT([+-]\d{2}:\d{2})/);
  return m ? m[1] : "+02:00";
}

/** Build an ISO timestamp for a wall-clock time in Israel. Returns null on bad input. */
export function israelISO(y, mo, d, hh = 0, mm = 0) {
  if (!Number.isFinite(hh)) hh = 20;
  if (!Number.isFinite(mm)) mm = 0;
  if (![y, mo, d].every(Number.isFinite)) return null;
  const approx = new Date(Date.UTC(y, mo - 1, d, hh, mm));
  if (Number.isNaN(approx.getTime())) return null;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${jerusalemOffset(approx)}`;
}

/**
 * Sites often print "12.06" with no year. Pick the year that makes the date
 * upcoming: if the date with the current year is more than 30 days in the past,
 * assume it belongs to next year.
 */
export function inferYear(month, day, now = new Date()) {
  const y = now.getFullYear();
  const candidate = new Date(Date.UTC(y, month - 1, day));
  return candidate.getTime() < now.getTime() - 30 * 864e5 ? y + 1 : y;
}

/** Decode the handful of HTML entities WordPress actually emits. */
export function decodeEntities(s = "") {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

/** HTML -> readable plain text (good enough for descriptions and AI input). */
export function stripHtml(html = "") {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

/** "50-60" / "₪35" / "" -> { priceText, isFree } with the guide's reconciliation rule. */
export function reconcilePrice(priceText, isFreeHint) {
  const text = (priceText || "").trim();
  const hasNumber = /\d/.test(text);
  const freeWords = /חינם|free|כניסה חופשית|entrada libre/i.test(text);
  let isFree = isFreeHint ?? null;
  if (freeWords && !hasNumber) isFree = true;
  if (hasNumber) isFree = false; // a number always beats a "free" flag
  return { priceText: text || null, isFree };
}

/** Canonical form of a title for dedup: lowercased, punctuation and extra spaces stripped. */
export function canonTitle(s = "") {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Two titles describe the same event when their word-sets overlap heavily —
 *  e.g. "FOREVER YOUNG" vs "FOREVER YOUNG - 80s Party", or a tour announced under
 *  slightly different phrasings. Measured as overlap / smaller-set (so a short
 *  title fully contained in a longer one counts as a match). */
export function titlesSimilar(a, b, threshold = 0.6) {
  const toks = (s) => new Set(canonTitle(s).split(" ").filter((w) => w.length > 1));
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size) >= threshold;
}

/** Detect an Instagram/Facebook PAGE url (for main-feed venues). FB groups are
 *  excluded — those are under-radar discovery sources, not venues. */
export function detectSocialUrl(u) {
  const s = String(u || "");
  let m;
  if ((m = s.match(/instagram\.com\/([A-Za-z0-9_.]+)/))) return { platform: "instagram", handle: m[1] };
  if (/facebook\.com\/groups\//.test(s)) return null;
  if ((m = s.match(/facebook\.com\/([A-Za-z0-9.\-]+)/))) return { platform: "facebook", handle: m[1] };
  return null;
}

/** Scan free text for a price: returns "₪50" / "₪50–70" / "חינם" / null. Generic, no per-site rules. */
export function scanPrice(text = "") {
  const nums = [
    ...text.matchAll(/(?:₪|ש"ח|ש״ח|שח|NIS|ILS)\s*(\d{1,4})|(\d{1,4})\s*(?:₪|ש"ח|ש״ח|שח|NIS|ILS)/gi),
  ]
    .map((m) => Number(m[1] || m[2]))
    .filter((n) => n >= 10 && n <= 2000);
  if (nums.length) {
    const lo = Math.min(...nums), hi = Math.max(...nums);
    return lo === hi ? `₪${lo}` : `₪${lo}–${hi}`;
  }
  if (/כניסה חופשית|כניסה חינם|הכניסה חופשית|free entrance|free entry|admission free/i.test(text)) return "חינם";
  return null;
}

/** First link to a known ticketing platform inside raw HTML, or null. */
export function findTicketLink(html = "") {
  const m = html.match(
    /href=["'](https?:\/\/[^"']*(?:eventer\.co\.il|eventbrite\.|tickchak\.co\.il|tic\.li|tixwise\.co\.il|smarticket\.co\.il|go-out\.co|did\.li|tickets\.|cardcom\.solutions|lu\.ma|tickel\.co)[^"']*)["']/i
  );
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

export const todayISODate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()); // YYYY-MM-DD
