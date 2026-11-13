import {
  fetchTokenScopes,
  getGmailOAuthConfig,
  refreshAccessToken,
  tokenHasCalendarScope,
} from './gmailClient.js';
import { syncCalendarWindow } from './googleCalendar.js';
import { getRuntimeEnv } from './runtimeEnv.js';
import { decryptSecret, encryptSecret } from './tokenCrypto.js';

const DEFAULT_STAGE = 'Initial Recruiter Screening';
const DEFAULT_REMINDER = 30;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function getBearer(req, body = {}) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return body.accessToken || '';
}

function serviceClient(env) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw Object.assign(
      new Error('Set SUPABASE_SECRET_KEY in frontend/.env.'),
      { status: 500 },
    );
  }
  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  };
}

async function sbRequest(url, headers, path, options = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message =
      data?.message ||
      data?.error_description ||
      data?.error ||
      text ||
      'Supabase error';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}

async function sb(env, path, options = {}) {
  const { url, headers } = serviceClient(env);
  return sbRequest(url, headers, path, options);
}

/** Interview writes as the signed-in admin so DB triggers see auth.uid()/is_allowed_admin(). */
async function sbAsUser(env, accessToken, path, options = {}) {
  const url = env.VITE_SUPABASE_URL;
  const anon = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon || !accessToken) {
    throw Object.assign(new Error('Missing Supabase user credentials.'), {
      status: 500,
    });
  }
  return sbRequest(
    url,
    {
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    path,
    options,
  );
}

async function assertAdmin(env, accessToken) {
  if (!accessToken) {
    throw Object.assign(new Error('Missing access token.'), { status: 401 });
  }
  const url = env.VITE_SUPABASE_URL;
  const anon = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${accessToken}` },
  });
  const authUser = await userRes.json().catch(() => ({}));
  if (!userRes.ok || !authUser?.id) {
    throw Object.assign(new Error('Invalid session.'), { status: 401 });
  }
  const profiles = await sb(
    env,
    `users?id=eq.${authUser.id}&select=id,user_role,status`,
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile || profile.status !== 'allowed' || profile.user_role !== 'admin') {
    throw Object.assign(
      new Error('Only admins can sync Google Calendar.'),
      { status: 403 },
    );
  }
  return profile;
}

async function getAccountAccessToken(env, accountId) {
  const cfg = getGmailOAuthConfig(env);
  const secrets = await sb(
    env,
    `gmail_account_secrets?gmail_account_id=eq.${accountId}&select=*`,
  );
  const secret = Array.isArray(secrets) ? secrets[0] : null;
  if (!secret?.refresh_token_enc) {
    throw Object.assign(
      new Error('Gmail account is missing OAuth credentials. Reconnect Gmail.'),
      { status: 400 },
    );
  }
  const refreshToken = decryptSecret(secret.refresh_token_enc, cfg.tokenSecret);
  const now = Date.now();
  if (
    secret.access_token_enc &&
    secret.access_token_expires_at &&
    new Date(secret.access_token_expires_at).getTime() > now + 60_000
  ) {
    return decryptSecret(secret.access_token_enc, cfg.tokenSecret);
  }
  const refreshed = await refreshAccessToken(env, refreshToken);
  const expiresAt = new Date(
    Date.now() + Number(refreshed.expires_in || 3600) * 1000,
  ).toISOString();
  await sb(env, `gmail_account_secrets?gmail_account_id=eq.${accountId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      access_token_enc: encryptSecret(refreshed.access_token, cfg.tokenSecret),
      access_token_expires_at: expiresAt,
      ...(refreshed.refresh_token
        ? {
            refresh_token_enc: encryptSecret(
              refreshed.refresh_token,
              cfg.tokenSecret,
            ),
          }
        : {}),
    }),
  });
  return refreshed.access_token;
}

async function findExistingCalendarInterview(env, account, googleEventId) {
  const encodedId = encodeURIComponent(googleEventId);

  // Prefer the exact account + event pair.
  const byAccount = await sb(
    env,
    `interviews?gmail_account_id=eq.${account.id}&google_event_id=eq.${encodedId}&select=id&limit=1`,
  );
  if (Array.isArray(byAccount) && byAccount[0]?.id) {
    return byAccount[0].id;
  }

  // Legacy / mismatched rows may have the event id without gmail_account_id.
  const byEvent = await sb(
    env,
    `interviews?google_event_id=eq.${encodedId}&select=id,gmail_account_id&order=created_at.asc`,
  );
  if (!Array.isArray(byEvent) || !byEvent.length) return null;

  const sameAccount = byEvent.find((row) => row.gmail_account_id === account.id);
  return (sameAccount || byEvent[0])?.id || null;
}

