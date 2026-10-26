-- Dispatch Register - final-state reference schema (matches what is applied in Supabase).
-- Files are NOT stored in Supabase: only Google Drive links.

create or replace function public.fn_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at := now(); return new; end $$;

-- ===== identity =====
create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  cnic text not null unique check (cnic ~ '^[0-9]{13}$'),
  full_name text not null, designation text, cell_no text,
  district text not null, tehsil text,
  wing text check (wing is null or wing in ('M-EE','W-EE','SE')), markaz text,
  role text not null default 'user' check (role in ('user','admin')),
  status text not null default 'active' check (status in ('active','suspended')),
  must_change_password boolean not null default true,
  gmail_address text check (gmail_address is null or gmail_address ~* '^[^@[:space:]]+@(gmail|googlemail)\.com$'),
  gmail_confirmed_at timestamptz,
  drive_folder_id text,
  consent_given_at timestamptz,            -- Drive permission screen completed and verified
  legacy_google_email text,
  created_by uuid references public.user_profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create trigger trg_user_profiles_touch before update on public.user_profiles
  for each row execute function public.fn_touch_updated_at();

create function public.fn_is_active() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles where id = (select auth.uid()) and status = 'active' and not must_change_password) $$;
create function public.fn_is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles where id = (select auth.uid()) and status = 'active' and role = 'admin' and not must_change_password) $$;
create function public.fn_has_consent() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_profiles where id = (select auth.uid()) and status = 'active' and consent_given_at is not null) $$;

alter table public.user_profiles enable row level security;
create policy profiles_select on public.user_profiles for select to authenticated
  using (id = (select auth.uid()) or public.fn_is_admin());

-- ===== reference / config =====
create table public.schools (
  emis_code text primary key check (emis_code ~ '^[0-9]{8}$'), name text not null,
  district text, tehsil text, markaz text, wing text, level text, gender_type text, area text);
create index schools_district_idx on public.schools(district);
alter table public.schools enable row level security;
create policy schools_select on public.schools for select to authenticated using (public.fn_is_active());
create policy schools_admin_insert on public.schools for insert to authenticated with check (public.fn_is_admin());
create policy schools_admin_update on public.schools for update to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

create table public.app_config (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.app_config enable row level security;
create policy config_select on public.app_config for select to authenticated using (public.fn_is_active());
create policy config_admin_write on public.app_config for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ===== recipients (user-managed, jurisdiction-scoped) =====
create table public.recipients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.user_profiles(id),
  office_name text not null check (length(btrim(office_name)) > 0),
  officer_name text, email_office text, email_personal text, cell_no text,
  scope_level text not null check (scope_level in ('district','tehsil','wing')),
  district text not null, tehsil text, wing text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (scope_level = 'district' or tehsil is not null), check (scope_level <> 'wing' or wing is not null));
create unique index recipients_unique_scope on public.recipients
  (lower(btrim(office_name)), district, coalesce(tehsil,''), coalesce(wing,''));
create index recipients_owner_idx on public.recipients(owner_id);
create trigger trg_recipients_touch before update on public.recipients for each row execute function public.fn_touch_updated_at();

create function public.fn_can_see_recipient(rid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.recipients r join public.user_profiles p on p.id = (select auth.uid())
    where r.id = rid and p.status = 'active' and p.district = r.district
      and (r.scope_level = 'district' or (p.tehsil is not distinct from r.tehsil
           and (r.scope_level = 'tehsil' or p.wing is not distinct from r.wing)))) $$;

create function public.fn_recipients_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_is_admin() and (new.owner_id, new.scope_level, new.district, new.tehsil, new.wing)
       is distinct from (old.owner_id, old.scope_level, old.district, old.tehsil, old.wing) then
    raise exception 'recipient scope cannot be changed' using errcode = '42501'; end if;
  return new; end $$;
create trigger trg_recipients_guard before update on public.recipients for each row execute function public.fn_recipients_guard();

alter table public.recipients enable row level security;
create policy recipients_select on public.recipients for select to authenticated
  using ((public.fn_is_active() and public.fn_can_see_recipient(id)) or public.fn_is_admin());
create policy recipients_insert on public.recipients for insert to authenticated with check (
  owner_id = (select auth.uid()) and public.fn_is_active() and exists (
    select 1 from public.user_profiles p where p.id = (select auth.uid()) and p.district = recipients.district
      and (recipients.scope_level = 'district' or (p.tehsil is not distinct from recipients.tehsil
           and (recipients.scope_level = 'tehsil' or p.wing is not distinct from recipients.wing)))));
create policy recipients_update on public.recipients for update to authenticated
  using ((owner_id = (select auth.uid()) and public.fn_is_active()) or public.fn_is_admin())
  with check ((owner_id = (select auth.uid()) and public.fn_is_active()) or public.fn_is_admin());
