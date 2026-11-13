import { useCallback, useEffect, useMemo, useState } from 'react';
import UserMenu from '../../components/dashboard/UserMenu';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { useAuth } from '../../context/AuthContext';
import { CALLER_PRACTICE_LINKS } from '../../lib/callerPracticeLinks';
import {
  fetchCallerInterviewStats,
  fetchCallerProfiles,
  formatInterviewDuration,
  formatJoinedAt,
  getCallerStatsRange,
} from '../../lib/callersApi';
import { canEditWorkspace, isCallerRole } from '../../lib/roles';
import { deleteUserAccount } from '../../lib/usersApi';
import './CallersPage.css';

const TIME_FILTERS = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

function CallersPage() {
  const { profile } = useAuth();
  const canDelete = canEditWorkspace(profile?.user_role);
  const showDirectory = !isCallerRole(profile?.user_role);

  const [callers, setCallers] = useState([]);
  const [statsByCaller, setStatsByCaller] = useState(() => new Map());
  const [timeFilter, setTimeFilter] = useState('week');
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(showDirectory);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!showDirectory) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const range = getCallerStatsRange(timeFilter);
      const [rows, stats] = await Promise.all([
        fetchCallerProfiles({ activeOnly: true }),
        fetchCallerInterviewStats(range),
      ]);
      setCallers(rows.filter((row) => row.status === 'allowed' || !row.status));
      setStatsByCaller(stats);
      setSelectedIds([]);
    } catch (err) {
      setError(err.message || 'Failed to load callers.');
    } finally {
      setLoading(false);
    }
  }, [showDirectory, timeFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const allSelected = useMemo(
    () => callers.length > 0 && selectedIds.length === callers.length,
    [callers, selectedIds],
  );

  const deleteMessage = useMemo(() => {
    const count = selectedIds.length;
    return `Delete ${count} caller${count === 1 ? '' : 's'}? This removes their login and cannot be undone.`;
  }, [selectedIds.length]);

  function toggleCaller(id) {
    if (!canDelete) return;
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  function toggleAll() {
    if (!canDelete) return;
    setSelectedIds(allSelected ? [] : callers.map((caller) => caller.id));
  }

  async function confirmDelete() {
    if (!canDelete || !selectedIds.length) return;
    setBusy(true);
    setError('');
    try {
      for (const id of selectedIds) {
        if (id === profile?.id) {
          throw new Error('You cannot delete your own account.');
        }
        await deleteUserAccount(id);
      }
      setConfirmOpen(false);
      await loadData();
    } catch (err) {
      setError(
        err.message?.includes('foreign key') ||
          err.message?.includes('violates')
          ? 'Cannot delete a caller who is still linked to interviews.'
          : err.message || 'Failed to delete callers.',
      );
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const tableColSpan = canDelete ? 8 : 7;

  return (
    <div className="callers-page">
      <header className="callers-page__header">
        <div>
          <h1>Callers</h1>
          <p>
            Practice links for interview skills and English pronunciation
            {showDirectory ? ', plus the caller directory.' : '.'}
          </p>
        </div>
        <UserMenu />
      </header>

      {error ? <div className="callers-page__error">{error}</div> : null}

      <section className="callers-links" aria-label="Practice links">
        {CALLER_PRACTICE_LINKS.map((panel) => (
          <article key={panel.id} className="callers-link-panel">
            <div className="callers-link-panel__head">
              <span className="callers-link-panel__badge" aria-hidden="true">
                {panel.id === 'ai-interview' ? <AiIcon /> : <MicIcon />}
              </span>
              <div>
                <h2>{panel.title}</h2>
                <p>{panel.description}</p>
              </div>
            </div>
            <ul className="callers-link-panel__list">
              {panel.links.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noreferrer">
                    <span className="callers-link-panel__row-icon" aria-hidden="true">
                      <LinkIcon />
                    </span>
                    <span className="callers-link-panel__row-text">
                      <span className="callers-link-panel__label">{link.label}</span>
                      <span className="callers-link-panel__href">{link.url}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      {showDirectory ? (
        <>
          {loading ? (
            <div className="callers-page__status">Loading callers…</div>
          ) : (
            <section className="callers-panel" aria-label="Caller directory">
              <div className="callers-panel__toolbar">
                <div>
                  <h2>Caller directory</h2>
                  <p>
                    {canDelete
                      ? 'View and remove caller accounts.'
                      : 'View-only caller contact list.'}
                  </p>
                </div>
                <div className="callers-panel__toolbar-right">
                  <div
                    className="callers-filter"
                    role="group"
                    aria-label="Interview time range"
                  >
                    {TIME_FILTERS.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        className={`callers-filter__btn${
                          timeFilter === filter.id ? ' is-active' : ''
                        }`}
                        onClick={() => setTimeFilter(filter.id)}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                  {canDelete ? (
                    <div className="callers-panel__actions">
                      <button
                        type="button"
                        className="callers-btn-danger"
                        disabled={!selectedIds.length || busy}
                        onClick={() => setConfirmOpen(true)}
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <p className="callers-panel__readonly">View only</p>
                  )}
                </div>
              </div>

              <div className="callers-table-wrap">
                <table className="callers-table">
                  <thead>
                    <tr>
                      {canDelete ? (
                        <th className="callers-table__check">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            aria-label="Select all callers"
                          />
                        </th>
                      ) : null}
                      <th>Name</th>
                      <th>Location</th>
                      <th>Email</th>
                      <th>WhatsApp</th>
                      <th>Joined at</th>
                      <th>Interviews</th>
                      <th>Total time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callers.length === 0 ? (
                      <tr>
                        <td colSpan={tableColSpan}>No callers found.</td>
                      </tr>
                    ) : (
                      callers.map((caller) => {
                        const selected = selectedIds.includes(caller.id);
                        const stats = statsByCaller.get(caller.id) || {
                          interviewCount: 0,
                          totalMs: 0,
                        };
                        return (
                          <tr
                            key={caller.id}
                            className={selected ? 'is-selected' : undefined}
                          >
                            {canDelete ? (
                              <td className="callers-table__check">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleCaller(caller.id)}
                                  aria-label={`Select ${caller.name}`}
                                />
                              </td>
                            ) : null}
                            <td>{caller.name || '—'}</td>
                            <td>{caller.location || '—'}</td>
                            <td>
                              {caller.email ? (
                                <a href={`mailto:${caller.email}`}>
                                  {caller.email}
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>{caller.whatsapp_number || '—'}</td>
                            <td>{formatJoinedAt(caller.created_at)}</td>
                            <td>{stats.interviewCount}</td>
                            <td>{formatInterviewDuration(stats.totalMs)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete callers"
        message={deleteMessage}
        confirmLabel={busy ? 'Deleting…' : 'Delete'}
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!busy) setConfirmOpen(false);
        }}
      />
    </div>
  );
}

function AiIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 17v2M16 17v2M9 21h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="9.5" cy="11" r="1.2" fill="currentColor" />
      <circle cx="14.5" cy="11" r="1.2" fill="currentColor" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10 14a4 4 0 0 1 0-5.7l1.4-1.4a4 4 0 0 1 5.7 5.7L16 14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M14 10a4 4 0 0 1 0 5.7l-1.4 1.4a4 4 0 1 1-5.7-5.7L8 10"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default CallersPage;
