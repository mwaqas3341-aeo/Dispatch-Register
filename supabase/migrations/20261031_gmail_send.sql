-- Email on dispatch: sent from each user's own Gmail (gmail.send scope). Per-recipient status lives in dispatch_recipients.
alter table public.google_drive_connections add column if not exists can_send boolean not null default false;
alter table public.dispatch_recipients add column if not exists email_error text;
drop function if exists public.fn_my_drive_connection();
create function public.fn_my_drive_connection()
returns table(google_email text, connection_status text, connected_at timestamptz, can_send boolean)
language sql stable security definer set search_path = '' as $$
  select c.google_email, c.connection_status, c.connected_at, c.can_send from public.google_drive_connections c where c.user_id = (select auth.uid()) $$;
revoke execute on function public.fn_my_drive_connection() from public, anon;
grant execute on function public.fn_my_drive_connection() to authenticated;
