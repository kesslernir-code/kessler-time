-- Part 2 of the schema: database-managed source list + password-protected admin
-- functions, so new sites can be added from the web admin page without code changes.
-- Run in Supabase SQL Editor. The admin password is set in a separate, non-committed
-- statement (see admin-secret.local.sql).

create table if not exists sources (
  id        text primary key,
  name      text not null,
  url       text not null,
  venue     text,
  city      text,
  strategy  text not null default 'auto-ladder',
  config    jsonb not null default '{}'::jsonb,
  enabled   boolean not null default true,
  added_at  timestamptz default now()
);

alter table sources enable row level security;
create policy "public read sources" on sources for select using (true);

-- Private config (no RLS policies = readable only by service role / definer functions)
create table if not exists admin_config (k text primary key, v text not null);
alter table admin_config enable row level security;

-- Add (or re-enable/update) a source. Returns 'ok' or an error string.
create or replace function add_source(
  secret text, p_id text, p_name text, p_url text,
  p_venue text default null, p_city text default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_config where k = 'admin_password' and v = secret) then
    return 'wrong password';
  end if;
  if p_id !~ '^[a-z0-9-]{2,30}$' then
    return 'bad id (lowercase letters/digits/hyphens)';
  end if;
  insert into sources (id, name, url, venue, city)
  values (p_id, p_name, p_url, nullif(p_venue, ''), nullif(p_city, ''))
  on conflict (id) do update
    set name = excluded.name, url = excluded.url,
        venue = excluded.venue, city = excluded.city, enabled = true;
  return 'ok';
end $$;

-- Enable/disable a source (disabled sources are skipped by the scraper).
create or replace function set_source_enabled(secret text, p_id text, p_enabled boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_config where k = 'admin_password' and v = secret) then
    return 'wrong password';
  end if;
  update sources set enabled = p_enabled where id = p_id;
  return 'ok';
end $$;

-- Seed the three original sources with their hand-tuned strategies
insert into sources (id, name, url, venue, city, strategy, config) values
  ('mazkeka', 'Mazkeka מזקקה', 'https://mazkeka.com/events/', 'מזקקה Mazkeka', 'ירושלים',
   'wp-events-api', '{"apiBase":"https://mazkeka.com","restBase":"events","langFilter":"he"}'),
  ('radical', 'Radical רדיקל', 'https://radical.org.il/calendar/', 'רדיקל Radical', 'תל אביב',
   'radical-calendar', '{}'),
  ('matmon', 'Matmon מטמון', 'https://matmon.space/%D7%9E%D7%98%D7%9E%D7%95%D7%9F-%D7%90%D7%99%D7%A8%D7%95%D7%A2%D7%99%D7%9D/', 'מטמון Matmon', null,
   'wp-api+ai-date', '{"apiBase":"https://matmon.space","restBase":"event"}')
on conflict (id) do nothing;
