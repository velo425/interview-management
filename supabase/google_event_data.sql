-- Store full non-empty Google Calendar event payload for Schedule display.
-- Apply in Supabase SQL Editor. Safe to re-run.

alter table public.interviews
  add column if not exists google_event_data jsonb not null default '{}'::jsonb;

create index if not exists interviews_google_event_data_gin
  on public.interviews using gin (google_event_data);
