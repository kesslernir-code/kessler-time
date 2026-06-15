// Venue whose events live on its Instagram / Facebook page (no website).
// Pulls the page's posts via the same engines the under-radar discovery uses,
// but the events land on the MAIN feed (kind=venue) tagged with this venue's
// name, category and city — everything derived from the social link.
import { detectSocialUrl } from "../lib/util.js";
import * as instagram from "../discovery/instagram.js";
import * as facebook from "../discovery/facebook.js";

const mods = { instagram, facebook };

export const name = "social-venue";

export async function scrape(source, log = console.error) {
  const d = detectSocialUrl(source.url);
  if (!d) throw new Error("not an Instagram/Facebook page URL");
  const mod = mods[d.platform];
  if (!mod) throw new Error(`unsupported social platform ${d.platform}`);
  // discovery modules expect a `handle`; everything else (venue/category/city)
  // comes from the source row and is applied by the main normalizer.
  return mod.discover({ ...source, handle: d.handle }, log);
}
