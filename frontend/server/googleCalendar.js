const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Drop null/empty string/empty array/empty object values. */
export function omitEmpty(value) {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const next = value.map(omitEmpty).filter((item) => item !== undefined);
    return next.length ? next : undefined;
  }
  if (isPlainObject(value)) {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      const cleaned = omitEmpty(child);
      if (cleaned !== undefined) next[key] = cleaned;
    }
    return Object.keys(next).length ? next : undefined;
  }
  return undefined;
}

function extractMeetingLink(event = {}) {
  if (event.hangoutLink) return String(event.hangoutLink);
  const entryPoints = event.conferenceData?.entryPoints || [];
  const video = entryPoints.find(
    (item) => item.entryPointType === 'video' && item.uri,
  );
  if (video?.uri) return String(video.uri);
  const location = String(event.location || '');
  const fromLocation = location.match(/https?:\/\/\S+/i);
  if (fromLocation) return fromLocation[0];
  const description = String(event.description || '');
  const fromDescription = description.match(/https?:\/\/\S+/i);
  if (fromDescription) return fromDescription[0];
  return '';
}

function parseEventTime(value) {
  if (!value) return null;
  if (value.dateTime) {
    const dt = new Date(value.dateTime);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (value.date) {
    // All-day events: treat as local midnight → next day midnight UTC date.
    const start = new Date(`${value.date}T00:00:00.000Z`);
    return Number.isNaN(start.getTime()) ? null : start;
  }
  return null;
}

function compactPerson(person) {
  if (!person || typeof person !== 'object') return undefined;
  return omitEmpty({
    email: person.email,
    displayName: person.displayName,
    self: person.self === true ? true : undefined,
    organizer: person.organizer === true ? true : undefined,
  });
}

function compactAttendee(attendee) {
  if (!attendee || typeof attendee !== 'object') return undefined;
  return omitEmpty({
    email: attendee.email,
    displayName: attendee.displayName,
    responseStatus: attendee.responseStatus,
    optional: attendee.optional === true ? true : undefined,
    organizer: attendee.organizer === true ? true : undefined,
    self: attendee.self === true ? true : undefined,
    comment: attendee.comment,
  });
}

/**
 * Persist only fields the app reads (organizer / creator / attendees for UI + Mail).
 * Avoid storing the full Google Calendar dump in interviews.google_event_data.
 */
export function buildGoogleEventData(event = {}) {
  return (
    omitEmpty({
      creator: compactPerson(event.creator),
      organizer: compactPerson(event.organizer),
      attendees: Array.isArray(event.attendees)
        ? event.attendees.map(compactAttendee).filter(Boolean)
        : undefined,
    }) || {}
  );
}

export function normalizeCalendarEvent(event) {
  const start = parseEventTime(event.start);
  let end = parseEventTime(event.end);
  if (!start) return null;
  if (!end || !(end > start)) {
    end = new Date(start.getTime() + 30 * 60 * 1000);
  }
  if (event.status === 'cancelled') {
    return {
      googleEventId: event.id,
      cancelled: true,
    };
  }

  return {
    googleEventId: event.id,
    cancelled: false,
    interviewName: String(event.summary || '').trim() || '(No title)',
    meetingLink: extractMeetingLink(event),
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    status: event.status || 'confirmed',
    googleEventData: buildGoogleEventData(event),
  };
}

export async function listCalendarEvents(accessToken, {
  calendarId = 'primary',
  timeMin,
  timeMax,
  pageToken = '',
  maxResults = 100,
} = {}) {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(Math.min(250, Math.max(1, maxResults))),
    showDeleted: 'true',
    // Include Meet / conference entry points in the payload.
    conferenceDataVersion: '1',
  });
  if (timeMin) params.set('timeMin', new Date(timeMin).toISOString());
  if (timeMax) params.set('timeMax', new Date(timeMax).toISOString());
  if (pageToken) params.set('pageToken', pageToken);

  const response = await fetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(
        payload.error?.message ||
          'Failed to list Google Calendar events. Reconnect Gmail with Calendar access.',
      ),
      { status: response.status === 403 ? 403 : 502, payload },
    );
  }
  return {
    events: Array.isArray(payload.items) ? payload.items : [],
    nextPageToken: payload.nextPageToken || '',
  };
}

export async function syncCalendarWindow(accessToken, options = {}) {
  const all = [];
  let pageToken = '';
  do {
    const page = await listCalendarEvents(accessToken, {
      ...options,
      pageToken,
    });
    all.push(...page.events);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return all.map(normalizeCalendarEvent).filter(Boolean);
}
