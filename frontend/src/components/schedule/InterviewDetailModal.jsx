import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatTimeBySetting } from '../../lib/calendarSettings';
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
} from '../../lib/interviewsApi';
import './InterviewModals.css';

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

function invitedMemberLabel(member) {
  const name = String(member?.name || '').trim() || 'Unknown';
  const email = String(member?.email || '').trim();
  return email ? `${name} (${email})` : name;
}

function formatDetailDate(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatDetailTimeRange(start, end, settings) {
  const startLabel = formatTimeBySetting(
    start,
    settings.timeFormat,
    settings.timeZone,
  );
  const endLabel = formatTimeBySetting(
    end,
    settings.timeFormat,
    settings.timeZone,
  );
  const zone =
    new Intl.DateTimeFormat('en-US', {
      timeZone: settings.timeZone,
      timeZoneName: 'short',
    })
      .formatToParts(start)
      .find((part) => part.type === 'timeZoneName')?.value || '';
  return zone
    ? `${startLabel} – ${endLabel} ${zone}`
    : `${startLabel} – ${endLabel}`;
}

function personLine(parts) {
  if (parts.name && parts.email) return `${parts.name} — ${parts.email}`;
  return parts.name || parts.email || '';
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
  const [editing, setEditing] = useState(false);
  const [callerId, setCallerId] = useState('');
  const [jobId, setJobId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [stage, setStage] = useState(DEFAULT_INTERVIEW_STAGE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!interview) return;
    setCallerId(interview.caller_id || '');
    setJobId(resolveJobId(interview, jobs));
    setCompanyName(interviewCompanyName(interview) || '');
    setStage(resolveStage(interview));
    setEditing(false);
    setError('');
    setSubmitting(false);
  }, [interview, jobs]);

  const canEditInterview = Boolean(
    interview && isAdmin && !interviewHasConcluded(interview),
  );

  const baseline = useMemo(() => {
    if (!interview) {
      return {
        callerId: '',
        jobId: '',
        companyName: '',
        stage: DEFAULT_INTERVIEW_STAGE,
      };
    }
    return {
      callerId: interview.caller_id || '',
      jobId: resolveJobId(interview, jobs),
      companyName: interviewCompanyName(interview) || '',
      stage: resolveStage(interview),
    };
  }, [interview, jobs]);

  const isDirty =
    editing &&
    canEditInterview &&
    (callerId !== baseline.callerId ||
      jobId !== baseline.jobId ||
      companyName.trim() !== baseline.companyName.trim() ||
      stage !== baseline.stage);

  if (!interview) return null;

  const start = new Date(interview.start_time);
  const end = new Date(interview.end_time);
  const organizer = interviewOrganizerParts(interview);
  const attendees = interviewAttendeeLabels(interview);
  const selectedJob = jobs.find((job) => job.id === jobId) || null;
  const organizerLine = personLine(organizer);
  const accent = interview.invited_member_id ? '#2563eb' : '#64748b';
  const callerLabel =
    interview.caller?.profile?.name ||
    interview.caller?.username ||
    callers.find((row) => row.id === interview.caller_id)?.name ||
    callers.find((row) => row.id === interview.caller_id)?.username ||
    '';
  const jobLabel = interviewJobTitle(interview) || '';
  const companyLabel = interviewCompanyName(interview) || '';
  const jobTargetId = interview.job?.id || interview.job_id || '';
  const stageLabel =
    interview.stage && interview.stage !== 'Onboarding'
      ? interview.stage
      : DEFAULT_INTERVIEW_STAGE;

  function goToCaller() {
    if (!interview.caller_id) return;
    onClose();
    navigate('/dashboard/callers');
  }

  function goToJob() {
    if (!jobTargetId) return;
    onClose();
    navigate(`/dashboard/jobs/${jobTargetId}`);
  }

  function goToMember() {
    if (!interview.invited_member?.id) return;
    onClose();
    navigate(`/dashboard/team/members/${interview.invited_member.id}`);
  }

  function handleJobChange(nextJobId) {
    setJobId(nextJobId);
    const job = jobs.find((row) => row.id === nextJobId);
    if (job?.company_name) {
      setCompanyName(job.company_name);
    }
  }

  function resetDraft() {
    setCallerId(baseline.callerId);
    setJobId(baseline.jobId);
    setCompanyName(baseline.companyName);
    setStage(baseline.stage);
    setError('');
  }

  function handleCancelEdit() {
    resetDraft();
    setEditing(false);
  }

  async function handleSave() {
    setError('');
    if (!canEditInterview) {
      setError('Past interviews cannot be edited.');
      handleCancelEdit();
      return;
    }
    setSubmitting(true);
    try {
      await onSave({
        caller_id: callerId || null,
        invited_member_id: interview.invited_member_id,
        job_id: selectedJob?.id || null,
        job_title: selectedJob?.job_title || interviewJobTitle(interview) || '',
        company_name: companyName.trim(),
        stage,
      });
      setEditing(false);
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
        <div
          className="interview-detail__accent"
          style={{ background: accent }}
          aria-hidden="true"
        />

        <div className="interview-detail__head">
          <h2 id="interview-detail-title">{interview.interview_name}</h2>
          <button
            type="button"
            className="icon-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error ? <div className="interview-alert">{error}</div> : null}

        <div className="interview-detail__rows">
          <DetailRow icon={<CalendarIcon />}>
            {formatDetailDate(start, settings.timeZone)}
          </DetailRow>

          <DetailRow icon={<ClockIcon />}>
            {formatDetailTimeRange(start, end, settings)}
          </DetailRow>

          <DetailRow icon={<PersonIcon />}>
            {interview.invited_member?.id ? (
              <button
                type="button"
                className="interview-detail__text-btn"
                onClick={goToMember}
              >
                {invitedMemberLabel(interview.invited_member)}
              </button>
            ) : (
              invitedMemberLabel(interview.invited_member)
            )}
          </DetailRow>

          {interview.meeting_link ? (
            <DetailRow icon={<VideoIcon />}>
              <a
                href={interview.meeting_link}
                target="_blank"
                rel="noreferrer"
                className="interview-detail__link"
              >
                {interview.meeting_link}
              </a>
            </DetailRow>
          ) : null}

          {organizerLine || attendees.length ? (
            <DetailRow icon={<MailIcon />}>
              <div className="interview-detail__stack">
                {organizerLine ? (
                  <span>Organizer: {organizerLine}</span>
                ) : null}
                {attendees.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </DetailRow>
          ) : null}

          {editing && canEditInterview ? (
            <>
              <DetailRow icon={<CallerIcon />}>
                <select
                  className="interview-detail__control"
                  value={callerId}
                  onChange={(e) => setCallerId(e.target.value)}
                  aria-label="Caller"
                >
                  <option value="">No caller</option>
                  {callers.map((caller) => (
                    <option key={caller.id} value={caller.id}>
                      {caller.name || caller.username}
                      {caller.user_id ? ` (${caller.user_id})` : ''}
                    </option>
                  ))}
                </select>
              </DetailRow>

              <DetailRow icon={<BriefcaseIcon />}>
                <select
                  className="interview-detail__control"
                  value={jobId}
                  onChange={(e) => handleJobChange(e.target.value)}
                  aria-label="Job"
                >
                  <option value="">No job</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.job_title}
                      {job.company_name ? ` · ${job.company_name}` : ''}
                    </option>
                  ))}
                </select>
              </DetailRow>

              <DetailRow icon={<BuildingIcon />}>
                <input
                  type="text"
                  className="interview-detail__control"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Company"
                  aria-label="Company"
                />
              </DetailRow>

              <DetailRow icon={<FlagIcon />}>
                <select
                  className="interview-detail__control"
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  aria-label="Stage"
                >
                  {INTERVIEW_STAGES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </DetailRow>
            </>
          ) : (
            <>
              <DetailRow icon={<CallerIcon />}>
                {interview.caller_id && callerLabel ? (
                  <button
                    type="button"
                    className="interview-detail__link"
                    onClick={goToCaller}
                  >
                    {callerLabel}
                  </button>
                ) : (
                  callerLabel || '—'
                )}
              </DetailRow>

              <DetailRow icon={<BriefcaseIcon />}>
                {jobTargetId && jobLabel ? (
                  <button
                    type="button"
                    className="interview-detail__link"
                    onClick={goToJob}
                  >
                    {jobLabel}
                  </button>
                ) : (
                  jobLabel || '—'
                )}
              </DetailRow>

              <DetailRow icon={<BuildingIcon />}>
                {companyLabel || '—'}
              </DetailRow>

              <DetailRow icon={<FlagIcon />}>
                <span className="interview-detail__stage">{stageLabel}</span>
              </DetailRow>
            </>
          )}
        </div>

        <div className="interview-detail__footer">
          <p className="interview-detail__footnote">
            {interview.job_id || interview.job?.id
              ? 'Linked to a job posting.'
              : 'Not linked to a job posting.'}
          </p>
          <div className="interview-actions">
            {isAdmin ? (
              editing && canEditInterview ? (
                <>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleCancelEdit}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleSave}
                    disabled={submitting || !isDirty}
                  >
                    {submitting ? 'Saving…' : 'Save changes'}
                  </button>
                </>
              ) : (
                <>
                  {canEditInterview ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setEditing(true)}
                    >
                      Edit
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-outline-pill btn-outline-pill--danger"
                    onClick={onCancelBooking}
                  >
                    <TrashIcon />
                    Remove
                  </button>
                </>
              )
            ) : (
              <button type="button" className="btn-primary" onClick={onClose}>
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, children }) {
  return (
    <div className="interview-detail__row">
      <span className="interview-detail__icon" aria-hidden="true">
        {icon}
      </span>
      <div className="interview-detail__value">{children}</div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8v4.5L15 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5 19c0-3.2 3-5.2 7-5.2s7 2 7 5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="7" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M15 10.5l5-2.5v8l-5-2.5v-3z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 8l8 6 8-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CallerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M8.5 5.5c1.2-1.2 3.2-1.2 4.4 0l1 1c.4.4.5 1 .3 1.5l-.7 1.7a1.4 1.4 0 0 0 .3 1.5l2.2 2.2c.4.4 1 .5 1.5.3l1.7-.7c.5-.2 1.1-.1 1.5.3l1 1c1.2 1.2 1.2 3.2 0 4.4l-.8.8c-1.2 1.2-3 1.5-4.6.8-3.3-1.5-6.3-4.5-7.8-7.8-.7-1.6-.4-3.4.8-4.6l.8-.8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="7" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 7V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1M3 12h18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M4 20V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14M4 20h16M16 20v-7h4v7" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M8 8h2M8 12h2M8 16h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M6 21V4M6 4h10l-2 4 2 4H6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
