# Kessler Time

Personal events page — scrapes the sites we follow into Supabase and shows the
upcoming events at **events.akibabus.com**. Everything runs in the cloud:

```
GitHub Actions (cron, 3x/day)          GitHub Pages
  scraper/index.js  ──► Supabase ◄──  web/ (static page, anon read key)
```

## Current sources

| Source | Strategy | Notes |
|--------|----------|-------|
| Mazkeka (Jerusalem) | `wp-events-api` | WP REST API exposes full event data |
| Radical (Tel Aviv) | `radical-calendar` | dates parsed from the calendar page cards |
| Matmon | `wp-api+ai-date` | WP API list + Claude reads the date from the Hebrew text (new events only) |

## Adding a site

Add an entry to [scraper/sources.js](scraper/sources.js) with `strategy: "auto-ladder"`
and the events-page URL. The ladder tries JSON-LD → (Puppeteer render) → Claude
extraction automatically. Test with:

```bash
node scraper/index.js --dry-run --source=<id>
```

If the site deserves a precise recipe (like Radical), add a module under
`scraper/strategies/` and register it in `scraper/index.js`.

## Local development

```bash
cp .env.example .env       # fill in keys for a real run
node scraper/index.js --dry-run    # scrape without writing anywhere
npm run serve              # preview the site at http://localhost:8731
```

## Debugging a broken source

1. Check **/status.html** on the live site — last run per source, strategy, error.
2. `scrape_runs` table in Supabase has the full history.
3. Failed GitHub Actions runs upload an `artifacts/` bundle with the error stack.
4. Re-run manually: GitHub → Actions → "Scrape events" → Run workflow.

## Secrets (GitHub repo → Settings → Secrets → Actions)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`

The public page uses only the anon key, baked into [web/config.js](web/config.js)
(safe: row-level security allows SELECT only).
