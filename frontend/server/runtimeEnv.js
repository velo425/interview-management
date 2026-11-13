import { readEnvFile, withGoogleEnvFile } from './googleOAuthConfig.js';

/**
 * Server env for Vite middleware (local) and Vercel Functions (production).
 * On Vercel, process.env is the source of truth.
 * Locally, merge frontend/.env so middleware has Supabase + Google keys without importing Vite.
 */
export function getRuntimeEnv(extra = null) {
  if (process.env.VERCEL) {
    return { ...process.env };
  }
  const fileEnv = readEnvFile(process.cwd());
  const merged = {
    ...process.env,
    ...fileEnv,
    ...(extra && typeof extra === 'object' ? extra : {}),
  };
  return withGoogleEnvFile(merged);
}
