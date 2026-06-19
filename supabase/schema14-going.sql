-- schema14: shared "going" list for the מה כבר בתפריט tab.
-- A small public table the front page reads AND writes with the anon key, so
-- marking an event "going" (🎟 הולכים) syncs across every device — no login.
-- Run once in the Supabase SQL Editor.

create table if not exists going_list (
  event_id  text primary key,
  marked_at timestamptz not null default now()
);

alter table going_list enable row level security;

-- This one table is intentionally public read + write (anon), so any of our
-- devices can toggle "going" without a password. (events/sources stay read-only.)
drop policy if exists going_select on going_list;
drop policy if exists going_insert on going_list;
drop policy if exists going_delete on going_list;
create policy going_select on going_list for select using (true);
create policy going_insert on going_list for insert with check (true);
create policy going_delete on going_list for delete using (true);
