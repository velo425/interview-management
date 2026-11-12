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

function compactEntryPoint(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  return omitEmpty({
    type: entry.entryPointType,
    uri: entry.uri,
    label: entry.label,
    pin: entry.pin,
    accessCode: entry.accessCode,
    meetingCode: entry.meetingCode,
    passcode: entry.passcode,
    password: entry.password,
  });
}

function compactAttachment(file) {
  if (!file || typeof file !== 'object') return undefined;
  return omitEmpty({
    title: file.title,
    fileUrl: file.fileUrl,
    mimeType: file.mimeType,
    iconLink: file.iconLink,
  });
}

/** Build a display-ready map of non-empty Google Calendar event fields. */
export function buildGoogleEventData(event = {}) {
  const start = event.start || {};
  const end = event.end || {};
  const conference = event.conferenceData || {};
  const reminders = event.reminders || {};

  return (
    omitEmpty({
      status: event.status,
      summary: event.summary,
      description: event.description,
      location: event.location,
      htmlLink: event.htmlLink,
      hangoutLink: event.hangoutLink,
      visibility: event.visibility,
      eventType: event.eventType,
      transparency: event.transparency,
      colorId: event.colorId,
      iCalUID: event.iCalUID,
      recurringEventId: event.recurringEventId,
      created: event.created,
      updated: event.updated,
      timeZone: start.timeZone || end.timeZone,
      start: omitEmpty({
        dateTime: start.dateTime,
        date: start.date,
        timeZone: start.timeZone,
      }),
      end: omitEmpty({
        dateTime: end.dateTime,
        date: end.date,
        timeZone: end.timeZone,
      }),
      creator: compactPerson(event.creator),
      organizer: compactPerson(event.organizer),
      attendees: Array.isArray(event.attendees)
        ? event.attendees.map(compactAttendee).filter(Boolean)
        : undefined,
      conferenceSolution: omitEmpty({
        name: conference.conferenceSolution?.name,
        type: conference.conferenceSolution?.key?.type,
      }),
      conferenceEntryPoints: Array.isArray(conference.entryPoints)
        ? conference.entryPoints.map(compactEntryPoint).filter(Boolean)
        : undefined,
      conferenceId: conference.conferenceId,
      attachments: Array.isArray(event.attachments)
        ? event.attachments.map(compactAttachment).filter(Boolean)
        : undefined,
      reminders: omitEmpty({
        useDefault: reminders.useDefault,
        overrides: Array.isArray(reminders.overrides)
          ? reminders.overrides
              .map((item) =>
                omitEmpty({
                  method: item.method,
                  minutes: item.minutes,
                }),
              )
              .filter(Boolean)
          : undefined,
      }),
      source: omitEmpty({
        title: event.source?.title,
        url: event.source?.url,
      }),
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

  const googleEventData = buildGoogleEventData(event);

  return {
    googleEventId: event.id,
    cancelled: false,
    interviewName: String(event.summary || '').trim() || '(No title)',
    meetingLink: extractMeetingLink(event),
    bookingNote: String(event.description || '').trim(),
    googleHtmlLink: String(event.htmlLink || ''),
    location: String(event.location || '').trim(),
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    status: event.status || 'confirmed',
    googleEventData,
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
