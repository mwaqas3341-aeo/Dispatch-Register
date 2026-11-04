-- ALREADY APPLIED to the live project (2026-10-27, version 20261027124602). Kept here so the repo matches the database.
-- The page does not use these tables yet; the "Action Taken" screen uses dispatch_inquiries instead.
-- Departmental Action Taken (independent of Google Drive / Gmail / email).
-- One action record per dispatch; PDF/image evidence lives in a private Supabase Storage bucket.

-- ===== tables =====
create table public.dispatch_actions (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null unique references public.dispatch_register(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id),
  action_status text not null check (action_status in ('needed','not_needed')),
  explanation text check (explanation is null or char_length(explanation) <= 5000),
  status text not null default 'active' check (status in ('active','deleted')),
  deleted_at timestamptz,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index dispatch_actions_user_idx on public.dispatch_actions(user_id);
create trigger trg_dispatch_actions_touch before update on public.dispatch_actions
  for each row execute function public.fn_touch_updated_at();

create table public.dispatch_action_files (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.dispatch_actions(id) on delete cascade,
  dispatch_id uuid not null references public.dispatch_register(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id),
  storage_path text not null unique,
  file_name text not null, mime_type text not null, file_size bigint not null check (file_size > 0),
  status text not null default 'active' check (status in ('active','deleted')),
  deleted_at timestamptz,
  created_at timestamptz not null default now());
create index dispatch_action_files_action_idx on public.dispatch_action_files(action_id);

alter table public.dispatch_actions enable row level security;
alter table public.dispatch_action_files enable row level security;

-- read: the dispatch owner only (same rule as dispatch_register); all writes go through the RPCs below
create policy actions_select_own on public.dispatch_actions for select to authenticated
  using (user_id = (select auth.uid()) and public.fn_is_active());
create policy action_files_select_own on public.dispatch_action_files for select to authenticated
  using (user_id = (select auth.uid()) and public.fn_is_active());

revoke all on public.dispatch_actions, public.dispatch_action_files from anon, authenticated, public;
grant select on public.dispatch_actions, public.dispatch_action_files to authenticated;

-- ===== private storage bucket =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dispatch-action-files', 'dispatch-action-files', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- objects live under <user_id>/<dispatch_id>/<file>; users may touch only their own folder
create policy action_files_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'dispatch-action-files' and (storage.foldername(name))[1] = (select auth.uid())::text and public.fn_is_active());
create policy action_files_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'dispatch-action-files' and (storage.foldername(name))[1] = (select auth.uid())::text and public.fn_is_active());
create policy action_files_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'dispatch-action-files' and (storage.foldername(name))[1] = (select auth.uid())::text and public.fn_is_active());

-- ===== RPCs =====
create function public.fn_save_action(p_dispatch_id uuid, p_action_status text, p_explanation text)
returns public.dispatch_actions language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_row public.dispatch_actions; v_exp text := nullif(btrim(coalesce(p_explanation,'')),'');
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_action_status is null or p_action_status not in ('needed','not_needed') then raise exception 'Select Action Needed or Action Not Needed'; end if;
  if v_exp is not null and char_length(v_exp) > 5000 then raise exception 'Explanation is too long (max 5000 characters)'; end if;
  if not exists (select 1 from public.dispatch_register d where d.id = p_dispatch_id and d.user_id = v_uid and d.status = 'active') then
    raise exception 'Record not found'; end if;
  insert into public.dispatch_actions(dispatch_id, user_id, action_status, explanation, created_by, updated_by)
  values (p_dispatch_id, v_uid, p_action_status, v_exp, v_uid, v_uid)
  on conflict (dispatch_id) do update set action_status = excluded.action_status, explanation = excluded.explanation,
     status = 'active', deleted_at = null, updated_by = v_uid
  returning * into v_row;
  return v_row;
end $$;

create function public.fn_delete_action(p_dispatch_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.dispatch_actions set status = 'deleted', deleted_at = now(), updated_by = v_uid
   where dispatch_id = p_dispatch_id and user_id = v_uid and status = 'active';
  if not found then raise exception 'Action not found'; end if;
  update public.dispatch_action_files set status = 'deleted', deleted_at = now()
   where dispatch_id = p_dispatch_id and user_id = v_uid and status = 'active';
end $$;

-- called after the browser uploaded the object; size/type are read from storage, never trusted from the client
create function public.fn_register_action_file(p_dispatch_id uuid, p_path text, p_file_name text)
returns public.dispatch_action_files language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_act public.dispatch_actions; v_obj storage.objects; v_row public.dispatch_action_files;
        v_name text := left(regexp_replace(coalesce(nullif(btrim(p_file_name),''),'file'), '[\\/\r\n]', '_', 'g'), 200);
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_act from public.dispatch_actions where dispatch_id = p_dispatch_id and user_id = v_uid and status = 'active';
  if not found then raise exception 'Save the action first, then add files'; end if;
  if p_path is null or split_part(p_path,'/',1) <> v_uid::text or split_part(p_path,'/',2) <> p_dispatch_id::text then
    raise exception 'Invalid file path'; end if;
  select * into v_obj from storage.objects where bucket_id = 'dispatch-action-files' and name = p_path;
  if not found then raise exception 'Uploaded file not found'; end if;
  if (select count(*) from public.dispatch_action_files where action_id = v_act.id and status = 'active') >= 10 then
    raise exception 'A maximum of 10 files is allowed per action'; end if;
  insert into public.dispatch_action_files(action_id, dispatch_id, user_id, storage_path, file_name, mime_type, file_size)
  values (v_act.id, p_dispatch_id, v_uid, p_path, v_name,
          coalesce(v_obj.metadata->>'mimetype','application/octet-stream'), coalesce((v_obj.metadata->>'size')::bigint, 1))
  returning * into v_row;
  return v_row;
end $$;

create function public.fn_remove_action_file(p_file_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_path text;
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.dispatch_action_files set status = 'deleted', deleted_at = now()
   where id = p_file_id and user_id = (select auth.uid()) and status = 'active' returning storage_path into v_path;
  if v_path is null then raise exception 'File not found'; end if;
  return v_path;   -- the browser then deletes the object from storage
end $$;

revoke execute on function public.fn_save_action(uuid,text,text), public.fn_delete_action(uuid),
  public.fn_register_action_file(uuid,text,text), public.fn_remove_action_file(uuid) from public, anon;
grant execute on function public.fn_save_action(uuid,text,text), public.fn_delete_action(uuid),
  public.fn_register_action_file(uuid,text,text), public.fn_remove_action_file(uuid) to authenticated;
