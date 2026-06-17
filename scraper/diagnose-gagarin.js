// How does gagarin.co.il expose events + posters? Render and inspect.
import { renderPage, closeBrowser } from "./lib/render.js";
import { fetchOgImage, fetchText } from "./lib/fetchPage.js";

const ROOT = "https://gagarin.co.il/";
const { html, images, text } = await renderPage(ROOT, { timeoutMs: 50000, settleMs: 2500, scroll: true });
console.log(`rendered: html=${html.length}, images=${images.length}, isWP=${/wp-content|wp-json/.test(html)}`);
console.log("\n=== largest images (first 12) ===");
console.log(images.slice(0, 12).join("\n"));

// Per-event links?
const links = [...new Set([...html.matchAll(/href=["'](https?:\/\/[^"']*(?:event|show|gig|\/e\/|tickets|go\.|tikchak|eventbuzz|gagarin\.co\.il\/[^"'?#]+)[^"']*)["']/gi)].map(m => m[1]))];
console.log("\n=== candidate event links (first 15) ===");
console.log(links.filter(l => !/\.(css|js|png|jpg|svg|woff)/.test(l)).slice(0, 15).join("\n"));

// Dump HTML around first poster image to see card markup
let n = 0;
for (const m of html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']*(?:upload|wp-content|media|\.jpg|\.png|\.webp)[^"']*)["'][^>]*>/gi)) {
  if (/logo|icon|sprite/i.test(m[1])) continue;
  if (++n > 2) break;
  console.log(`\n========== CARD ${n} ==========`);
  console.log(html.slice(Math.max(0, m.index - 600), m.index + 500).replace(/\s+/g, " "));
}

// Is gagarin WordPress with a usable REST API?
try {
  const types = await fetchText(ROOT + "wp-json/wp/v2/types", { retries: 0, timeoutMs: 12000 });
  const j = JSON.parse(types);
  console.log("\nWP types:", Object.keys(j).join(", "));
} catch (e) { console.log("\nWP types: n/a", e.message); }

await closeBrowser();
console.log("\n=== DONE ===");
