// One-time migration: switch gagarin to the Tribe Events Calendar REST strategy
// (its events live in /wp-json/tribe/events/v1/events with proper posters).
import { getSources, updateSourceRow, deleteSourceEvents } from "./lib/db.js";

const sources = (await getSources()) || [];
const g = sources.find((s) => s.id === "gagarin" || /gagarin\.co\.il/i.test(s.url || ""));

if (!g) {
  console.log("migrate-gagarin: no gagarin source found (nothing to do)");
} else if (g.strategy === "tribe-events") {
  console.log("migrate-gagarin: already on tribe-events (nothing to do)");
} else {
  await updateSourceRow(g.id, { url: "https://gagarin.co.il/", strategy: "tribe-events" });
  await deleteSourceEvents(g.id); // clear old homepage-url/imageless events
  console.log(`migrate-gagarin: ${g.id} → strategy=tribe-events, events cleared`);
}
