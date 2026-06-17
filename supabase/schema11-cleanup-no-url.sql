-- schema11: disable sources that have no website URL (Facebook/Instagram-only venues
-- that we can no longer scrape). Run once in the Supabase SQL Editor.
-- Review the list with the SELECT first, then run the UPDATE.

-- Preview which sources will be disabled:
-- SELECT id, name, url, platform FROM sources WHERE (url IS NULL OR url = '') AND enabled = true;

-- Disable them:
update sources
set enabled = false
where (url is null or url = '')
  and enabled = true;
