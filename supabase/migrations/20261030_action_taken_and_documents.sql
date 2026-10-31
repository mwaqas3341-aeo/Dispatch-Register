-- Action Taken (inquiries) + Supporting Documents for Reports (dispatch records).
-- Run once in the Supabase SQL editor of project "Diary dispatch Module". Safe to re-run.
-- Files stay in each user's own Google Drive; Supabase stores metadata and links only.

-- 1. Documents: distinguish main attachment / supporting document / inquiry document
alter table public.dispatch_documents add column if not exists doc_kind text not null default 'main';
alter table public.dispatch_documents add column if not exists inquiry_id uuid;
alter table public.dispatch_documents add column if not exists drive_path text;      -- e.g. Reports/Report_2026-0007/Supporting_Documents
alter table public.dispatch_documents drop constraint if exists dispatch_documents_doc_kind_check;
alter table public.dispatch_documents add constraint dispatch_documents_doc_kind_check
  check (doc_kind in ('main','supporting','inquiry') and ((doc_kind = 'inquiry') = (inquiry_id is not null)));
alter table public.dispatch_documents drop constraint if exists dispatch_documents_status_check;
alter table public.dispatch_documents add constraint dispatch_documents_status_check
  check (status in ('active','missing','deleted'));

-- 2. Inquiries / actions taken (unlimited per report)
create table if not exists public.dispatch_inquiries (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.dispatch_register(id) on delete restrict,
  user_id uuid not null references public.user_profiles(id),
  inquiry_no int not null check (inquiry_no > 0),
  authority text not null check (length(btrim(authority)) > 0),
  action_details text not null check (length(btrim(action_details)) > 0),
  action_date date not null,
  action_status text not null default 'pending'
    check (action_status in ('pending','in_progress','completed','closed','not_applicable')),
  remarks text,
  record_status text not null default 'active' check (record_status in ('active','deleted')),
  deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (dispatch_id, inquiry_no));
create index if not exists dispatch_inquiries_dispatch_idx on public.dispatch_inquiries(dispatch_id, action_date);
create index if not exists dispatch_inquiries_user_idx on public.dispatch_inquiries(user_id);
drop trigger if exists trg_inquiries_touch on public.dispatch_inquiries;
create trigger trg_inquiries_touch before update on public.dispatch_inquiries
  for each row execute function public.fn_touch_updated_at();

alter table public.dispatch_documents drop constraint if exists dispatch_documents_inquiry_fk;
alter table public.dispatch_documents add constraint dispatch_documents_inquiry_fk
  foreign key (inquiry_id) references public.dispatch_inquiries(id) on delete restrict;
create index if not exists dispatch_documents_inquiry_idx on public.dispatch_documents(inquiry_id);

-- 3. Row level security: owner of the report only
alter table public.dispatch_inquiries enable row level security;
drop policy if exists inquiries_select_own on public.dispatch_inquiries;
create policy inquiries_select_own on public.dispatch_inquiries for select to authenticated
  using (user_id = (select auth.uid()) and public.fn_is_active());
-- no insert/update/delete policies: all writes go through the functions below

-- documents: replace insert policy so inquiry documents must belong to the same report and owner
drop policy if exists docs_insert_own on public.dispatch_documents;
create policy docs_insert_own on public.dispatch_documents for insert to authenticated
  with check (user_id = (select auth.uid()) and public.fn_is_active() and public.fn_has_consent()
    and exists (select 1 from public.dispatch_register d where d.id = dispatch_documents.dispatch_id and d.user_id = (select auth.uid()))
    and (inquiry_id is null or exists (select 1 from public.dispatch_inquiries i
          where i.id = dispatch_documents.inquiry_id and i.dispatch_id = dispatch_documents.dispatch_id
            and i.user_id = (select auth.uid()) and i.record_status = 'active')));

-- 4. Functions
create or replace function public.fn_add_inquiry(p_dispatch_id uuid, p_authority text, p_details text,
  p_date date, p_status text, p_remarks text) returns public.dispatch_inquiries
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_no int; v_row public.dispatch_inquiries;
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform 1 from public.dispatch_register where id = p_dispatch_id and user_id = v_uid and status = 'active' for update;
  if not found then raise exception 'Record not found'; end if;
  if coalesce(btrim(p_authority),'') = '' then raise exception 'Authority / department is required'; end if;
  if coalesce(btrim(p_details),'') = '' then raise exception 'Action details are required'; end if;
  if p_date is null then raise exception 'Date of action is required'; end if;
  select coalesce(max(inquiry_no),0) + 1 into v_no from public.dispatch_inquiries where dispatch_id = p_dispatch_id;
  insert into public.dispatch_inquiries(dispatch_id, user_id, inquiry_no, authority, action_details, action_date, action_status, remarks)
  values (p_dispatch_id, v_uid, v_no, btrim(p_authority), btrim(p_details), p_date, coalesce(nullif(p_status,''),'pending'),
          nullif(btrim(coalesce(p_remarks,'')),''))
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.fn_update_inquiry(p_id uuid, p_authority text, p_details text,
  p_date date, p_status text, p_remarks text) returns public.dispatch_inquiries
language plpgsql security definer set search_path = '' as $$
declare v_row public.dispatch_inquiries;
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(btrim(p_authority),'') = '' then raise exception 'Authority / department is required'; end if;
  if coalesce(btrim(p_details),'') = '' then raise exception 'Action details are required'; end if;
  if p_date is null then raise exception 'Date of action is required'; end if;
  update public.dispatch_inquiries set authority = btrim(p_authority), action_details = btrim(p_details), action_date = p_date,
         action_status = coalesce(nullif(p_status,''),'pending'), remarks = nullif(btrim(coalesce(p_remarks,'')),'')
   where id = p_id and user_id = (select auth.uid()) and record_status = 'active' returning * into v_row;
  if not found then raise exception 'Inquiry not found'; end if;
  return v_row;
end $$;

-- soft delete (same policy as dispatch records); its documents are hidden too, files stay in the user's Drive
create or replace function public.fn_delete_inquiry(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.dispatch_inquiries set record_status = 'deleted', deleted_at = now()
   where id = p_id and user_id = (select auth.uid()) and record_status = 'active';
  if not found then raise exception 'Inquiry not found'; end if;
  update public.dispatch_documents set status = 'deleted' where inquiry_id = p_id and status = 'active';
end $$;

create or replace function public.fn_delete_document(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.dispatch_documents set status = 'deleted'
   where id = p_id and user_id = (select auth.uid()) and status = 'active';
  if not found then raise exception 'Document not found'; end if;
end $$;

-- 5. Privileges
revoke all on public.dispatch_inquiries from anon, authenticated;
grant select on public.dispatch_inquiries to authenticated;
revoke execute on function public.fn_add_inquiry(uuid,text,text,date,text,text), public.fn_update_inquiry(uuid,text,text,date,text,text),
  public.fn_delete_inquiry(uuid), public.fn_delete_document(uuid) from public, anon;
grant execute on function public.fn_add_inquiry(uuid,text,text,date,text,text), public.fn_update_inquiry(uuid,text,text,date,text,text),
  public.fn_delete_inquiry(uuid), public.fn_delete_document(uuid) to authenticated;
