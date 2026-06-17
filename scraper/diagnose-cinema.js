// Verify the cinema strategy end-to-end (with render-retry) + og:image per film.
import * as cinema from "./strategies/cinema.js";
import { fetchOgImage } from "./lib/fetchPage.js";

const source = { id: "cinema", name: "סינמטק", url: "https://www.cinema.co.il/", venue: "סינמטק", city: "תל אביב" };
const events = await cinema.scrape(source);
console.log(`\nPARSED ${events.length} screenings`);
for (const e of events.slice(0, 8)) console.log(`  ${e.startsAt}  ${e.title}  → ${e.eventUrl.slice(-40)}`);

const seen = new Set(); let checked = 0, withImg = 0;
for (const e of events) {
  if (seen.has(e.eventUrl) || checked >= 5) continue;
  seen.add(e.eventUrl); checked++;
  const og = await fetchOgImage(e.eventUrl);
  if (og) withImg++;
  console.log(`\n- ${e.title}\n  og:image → ${og ? og.slice(0, 70) : "(none)"}`);
}
console.log(`\n=== ${events.length} screenings; og:image OK on ${withImg}/${checked} sampled ===`);
