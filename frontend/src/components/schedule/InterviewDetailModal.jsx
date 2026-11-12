import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDisplayDate, formatTimeBySetting } from '../../lib/calendarSettings';
import {
  DEFAULT_INTERVIEW_STAGE,
  INTERVIEW_STAGES,
} from '../../lib/interviewStages';
import {
  interviewAttendeeLabels,
  interviewCompanyName,
  interviewHasConcluded,
  interviewJobTitle,
  interviewOrganizerParts,
  isGoogleCalendarInterview,
} from '../../lib/interviewsApi';
import GoogleCalendarFields from './GoogleCalendarFields';
import './InterviewModals.css';

const REMINDER_OPTIONS = [
  { id: 10, label: '10 minutes before' },
  { id: 20, label: '20 minutes before' },
  { id: 30, label: '30 minutes before' },
  { id: 60, label: '60 minutes before' },
];

function resolveJobId(interview, jobs = []) {
  if (interview?.job_id) return interview.job_id;
  if (interview?.job?.id) return interview.job.id;
  const title = interviewJobTitle(interview).toLowerCase();
  const company = interviewCompanyName(interview).toLowerCase();
  if (!title) return '';
  const match = jobs.find((job) => {
    const sameTitle = String(job.job_title || '').trim().toLowerCase() === title;
    if (!sameTitle) return false;
    if (!company) return true;
    return String(job.company_name || '').trim().toLowerCase() === company;
  });
  return match?.id || '';
}

function resolveStage(interview) {
  const nextStage = interview?.stage || DEFAULT_INTERVIEW_STAGE;
  return INTERVIEW_STAGES.includes(nextStage)
    ? nextStage
    : DEFAULT_INTERVIEW_STAGE;
}

function resolveReminder(interview) {
  const reminder = Number(interview?.reminder_minutes);
  return [10, 20, 30, 60].includes(reminder) ? reminder : 30;
}

