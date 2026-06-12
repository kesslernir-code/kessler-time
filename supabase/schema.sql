-- kessler-time schema. Run once in Supabase SQL Editor.

create table if not exists events (
  id            text primary key,            -- deterministic: source + occurrence key (re-scrapes upsert, never duplicate)
  source_id     text not null,
  title         text not null,
  description   text,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  venue         text,
  city          text,
  price_text    text,                        -- human string, e.g. "50-60 ₪" / "חינם לחברי רדיקל"
  is_free       boolean,
  booking_url   text,
  event_url     text,
  image_url     text,
  lang          text default 'he',
  confidence    real default 1.0,            -- 1.0 = structured source, lower = AI-extracted
  first_seen_at timestamptz default now(),
  last_seen_at  timestamptz default now()
);

create index if not exists events_starts_at_idx on events (starts_at);
create index if not exists events_source_idx on events (source_id);

-- Every scraper run logs here; the /status page reads it.
create table if not exists scrape_runs (
  id            bigint generated always as identity primary key,
  source_id     text not null,
  started_at    timestamptz default now(),
  duration_ms   int,
  strategy      text,                        -- which rung of the extraction ladder produced the events
  events_found  int,
  events_upserted int,
  ok            boolean,
  error         text
);

create index if not exists scrape_runs_source_idx on scrape_runs (source_id, started_at desc);

-- Public read-only access (the web page uses the anon key); writes only via service role.
alter table events enable row level security;
alter table scrape_runs enable row level security;

create policy "public read events"  on events      for select using (true);
create policy "public read runs"    on scrape_runs for select using (true);