create policy recipients_admin_delete on public.recipients for delete to authenticated using (public.fn_is_admin());

-- ===== register =====
create table public.dispatch_register (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id),
  dispatch_date date not null,
  dispatch_year smallint generated always as ((extract(year from dispatch_date))::smallint) stored,
  dispatch_no int not null check (dispatch_no > 0),
  category text, subject text, remarks text, school_type text, emis_code text, school_name text,
  concerned_person text, other_office_name text,
  status text not null default 'active' check (status in ('active','deleted')),
  deleted_at timestamptz, legacy_sr_no int,
  source text not null default 'app' check (source in ('app','sheet_import')), source_ref text,
  created_by uuid, updated_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (user_id, dispatch_year, dispatch_no));
create index dispatch_user_date_idx on public.dispatch_register(user_id, dispatch_date desc);
create trigger trg_dispatch_touch before update on public.dispatch_register for each row execute function public.fn_touch_updated_at();

create table public.dispatch_recipients (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.dispatch_register(id) on delete cascade,
  recipient_id uuid references public.recipients(id) on delete set null,
  name_snapshot text not null, is_other boolean not null default false,
  email_status text not null default 'pending' check (email_status in ('pending','sent','failed','no_email')), sent_at timestamptz);
create index dispatch_recipients_dispatch_idx on public.dispatch_recipients(dispatch_id);
create index dispatch_recipients_recipient_idx on public.dispatch_recipients(recipient_id);

create table public.dispatch_documents (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.dispatch_register(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id),
  file_name text, mime_type text, file_size bigint,
  drive_file_id text, drive_web_view_link text,
  source text not null default 'user_drive' check (source in ('user_drive','legacy_url')), legacy_url text,
  status text not null default 'active' check (status in ('active','missing')),
  created_at timestamptz not null default now());
create index dispatch_documents_dispatch_idx on public.dispatch_documents(dispatch_id);
create index dispatch_documents_user_idx on public.dispatch_documents(user_id);

create table public.dispatch_counters (
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  dispatch_year smallint not null, last_no int not null default 0, primary key (user_id, dispatch_year));
create table public.dispatch_import_staging (
  id bigint generated always as identity primary key, batch_id text not null, workbook text, row_no int,
  raw jsonb not null, parsed jsonb, problems text[], resolution text, created_at timestamptz not null default now());

alter table public.dispatch_register enable row level security;
alter table public.dispatch_recipients enable row level security;
alter table public.dispatch_documents enable row level security;
alter table public.dispatch_counters enable row level security;      -- no policies: server-only
alter table public.dispatch_import_staging enable row level security;

create policy dispatch_select_own on public.dispatch_register for select to authenticated
  using (user_id = (select auth.uid()) and public.fn_is_active());
create policy dispatch_rec_select_own on public.dispatch_recipients for select to authenticated
  using (public.fn_is_active() and exists (select 1 from public.dispatch_register d where d.id = dispatch_recipients.dispatch_id and d.user_id = (select auth.uid())));
create policy dispatch_rec_update_own on public.dispatch_recipients for update to authenticated
  using (public.fn_is_active() and exists (select 1 from public.dispatch_register d where d.id = dispatch_recipients.dispatch_id and d.user_id = (select auth.uid())))
  with check (public.fn_is_active() and exists (select 1 from public.dispatch_register d where d.id = dispatch_recipients.dispatch_id and d.user_id = (select auth.uid())));
create policy docs_select_own on public.dispatch_documents for select to authenticated
  using (user_id = (select auth.uid()) and public.fn_is_active());
create policy docs_insert_own on public.dispatch_documents for insert to authenticated
  with check (user_id = (select auth.uid()) and public.fn_is_active() and public.fn_has_consent()
    and exists (select 1 from public.dispatch_register d where d.id = dispatch_documents.dispatch_id and d.user_id = (select auth.uid())));
create policy docs_update_own on public.dispatch_documents for update to authenticated
  using (user_id = (select auth.uid()) and public.fn_is_active()) with check (user_id = (select auth.uid()) and public.fn_is_active());
create policy staging_admin on public.dispatch_import_staging for select to authenticated using (public.fn_is_admin());

-- ===== RPCs =====
create function public.fn_confirm_gmail(p_email text) returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_email text := lower(btrim(p_email));
begin
  if v_email !~ '^[^@[:space:]]+@(gmail|googlemail)\.com$' then raise exception 'Please enter a valid Gmail address'; end if;
  update public.user_profiles
     set consent_given_at = case when gmail_address is distinct from v_email then null else consent_given_at end,
         drive_folder_id  = case when gmail_address is distinct from v_email then null else drive_folder_id end,
         gmail_address = v_email, gmail_confirmed_at = now()
   where id = v_uid and status = 'active';
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

