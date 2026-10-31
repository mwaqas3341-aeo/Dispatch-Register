-- Server-side Google Drive connections. Tokens are encrypted by the Edge Function and never readable by the browser.
create table if not exists public.google_drive_connections (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  google_email text not null,
  refresh_token_enc text not null default '',
  root_folder_id text,
  connection_status text not null default 'connected' check (connection_status in ('connected','needs_reconnect','disconnected')),
  connected_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.google_drive_connections enable row level security;      -- no policies: service role only
revoke all on public.google_drive_connections from anon, authenticated;

create table if not exists public.oauth_states (
  state text primary key, user_id uuid not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default now());
alter table public.oauth_states enable row level security;
revoke all on public.oauth_states from anon, authenticated;

alter table public.dispatch_documents add column if not exists drive_folder_id text;

-- Status the browser may see (never the token)
create or replace function public.fn_my_drive_connection()
returns table(google_email text, connection_status text, connected_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.google_email, c.connection_status, c.connected_at from public.google_drive_connections c where c.user_id = (select auth.uid()) $$;
revoke execute on function public.fn_my_drive_connection() from public, anon;
grant execute on function public.fn_my_drive_connection() to authenticated;

-- Consent now means a real, current OAuth connection (not a client-reported flag)
create or replace function public.fn_has_consent() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.google_drive_connections c join public.user_profiles p on p.id = c.user_id
    where c.user_id = (select auth.uid()) and p.status = 'active' and c.connection_status = 'connected') $$;

-- The browser can no longer create or alter document records: only the Edge Function does, after a real Drive upload.
drop function if exists public.fn_drive_connected(text, text);
drop policy if exists docs_insert_own on public.dispatch_documents;
drop policy if exists docs_update_own on public.dispatch_documents;
revoke insert, update, delete on public.dispatch_documents from authenticated, anon;

-- Deleting a document is done by the Edge Function (it must trash the Drive file first)
revoke execute on function public.fn_delete_document(uuid) from authenticated;
