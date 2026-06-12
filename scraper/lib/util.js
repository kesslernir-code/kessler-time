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

/** Build an ISO timestamp for a wall-clock time in Israel. */
export function israelISO(y, mo, d, hh = 0, mm = 0) {
  const approx = new Date(Date.UTC(y, mo - 1, d, hh, mm));
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

export const todayISODate = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()); // YYYY-MM-DD
