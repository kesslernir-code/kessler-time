-- schema11: disable sources whose URL is a Facebook or Instagram page
-- (we can no longer scrape these — Graph API needs App Review, mbasic is blocked).
-- Run once in the Supabase SQL Editor.

-- Preview which sources will be disabled:
-- SELECT id, name, url FROM sources WHERE url ~* 'facebook\.com|instagram\.com' AND enabled = true;

-- Disable them:
update sources
set enabled = false
where url ~* 'facebook\.com|instagram\.com'
  and enabled = true;
