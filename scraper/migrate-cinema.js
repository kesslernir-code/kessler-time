// One-time migration: switch the Cinematheque source to the dedicated `cinema`
// strategy (renders the schedule, captures per-film /event/ pages with posters).
import { getSources, updateSourceRow, deleteSourceEvents } from "./lib/db.js";

const sources = (await getSources()) || [];
const c = sources.find((s) => s.id === "cinema" || /cinema\.co\.il/i.test(s.url || ""));

if (!c) {
  console.log("migrate-cinema: no cinema source found (nothing to do)");
} else if (c.strategy === "cinema") {
  console.log("migrate-cinema: already on cinema strategy (nothing to do)");
} else {
  await updateSourceRow(c.id, { url: "https://www.cinema.co.il/", strategy: "cinema" });
  await deleteSourceEvents(c.id); // clear old imageless/homepage-url events
  console.log(`migrate-cinema: ${c.id} → strategy=cinema, events cleared`);
}
