-- Store slim Google Calendar event payload (organizer / creator / attendees).
-- Apply in Supabase SQL Editor. Safe to re-run.
-- Prefer optimize_interview_columns.sql to trim existing rows + drop unused columns.

alter table public.interviews
  add column if not exists google_event_data jsonb not null default '{}'::jsonb;

create index if not exists interviews_google_event_data_gin
  on public.interviews using gin (google_event_data);
