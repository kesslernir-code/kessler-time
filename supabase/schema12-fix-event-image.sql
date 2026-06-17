-- schema12: RPC to update a single event's image_url (password-protected)
create or replace function fix_event_image(secret text, p_id text, p_image_url text)
returns text language plpgsql security definer as $$
begin
  if secret != current_setting('app.admin_password', true) then
    raise exception 'wrong password';
  end if;
  update events set image_url = p_image_url where id = p_id;
  return 'ok';
end;
$$;
