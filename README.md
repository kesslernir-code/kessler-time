# Kessler Time

Personal events page — scrapes the venue websites we follow into Supabase and
shows the upcoming events at **events.akibabus.com**. Everything runs in the
cloud; the page is static and reads Supabase directly with a public anon key.

```
GitHub Actions (cron, 3×/day)                         Netlify (static)
  scraper/index.js  ──► Supabase  ◄────────────────  web/  (anon read key)
  scraper/check.js  ──►  (events + scrape_runs tables)
```

Everything is **zero ongoing cost**: only public websites are scraped (no
Facebook/Instagram, no Apify). The one paid dependency is the Anthropic API,
used sparingly to read dates out of Hebrew free-text where a site has no
structured data.

## How it works

1. **`scraper/index.js`** runs every enabled source through its strategy,
   normalizes the results, de-duplicates, and upserts into the `events` table.
   Past events are dropped — except multi-day runs (exhibitions) that haven't
   ended yet.
2. **`scraper/check.js`** is the post-scrape QA / "checking agent". It:
   - drops junk `image_url`s (tracking pixels, social post links) and **verifies
     every remaining poster actually loads** through the wsrv.nl image proxy — a
     stored URL that 404s would show a broken-image placeholder, so "has an
     image" ≠ "shows a poster";
   - rescues missing posters via an escalation ladder (og:image / twitter:image
     / first content image → browser render of the event's own page);
   - runs a **QC gate**: any source with ≥4 events and <50% working images is
     reported as a FAIL on `/status`, so a regression is loud instead of silent.

## Sources & strategies

The live source list lives in the **`sources` table** (edit it from
[web/admin.html](web/admin.html)); [scraper/sources.js](scraper/sources.js) is a
seed/fallback used only when the table is empty. Each source has a `strategy`:

| Strategy | When to use |
|----------|-------------|
| `auto-ladder` | default for a new site — climbs JSON-LD → WP REST → AI → render → vision |
| `wp-auto` | generic WordPress REST extractor (title/image/date structurally) |
| `wp-events-api` | site exposes The Events Calendar / WP events REST directly |
| `listing-detail-ai` | a listing page links to per-item detail pages; Claude reads the date from each. Config: `linkPath` (path segment, default `event`), `keepQuery` (keep `?lang=` etc. on detail URLs), `dateRange` (exhibitions with a closing date) |
| `tribe-events` | The Events Calendar JSON API |
| `radical-calendar`, `cinema`, `epgb`, `amphitlv`, `jaffa-cinema` | hand-tuned per-site recipes |

Posters are always shown through the **wsrv.nl** proxy (resizes, sidesteps
hotlink blocks). `isJunkImageUrl()` in [scraper/lib/util.js](scraper/lib/util.js)
keeps tracking pixels / social links out of `image_url`.

## Categories

Event categories: `fringe`, `live`, `bohemia`, `exhibitions`, `galleries`,
`club`, `cinema`, `secret`, `other`. `galleries` holds ongoing exhibitions
(date ranges) and is shown only under its own filter chip, not the main feed.
`bars`, `restaurants`, `festival` are **directory** categories — single info
cards (image / phone / link), not scraped for events.

## Adding a site

From [web/admin.html](web/admin.html): paste the events-page URL, pick a
category, hit Add (default strategy `auto-ladder`), then **↻ Scan now**. Or seed
it in [scraper/sources.js](scraper/sources.js). Test locally:

```bash
node scraper/index.js --dry-run --source=<id>
```

If the site needs a precise recipe, add a module under `scraper/strategies/` and
register it in the `strategies` map in [scraper/index.js](scraper/index.js).

## Local development

```bash
cp .env.example .env             # fill in keys for a real run
node scraper/index.js --dry-run  # scrape without writing anywhere
node scraper/check.js            # QA pass (writes image fixes — needs the service key)
npm run serve                    # preview the site at http://localhost:8731
```

## Debugging a broken source

1. **/status.html** on the live site — last run per source, strategy, error, and
   the QC image-coverage flags.
2. `scrape_runs` table in Supabase has the full history.
3. Failed GitHub Actions runs upload an `artifacts/` bundle with the error stack.
4. Re-run manually: GitHub → Actions → "Scrape events" → Run workflow.

## Secrets (GitHub repo → Settings → Secrets → Actions)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`. The public page
uses only the anon key, baked into [web/config.js](web/config.js) (safe:
row-level security allows SELECT only).
