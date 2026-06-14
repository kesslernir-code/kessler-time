-- Part 5: the "Social" discovery layer — events found only on social media
-- (temporary / underground / off-grid), shown on a separate event-first page.
-- Run once in the Supabase SQL Editor.

-- Mark whether an event came from a tracked venue website ('venue') or was
-- discovered on social media ('social'). The main feed shows only 'venue';
-- the Social page shows only 'social'.
alter table events add column if not exists kind text not null default 'venue';
create index if not exists events_kind_idx on events (kind, starts_at);

-- Social channels/pages the discovery engine monitors.
create table if not exists social_sources (
  id        text primary key,         -- e.g. "tg:hamiffal" / "ig:venue" / "fb:venue"
  platform  text not null,            -- telegram | instagram | facebook
  handle    text not null,            -- channel/page handle (no @)
  city      text,
  enabled   boolean not null default true,
  added_at  timestamptz default now()
);

alter table social_sources enable row level security;
create policy "public read social_sources" on social_sources for select using (true);

-- Add a social channel (admin-password protected, same pattern as add_source).
create or replace function add_social_source(
  secret text, p_platform text, p_handle text, p_city text default null
) returns text language plpgsql security definer set search_path = public as $$
declare clean_handle text; new_id text;
begin
  if not exists (select 1 from admin_config where k = 'admin_password' and v = secret) then
    return 'wrong password';
  end if;
  if p_platform not in ('telegram', 'instagram', 'facebook') then return 'bad platform'; end if;
  clean_handle := regexp_replace(lower(p_handle), '^@|https?://[^/]+/(s/)?', '', 'g');
  clean_handle := regexp_replace(clean_handle, '[^a-z0-9_.]', '', 'g');
  if length(clean_handle) < 2 then return 'bad handle'; end if;
  new_id := (case p_platform when 'telegram' then 'tg:' when 'instagram' then 'ig:' else 'fb:' end) || clean_handle;
  insert into social_sources (id, platform, handle, city)
  values (new_id, p_platform, clean_handle, nullif(p_city, ''))
  on conflict (id) do update set city = excluded.city, enabled = true;
  return 'ok';
end $$;