async function upsertCalendarEvent(env, {
  account,
  event,
  createdBy,
  accessToken,
}) {
  if (!event?.googleEventId || !account?.id || !account.team_member_id) {
    return { skipped: true };
  }

  const existingId = await findExistingCalendarInterview(
    env,
    account,
    event.googleEventId,
  );
  // Prefer admin JWT for writes so restrict_caller_interview_updates allows them.
  const write = (path, options) =>
    accessToken
      ? sbAsUser(env, accessToken, path, options)
      : sb(env, path, options);

  if (event.cancelled) {
    if (existingId) {
      await write(`interviews?id=eq.${existingId}`, { method: 'DELETE' });
      return { deleted: true };
    }
    return { skipped: true };
  }

  const googleFields = {
    interview_name: event.interviewName,
    meeting_link: event.meetingLink || '',
    start_time: event.startTime,
    end_time: event.endTime,
    google_event_data: event.googleEventData || {},
    source: 'google_calendar',
    invited_member_id: account.team_member_id,
    google_event_id: event.googleEventId,
    gmail_account_id: account.id,
  };

  if (existingId) {
    // Refresh Google-sourced fields only; keep app enrichment (caller/job/stage/reminder).
    const patched = await write(`interviews?id=eq.${existingId}`, {
      method: 'PATCH',
      body: JSON.stringify(googleFields),
    });
    if (!Array.isArray(patched) || !patched.length) {
      throw Object.assign(
        new Error(`Failed to update calendar event ${event.googleEventId}.`),
        { status: 502 },
      );
    }
    return { updated: true };
  }

  await write('interviews', {
    method: 'POST',
    body: JSON.stringify({
      ...googleFields,
      caller_id: null,
      job_id: null,
      job_title: '',
      company_name: '',
      stage: DEFAULT_STAGE,
      reminder_minutes: DEFAULT_REMINDER,
      created_by: createdBy,
    }),
  });
  return { created: true };
}

async function syncAccountCalendar(env, account, createdBy, window, accessToken) {
  const token = await getAccountAccessToken(env, account.id);
  // tokeninfo can flake; only hard-fail when it clearly returns scopes without Calendar.
  try {
    const { scopes, payload } = await fetchTokenScopes(token);
    if (scopes.length > 0 && !tokenHasCalendarScope(scopes)) {
      throw Object.assign(
        new Error(
          'Token has no Calendar scope. Reconnect this account and approve Google Calendar access (scope .../auth/calendar).',
        ),
        { status: 403, payload },
      );
    }
  } catch (scopeErr) {
    if (scopeErr.status === 403) throw scopeErr;
    // Proceed — Calendar API will return the real error if access is missing.
  }
  let events;
  try {
    events = await syncCalendarWindow(token, window);
  } catch (calErr) {
    const detail = String(calErr.message || '');
    const lower = detail.toLowerCase();
    if (
      calErr.status === 403 ||
      lower.includes('insufficient') ||
      lower.includes('access not configured') ||
      lower.includes('has not been used') ||
      lower.includes('disabled')
    ) {
      throw Object.assign(
        new Error(
          `${detail} Enable Google Calendar API in Cloud Console, confirm OAuth consent includes .../auth/calendar, then Reconnect this Gmail account.`,
        ),
        { status: 403 },
      );
    }
    throw calErr;
  }
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let skipped = 0;
  for (const event of events) {
    const result = await upsertCalendarEvent(env, {
      account,
      event,
      createdBy,
      accessToken,
    });
    if (result.created) created += 1;
    else if (result.updated) updated += 1;
    else if (result.deleted) deleted += 1;
    else skipped += 1;
  }
  return {
    accountId: account.id,
    gmailAddress: account.gmail_address,
    teamMemberId: account.team_member_id,
    events: events.length,
    created,
    updated,
    deleted,
    skipped,
  };
}

export function createCalendarMiddleware(getEnv = getRuntimeEnv) {
  return async function calendarMiddleware(req, res, next) {
    const env = getEnv();
    const rawUrl = req.url || '';
    const path = rawUrl.split('?')[0];
    if (!path.startsWith('/api/calendar')) {
      return next();
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      const body =
        req.method === 'GET' || req.method === 'HEAD'
          ? {}
          : await readJsonBody(req);
      const accessToken = getBearer(req, body);
      const profile = await assertAdmin(env, accessToken);

      if (path === '/api/calendar/sync' && req.method === 'POST') {
        const daysBack = Math.min(30, Math.max(1, Number(body.daysBack) || 7));
        const daysForward = Math.min(
          180,
          Math.max(7, Number(body.daysForward) || 60),
        );
        const now = Date.now();
        const window = {
          timeMin: new Date(now - daysBack * 24 * 60 * 60 * 1000),
          timeMax: new Date(now + daysForward * 24 * 60 * 60 * 1000),
        };

        const accounts = await sb(
          env,
          'gmail_accounts?account_kind=eq.member&status=neq.revoked&select=id,team_member_id,gmail_address,status',
        );
        const list = Array.isArray(accounts) ? accounts : [];
        const connected = list.filter(
          (row) => row.status === 'connected' || row.status === 'error',
        );

        const results = [];
        for (const account of connected) {
          if (!account.team_member_id) {
            results.push({
              accountId: account.id,
              gmailAddress: account.gmail_address,
              error: 'Account is not linked to a team member.',
            });
            continue;
          }
          try {
            const result = await syncAccountCalendar(
              env,
              account,
              profile.id,
              window,
              accessToken,
            );
            results.push(result);
          } catch (err) {
            results.push({
              accountId: account.id,
              gmailAddress: account.gmail_address,
              teamMemberId: account.team_member_id,
              error: err.message || 'Calendar sync failed.',
            });
          }
        }

        const failed = results.filter((row) => row.error);
        sendJson(res, failed.length && failed.length === results.length ? 207 : 200, {
          data: {
            success: failed.length === 0,
            accounts: connected.length,
            results,
          },
        });
        return;
      }

      sendJson(res, 404, { error: 'Unknown Calendar API route.' });
    } catch (err) {
      sendJson(res, err.status || 500, {
        error: err.message || 'Calendar request failed.',
      });
    }
  };
}

export function calendarPlugin() {
  return {
    name: 'google-calendar-api',
    configureServer(server) {
      server.middlewares.use(
        createCalendarMiddleware(() => getRuntimeEnv()),
      );
    },
  };
}
