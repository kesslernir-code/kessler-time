-- Part 4: add the "cinema" place category. Run once in the Supabase SQL Editor.
-- (Only needed so NEW cinemas can be added via the admin page; existing data is
--  already updated directly.)

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
  if p_category not in ('fringe', 'club', 'mainstream', 'festival', 'cinema') then
    return 'bad category';
  end if;
  insert into sources (id, name, url, venue, city, category)
  values (p_id, p_name, p_url, nullif(p_venue, ''), nullif(p_city, ''), p_category)
  on conflict (id) do update
    set name = excluded.name, url = excluded.url, venue = excluded.venue,
        city = excluded.city, category = excluded.category, enabled = true;
  return 'ok';
end $$;
