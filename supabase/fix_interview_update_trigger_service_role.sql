-- Calendar sync (and other server APIs) use the Supabase service_role key.
-- Triggers still run for service_role; this trigger previously blocked those
-- updates because auth.uid() is null for service_role requests.
-- Allow service_role and admins to update interviews freely.

create or replace function public.restrict_caller_interview_updates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' or public.is_allowed_admin() then
    return new;
  end if;

  if auth.uid() is null or old.caller_id is distinct from auth.uid() then
    raise exception 'Not allowed to update this interview';
  end if;

  if
    new.interview_name is distinct from old.interview_name
    or new.caller_id is distinct from old.caller_id
    or new.invited_member_id is distinct from old.invited_member_id
    or new.job_id is distinct from old.job_id
    or new.meeting_link is distinct from old.meeting_link
    or new.stage is distinct from old.stage
    or new.result is distinct from old.result
    or new.start_time is distinct from old.start_time
    or new.end_time is distinct from old.end_time
    or new.created_by is distinct from old.created_by
  then
    raise exception 'Callers may only update the interview video';
  end if;

  return new;
end;
$$;
