-- Permanent delete of a report. Apply AFTER the page that asks for confirmation and trashes the Drive files is deployed.
-- Removes the record, recipients, documents, inquiries (action taken) and departmental-action rows for good.
-- Returns the storage paths of any departmental-action files so the browser can remove the blobs
-- (Supabase does not allow deleting storage objects through SQL).
drop function if exists public.fn_delete_dispatch(uuid);
create function public.fn_delete_dispatch(p_id uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_paths text[];
begin
  if not public.fn_is_active() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform 1 from public.dispatch_register where id = p_id and user_id = v_uid for update;
  if not found then raise exception 'Record not found'; end if;
  select coalesce(array_agg(storage_path), '{}') into v_paths from public.dispatch_action_files where dispatch_id = p_id and user_id = v_uid;
  delete from public.dispatch_documents where dispatch_id = p_id;     -- documents point at inquiries (RESTRICT), so they go first
  delete from public.dispatch_inquiries where dispatch_id = p_id;     -- inquiries point at the report (RESTRICT)
  delete from public.dispatch_register where id = p_id and user_id = v_uid;   -- cascades to recipients and action rows
  return v_paths;
end $$;
revoke execute on function public.fn_delete_dispatch(uuid) from public, anon;
grant execute on function public.fn_delete_dispatch(uuid) to authenticated;
-- fn_restore_dispatch is kept for now (legacy soft-deleted rows); drop it once nobody needs it:
--   drop function public.fn_restore_dispatch(uuid);
