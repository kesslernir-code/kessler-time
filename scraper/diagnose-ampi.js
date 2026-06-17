// Diagnostic #3: how are event cards structured on the amphitlv homepage?
// We need to map each event (title/ticket link) to its poster <img>.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000) });
  return res.ok ? await res.text() : "";
}
const html = await get("https://amphitlv.co.il/");
console.log("homepage bytes:", html.length);

// Print HTML windows around each kupat.co.il/show link so we can see the card markup.
const marker = /kupat\.co\.il\/show\//g;
let m, count = 0;
while ((m = marker.exec(html)) && count < 3) {
  count++;
  const start = Math.max(0, m.index - 900);
  const end = Math.min(html.length, m.index + 200);
  // collapse whitespace for readability
  const chunk = html.slice(start, end).replace(/\s+/g, " ");
  console.log(`\n========== CARD ${count} (around kupat link) ==========`);
  console.log(chunk);
}

// Also: find the repeating container class. Look for class names near the first card.
console.log("\n========== class names near first card ==========");
const firstIdx = html.search(/kupat\.co\.il\/show\//);
if (firstIdx > 0) {
  const region = html.slice(Math.max(0, firstIdx - 1500), firstIdx + 100);
  const classes = [...region.matchAll(/class=["']([^"']+)["']/g)].map(c => c[1]);
  console.log([...new Set(classes)].join("\n"));
}
console.log("\n=== DONE ===");
