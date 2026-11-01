-- Recipient offices belong to the user who added them. Nobody else sees, picks or edits them.
create or replace function public.fn_can_see_recipient(rid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.recipients r join public.user_profiles p on p.id = (select auth.uid())
    where r.id = rid and p.status = 'active' and r.owner_id = (select auth.uid())) $$;
drop policy if exists recipients_select on public.recipients;
create policy recipients_select on public.recipients for select to authenticated
  using (owner_id = (select auth.uid()) and public.fn_is_active());
drop index if exists public.recipients_unique_scope;
create unique index if not exists recipients_unique_owner on public.recipients (owner_id, lower(btrim(office_name)));
