-- schema15: allow dateless events (bars/restaurants directory cards added via the
-- screenshot uploader have no date). The events table originally required
-- starts_at; drop that so directory-style entries can be saved.
-- Run once in the Supabase SQL Editor (already applied on the live project).

alter table events alter column starts_at drop not null;
