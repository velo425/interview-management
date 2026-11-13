import { supabase } from './supabase';

const CALLER_SELECT = `
  id,
  name,
  location,
  email,
  whatsapp_number,
  linkedin_url,
  freelancer_profile_url,
  notes,
  active,
  created_at,
  updated_at,
  user:users!callers_id_fkey (
    id,
    username,
    user_id,
    email,
    user_role,
    status
  )
`;

function mapCaller(row) {
  return {
    id: row.id,
    name: row.name || row.user?.username || 'Caller',
    location: row.location || '',
    email: row.email || row.user?.email || '',
    whatsapp_number: row.whatsapp_number || '',
    linkedin_url: row.linkedin_url || '',
    freelancer_profile_url: row.freelancer_profile_url || '',
    notes: row.notes || '',
    active: row.active !== false,
    username: row.user?.username || row.name || 'Caller',
    user_id: row.user?.user_id || '',
    user_role: row.user?.user_role || 'caller',
    status: row.user?.status || 'allowed',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchCallerProfiles({ activeOnly = false } = {}) {
  let query = supabase
    .from('callers')
    .select(CALLER_SELECT)
    .order('name', { ascending: true });

  if (activeOnly) query = query.eq('active', true);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(mapCaller);
}

export async function fetchCallerById(id) {
  const { data, error } = await supabase
    .from('callers')
    .select(CALLER_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? mapCaller(data) : null;
}

export async function updateCallerProfile(id, payload) {
  const { data, error } = await supabase
    .from('callers')
    .update(payload)
    .eq('id', id)
    .select(CALLER_SELECT)
    .single();
  if (error) throw error;
  return mapCaller(data);
}

export async function ensureCallerProfile(user) {
  if (!user?.id) return null;
  const existing = await fetchCallerById(user.id);
  if (existing) return existing;

  const { data, error } = await supabase
    .from('callers')
    .upsert(
      {
        id: user.id,
        active: user.status === 'allowed',
        name: user.username || '',
        email: user.email || '',
      },
      { onConflict: 'id' },
    )
    .select(CALLER_SELECT)
    .single();
  if (error) throw error;
  return mapCaller(data);
}

/**
 * Aggregate interviews per caller for a time window.
 * Returns Map<callerId, { interviewCount, totalMs }>.
 */
export async function fetchCallerInterviewStats({ from, to } = {}) {
  let query = supabase
    .from('interviews')
    .select('caller_id, start_time, end_time')
    .not('caller_id', 'is', null);

  if (from) query = query.gte('start_time', from.toISOString());
  if (to) query = query.lt('start_time', to.toISOString());

  const { data, error } = await query;
  if (error) throw error;

  const stats = new Map();
  for (const row of data || []) {
    const callerId = row.caller_id;
    if (!callerId) continue;
    const start = new Date(row.start_time).getTime();
    const end = new Date(row.end_time).getTime();
    const durationMs =
      Number.isFinite(start) && Number.isFinite(end) && end > start
        ? end - start
        : 0;
    const current = stats.get(callerId) || {
      interviewCount: 0,
      totalMs: 0,
    };
    current.interviewCount += 1;
    current.totalMs += durationMs;
    stats.set(callerId, current);
  }
  return stats;
}

export function getCallerStatsRange(filterId) {
  const now = new Date();
  if (filterId === 'week') {
    const from = new Date(now);
    const day = from.getDay(); // 0 = Sunday
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - day);
    return { from, to: null };
  }
  if (filterId === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to: null };
  }
  return { from: null, to: null };
}

export function formatInterviewDuration(totalMs) {
  const ms = Math.max(0, Number(totalMs) || 0);
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatJoinedAt(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
