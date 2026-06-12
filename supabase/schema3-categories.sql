-- Part 3: place categories. Each source (place) has a category; its events inherit it.
-- Categories: fringe (שוליים) / club (מועדונים) / mainstream (מיינסטרים) / festival (פסטיבלים)
-- Run once in the Supabase SQL Editor.

alter table sources add column if not exists category text not null default 'fringe';
alter table events  add column if not exists category text;

update events set category = 'fringe' where category is null;

-- add_source gains a category parameter (drop the old signature first so the
-- RPC name stays unambiguous for PostgREST)
drop function if exists add_source(text, text, text, text, text, text);

create or replace function add_source(
  secret text, p_id text, p_name text, p_url text,
  p_venue text default null, p_city text default null, p_category text default 'fringe'
) returns text language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_config where k = 'admin_password' and v = secret) then
    return 'wrong password';
  end if;
  if p_id !~ '^[a-z0-9-]{2,30}$' then
    return 'bad id (lowercase letters/digits/hyphens)';
  end if;
  if p_category not in ('fringe', 'club', 'mainstream', 'festival') then
    return 'bad category';
  end if;
  insert into sources (id, name, url, venue, city, category)
  values (p_id, p_name, p_url, nullif(p_venue, ''), nullif(p_city, ''), p_category)
  on conflict (id) do update
    set name = excluded.name, url = excluded.url, venue = excluded.venue,
        city = excluded.city, category = excluded.category, enabled = true;
  return 'ok';
end $$;
