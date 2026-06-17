-- schema10: add_manual_event RPC — lets the admin add a single event directly
-- (used by the screenshot-upload feature in admin.html).
-- Run once in the Supabase SQL Editor.

create or replace function add_manual_event(
  secret        text,
  p_title       text,
  p_starts_at   text,          -- ISO 8601 string, e.g. "2025-07-04T21:00:00+03:00"
  p_category    text default 'other',
  p_venue       text default null,
  p_city        text default null,
  p_description text default null,
  p_price_text  text default null,
  p_is_free     boolean default null,
  p_booking_url text default null,
  p_image_url   text default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_id text;
begin
  if not exists (select 1 from admin_config where k = 'admin_password' and v = secret) then
    return 'wrong password';
  end if;
  -- deterministic id: manual- + title slug + date
  v_id := 'manual-' || regexp_replace(lower(p_title), '[^a-z0-9]', '-', 'g') || '-' || left(p_starts_at, 10);
  v_id := left(v_id, 120);

  insert into events (id, source_id, title, starts_at, category, venue, city, description,
                      price_text, is_free, booking_url, image_url, confidence, lang)
  values (
    v_id, 'manual', p_title, p_starts_at::timestamptz,
    p_category, nullif(p_venue,''), nullif(p_city,''), nullif(p_description,''),
    nullif(p_price_text,''), p_is_free, nullif(p_booking_url,''), nullif(p_image_url,''),
    1.0, 'he'
  )
  on conflict (id) do update set
    title = excluded.title, starts_at = excluded.starts_at, category = excluded.category,
    venue = excluded.venue, city = excluded.city, description = excluded.description,
    price_text = excluded.price_text, is_free = excluded.is_free,
    booking_url = excluded.booking_url, image_url = excluded.image_url,
    last_seen_at = now();

  return 'ok';
end $$;
