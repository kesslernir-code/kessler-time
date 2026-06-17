// Render cinema.co.il and inspect the film-card structure: per-film link + poster.
import { renderPage, closeBrowser } from "./lib/render.js";

const { text, html, images } = await renderPage("https://www.cinema.co.il/", { timeoutMs: 45000, scroll: true });
console.log(`rendered: html=${html.length} bytes, text=${text.length}, images=${images.length}`);

console.log("\n=== largest rendered images (first 15) ===");
console.log(images.slice(0, 15).join("\n"));

// Find anchors that wrap an image (typical film card: <a href=film><img poster></a>)
console.log("\n=== anchors with film-ish hrefs ===");
const aTags = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
const filmish = [...new Set(aTags.filter(h => /film|movie|event|screening|הקרנ|\/sרט|show|\d{4,}/i.test(h)))];
console.log(filmish.slice(0, 20).join("\n") || "(none)");

// Show a window of HTML around the first poster image to reveal card markup
const firstPoster = images.find(s => /upload|poster|film|movie|media/i.test(s)) || images[0];
if (firstPoster) {
  const key = firstPoster.split("/").pop().slice(0, 20);
  const idx = html.indexOf(key);
  if (idx > 0) {
    console.log(`\n=== HTML around first poster (${key}) ===`);
    console.log(html.slice(Math.max(0, idx - 700), idx + 200).replace(/\s+/g, " "));
  }
}
await closeBrowser();
console.log("\n=== DONE ===");
