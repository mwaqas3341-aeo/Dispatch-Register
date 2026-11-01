-- Dropdown values for the admin "Create user" form, taken from the schools list (district > tehsil > wing > markaz)
create index if not exists schools_geo_idx on public.schools (district, tehsil, wing, markaz);
create or replace function public.fn_geo_options(p_level text, p_district text default null, p_tehsil text default null, p_wing text default null)
returns setof text language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.fn_is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_level = 'district' then
    return query select distinct s.district from public.schools s where s.district is not null order by 1;
  elsif p_level = 'tehsil' then
    return query select distinct s.tehsil from public.schools s where s.district = p_district and s.tehsil is not null order by 1;
  elsif p_level = 'wing' then
    return query select distinct s.wing from public.schools s where s.district = p_district
      and (p_tehsil is null or s.tehsil = p_tehsil) and s.wing is not null order by 1;
  elsif p_level = 'markaz' then
    return query select distinct s.markaz from public.schools s where s.district = p_district
      and (p_tehsil is null or s.tehsil = p_tehsil) and (p_wing is null or s.wing = p_wing) and s.markaz is not null order by 1;
  else
    raise exception 'unknown level';
  end if;
end $$;
revoke execute on function public.fn_geo_options(text,text,text,text) from public, anon;
grant execute on function public.fn_geo_options(text,text,text,text) to authenticated;
