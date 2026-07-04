# CLAUDE.md

Guidance for working in this repo. See [README.md](README.md) for the full picture.

## What this is
A personal Tel Aviv / Israel events page. A scraper (GitHub Actions, 3×/day)
pulls events from venue **websites** into Supabase; a static page on Netlify
(`web/`) reads them with a public anon key.

## Hard constraints
- **Zero ongoing cost.** Only public websites are scraped. No Facebook /
  Instagram / Apify — that path was removed deliberately (login-walled, paid,
  never self-updates). Don't reintroduce it. The only paid call is the Anthropic
  API for reading dates out of Hebrew free text.
- **Posters must actually render.** Every image is shown through the wsrv.nl
  proxy. A non-null `image_url` is not proof it loads — `check.js` validates each
  one. Keep junk URLs (tracking pixels, social post links) out via
  `isJunkImageUrl()` in `scraper/lib/util.js`.

## Layout
- `scraper/index.js` — orchestrator: source → strategy → normalize → dedupe → upsert.
- `scraper/check.js` — post-scrape QA: drop junk, verify each image loads via the
  proxy, escalate to rescue missing posters (og → render → **catalog**: match the
  event to the venue's WooCommerce/Shopify product posters by title, `lib/catalog.js`
  — this is how e-commerce venues like lauter get images when the date came from a
  listing → **vision**: render the listing and read posters with Claude vision),
  **re-host** hotlink/proxy-blocked
  images to Supabase Storage (`lib/storage.js`; levontin7 is force-rehosted),
  **dedup** near-duplicates (same source+day+similar title), and a QC gate
  (per-source coverage flags). listing-detail-ai sources also get last_seen_at
  refreshed here so the 48h stale-prune doesn't delete still-listed events.
- `scraper/strategies/*` — one per extraction approach (see README table).
  `smarticket` renders *.smarticket.co.il show cards (e.g. shablul);
  `shopify` reads a store's products.json (event-as-product venues).
  Note: sites that delegate event DATES to a JS ticketing widget (hameretz2's
  dateless WooCommerce products, batsheva's smarticket-only performances) can't be
  scraped reliably — posters exist but no machine-readable date; use manual upload.
- `scraper/lib/*` — `fetchPage`, `render` (puppeteer), `ai` (Claude), `db`
  (Supabase REST), `util`.
- `web/` — static page (`app.js`), admin (`admin.html`), status (`status.html`).
  Public filters are single-select (Date·City·Category·Place, "All" default,
  cascading); the מה כבר בתפריט tab is a SHARED "going" list in the public
  `going_list` table (anon read+write RLS), synced across devices.
  Asset URLs are versioned (app.js?v=N) — bump N when web/ changes so phones
  pick it up; html/js/css are served must-revalidate (netlify.toml).
- `netlify/functions/` — admin-only, password-gated (ADMIN_PW): `extract-event`
  (Claude Vision reads a screenshot), `save-event` (hosts the poster in the
  `event-images` Storage bucket + inserts a manual event via the service key —
  needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY on Netlify), `trigger-scrape`.
- Sources live in the Supabase `sources` table (edit via admin.html);
  `scraper/sources.js` is only a fallback seed.

## Conventions
- New sites default to the `auto-ladder` strategy. For listing→detail sites use
  `listing-detail-ai` with `config`: `linkPath` (detail path segment, default
  `event`), `keepQuery` (keep `?lang=` on detail URLs — some WPML sites 500
  without it), `dateRange` (exhibitions whose closing date should keep them
  visible until they end).
- Categories: event ones (`fringe`/`live`/`exhibitions`/`galleries`/…) vs
  directory ones (`bars`/`restaurants`/`festival` → info cards). `galleries` =
  ongoing exhibitions, shown only under its own chip.
- Multi-day events set `ends_at`; `normalize()` keeps an event while its
  `ends_at` is in the future even if it started in the past.

## Environment gotchas (this machine)
- `node` is at `C:\Program Files\nodejs\node.exe` — NOT on the non-interactive
  PATH. Call it by full path from PowerShell; it's absent from the Bash tool.
- **Do not read UTF-8/JSON with PowerShell `Get-Content`** — it decodes as
  CP1255 here and mangles Hebrew into mojibake. Use `node` or `Invoke-RestMethod`.
- Local runs read `.env` (has SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  ANTHROPIC_API_KEY). The scraper expects these in `process.env`.

## Testing a change
```
node scraper/index.js --dry-run --source=<id>   # extraction only, no writes
node scraper/check.js                            # QA pass (writes image fixes)
node tools/check-images.mjs                      # read-only: which posters load
```
