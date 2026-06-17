// Decisive test: does a cinema /event/ page yield og:image via the scraper's
// normal fetch (fetchOgImage)? If yes, the fix is trivial: capture /event/ URLs
// and the existing escalation fills posters — no per-page render needed.
import { fetchOgImage, fetchPage } from "./lib/fetchPage.js";

const urls = [
  "https://www.cinema.co.il/event/%d7%97%d7%99%d7%99%d7%9d-%d7%9c%d7%9c%d7%90-%d7%9b%d7%99%d7%a1%d7%95%d7%99-%d7%99%d7%95%d7%9d-%d7%94%d7%a7%d7%95%d7%9c%d7%a0%d7%95%d7%a2-%d7%94%d7%99%d7%a9%d7%a8%d7%90%d7%9c%d7%99/",
  "https://www.cinema.co.il/event/%d7%9e%d7%90%d7%9e%d7%90-%d7%99%d7%95%d7%9d-%d7%94%d7%a7%d7%95%d7%9c%d7%a0%d7%95%d7%a2-%d7%94%d7%99%d7%a9%d7%a8%d7%90%d7%9c%d7%99/",
];
for (const u of urls) {
  let status = "?";
  try { status = (await fetchPage(u, { retries: 0, timeoutMs: 15000 })).status; } catch (e) { status = "ERR " + e.message; }
  const og = await fetchOgImage(u);
  console.log(`\nstatus=${status}`);
  console.log(`og:image = ${og || "(none)"}`);
}
console.log("\n=== DONE ===");
