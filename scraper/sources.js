// The sites we follow. To add a new site: add an entry with strategy "auto-ladder"
// and its events-page URL — the ladder (JSON-LD -> render -> AI) figures out the rest.
// If it deserves a hand-tuned recipe later, add a strategy module and point to it.
export const sources = [
  {
    id: "mazkeka",
    name: "Mazkeka מזקקה",
    url: "https://mazkeka.com/events/",
    venue: "מזקקה Mazkeka",
    city: "ירושלים",
    strategy: "wp-events-api",
    config: { apiBase: "https://mazkeka.com", restBase: "events", langFilter: "he" },
  },
  {
    id: "radical",
    name: "Radical רדיקל",
    url: "https://radical.org.il/calendar/",
    venue: "רדיקל Radical",
    city: "תל אביב",
    strategy: "radical-calendar",
    config: {},
  },
  {
    id: "matmon",
    name: "Matmon מטמון",
    url: "https://matmon.space/%D7%9E%D7%98%D7%9E%D7%95%D7%9F-%D7%90%D7%99%D7%A8%D7%95%D7%A2%D7%99%D7%9D/",
    venue: "מטמון Matmon",
    city: null,
    strategy: "wp-api+ai-date",
    config: { apiBase: "https://matmon.space", restBase: "event" },
  },
];
