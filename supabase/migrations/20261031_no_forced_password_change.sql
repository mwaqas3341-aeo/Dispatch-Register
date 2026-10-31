-- Password change is optional and done from inside the account; nothing is blocked by must_change_password any more.
update public.user_profiles set must_change_password = false where must_change_password;
alter table public.user_profiles alter column must_change_password set default false;
create or replace function public.fn_is_active() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles where id = (select auth.uid()) and status = 'active') $$;
create or replace function public.fn_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles where id = (select auth.uid()) and status = 'active' and role = 'admin') $$;
