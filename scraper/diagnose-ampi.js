// Verify the amphitlv strategy parses events + images correctly (no DB writes).
import * as amphitlv from "./strategies/amphitlv.js";
const source = { id: "ampi", name: "אמפי תל אביב", url: "https://amphitlv.co.il/", venue: "אמפי תל אביב", city: "תל אביב" };
const events = await amphitlv.scrape(source);
console.log(`\nPARSED ${events.length} EVENTS:`);
for (const e of events) {
  console.log(`\n- ${e.title}`);
  console.log(`  when: ${e.startsAt}`);
  console.log(`  img:  ${e.imageUrl || "(NONE)"}`);
  console.log(`  link: ${e.bookingUrl}`);
}
const withImg = events.filter(e => e.imageUrl).length;
console.log(`\n=== ${withImg}/${events.length} have images ===`);
