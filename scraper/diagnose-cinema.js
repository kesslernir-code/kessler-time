// Verify the cinema strategy: parse the schedule + confirm og:image per film.
import * as cinema from "./strategies/cinema.js";
import { fetchOgImage } from "./lib/fetchPage.js";

const source = { id: "cinema", name: "סינמטק", url: "https://www.cinema.co.il/", venue: "סינמטק", city: "תל אביב" };
const events = await cinema.scrape(source);
console.log(`\nPARSED ${events.length} screenings`);

// Spot-check og:image on the first 5 distinct film pages.
const seen = new Set(); let checked = 0, withImg = 0;
for (const e of events) {
  if (seen.has(e.eventUrl) || checked >= 5) continue;
  seen.add(e.eventUrl); checked++;
  const og = await fetchOgImage(e.eventUrl);
  if (og) withImg++;
  console.log(`\n- ${e.title}  @ ${e.startsAt}`);
  console.log(`  event: ${e.eventUrl.slice(0, 70)}`);
  console.log(`  og:image → ${og ? og.slice(0, 70) : "(none)"}`);
}
console.log(`\n=== ${events.length} screenings; og:image OK on ${withImg}/${checked} sampled films ===`);
