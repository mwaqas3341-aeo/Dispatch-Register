-- "My profile": every user can update their own name, cell, Gmail and how the dispatch reference is shown
-- (prefix text and number padding). Users have SELECT-only access to user_profiles, so this is a narrow RPC that
-- touches only the signed-in user's own row and only these fields. Additive and backwards compatible.

alter table public.user_profiles
  add column if not exists ref_prefix text,
  add column if not exists ref_pad smallint not null default 4;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_ref_pad_chk') then
    alter table public.user_profiles add constraint user_profiles_ref_pad_chk check (ref_pad between 1 and 6); end if;
  if not exists (select 1 from pg_constraint where conname = 'user_profiles_ref_prefix_chk') then
    alter table public.user_profiles add constraint user_profiles_ref_prefix_chk check (ref_prefix is null or ref_prefix ~ '^[A-Z0-9.-]{1,12}$'); end if;
end $$;

create or replace function public.fn_update_my_profile(
  p_full_name text, p_cell_no text, p_gmail text, p_ref_prefix text, p_ref_pad int
) returns public.user_profiles language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_p public.user_profiles;
  v_name text := btrim(coalesce(p_full_name, ''));
  v_cell text := nullif(btrim(coalesce(p_cell_no, '')), '');
  v_gmail text := lower(btrim(coalesce(p_gmail, '')));
  v_pre text := nullif(upper(btrim(coalesce(p_ref_prefix, ''))), '');
  v_changed boolean;
begin
  select * into v_p from public.user_profiles where id = v_uid and status = 'active';
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'Full name is required'; end if;
  if char_length(v_name) > 120 then raise exception 'Name is too long (max 120 characters)'; end if;
  if v_cell is not null and v_cell !~ '^[0-9+ -]{7,20}$' then raise exception 'Cell number may contain digits, +, - and spaces only (7 to 20 characters)'; end if;
  if v_gmail = '' then v_gmail := v_p.gmail_address; end if;            -- blank = keep the current one
  if v_gmail is not null and v_gmail !~ '^[^@[:space:]]+@(gmail|googlemail)\.com$' then raise exception 'Please enter a valid Gmail address'; end if;
  if v_pre is not null and v_pre !~ '^[A-Z0-9.-]{1,12}$' then raise exception 'Prefix may use letters, digits, dot and dash only (max 12 characters)'; end if;
  if p_ref_pad is null or p_ref_pad < 1 or p_ref_pad > 6 then raise exception 'Number padding must be between 1 and 6 digits'; end if;

  v_changed := v_gmail is distinct from v_p.gmail_address;
  update public.user_profiles set
      full_name = v_name, cell_no = v_cell, ref_prefix = v_pre, ref_pad = p_ref_pad,
      gmail_address = v_gmail,
      gmail_confirmed_at = case when v_changed then now() else gmail_confirmed_at end,
      consent_given_at   = case when v_changed then null else consent_given_at end,   -- same effect as fn_confirm_gmail
      drive_folder_id    = case when v_changed then null else drive_folder_id end
   where id = v_uid returning * into v_p;
  if v_changed then   -- the old Google account must not keep receiving uploads
    update public.google_drive_connections set connection_status = 'needs_reconnect', updated_at = now()
     where user_id = v_uid and connection_status = 'connected';
  end if;
  return v_p;
end $$;

revoke execute on function public.fn_update_my_profile(text, text, text, text, int) from public, anon;
grant execute on function public.fn_update_my_profile(text, text, text, text, int) to authenticated;
