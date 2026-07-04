-- Part 16: add_source/update_source still whitelisted the old category set
-- (had 'exhibitions', missing 'live' and 'galleries') from before תערוכות was
-- merged into גלריות — every "Add a site" submission with a current category
-- was rejected as "bad category". Sync the whitelist to the live set used by
-- web/app.js and web/admin.html's own dropdowns:
--   fringe, live, bohemia, galleries, festival, cinema, bars, restaurants,
--   club, secret, other.

create or replace function add_source(
  secret text, p_id text, p_name text, p_url text,
  p_venue text default null, p_city text default null, p_category text default 'other'
) returns text language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_config where k = 'admin_password' and v = secret) then
    return 'wrong password';
  end if;
  if p_id !~ '^[a-z0-9-]{2,30}$' then
    return 'bad id (lowercase letters/digits/hyphens)';
  end if;
  if p_category not in ('fringe','live','bohemia','galleries','festival','cinema','bars','restaurants','club','secret','other') then
    return 'bad category';
  end if;
  insert into sources (id, name, url, venue, city, category)
  values (p_id, p_name, p_url, nullif(p_venue, ''), nullif(p_city, ''), p_category)
  on conflict (id) do update
    set name = excluded.name, url = excluded.url, venue = excluded.venue,
        city = excluded.city, category = excluded.category, enabled = true;
  return 'ok';
end $$;

create or replace function update_source(
  secret text, p_id text, p_name text, p_category text, p_city text default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_config where k = 'admin_password' and v = secret) then
    return 'wrong password';
  end if;
  if p_category not in ('fringe','live','bohemia','galleries','festival','cinema','bars','restaurants','club','secret','other') then
    return 'bad category';
  end if;
  update sources set name = p_name, category = p_category, city = nullif(p_city, '') where id = p_id;
  update events set category = p_category, city = nullif(p_city, '') where source_id = p_id;
  return 'ok';
end $$;
