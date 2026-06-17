// Dump cinema.co.il film-card markup so we can pair link + poster + title + date.
import { renderPage, closeBrowser } from "./lib/render.js";
const { html } = await renderPage("https://www.cinema.co.il/", { timeoutMs: 45000, scroll: true });
console.log("html bytes:", html.length);

// Windows around the first 2 /event/ anchors reveal the repeating card structure.
const re = /href=["']https:\/\/www\.cinema\.co\.il\/event\//g;
let m, n = 0;
while ((m = re.exec(html)) && n < 2) {
  n++;
  const chunk = html.slice(Math.max(0, m.index - 1100), m.index + 400).replace(/\s+/g, " ");
  console.log(`\n========== CARD ${n} ==========`);
  console.log(chunk);
}
await closeBrowser();
console.log("\n=== DONE ===");
