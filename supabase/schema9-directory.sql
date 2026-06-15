-- Part 9: "directory" places (bars / restaurants / festivals) are shown as info
-- cards (image, phone, name, description, link) instead of being scraped for
-- events. These columns hold that info. Run once in the SQL Editor.

alter table sources add column if not exists image text;
alter table sources add column if not exists description text;
alter table sources add column if not exists phone text;