create function public.fn_drive_connected(p_google_email text, p_folder_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_gmail text;
begin
  select gmail_address into v_gmail from public.user_profiles where id = v_uid and status = 'active';
  if v_gmail is null then raise exception 'Confirm your Gmail address first'; end if;
  if lower(btrim(p_google_email)) <> v_gmail then raise exception 'The Google account does not match your confirmed Gmail'; end if;
  update public.user_profiles set consent_given_at = coalesce(consent_given_at, now()), drive_folder_id = p_folder_id where id = v_uid;
end $$;

create function public.fn_next_dispatch_no(p_date date) returns text language sql stable security definer set search_path = '' as $$
  select lpad((coalesce((select c.last_no from public.dispatch_counters c where c.user_id = (select auth.uid())
    and c.dispatch_year = extract(year from p_date)::smallint), 0) + 1)::text, 4, '0') $$;

create function public.fn_create_dispatch(
  p_date date, p_category text, p_subject text, p_remarks text, p_school_type text,
  p_emis text, p_school_name text, p_concerned text, p_other_office text, p_recipients jsonb
) returns public.dispatch_register language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_year smallint; v_no int; v_row public.dispatch_register; r jsonb; v_rid uuid; v_count int := 0;
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if coalesce(btrim(p_category),'') = '' then raise exception 'Category is required'; end if;
  if coalesce(btrim(p_subject),'') = '' then raise exception 'Description is required'; end if;
  if coalesce(btrim(p_school_type),'') = '' then raise exception 'School type is required'; end if;
  if coalesce(btrim(p_emis),'') <> '' and p_emis !~ '^[0-9]{8}$' then raise exception 'EMIS code must be 8 digits'; end if;
  v_year := extract(year from p_date)::smallint;
  insert into public.dispatch_counters(user_id, dispatch_year, last_no) values (v_uid, v_year, 1)
  on conflict (user_id, dispatch_year) do update set last_no = public.dispatch_counters.last_no + 1 returning last_no into v_no;
  insert into public.dispatch_register(user_id, dispatch_date, dispatch_no, category, subject, remarks,
      school_type, emis_code, school_name, concerned_person, other_office_name, created_by, updated_by)
  values (v_uid, p_date, v_no, btrim(p_category), btrim(p_subject), nullif(btrim(coalesce(p_remarks,'')),''),
      btrim(p_school_type), nullif(btrim(coalesce(p_emis,'')),''), nullif(btrim(coalesce(p_school_name,'')),''),
      nullif(btrim(coalesce(p_concerned,'')),''), nullif(btrim(coalesce(p_other_office,'')),''), v_uid, v_uid)
  returning * into v_row;
  for r in select * from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) loop
    v_rid := nullif(r->>'recipient_id','')::uuid;
    if v_rid is not null and not public.fn_can_see_recipient(v_rid) then raise exception 'Recipient not available to you'; end if;
    insert into public.dispatch_recipients(dispatch_id, recipient_id, name_snapshot, is_other)
    values (v_row.id, v_rid, btrim(coalesce(r->>'name','')), coalesce((r->>'is_other')::boolean, false));
    v_count := v_count + 1;
  end loop;
  if v_count = 0 and v_row.other_office_name is null then raise exception 'Select at least one office'; end if;
  return v_row;
end $$;

create function public.fn_delete_dispatch(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.dispatch_register set status = 'deleted', deleted_at = now(), updated_by = (select auth.uid())
   where id = p_id and user_id = (select auth.uid()) and status = 'active';
  if not found then raise exception 'Record not found'; end if;
end $$;

create function public.fn_restore_dispatch(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.dispatch_register set status = 'active', deleted_at = null, updated_by = (select auth.uid())
   where id = p_id and user_id = (select auth.uid()) and status = 'deleted';
  if not found then raise exception 'Record not found'; end if;
end $$;

-- fn_admin_import_dispatch(p_user_id, p_batch, p_rows jsonb, p_commit boolean): admin-only dry-run/commit importer.
-- Rows with bad dates, bad numbers or duplicate (user, year, number) go to dispatch_import_staging, never overwrite;
-- counters are raised to the highest imported number per year. (Definition is in the live database.)

-- Privileges: revoke all on tables from anon/authenticated, then grant only select (and the inserts/updates the
-- policies above need); revoke execute on functions from public/anon and grant to authenticated.

-- Admin account: created once by the project owner (auth user + user_profiles row with role = 'admin').
-- Edge Functions: supabase/functions/admin-users, supabase/functions/change-password.
