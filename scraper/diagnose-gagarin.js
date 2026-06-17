// Verify the tribe-events strategy against gagarin.
import * as tribe from "./strategies/tribeEvents.js";
const source = { id: "gagarin", name: "גאגרין", url: "https://gagarin.co.il/", venue: "גאגרין", city: "תל אביב" };
const events = await tribe.scrape(source);
console.log(`\nPARSED ${events.length} events`);
for (const e of events.slice(0, 8)) {
  console.log(`\n- ${e.title}  @ ${e.localDateTime}`);
  console.log(`  img: ${e.imageUrl || "(NONE)"}`);
  console.log(`  url: ${e.eventUrl}`);
}
console.log(`\n=== ${events.filter(e => e.imageUrl).length}/${events.length} have images ===`);
