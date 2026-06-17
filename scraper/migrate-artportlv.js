// One-time migration: switch fb-artportlv from Facebook to website scraping
import { updateSourceRow } from "./lib/db.js";

await updateSourceRow("fb-artportlv", {
  platform: null,
  handle: null,
  url: "https://www.artport.art/events/?lang=en",
  strategy: "auto-ladder",
});

console.log("fb-artportlv updated: facebook → artport.art/events");
