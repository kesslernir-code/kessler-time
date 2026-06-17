// One-time migration: point the Amphi Tel Aviv source at the homepage and the
// dedicated `amphitlv` strategy (its events have images only on the homepage grid).
import { getSources, updateSourceRow, deleteSourceEvents } from "./lib/db.js";

const sources = (await getSources()) || [];
const ampi = sources.find((s) => /amphitlv\.co\.il/i.test(s.url || "") || /אמפי תל אביב/.test(s.name || ""));

if (!ampi) {
  console.log("migrate-amphitlv: no Amphi source found (nothing to do)");
} else {
  await updateSourceRow(ampi.id, {
    url: "https://amphitlv.co.il/",
    strategy: "amphitlv",
    category: "live", // Amphi Tel Aviv = live shows / concerts
  });
  // Drop old imageless events so the next scrape repopulates them with posters.
  await deleteSourceEvents(ampi.id);
  console.log(`migrate-amphitlv: ${ampi.id} → strategy=amphitlv, events cleared`);
}
