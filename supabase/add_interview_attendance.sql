-- Attendance for interview reports: join | miss (nullable until set).
-- Safe to re-run.

alter table public.interviews
  add column if not exists attendance text;

alter table public.interviews
  drop constraint if exists interviews_attendance_check;

alter table public.interviews
  add constraint interviews_attendance_check
  check (attendance is null or attendance in ('join', 'miss'));

create index if not exists interviews_attendance_idx
  on public.interviews (attendance);

-- Gate attendance changes until after the session ends (same as result/video).
create or replace function public.enforce_interview_result_after_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if
    new.video_path is distinct from old.video_path
    and coalesce(new.video_path, '') = ''
    and new.stage is not distinct from old.stage
    and new.result is not distinct from old.result
    and new.attendance is not distinct from old.attendance
  then
    return new;
  end if;

  if
    new.stage is distinct from old.stage
    or new.result is distinct from old.result
    or new.attendance is distinct from old.attendance
    or new.video_path is distinct from old.video_path
  then
    if old.end_time is null or old.end_time > now() then
      raise exception
        'Interview results can only be added after the interview session has concluded';
    end if;
  end if;

  return new;
end;
$$;
