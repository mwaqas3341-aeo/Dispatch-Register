-- Dispatch numbering from the records that really exist + Markaz reference prefix.
--   next number = (highest number among that user's ACTIVE records in the date's year) + 1
--   -> restarts at 1 each 1 January; a previous-year date continues that year's own sequence;
--      deleting the latest report frees its number again.
--   A Markaz prefix ("Fateh Pur" -> "F.P") is stored on each new record so printed references never change.
-- Backwards compatible with the deployed page (additive column; same function signatures).

alter table public.dispatch_register add column if not exists markaz_prefix text;

create or replace function public.fn_markaz_prefix(p_markaz text) returns text
language sql immutable set search_path = '' as $$
  select string_agg(upper(left(w, 1)), '.' order by n)
    from regexp_split_to_table(btrim(coalesce(p_markaz, '')), '[\s_/.\-]+') with ordinality as t(w, n)
   where w <> '' $$;

-- uniqueness applies to ACTIVE records only, so soft-deleted legacy rows never block a number
create unique index if not exists dispatch_active_number_uq
  on public.dispatch_register (user_id, dispatch_year, dispatch_no) where status = 'active';
do $$
declare c text;
begin
  select con.conname into c from pg_constraint con
   where con.conrelid = 'public.dispatch_register'::regclass and con.contype = 'u'
     and (select array_agg(a.attname::text order by a.attname::text) from pg_attribute a
           where a.attrelid = con.conrelid and a.attnum = any (con.conkey)) = array['dispatch_no','dispatch_year','user_id'];
  if c is not null then execute format('alter table public.dispatch_register drop constraint %I', c); end if;
end $$;

create or replace function public.fn_next_dispatch_no(p_date date) returns text
language sql stable security definer set search_path = '' as $$
  select lpad((coalesce(max(d.dispatch_no), 0) + 1)::text, 4, '0')
    from public.dispatch_register d
   where d.user_id = (select auth.uid()) and d.status = 'active'
     and d.dispatch_year = extract(year from p_date)::smallint $$;

create or replace function public.fn_create_dispatch(
  p_date date, p_category text, p_subject text, p_remarks text, p_school_type text,
  p_emis text, p_school_name text, p_concerned text, p_other_office text, p_recipients jsonb
) returns public.dispatch_register language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_year smallint; v_no int; v_row public.dispatch_register; r jsonb; v_rid uuid; v_count int := 0; v_prefix text;
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if coalesce(btrim(p_category),'') = '' then raise exception 'Category is required'; end if;
  if coalesce(btrim(p_subject),'') = '' then raise exception 'Description is required'; end if;
  if coalesce(btrim(p_school_type),'') = '' then raise exception 'School type is required'; end if;
  if coalesce(btrim(p_emis),'') <> '' and p_emis !~ '^[0-9]{8}$' then raise exception 'EMIS code must be 8 digits'; end if;
  v_year := extract(year from p_date)::smallint;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || v_year::text, 0));   -- one writer per user+year
  select coalesce(max(dispatch_no), 0) + 1 into v_no from public.dispatch_register
   where user_id = v_uid and dispatch_year = v_year and status = 'active';
  select public.fn_markaz_prefix(markaz) into v_prefix from public.user_profiles where id = v_uid;
  insert into public.dispatch_register(user_id, dispatch_date, dispatch_no, markaz_prefix, category, subject, remarks,
      school_type, emis_code, school_name, concerned_person, other_office_name, created_by, updated_by)
  values (v_uid, p_date, v_no, v_prefix, btrim(p_category), btrim(p_subject), nullif(btrim(coalesce(p_remarks,'')),''),
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

revoke execute on function public.fn_next_dispatch_no(date),
  public.fn_create_dispatch(date,text,text,text,text,text,text,text,text,jsonb) from public, anon;
grant execute on function public.fn_next_dispatch_no(date),
  public.fn_create_dispatch(date,text,text,text,text,text,text,text,text,jsonb) to authenticated;
