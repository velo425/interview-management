-- Drop unused interview columns and slim google_event_data.
-- Safe to re-run. Apply in Supabase SQL Editor (or via service role SQL).
-- Temporarily disable the caller-update trigger so SQL Editor updates succeed.

alter table public.interviews disable trigger interviews_restrict_caller_updates;

-- Keep only organizer / creator / attendees in stored Calendar payload.
update public.interviews
set google_event_data = coalesce(
  jsonb_strip_nulls(
    jsonb_build_object(
      'organizer', case
        when jsonb_typeof(google_event_data->'organizer') = 'object'
          then google_event_data->'organizer'
        else null
      end,
      'creator', case
        when jsonb_typeof(google_event_data->'creator') = 'object'
          then google_event_data->'creator'
        else null
      end,
      'attendees', case
        when jsonb_typeof(google_event_data->'attendees') = 'array'
          then google_event_data->'attendees'
        else null
      end
    )
  ),
  '{}'::jsonb
)
where google_event_data is not null
  and google_event_data <> '{}'::jsonb;

alter table public.interviews
  drop column if exists booking_note;

alter table public.interviews
  drop column if exists google_html_link;

alter table public.interviews
  drop column if exists google_calendar_id;

alter table public.interviews enable trigger interviews_restrict_caller_updates;

-- Refresh caller-update guard (no booking_note column).
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
