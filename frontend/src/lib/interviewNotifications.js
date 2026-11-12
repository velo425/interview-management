const NOTIFIED_KEY = 'calid.notifiedInterviewReminders';

function loadNotifiedMap() {
  try {
    const raw = sessionStorage.getItem(NOTIFIED_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveNotifiedMap(map) {
  sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify(map));
}

/**
 * Collect toast payloads for interviews starting within the lead window.
 * Does not use the browser Notification API.
 */
export function collectInterviewReminderToasts({
  interviews = [],
  leadMinutes = 10,
  timeZone,
  timeFormat = '12h',
}) {
  const now = Date.now();
  const defaultLead = Math.max(1, Number(leadMinutes) || 10);
  const notified = loadNotifiedMap();
  const toasts = [];

  for (const interview of interviews) {
    if (!interview?.id || !interview.start_time) continue;
    const startMs = new Date(interview.start_time).getTime();
    if (!Number.isFinite(startMs)) continue;

    const interviewLead = [10, 20, 30, 60].includes(
      Number(interview.reminder_minutes),
    )
      ? Number(interview.reminder_minutes)
      : defaultLead;
    const leadMs = interviewLead * 60 * 1000;

    const msUntil = startMs - now;
    if (msUntil <= 0 || msUntil > leadMs) continue;

    const key = `${interview.id}:${interviewLead}`;
    if (notified[key]) continue;

    const endMs = interview.end_time
      ? new Date(interview.end_time).getTime()
      : startMs;
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: timeFormat === '24h' ? '2-digit' : 'numeric',
      minute: '2-digit',
      hour12: timeFormat !== '24h',
    });

    const startLabel = timeFormatter.format(new Date(startMs));
    const endLabel = Number.isFinite(endMs)
      ? timeFormatter.format(new Date(endMs))
      : '';
    const minsLeft = Math.max(1, Math.round(msUntil / 60000));
    const jobTitle =
      String(interview.job_title || '').trim() ||
      interview.job?.job_title ||
      '—';

    toasts.push({
      id: `toast-${key}-${now}`,
      notifyKey: key,
      title: interview.interview_name || 'Upcoming interview',
      time: endLabel ? `${startLabel} – ${endLabel}` : startLabel,
      jobTitle,
      callerName:
        interview.caller?.profile?.name ||
        interview.caller?.username ||
        'None',
      memberName: interview.invited_member?.name || '—',
      subtitle: `Starts in ${minsLeft} min`,
    });

    notified[key] = Date.now();
  }

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [key, ts] of Object.entries(notified)) {
    if (Number(ts) < cutoff) delete notified[key];
  }
  saveNotifiedMap(notified);
  return toasts;
}
