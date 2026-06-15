-- Part 8: under-radar discovery sources can now be Facebook groups too (plus the
-- existing telegram / instagram / facebook-page). Run once in the SQL Editor.

create or replace function add_social_source(
  secret text, p_platform text, p_handle text, p_city text default null
) returns text language plpgsql security definer set search_path = public as $$
declare clean_handle text; new_id text;
begin
  if not exists (select 1 from admin_config where k = 'admin_password' and v = secret) then
    return 'wrong password';
  end if;
  if p_platform not in ('telegram', 'instagram', 'facebook', 'fb-group') then return 'bad platform'; end if;
  clean_handle := regexp_replace(lower(p_handle), '[^a-z0-9_.\-]', '', 'g');
  if length(clean_handle) < 2 then return 'bad handle'; end if;
  new_id := (case p_platform
               when 'telegram' then 'tg:'
               when 'instagram' then 'ig:'
               when 'fb-group' then 'fbg:'
               else 'fb:' end) || clean_handle;
  insert into social_sources (id, platform, handle, city)
  values (new_id, p_platform, clean_handle, nullif(p_city, ''))
  on conflict (id) do update set city = excluded.city, enabled = true;
  return 'ok';
end $$;
