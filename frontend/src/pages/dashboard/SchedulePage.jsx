import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  canEditWorkspace,
  interviewCallerScopeId,
  isTeamMemberRole,
} from '../../lib/roles';
import {
  COUNTRIES,
  DATE_FORMATS,
  NOTIFICATION_LEAD_OPTIONS,
  TIME_FORMATS,
  TIME_ZONES,
  formatDateBySetting,
  formatTimeBySetting,
  getGmtLabel,
  getTimeZoneParts,
  loadCalendarSettings,
  saveCalendarSettings,
} from '../../lib/calendarSettings';
import { collectInterviewReminderToasts } from '../../lib/interviewNotifications';
import { getCallerColor } from '../../lib/callerColors';
import { getHolidaysForRangeAsync, holidaysOnDay } from '../../lib/holidays';
import { firstName } from '../../lib/names';
import {
  deleteInterview,
  fetchCallers,
  fetchInterviews,
  fetchJobs,
  fetchTeamMembers,
  interviewAttendeeLabels,
  interviewOrganizerLabel,
  syncGoogleCalendar,
  updateInterview,
} from '../../lib/interviewsApi';
import InterviewDetailModal from '../../components/schedule/InterviewDetailModal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import SearchableSelect from '../../components/ui/SearchableSelect';
import ToastStack from '../../components/ui/ToastStack';
import UserMenu from '../../components/dashboard/UserMenu';
import './SchedulePage.css';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const SLOT_MINUTES = 30;
const SLOT_HEIGHT = 36;
const DAY_SLOTS = Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, i) => i);
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => i);

