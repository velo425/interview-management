-- Google Calendar → Schedule: enrichment columns + nullable caller/job.
-- Safe to re-run. Apply in Supabase SQL Editor.
-- Existing Gmail connections must Reconnect to grant calendar.readonly.

alter table public.interviews
  alter column caller_id drop not null;

alter table public.interviews
  alter column job_id drop not null;

alter table public.interviews
  add column if not exists job_title text not null default '';

alter table public.interviews
  add column if not exists company_name text not null default '';

alter table public.interviews
  add column if not exists reminder_minutes integer not null default 30;

alter table public.interviews
  drop constraint if exists interviews_reminder_minutes_check;

alter table public.interviews
  add constraint interviews_reminder_minutes_check
  check (reminder_minutes in (10, 20, 30, 60));

alter table public.interviews
  add column if not exists google_event_id text;

alter table public.interviews
  add column if not exists google_calendar_id text not null default 'primary';

alter table public.interviews
  add column if not exists gmail_account_id uuid
    references public.gmail_accounts (id) on delete cascade;

alter table public.interviews
  add column if not exists google_html_link text not null default '';

alter table public.interviews
  add column if not exists google_event_data jsonb not null default '{}'::jsonb;

alter table public.interviews
  add column if not exists source text not null default 'manual';

alter table public.interviews
  drop constraint if exists interviews_source_check;

alter table public.interviews
  add constraint interviews_source_check
  check (source in ('manual', 'google_calendar'));

-- Note: avoid mass UPDATE here — interviews_restrict_caller_updates trigger
-- blocks SQL-editor updates when auth.uid() is null.

create unique index if not exists interviews_google_event_unique
  on public.interviews (gmail_account_id, google_event_id)
  where google_event_id is not null and gmail_account_id is not null;

create index if not exists interviews_gmail_account_idx
  on public.interviews (gmail_account_id);

create index if not exists interviews_source_idx
  on public.interviews (source);
