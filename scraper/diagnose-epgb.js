// EPGB (epgb.co.il) is JS-rendered — posters load dynamically. Render the page
// and dump the card structure so we can pair poster + title + date + register link.
import { renderPage, closeBrowser } from "./lib/render.js";

const { html, images, text } = await renderPage("https://www.epgb.co.il/", { timeoutMs: 50000, settleMs: 2500, scroll: true });
console.log(`rendered: html=${html.length} bytes, images=${images.length}`);
console.log("\n=== largest images (first 12) ===");
console.log(images.slice(0, 12).join("\n"));

// Date-ish strings present?
const dates = [...new Set([...text.matchAll(/\b\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\b/g)].map(m => m[0]))];
console.log("\ndate-ish in text:", dates.slice(0, 15).join(", "));

// Dump HTML windows around the first 2 poster <img> to reveal card markup.
let n = 0;
for (const m of html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']*(?:upload|wp-content|media|\.jpg|\.png|\.webp)[^"']*)["'][^>]*>/gi)) {
  if (/logo|icon|sprite/i.test(m[1])) continue;
  if (++n > 2) break;
  const idx = m.index;
  console.log(`\n========== CARD ${n} ==========`);
  console.log(html.slice(Math.max(0, idx - 200), idx + 900).replace(/\s+/g, " "));
}
await closeBrowser();
console.log("\n=== DONE ===");
