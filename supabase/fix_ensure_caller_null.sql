-- Allow interviews with null caller_id (Google Calendar sync).
-- Apply in Supabase SQL Editor. Safe to re-run.

create or replace function public.ensure_caller_exists()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.caller_id is null then
    return new;
  end if;
  insert into public.callers (id)
  values (new.caller_id)
  on conflict (id) do nothing;
  return new;
end;
$$;
