// Verify the epgb strategy end-to-end.
import * as epgb from "./strategies/epgb.js";
const source = { id: "epgb", name: "רדיו E.P.G.B", url: "https://www.epgb.co.il/", venue: "רדיו", city: "תל אביב" };
const events = await epgb.scrape(source);
console.log(`\nPARSED ${events.length} events`);
for (const e of events) {
  console.log(`\n- ${e.title}  @ ${e.startsAt}`);
  console.log(`  img:  ${e.imageUrl || "(NONE)"}`);
  console.log(`  url:  ${e.eventUrl}`);
}
console.log(`\n=== ${events.filter(e => e.imageUrl).length}/${events.length} have images ===`);
