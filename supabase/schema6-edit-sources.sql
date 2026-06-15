-- Part 6: let the admin page edit a place's name, category and city.
-- Run once in the Supabase SQL Editor.

create or replace function update_source(
  secret text, p_id text, p_name text, p_category text, p_city text default null
) returns text language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from admin_config where k = 'admin_password' and v = secret) then
    return 'wrong password';
  end if;
  if p_category not in ('fringe', 'club', 'mainstream', 'festival', 'cinema') then
    return 'bad category';
  end if;
  update sources set name = p_name, category = p_category, city = nullif(p_city, '')
  where id = p_id;
  -- cascade category + city to this source's existing events so the change shows now
  update events set category = p_category, city = nullif(p_city, '')
  where source_id = p_id;
  return 'ok';
end $$;
