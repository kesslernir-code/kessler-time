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
  **dedup** near-duplicates (same source+day+similar title, OR same source+day
  where one's event_url is literally its source's own listing/homepage URL —
  a strategy switch's orphaned old-scheme row often has a wrongly-guessed title
  that won't text-match its correctly-titled replacement, so title similarity
  alone misses it), and a QC gate (per-source coverage flags). listing-detail-ai
  sources also get last_seen_at
  refreshed here so the 48h stale-prune doesn't delete still-listed events.
- `scraper/strategies/*` — one per extraction approach (see README table).
  `smarticket` renders *.smarticket.co.il show cards (e.g. shablul);
  `shopify` reads a store's products.json (event-as-product venues);
  `batsheva-schedule` reads batsheva.co.il's `/schedule/` table directly (DOM
  `data-run-id`/`data-show`/`data-month` attributes give a stable per-occurrence
  id + date; its `/repertory/` pages are evergreen "work" pages with no reliable
  date and are only used as a poster lookup by slug via the WP REST API);
  `sol-therapy-cloud` reads sol-therapy.com/cloud's `<article class="lp-card">`
  session grid directly — its only Event JSON-LD is one bogus 3-month summary
  listing every performer at once, the real per-session dates only exist as
  plain HTML cards.
  Note: hameretz2's WooCommerce products carry no date anywhere (only in a JS
  ticketing widget) and can't be scraped reliably — use manual upload for it.
- `scraper/lib/*` — `fetchPage`, `render` (puppeteer), `ai` (Claude), `db`
  (Supabase REST), `util`.
- `web/` — static page (`app.js`), admin (`admin.html`), status (`status.html`).
  Public filters are single-select (Date·City·Category·Place, "All" default,
  cascading); the מה כבר בתפריט tab is a SHARED "going" list in the public
  `going_list` table (anon read+write RLS), synced across devices. A currently-
  running multi-day event (exhibition etc., `ends_at` still future though
  `starts_at` is past) is grouped/sorted as if it started today in the feed —
  otherwise it looks stuck under a stale date instead of appearing as ongoing.
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
  without it), `renderDetail` (detail page injects its date via client-side JS —
  render it instead of a static fetch), `alwaysRefresh` (an evergreen detail page
  whose URL never changes but whose "next date" text does — skip the known-URL
  cache and re-check every run; occurrenceKey still dedupes). Exhibitions/
  multi-day runs always keep their closing date as `ends_at` automatically (no
  config flag needed) in both listing-detail-ai and wp-auto's AI-date fallback.
  AI-batch calls key items by array index, never by URL — long percent-encoded
  Hebrew URLs are opaque enough that the model can echo one back wrong, silently
  dropping that item. The listing page's own nav links (a menu item that happens
  to share the linkPath segment, e.g. a "תערוכות" link pointing back at
  `/exhibitions/`) are excluded from the detail-page set. A poster's lookback
  window on the listing page is bounded at the previous event link's position,
  so a compact card grid can't bleed the previous card's image into this one;
  a detail-page image whose filename matches the post's own title is preferred
  over a "first non-common image" guess, since a related-posts widget can put
  another post's photo earlier in the DOM.
- Categories: event ones (`fringe`/`live`/`galleries`/…) vs directory ones
  (`bars`/`restaurants`/`festival` → info cards). `galleries` = ongoing
  exhibitions, shown only under its own chip. The full whitelist lives in THREE
  places that must stay in sync: `web/app.js` (`CATEGORIES`), `web/admin.html`
  (two `CATS`/`MCATS` arrays), and the `add_source`/`update_source` Postgres
  functions (`supabase/schema16-categories-fix.sql` has the current list) —
  adding a category means updating all three or "Add a site" silently 500s with
  "bad category".
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
Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
