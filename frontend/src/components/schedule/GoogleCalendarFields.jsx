const FIELD_LABELS = {
  status: 'Status',
  summary: 'Title',
  description: 'Description',
  location: 'Location',
  htmlLink: 'Google Calendar link',
  hangoutLink: 'Hangout link',
  visibility: 'Visibility',
  eventType: 'Event type',
  transparency: 'Transparency',
  colorId: 'Color',
  iCalUID: 'iCal UID',
  recurringEventId: 'Recurring event ID',
  created: 'Created',
  updated: 'Updated',
  timeZone: 'Time zone',
  start: 'Start',
  end: 'End',
  creator: 'Creator',
  organizer: 'Organizer',
  attendees: 'Attendees',
  conferenceSolution: 'Conference',
  conferenceEntryPoints: 'Join details',
  conferenceId: 'Conference ID',
  attachments: 'Attachments',
  reminders: 'Reminders',
  source: 'Source',
};

/** Fields already shown as primary interview rows — skip duplicates in the dump. */
const SKIP_KEYS = new Set([
  'summary',
  'description',
  'start',
  'end',
  'organizer',
  'attendees',
  'htmlLink',
]);

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function formatPerson(person) {
  if (!person || typeof person !== 'object') return '';
  const name = person.displayName || '';
  const email = person.email || '';
  if (name && email) return `${name} <${email}>`;
  return name || email || '';
}

function formatAttendee(attendee) {
  const base = formatPerson(attendee);
  const bits = [];
  if (attendee.responseStatus) bits.push(attendee.responseStatus);
  if (attendee.optional) bits.push('optional');
  if (attendee.organizer) bits.push('organizer');
  if (attendee.self) bits.push('you');
  if (attendee.comment) bits.push(attendee.comment);
  return bits.length ? `${base} (${bits.join(', ')})` : base;
}

function formatEntryPoint(entry) {
  const type = entry.type || 'link';
  const label = entry.label || type;
  const extras = [entry.pin, entry.accessCode, entry.meetingCode, entry.passcode]
    .filter(Boolean)
    .join(' · ');
  if (entry.uri && extras) return `${label}: ${entry.uri} (${extras})`;
  if (entry.uri) return `${label}: ${entry.uri}`;
  return extras ? `${label}: ${extras}` : label;
}

function formatValue(key, value) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;

  if (key === 'creator' || key === 'organizer') {
    return formatPerson(value);
  }
  if (key === 'attendees' && Array.isArray(value)) {
    return value.map(formatAttendee).filter(Boolean);
  }
  if (key === 'conferenceEntryPoints' && Array.isArray(value)) {
    return value.map(formatEntryPoint).filter(Boolean);
  }
  if (key === 'attachments' && Array.isArray(value)) {
    return value.map((file) => ({
      text: file.title || file.fileUrl || 'Attachment',
      href: file.fileUrl || '',
    }));
  }
  if (key === 'conferenceSolution' && typeof value === 'object') {
    return [value.name, value.type].filter(Boolean).join(' · ');
  }
  if (key === 'reminders' && typeof value === 'object') {
    const parts = [];
    if (value.useDefault) parts.push('Default reminders');
    if (Array.isArray(value.overrides)) {
      for (const item of value.overrides) {
        parts.push(`${item.method || 'alert'} · ${item.minutes} min`);
      }
    }
    return parts.length ? parts : null;
  }
  if (key === 'source' && typeof value === 'object') {
    return value.title || value.url || null;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function renderScalar(text, href) {
  if (!text) return null;
  const link = href || (isHttpUrl(text) ? text : '');
  if (link) {
    return (
      <a href={link} target="_blank" rel="noreferrer" className="interview-detail__link">
        {text}
      </a>
    );
  }
  return text;
}

function GoogleCalendarFields({ data, className = '' }) {
  const payload =
    data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const entries = Object.entries(payload).filter(
    ([key, value]) =>
      !SKIP_KEYS.has(key) && value != null && value !== '' &&
      !(Array.isArray(value) && value.length === 0),
  );

  if (!entries.length) return null;

  return (
    <div className={`google-cal-fields ${className}`.trim()}>
      <p className="google-cal-fields__title">Google Calendar</p>
      <dl className="interview-detail__list google-cal-fields__list">
        {entries.map(([key, raw]) => {
          const label = FIELD_LABELS[key] || key;
          const formatted = formatValue(key, raw);
          if (formatted == null || formatted === '') return null;

          if (Array.isArray(formatted)) {
            return (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  <ul className="google-cal-fields__bullets">
                    {formatted.map((item, index) => {
                      if (item && typeof item === 'object' && 'text' in item) {
                        return (
                          <li key={`${key}-${index}`}>
                            {renderScalar(item.text, item.href)}
                          </li>
                        );
                      }
                      return (
                        <li key={`${key}-${index}`}>
                          {renderScalar(String(item))}
                        </li>
                      );
                    })}
                  </ul>
                </dd>
              </div>
            );
          }

          if (key === 'htmlLink' || key === 'hangoutLink') {
            return (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{renderScalar(String(formatted), String(formatted))}</dd>
              </div>
            );
          }

          if (key === 'source' && raw?.url) {
            return (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{renderScalar(String(formatted), raw.url)}</dd>
              </div>
            );
          }

          return (
            <div key={key}>
              <dt>{label}</dt>
              <dd className={key === 'description' ? 'interview-detail__note' : undefined}>
                {renderScalar(String(formatted))}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export default GoogleCalendarFields;