function startOfWeek(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatRange(weekStart, dateFormat) {
  const weekEnd = addDays(weekStart, 6);
  return `${formatDateBySetting(weekStart, dateFormat)} – ${formatDateBySetting(weekEnd, dateFormat)}`;
}

function formatHourLabel(hour, timeFormat) {
  const date = new Date(Date.UTC(2000, 0, 1, hour, 0));
  if (timeFormat === '24h') {
    return `${String(hour).padStart(2, '0')}:00`;
  }
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

function SchedulePage() {
  const { profile } = useAuth();
  const canEdit = canEditWorkspace(profile?.user_role);
  const isTeamMember = isTeamMemberRole(profile?.user_role);
  const callerScopeId = interviewCallerScopeId(profile);

  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [view, setView] = useState('week');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState(() => loadCalendarSettings());
  const [callers, setCallers] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [interviews, setInterviews] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [monthHolidays, setMonthHolidays] = useState([]);
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [selectedInterview, setSelectedInterview] = useState(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [callerFilter, setCallerFilter] = useState('all');
  const [memberFilter, setMemberFilter] = useState('all');
  const [toasts, setToasts] = useState([]);

  const weekStart = useMemo(() => startOfWeek(anchorDate), [anchorDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekEnd = useMemo(() => {
    const end = addDays(weekStart, 6);
    end.setHours(23, 59, 59, 999);
    return end;
  }, [weekStart]);

  const rangeStart = useMemo(() => {
    if (view === 'day') {
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    if (view === 'month') {
      return new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    }
    return weekStart;
  }, [view, selectedDate, weekStart]);

  const rangeEnd = useMemo(() => {
    if (view === 'day') {
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);
      return end;
    }
    if (view === 'month') {
      return new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
    }
    return weekEnd;
  }, [view, selectedDate, weekEnd]);

  const boardDays = useMemo(() => {
    if (view === 'day') {
      return [
        new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate(),
        ),
      ];
    }
    return weekDays;
  }, [view, selectedDate, weekDays]);

  const monthLabel = selectedDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const miniDays = useMemo(() => buildMiniMonth(selectedDate), [selectedDate]);
  const gmtLabel = useMemo(() => getGmtLabel(now, settings.timeZone), [now, settings.timeZone]);
  const nowParts = useMemo(
    () => getTimeZoneParts(now, settings.timeZone),
    [now, settings.timeZone],
  );

  const nowTop =
    ((nowParts.hour * 60 + nowParts.minute) / SLOT_MINUTES) * SLOT_HEIGHT;

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHolidays() {
      const weekHolidayRows = await getHolidaysForRangeAsync(
        settings.country,
        weekStart,
        weekEnd,
      );
      const monthStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
      const monthEnd = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth() + 1,
        0,
        23,
        59,
        59,
      );
      const monthHolidayRows = await getHolidaysForRangeAsync(
        settings.country,
        monthStart,
        monthEnd,
      );
      if (!cancelled) {
        setHolidays(weekHolidayRows);
        setMonthHolidays(monthHolidayRows);
      }
    }

    loadHolidays();
    return () => {
      cancelled = true;
    };
  }, [settings.country, weekStart, weekEnd, selectedDate]);

  const loadData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError('');
    try {
      const loadDirectory = !callerScopeId;
      const [interviewRows, callerRows, memberRows, jobRows] = await Promise.all([
        fetchInterviews({
          from: rangeStart,
          to: rangeEnd,
          callerOnlyId: callerScopeId || undefined,
        }),
        loadDirectory ? fetchCallers() : Promise.resolve([]),
        loadDirectory ? fetchTeamMembers() : Promise.resolve([]),
        loadDirectory ? fetchJobs() : Promise.resolve([]),
      ]);

      setInterviews(interviewRows);
      setCallers(callerRows);
      setTeamMembers(memberRows);
      setJobs(jobRows);
    } catch (err) {
      setError(err.message || 'Failed to load schedule.');
    } finally {
      setLoading(false);
    }
  }, [profile, rangeStart, rangeEnd, callerScopeId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const runCheck = () => {
      const nextToasts = collectInterviewReminderToasts({
        interviews,
        leadMinutes: settings.notificationLeadMinutes,
        timeZone: settings.timeZone,
        timeFormat: settings.timeFormat,
      });
      if (!nextToasts.length) return;
      setToasts((current) => [...nextToasts, ...current].slice(0, 5));
    };

    runCheck();
    const timerId = window.setInterval(runCheck, 15_000);
    return () => window.clearInterval(timerId);
  }, [
    interviews,
    settings.notificationLeadMinutes,
    settings.timeZone,
    settings.timeFormat,
  ]);

  useEffect(() => {
    if (!toasts.length) return undefined;
    const timerId = window.setTimeout(() => {
      setToasts((current) => current.slice(0, -1));
    }, 8000);
    return () => window.clearTimeout(timerId);
  }, [toasts]);

  function updateSetting(key, value) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveCalendarSettings(next);
      return next;
    });
  }

  function shiftRange(direction) {
    if (view === 'day') {
      setAnchorDate((d) => addDays(d, direction));
      setSelectedDate((d) => addDays(d, direction));
      return;
    }
    if (view === 'month') {
      setSelectedDate(
        (d) => new Date(d.getFullYear(), d.getMonth() + direction, 1),
      );
      setAnchorDate(
        (d) => new Date(d.getFullYear(), d.getMonth() + direction, 1),
      );
      return;
    }
    setAnchorDate((d) => addDays(d, direction * 7));
  }

  function toolbarRangeLabel() {
    if (view === 'day') {
      return formatDateBySetting(selectedDate, settings.dateFormat);
    }
    if (view === 'month') {
      return selectedDate.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });
    }
    return formatRange(weekStart, settings.dateFormat);
  }

  async function handleSaveInterview(payload) {
    if (!selectedInterview) return;
    const updated = await updateInterview(selectedInterview.id, payload);
    setInterviews((prev) =>
      prev
        .map((item) => (item.id === updated.id ? updated : item))
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time)),
    );
    setSelectedInterview(updated);
  }

  async function handleSyncCalendar() {
    if (!canEdit) return;
    setSyncBusy(true);
    setError('');
    setStatus('Syncing Google Calendar events…');
    try {
      const result = await syncGoogleCalendar();
      const failed = (result.results || []).filter((row) => row.error);
      const created = (result.results || []).reduce(
        (sum, row) => sum + Number(row.created || 0),
        0,
      );
      const updated = (result.results || []).reduce(
        (sum, row) => sum + Number(row.updated || 0),
        0,
      );
      await loadData();
      setStatus(
        `Calendar sync finished: ${created} new, ${updated} updated` +
          (failed.length
            ? `. ${failed.length} account${failed.length === 1 ? '' : 's'} failed — reconnect Gmail with Calendar access.`
            : '.'),
      );
      if (failed.length) {
        setError(
          failed
            .map((row) => `${row.gmailAddress || row.accountId}: ${row.error}`)
            .join(' · '),
        );
      }
    } catch (err) {
      setStatus('');
      setError(err.message || 'Failed to sync Google Calendar.');
    } finally {
      setSyncBusy(false);
    }
  }

  function handleCancelBooking() {
    if (!canEdit || !selectedInterview) return;
    setCancelConfirmOpen(true);
  }

  async function confirmCancelBooking() {
    if (!selectedInterview) return;

    setCancelBusy(true);
    setError('');
    try {
      await deleteInterview(selectedInterview.id);
      setInterviews((prev) => prev.filter((item) => item.id !== selectedInterview.id));
      setSelectedInterview(null);
      setCancelConfirmOpen(false);
    } catch (err) {
      setError(err.message || 'Failed to cancel booking.');
      setCancelConfirmOpen(false);
    } finally {
      setCancelBusy(false);
    }
  }

  const visibleInterviews = useMemo(() => {
    return interviews.filter((item) => {
      if (callerFilter !== 'all' && item.caller_id !== callerFilter) return false;
      if (memberFilter !== 'all' && item.invited_member_id !== memberFilter) {
        return false;
      }

      const q = search.trim().toLowerCase();
      if (!q) return true;
      return (
        item.interview_name.toLowerCase().includes(q) ||
        item.job?.job_title?.toLowerCase().includes(q) ||
        item.job?.company_name?.toLowerCase().includes(q) ||
        item.invited_member?.name?.toLowerCase().includes(q) ||
        item.caller?.username?.toLowerCase().includes(q)
      );
    });
  }, [interviews, callerFilter, memberFilter, search]);

  // Keep every caller chip visible; selection only highlights (does not rebuild list).
  const legendCallers = useMemo(() => {
    const map = new Map();
    if (callers.length) {
      for (const caller of callers) {
        map.set(caller.id, {
          id: caller.id,
          name: caller.name || caller.username || 'Caller',
          color: getCallerColor(caller.id),
        });
      }
    }
    for (const item of interviews) {
      const id = item.caller_id || item.caller?.id;
      if (!id || map.has(id)) continue;
      map.set(id, {
        id,
        name:
          item.caller?.profile?.name || item.caller?.username || 'Caller',
        color: getCallerColor(id),
      });
    }
    return [...map.values()];
  }, [callers, interviews]);

  const countryOptions = useMemo(
    () => COUNTRIES.map((country) => ({ value: country.code, label: country.label })),
    [],
  );
  const timeZoneOptions = useMemo(
    () => TIME_ZONES.map((zone) => ({ value: zone.id, label: zone.label })),
    [],
  );

  return (
    <div className="schedule">
      <ToastStack
        toasts={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((toast) => toast.id !== id))
        }
      />

      <header className="schedule__header">
        <div>
          <h1>Unified Calendar</h1>
          <p>
            {isTeamMember
              ? 'View team Google Calendar events with Cal.ID enrichment (read-only).'
              : 'Sync team Google Calendar events, then enrich caller, job, stage, and reminders.'}
          </p>
        </div>
        <UserMenu />
      </header>

      {status ? <div className="schedule__status">{status}</div> : null}

      <div className="schedule__toolbar">
        <div className="schedule__toolbar-left">
          <button type="button" className="icon-btn" aria-label="Menu">
            <MenuIcon />
          </button>
          <button
            type="button"
            className="chip-btn"
            onClick={() => {
              const today = new Date();
              setAnchorDate(today);
              setSelectedDate(today);
            }}
          >
            Today
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Previous"
            onClick={() => shiftRange(-1)}
          >
            <ChevronIcon dir="left" />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Next"
            onClick={() => shiftRange(1)}
          >
            <ChevronIcon dir="right" />
          </button>
          <span className="schedule__range">{toolbarRangeLabel()}</span>
        </div>

        <div className="schedule__legend" aria-label="Caller colors">
          {legendCallers.map((caller) => (
            <button
              key={caller.id}
              type="button"
              className={`schedule__legend-item${
                callerFilter === caller.id ? ' is-active' : ''
              }`}
              onClick={() =>
                setCallerFilter((current) =>
                  current === caller.id ? 'all' : caller.id,
                )
              }
              title={
                callerFilter === caller.id
                  ? 'Clear caller filter'
                  : `Filter by ${caller.name}`
              }
            >
              <span
                className="schedule__legend-swatch"
                style={{ background: caller.color.border }}
                aria-hidden="true"
              />
              <span className="schedule__legend-name">{caller.name}</span>
            </button>
          ))}
        </div>

        <div className="schedule__toolbar-right">
          <div className="view-toggle" role="group" aria-label="Calendar view">
            {['day', 'week', 'month'].map((option) => (
              <button
                key={option}
                type="button"
                className={view === option ? 'is-active' : ''}
                onClick={() => setView(option)}
              >
                {option[0].toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
          {canEdit ? (
            <button
              type="button"
              className="new-btn"
              disabled={syncBusy}
              onClick={handleSyncCalendar}
            >
              {syncBusy ? 'Syncing…' : 'Sync Calendar'}
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="schedule__error">{error}</div> : null}

      <div className="schedule__body">
        <aside className="schedule__aside">
          <label className="search-box">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search events..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          <div className="mini-cal">
            <div className="mini-cal__head">
              <strong>{monthLabel}</strong>
              <div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Previous month"
                  onClick={() =>
                    setSelectedDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
                  }
                >
                  <ChevronIcon dir="left" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Next month"
                  onClick={() =>
                    setSelectedDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
                  }
                >
                  <ChevronIcon dir="right" />
                </button>
              </div>
            </div>
            <div className="mini-cal__weekdays">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, i) => (
                <span key={`${label}-${i}`}>{label}</span>
              ))}
            </div>
            <div className="mini-cal__grid">
              {miniDays.map((day) => {
                const isSelected = sameDay(day.date, selectedDate);
                const isToday = sameDay(day.date, new Date());
                const dayHolidays = holidaysOnDay(monthHolidays, day.date);
                return (
                  <button
                    key={day.date.toISOString()}
                    type="button"
                    className={[
                      'mini-cal__day',
                      day.inMonth ? '' : 'is-muted',
                      isSelected ? 'is-selected' : '',
                      isToday ? 'is-today' : '',
                      dayHolidays.length ? 'is-holiday' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title={dayHolidays.map((h) => h.name).join(', ')}
                    onClick={() => {
                      setSelectedDate(day.date);
                      setAnchorDate(day.date);
                    }}
                  >
                    {day.date.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="cal-settings">
            <div className="cal-settings__head">
              <strong>Calendar settings</strong>
            </div>

            <label className="setting-card">
              <span>Country</span>
              <div className="setting-card__row">
                <SearchableSelect
                  ariaLabel="Country"
                  options={countryOptions}
                  value={settings.country}
                  onChange={(next) => updateSetting('country', next)}
                  placeholder="Select or type a country"
                />
              </div>
            </label>

            <label className="setting-card">
              <span>Date format</span>
              <div className="setting-card__row">
                <select
                  value={settings.dateFormat}
                  onChange={(e) => updateSetting('dateFormat', e.target.value)}
                >
                  {DATE_FORMATS.map((fmt) => (
                    <option key={fmt.id} value={fmt.id}>
                      {fmt.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className="setting-card">
              <span>Time format</span>
              <div className="setting-card__row">
                <select
                  value={settings.timeFormat}
                  onChange={(e) => updateSetting('timeFormat', e.target.value)}
                >
                  {TIME_FORMATS.map((fmt) => (
                    <option key={fmt.id} value={fmt.id}>
                      {fmt.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className="setting-card">
              <span>Primary time zone</span>
              <div className="setting-card__row">
                <SearchableSelect
                  ariaLabel="Primary time zone"
                  options={timeZoneOptions}
                  value={settings.timeZone}
                  onChange={(next) => updateSetting('timeZone', next)}
                  placeholder="Select or type a time zone"
                />
              </div>
            </label>

            <label className="setting-card">
              <span>Notify before interview</span>
              <div className="setting-card__row">
                <select
                  value={settings.notificationLeadMinutes}
                  onChange={(e) =>
                    updateSetting(
                      'notificationLeadMinutes',
                      Number(e.target.value),
                    )
                  }
                >
                  {NOTIFICATION_LEAD_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <div className="cal-settings__head cal-settings__head--spaced">
              <strong>Filters</strong>
            </div>

            <label className="setting-card">
              <span>Caller</span>
              <div className="setting-card__row">
                <select
                  value={callerFilter}
                  onChange={(e) => setCallerFilter(e.target.value)}
                >
                  <option value="all">All callers</option>
                  {callers.map((caller) => (
                    <option key={caller.id} value={caller.id}>
                      {caller.name || caller.username}
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className="setting-card">
              <span>Invited team member</span>
              <div className="setting-card__row">
                <select
                  value={memberFilter}
                  onChange={(e) => setMemberFilter(e.target.value)}
                >
                  <option value="all">All members</option>
                  {teamMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </div>
        </aside>

        {view === 'month' ? (
          <section className="month-board" aria-label="Month calendar">
            {loading ? <div className="week-board__loading">Loading schedule...</div> : null}
            <div className="month-board__weekdays">
              {WEEKDAYS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="month-board__grid">
              {miniDays.map((day) => {
                const dayItems = visibleInterviews.filter((item) => {
                  const start = new Date(item.start_time);
                  const parts = getTimeZoneParts(start, settings.timeZone);
                  const localDay = new Date(parts.year, parts.month - 1, parts.day);
                  return sameDay(localDay, day.date);
                });
                return (
                  <button
                    key={day.date.toISOString()}
                    type="button"
                    className={[
                      'month-board__cell',
                      day.inMonth ? '' : 'is-muted',
                      sameDay(day.date, selectedDate) ? 'is-selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      setSelectedDate(day.date);
                      setAnchorDate(day.date);
                      setView('day');
                    }}
                  >
                    <span className="month-board__date">{day.date.getDate()}</span>
                    <div className="month-board__events">
                      {dayItems.slice(0, 3).map((item) => {
                        const color = getCallerColor(item.caller_id || item.caller?.id);
                        const memberLabel = [
                          item.invited_member?.name,
                          item.invited_member?.email,
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        const organizer = interviewOrganizerLabel(item);
                        const attendees = interviewAttendeeLabels(item);
                        return (
                          <span
                            key={item.id}
                            className="month-board__chip"
                            style={{
                              background: color.bg,
                              borderLeftColor: color.border,
                              color: color.text,
                            }}
                            title={[
                              item.interview_name,
                              organizer ? `Organizer: ${organizer}` : '',
                              attendees.length
                                ? `Attendees: ${attendees.join(', ')}`
                                : '',
                              memberLabel,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          >
                            {memberLabel
                              ? `${item.interview_name} · ${firstName(item.invited_member?.name) || item.invited_member?.email}`
                              : item.interview_name}
                          </span>
                        );
                      })}
                      {dayItems.length > 3 ? (
                        <span className="month-board__more">+{dayItems.length - 3}</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          <section
            className={`week-board${view === 'day' ? ' week-board--day' : ''}`}
            aria-label={`${view} calendar`}
          >
            {loading ? <div className="week-board__loading">Loading schedule...</div> : null}

            <div className="week-board__scroll">
              <div className="week-board__sticky">
                <div className="week-board__head">
                  <div className="week-board__spacer">{gmtLabel}</div>
                  {boardDays.map((day) => {
                    const isSelected = sameDay(day, selectedDate);
                    const todayInZone = new Date(
                      nowParts.year,
                      nowParts.month - 1,
                      nowParts.day,
                    );
                    const isToday = sameDay(day, todayInZone);
                    return (
                      <div
                        key={day.toISOString()}
                        className={`week-board__dayhead${isToday ? ' is-today' : ''}`}
                      >
                        <span className={isToday ? 'is-today-label' : ''}>
                          {WEEKDAYS[day.getDay()]}
                        </span>
                        <button
                          type="button"
                          className={`week-board__date${isSelected || isToday ? ' is-selected' : ''}`}
                          onClick={() => setSelectedDate(day)}
                        >
                          {day.getDate()}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="week-board__allday">
                  <div className="week-board__allday-label" />
                  {boardDays.map((day) => {
                    const dayHolidays = holidaysOnDay(holidays, day);
                    return (
                      <div key={`allday-${day.toISOString()}`} className="week-board__allday-cell">
                        {dayHolidays.map((holiday) => (
                          <div key={`${holiday.name}-${holiday.date}`} className="holiday-event">
                            {holiday.name}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="week-board__grid">
                <div className="week-board__times">
                  {HOUR_LABELS.map((hour) => (
                    <div key={hour} className="week-board__time">
                      {hour === 0 ? '' : formatHourLabel(hour, settings.timeFormat)}
                    </div>
                  ))}
                </div>

                <div className="week-board__columns">
                  {boardDays.map((day) => {
                    const todayInZone = new Date(
                      nowParts.year,
                      nowParts.month - 1,
                      nowParts.day,
                    );
                    const showNow = sameDay(day, todayInZone);
                    return (
                      <div key={day.toISOString()} className="week-board__column">
                        {DAY_SLOTS.map((slotIndex) => {
                          const minute = (slotIndex * SLOT_MINUTES) % 60;
                          return (
                            <div
                              key={slotIndex}
                              className={`week-board__slot${
                                minute === 0 ? ' is-hour' : ' is-half'
                              }`}
                              aria-hidden="true"
                            />
                          );
                        })}

                        {visibleInterviews
                          .filter((item) => {
                            const start = new Date(item.start_time);
                            const parts = getTimeZoneParts(start, settings.timeZone);
                            const localDay = new Date(
                              parts.year,
                              parts.month - 1,
                              parts.day,
                            );
                            return sameDay(localDay, day);
                          })
                          .map((item) => {
                            const start = new Date(item.start_time);
                            const end = new Date(item.end_time);
                            const startParts = getTimeZoneParts(start, settings.timeZone);
                            const endParts = getTimeZoneParts(end, settings.timeZone);
                            const startMins = startParts.hour * 60 + startParts.minute;
                            const endMins = endParts.hour * 60 + endParts.minute;
                            const top = (startMins / SLOT_MINUTES) * SLOT_HEIGHT;
                            const height = Math.max(
                              ((endMins - startMins) / SLOT_MINUTES) * SLOT_HEIGHT - 4,
                              28,
                            );
                            const color = getCallerColor(
                              item.caller_id || item.caller?.id,
                            );
                            const organizer = interviewOrganizerLabel(item);
                            const attendees = interviewAttendeeLabels(item);
                            const attendeePreview = attendees.slice(0, 2).join(', ');
                            const attendeeMore =
                              attendees.length > 2
                                ? ` +${attendees.length - 2}`
                                : '';

                            return (
                              <article
                                key={item.id}
                                className="week-event"
                                style={{
                                  top: `${top}px`,
                                  height: `${height}px`,
                                  background: color.bg,
                                  borderLeftColor: color.border,
                                  color: color.text,
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedInterview(item);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    setSelectedInterview(item);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                                title={[
                                  item.interview_name,
                                  organizer ? `Organizer: ${organizer}` : '',
                                  attendees.length
                                    ? `Attendees: ${attendees.join(', ')}`
                                    : '',
                                ]
                                  .filter(Boolean)
                                  .join('\n')}
                              >
                                <div className="week-event__top">
                                  <strong style={{ color: color.text }}>
                                    {item.interview_name}
                                  </strong>
                                  <em style={{ color: color.text }}>
                                    {firstName(item.invited_member?.name) || '—'}
                                  </em>
                                </div>
                                {organizer ? (
                                  <span
                                    className="week-event__meta"
                                    style={{ color: color.soft }}
                                  >
                                    Org: {organizer}
                                  </span>
                                ) : null}
                                {attendees.length ? (
                                  <span
                                    className="week-event__meta"
                                    style={{ color: color.soft }}
                                  >
                                    {attendeePreview}
                                    {attendeeMore}
                                  </span>
                                ) : null}
                                <span style={{ color: color.soft }}>
                                  {formatTimeBySetting(
                                    start,
                                    settings.timeFormat,
                                    settings.timeZone,
                                  )}
                                  {' – '}
                                  {formatTimeBySetting(
                                    end,
                                    settings.timeFormat,
                                    settings.timeZone,
                                  )}
                                </span>
                              </article>
                            );
                          })}

                        {showNow ? (
                          <div className="now-indicator" style={{ top: `${nowTop}px` }}>
                            <span className="now-indicator__dot" />
                            <span className="now-indicator__line" />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      <InterviewDetailModal
        interview={selectedInterview}
        settings={settings}
        callers={callers}
        jobs={jobs}
        isAdmin={canEdit}
        onClose={() => setSelectedInterview(null)}
        onSave={handleSaveInterview}
        onCancelBooking={handleCancelBooking}
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        title="Remove from Schedule"
        message={
          selectedInterview
            ? `Remove "${selectedInterview.interview_name}" from Cal.ID? The Google Calendar event is not deleted.`
            : 'Remove this event from Cal.ID?'
        }
        confirmLabel="Remove"
        cancelLabel="Keep"
        busy={cancelBusy}
        onCancel={() => setCancelConfirmOpen(false)}
        onConfirm={confirmCancelBooking}
      />
    </div>
  );
}

function buildMiniMonth(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const start = addDays(first, -first.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const current = addDays(start, i);
    return {
      date: current,
      inMonth: current.getMonth() === month,
    };
  });
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ dir }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export default SchedulePage;
