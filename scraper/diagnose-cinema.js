// Does a cinema /event/ page expose a parseable date + title + og:image,
// and does the rendered homepage reliably yield the /event/ links?
import { fetchText } from "./lib/fetchPage.js";
import { renderPage, closeBrowser } from "./lib/render.js";

const ev = "https://www.cinema.co.il/event/%d7%9e%d7%90%d7%9e%d7%90-%d7%99%d7%95%d7%9d-%d7%94%d7%a7%d7%95%d7%9c%d7%a0%d7%95%d7%a2-%d7%94%d7%99%d7%a9%d7%a8%d7%90%d7%9c%d7%99/";
const html = await fetchText(ev, { retries: 1, timeoutMs: 20000 });
console.log("event page bytes:", html.length);

const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1];
const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1];
console.log("og:title =", ogTitle);
console.log("og:image =", ogImg?.slice(0, 80));

// JSON-LD blocks (look for startDate)
for (const b of html.matchAll(/<script type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
  const t = b[1];
  if (/startDate|Event|datePublished/i.test(t)) console.log("JSON-LD snippet:", t.replace(/\s+/g, " ").slice(0, 300));
}
// Any date-ish text on the page (DD.MM.YY or DD.MM)
const dates = [...html.matchAll(/(\d{1,2}\.\d{1,2}\.\d{2,4})/g)].map(m => m[1]);
console.log("date-ish strings (first 10):", [...new Set(dates)].slice(0, 10).join(", "));

// Confirm homepage render yields /event/ links (count distinct)
const { html: home } = await renderPage("https://www.cinema.co.il/", { timeoutMs: 50000, scroll: true });
await closeBrowser();
const links = [...new Set([...home.matchAll(/href=["'](https:\/\/www\.cinema\.co\.il\/event\/[^"']+)["']/gi)].map(m => m[1]))];
console.log(`\nhomepage render: ${home.length} bytes, ${links.length} distinct /event/ links`);
console.log(links.slice(0, 5).join("\n"));
console.log("\n=== DONE ===");
