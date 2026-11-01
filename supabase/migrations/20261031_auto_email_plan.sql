-- Paid "automatic email to offices" plan. Admin (developer) accounts are always allowed and need no date.
-- Only the admin Edge Function writes this column (users have SELECT only on user_profiles).
alter table public.user_profiles add column if not exists auto_email_until date;
