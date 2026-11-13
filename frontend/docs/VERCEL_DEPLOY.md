# Deploy Cal.ID to Vercel

## Architecture

- **Frontend:** Vite + React SPA (`dist/`)
- **API:** Same `/api/*` routes as local Vite middleware, served as a Vercel Node Function (`api/[...path].js`)
- **Database / Auth:** Existing Supabase project (unchanged)

## Project settings

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Framework | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node | 20.x or 22.x |

## Environment variables (names only)

Set these in Vercel → Project → Settings → Environment Variables for **Preview** and **Production**:

| Name | Client-visible? | Notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | Existing Supabase URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Anon / publishable key |
| `SUPABASE_SECRET_KEY` | **No** | Service role / secret key |
| `GOOGLE_CLIENT_ID` | **No** | OAuth client |
| `GOOGLE_CLIENT_SECRET` | **No** | OAuth secret |
| `GOOGLE_AUTH_URI` | **No** | Optional; default Google auth URI |
| `GOOGLE_TOKEN_URI` | **No** | Optional |
| `GOOGLE_CERT_URL` | **No** | Optional |
| `GOOGLE_REFRESH_TOKEN` | **No** | Drive refresh token |
| `GOOGLE_DRIVE_FOLDER_NAME` | **No** | Default folder name |
| `GMAIL_TOKEN_SECRET` | **No** | AES key for stored Gmail tokens |
| `APP_ORIGIN` | **No** | e.g. `https://<project>.vercel.app` |
| `GMAIL_OAUTH_REDIRECT_URI` | **No** | `https://<project>.vercel.app/api/gmail/oauth/callback` |

Never prefix secrets with `VITE_`.

## Google Cloud Console

Keep localhost entries for local dev. Add production:

**Authorized JavaScript origins**

- `https://cal-id.vercel.app`
- `https://*-vladimiroradi-1446s-projects.vercel.app` (if Google allows wildcard; otherwise add each preview URL you test)
- Keep existing `http://localhost:5173`

**Authorized redirect URIs**

- `https://cal-id.vercel.app/api/gmail/oauth/callback`
- Preview (add when testing OAuth on a specific preview): `https://<preview-host>/api/gmail/oauth/callback`
- Keep existing `http://localhost:5173/api/gmail/oauth/callback`

(Drive desktop/loopback OAuth used by the upload helper can stay as-is if unchanged.)

After changing redirect URIs, reconnect Gmail only if Google rejects the existing refresh tokens (usually not required when only adding a new redirect URI).

## Limits (Hobby)

- Serverless `maxDuration` is **60s**. Large Gmail **Full sync** or Drive uploads may need multiple requests / retries.
- In-memory sync locks and rate limiters do not span multiple serverless instances.

## Deploy flow

1. Preview deploy first.
2. Set env vars + Google redirect URIs.
3. Verify Schedule / Mail / Drive / Auth on the preview URL.
4. Promote to production only after explicit approval.
