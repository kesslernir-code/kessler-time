// Fetch a venue's product catalog (WooCommerce or Shopify) as [{title, image}].
// On e-commerce venues (hameretz2 = WooCommerce, lauter = Shopify) each event is a
// product whose poster is the product image, but the DATE lives on the listing —
// so we extract the dated event normally and match the catalog poster on by title.
// Both endpoints are public/read-only and cost nothing. Cached per origin per run.
import { fetchJson } from "./fetchPage.js";
import { decodeEntities } from "./util.js";

const cache = new Map(); // origin -> [{title,image}] | null

export async function fetchCatalog(origin) {
  if (cache.has(origin)) return cache.get(origin);
  let out = null;
  // WooCommerce Store API (no auth) — /wp-json/wc/store/v1/products. Newest first
  // (upcoming events are the most recently added products) and paginate, since a
  // venue accrues hundreds of past-event products behind the current ones.
  try {
    const all = [];
    for (let page = 1; page <= 4; page++) {
      const p = await fetchJson(`${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}&orderby=date&order=desc&catalog_visibility=visible`);
      if (!Array.isArray(p) || !p.length) break;
      all.push(...p);
      if (p.length < 100) break;
    }
    if (all.length) {
      out = all.map((x) => ({ title: decodeEntities(x.name || "").trim(), image: x.images?.[0]?.src || null }))
        .filter((x) => x.title && x.image);
    }
  } catch { /* not WooCommerce */ }
  // Shopify storefront JSON — /products.json
  if (!out || !out.length) {
    try {
      const j = await fetchJson(`${origin}/products.json?limit=250`);
      const p = j?.products;
      if (Array.isArray(p) && p.length) {
        out = p.map((x) => ({ title: decodeEntities(x.title || "").trim(), image: x.images?.[0]?.src || null }))
          .filter((x) => x.title && x.image);
      }
    } catch { /* not Shopify */ }
  }
  cache.set(origin, out && out.length ? out : null);
  return cache.get(origin);
}
