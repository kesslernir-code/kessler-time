// One-time migration: switch the EPGB (radio) source to the dedicated `epgb`
// strategy that renders the weekly grid and captures per-event posters.
import { getSources, updateSourceRow, deleteSourceEvents } from "./lib/db.js";

const sources = (await getSources()) || [];
const e = sources.find((s) => s.id === "epgb" || /epgb\.co\.il/i.test(s.url || ""));

if (!e) {
  console.log("migrate-epgb: no epgb source found (nothing to do)");
} else if (e.strategy === "epgb") {
  console.log("migrate-epgb: already on epgb strategy (nothing to do)");
} else {
  await updateSourceRow(e.id, { url: "https://www.epgb.co.il/", strategy: "epgb" });
  await deleteSourceEvents(e.id); // clear old imageless events
  console.log(`migrate-epgb: ${e.id} → strategy=epgb, events cleared`);
}