function InterviewDetailModal({
  interview,
  settings,
  callers = [],
  jobs = [],
  isAdmin = false,
  onClose,
  onSave,
  onCancelBooking,
}) {
  const navigate = useNavigate();
  const [callerId, setCallerId] = useState('');
  const [jobId, setJobId] = useState('');
  const [stage, setStage] = useState(DEFAULT_INTERVIEW_STAGE);
  const [reminderMinutes, setReminderMinutes] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!interview) return;
    setCallerId(interview.caller_id || '');
    setJobId(resolveJobId(interview, jobs));
    setStage(resolveStage(interview));
    setReminderMinutes(resolveReminder(interview));
    setError('');
    setSubmitting(false);
  }, [interview, jobs]);

  const canEditInterview = Boolean(
    interview && isAdmin && !interviewHasConcluded(interview),
  );

  const baseline = useMemo(() => {
    if (!interview) {
      return { callerId: '', jobId: '', stage: DEFAULT_INTERVIEW_STAGE, reminderMinutes: 30 };
    }
    return {
      callerId: interview.caller_id || '',
      jobId: resolveJobId(interview, jobs),
      stage: resolveStage(interview),
      reminderMinutes: resolveReminder(interview),
    };
  }, [interview, jobs]);

  const isDirty =
    canEditInterview &&
    (callerId !== baseline.callerId ||
      jobId !== baseline.jobId ||
      stage !== baseline.stage ||
      Number(reminderMinutes) !== Number(baseline.reminderMinutes));

  if (!interview) return null;

  const start = new Date(interview.start_time);
  const end = new Date(interview.end_time);
  const fromGoogle = isGoogleCalendarInterview(interview);
  const organizer = interviewOrganizerParts(interview);
  const attendees = interviewAttendeeLabels(interview);
  const selectedJob = jobs.find((job) => job.id === jobId) || null;

  function goToJob() {
    if (!interview.job?.id || canEditInterview) return;
    onClose();
    navigate(`/dashboard/jobs/${interview.job.id}`);
  }

  function goToMember() {
    if (!interview.invited_member?.id) return;
    onClose();
    navigate(`/dashboard/team/members/${interview.invited_member.id}`);
  }

  function resetDraft() {
    setCallerId(baseline.callerId);
    setJobId(baseline.jobId);
    setStage(baseline.stage);
    setReminderMinutes(baseline.reminderMinutes);
    setError('');
  }

  function handleCancelChanges() {
    resetDraft();
  }

  async function handleSave() {
    setError('');
    if (!canEditInterview) {
      setError('Past interviews cannot be edited.');
      resetDraft();
      return;
    }
    setSubmitting(true);
    try {
      await onSave({
        caller_id: callerId || null,
        invited_member_id: interview.invited_member_id,
        job_id: selectedJob?.id || null,
        job_title: selectedJob?.job_title || '',
        company_name: selectedJob?.company_name || '',
        stage,
        reminder_minutes: reminderMinutes,
      });
    } catch (err) {
      setError(err.message || 'Failed to save interview details.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="interview-modal-backdrop" onClick={onClose}>
      <div
        className="interview-modal interview-modal--detail"
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="interview-detail__head">
          <div>
            <p className="interview-detail__eyebrow">Interview details</p>
            <h2 id="interview-detail-title">{interview.interview_name}</h2>
          </div>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error ? <div className="interview-alert">{error}</div> : null}
        {canEditInterview && fromGoogle ? (
          <p className="interview-hint">
            Google Calendar fields stay read-only. Caller, job, stage, and
            reminder can be changed below.
          </p>
        ) : null}

        <dl className="interview-detail__list">
          <div>
            <dt>Caller</dt>
            <dd>
              {canEditInterview ? (
                <select
                  className="interview-detail__control"
                  value={callerId}
                  onChange={(e) => setCallerId(e.target.value)}
                >
                  <option value="">None</option>
                  {callers.map((caller) => (
                    <option key={caller.id} value={caller.id}>
                      {caller.name || caller.username}
                      {caller.user_id ? ` (${caller.user_id})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  {interview.caller?.profile?.name ||
                    interview.caller?.username ||
                    'None'}
                  {interview.caller?.user_id ? (
                    <span className="interview-detail__meta">
                      {interview.caller.user_id}
                    </span>
                  ) : null}
                  {interview.caller?.profile?.email || interview.caller?.email ? (
                    <span className="interview-detail__meta">
                      {interview.caller?.profile?.email || interview.caller?.email}
                    </span>
                  ) : null}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Invited member</dt>
            <dd>
              {interview.invited_member?.id ? (
                <button type="button" className="interview-detail__link" onClick={goToMember}>
                  {interview.invited_member?.name || 'Unknown'}
                </button>
              ) : (
                interview.invited_member?.name || 'Unknown'
              )}
              {interview.invited_member?.email ? (
                <span className="interview-detail__meta">
                  {interview.invited_member.email}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Job title</dt>
            <dd>
              {canEditInterview ? (
                <select
                  className="interview-detail__control"
                  value={jobId}
                  onChange={(e) => setJobId(e.target.value)}
                >
                  <option value="">None</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.job_title}
                      {job.company_name ? ` · ${job.company_name}` : ''}
                    </option>
                  ))}
                </select>
              ) : interview.job?.id ? (
                <button type="button" className="interview-detail__link" onClick={goToJob}>
                  {interviewJobTitle(interview) || '—'}
                </button>
              ) : (
                interviewJobTitle(interview) || '—'
              )}
            </dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>
              {canEditInterview
                ? selectedJob?.company_name || '—'
                : interviewCompanyName(interview) || '—'}
            </dd>
          </div>
          {organizer.name || organizer.email ? (
            <div>
              <dt>Organizer</dt>
              <dd>
                {organizer.name || organizer.email}
                {organizer.name && organizer.email ? (
                  <span className="interview-detail__meta">{organizer.email}</span>
                ) : null}
              </dd>
            </div>
          ) : null}
          {attendees.length ? (
            <div>
              <dt>Attendees</dt>
              <dd>
                <ul className="google-cal-fields__bullets">
                  {attendees.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Meeting link</dt>
            <dd>
              {interview.meeting_link ? (
                <a
                  href={interview.meeting_link}
                  target="_blank"
                  rel="noreferrer"
                  className="interview-detail__link"
                >
                  {interview.meeting_link}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>
              <span className="interview-detail__when">
                {formatDisplayDate(start, settings.dateFormat, settings.timeZone)}
              </span>
              <span className="interview-detail__meta">
                {formatTimeBySetting(start, settings.timeFormat, settings.timeZone)}
                {' – '}
                {formatTimeBySetting(end, settings.timeFormat, settings.timeZone)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Reminder</dt>
            <dd>
              {canEditInterview ? (
                <select
                  className="interview-detail__control"
                  value={reminderMinutes}
                  onChange={(e) => setReminderMinutes(Number(e.target.value))}
                >
                  {REMINDER_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : [10, 20, 30, 60].includes(Number(interview.reminder_minutes)) ? (
                `${interview.reminder_minutes} min before`
              ) : settings.notificationLeadMinutes ? (
                `${settings.notificationLeadMinutes} min before`
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt>Stage</dt>
            <dd>
              {canEditInterview ? (
                <select
                  className="interview-detail__control"
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                >
                  {INTERVIEW_STAGES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="interview-detail__stage">
                  {interview.stage && interview.stage !== 'Onboarding'
                    ? interview.stage
                    : DEFAULT_INTERVIEW_STAGE}
                </span>
              )}
            </dd>
          </div>
        </dl>

        {fromGoogle ? (
          <GoogleCalendarFields data={interview.google_event_data} />
        ) : null}

        <div className="interview-actions">
          {isAdmin ? (
            isDirty ? (
              <>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={handleCancelChanges}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSave}
                  disabled={submitting}
                >
                  {submitting ? 'Saving…' : 'Save changes'}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-outline-pill btn-outline-pill--danger"
                onClick={onCancelBooking}
              >
                <TrashIcon />
                Remove
              </button>
            )
          ) : (
            <button type="button" className="btn-primary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default InterviewDetailModal;
