/**
 * Slim interviews.google_event_data to organizer/creator/attendees via service role.
 * Does not drop columns (use optimize_interview_columns.sql for that).
 *
 * Usage from frontend/:
 *   node ../supabase/slim_google_event_data.js
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require(
  path.join(__dirname, '../frontend/node_modules/@supabase/supabase-js'),
);

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = {
  ...loadEnv(path.join(__dirname, '../frontend/.env')),
  ...process.env,
};

const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SECRET_KEY');
  process.exit(1);
}

function slim(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const next = {};
  if (data.organizer && typeof data.organizer === 'object') next.organizer = data.organizer;
  if (data.creator && typeof data.creator === 'object') next.creator = data.creator;
  if (Array.isArray(data.attendees)) next.attendees = data.attendees;
  return next;
}

async function main() {
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const pageSize = 200;
  let from = 0;
  let updated = 0;
  let scanned = 0;

  for (;;) {
    const { data, error } = await sb
      .from('interviews')
      .select('id, google_event_data')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data?.length) break;

    for (const row of data) {
      scanned += 1;
      const next = slim(row.google_event_data);
      const before = JSON.stringify(row.google_event_data || {});
      const after = JSON.stringify(next);
      if (before === after) continue;
      const { error: upErr } = await sb
        .from('interviews')
        .update({ google_event_data: next })
        .eq('id', row.id);
      if (upErr) throw upErr;
      updated += 1;
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`Scanned ${scanned} interviews; slimmed ${updated}.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
