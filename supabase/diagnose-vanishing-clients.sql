-- Binti Events — diagnose "clients disappear after logout/login".
-- Run in Supabase Dashboard > SQL Editor on project ltinjyvcrgwcvudrnfby.
-- The app scopes every row by owner_id = your login user id. If you have
-- more than one admin row, or rows stamped with an old id, re-login can
-- land on a different id and the list comes back empty (rows NOT deleted).

-- 1. How many login identities exist?
SELECT id, email, name, role, created_at FROM public.auth_users ORDER BY created_at;

-- 2. Which owner_ids actually own client rows?
SELECT owner_id, COUNT(*) AS clients FROM public.clients GROUP BY owner_id;

-- 3. Same check for the other modules
SELECT owner_id, COUNT(*) AS quotes FROM public.quotes GROUP BY owner_id;
SELECT owner_id, COUNT(*) AS invoices FROM public.invoices GROUP BY owner_id;

-- INTERPRETATION:
-- * If query 1 returns 2+ rows -> you have duplicate logins; each sees only its own rows.
-- * If query 2 shows an owner_id NOT in query 1 -> those rows are orphaned (created under
--   a deleted/reset admin id) and invisible to every current login.
-- Send all four result tables back and you will get the exact repair statement.
