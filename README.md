# Chi Voice — Language Preservation Platform

## Overview
Chi Voice is a web app that helps users contribute to indigenous and minority language preservation by recording themselves speaking AI-generated prompts (words, phrases, sentences). Recordings are stored in Supabase Storage and archived to Sia decentralised storage via the S5 protocol.

## Architecture

**Frontend**: React 18 + Vite 5 + TypeScript, served on port 5000
- Routing: `react-router-dom` v7
- UI: shadcn/ui components + Tailwind CSS
- i18n: `react-i18next` (en, es, fr, ar, ru, zh)
- State/data: `@tanstack/react-query` v5
- Theme: `next-themes` (light/dark)

**API Server**: Express on port 3001 (Node.js 20, tsx)
- Proxied through Vite at `/api/*`
- Handles S5/Sia archival (requires `@julesl23/s5js`)
- Reads `S5_SEED_PHRASE`, `S5_PORTAL_URL`, `SUPABASE_SERVICE_ROLE_KEY` from env

**Backend**: Supabase (fully managed)
- Auth: Supabase Auth (email/password + Google OAuth)
- Database: Supabase PostgreSQL (with RLS)
- Storage: Supabase Storage (`recordings` bucket, public read)
- Edge Functions: Deno-based (generate-task, get-public-stats, upsert-language)

## S5 / Sia Archival Flow   WORKING

1. User records audio → uploaded to Supabase Storage (unchanged)
2. Recording row inserted in Supabase DB
3. Frontend calls `POST /api/archive` (fire-and-forget, non-blocking)
4. Express server:
   - Downloads audio from Supabase public URL
   - Calls `apiWithIdentity.uploadBlob()` to upload audio directly to the S5 portal via HTTP
   - Calls `apiWithIdentity.uploadBlob()` to upload metadata JSON to S5
   - Updates `recordings` row with `sia_cid`, `sia_metadata_cid`, `sia_archived_at`
   - Falls back gracefully if `sia_metadata_cid` column is missing

### S5 Init Strategy (important)
- `buildIdentityFromBip39()` derives `S5UserIdentity` from 12-word BIP39 mnemonic using `mnemonicToEntropy` → Blake3 → `deriveHashInt` chain (bypasses SDK's 15-word-only validator)
- `(node as any).registry.cachedOnlyMode = true` is kept **permanently** to prevent P2P registry lookups from triggering `downloadBlobAsBytes` infinite loops
- Identity pack and portal auth tokens are persisted in `FileKvStore` (`.s5data/`) so registration only happens on first startup
- S5 client is a lazy singleton — init happens on first `/api/archive` request, then cached

### Pending Supabase Migration
The `sia_metadata_cid TEXT` column needs to be applied via the Supabase dashboard SQL editor:
```sql
ALTER TABLE public.recordings ADD COLUMN IF NOT EXISTS sia_metadata_cid TEXT;
```
Until applied, the code falls back to updating only `sia_cid` and `sia_archived_at`.

## Database Schema (Supabase)
- `profiles` — user profiles with display_name, points, total_recordings
- `languages` — language catalog with code, name, is_popular
- `tasks` — recording prompts (english_text, type, difficulty, sequence_order, is_starter_task)
- `recordings` — user audio recordings; includes `sia_cid`, `sia_metadata_cid`, `sia_archived_at`
- `user_task_progress` — per-user per-language progress tracking
- `referrals` — referral tracking with points_awarded

## Edge Functions (Supabase)
- `generate-task` — generates AI tasks via OpenAI GPT-4o-mini
- `get-public-stats` — returns global recording/language/contributor counts
- `upsert-language` — creates or resolves a language by code/name
- `archive-to-sia` — legacy raw-HTTP archival (superseded by `/api/archive`)

## Key Files
- `src/integrations/supabase/client.ts` — Supabase client (hardcoded URL + anon key)
- `src/lib/s5Archive.ts` — frontend helper that calls `POST /api/archive`
- `src/pages/Chat.tsx` — recording chat interface; triggers S5 archival after each recording
- `server/index.ts` — Express API server (port 3001)
- `server/services/s5Client.ts` — lazy S5 client singleton using `@julesl23/s5js`
- `server/routes/archive.ts` — `POST /api/archive` endpoint
- `public/glottolog-full.csv` — full Glottolog language database for search

## Required Environment Secrets
| Secret | Description |
|--------|-------------|
| `S5_SEED_PHRASE` | 12-word seed phrase for S5 identity (generate once, never change) |
| `S5_PORTAL_URL` | S5 portal URL, e.g. `https://s5.vup.cx` |
| `S5_INITIAL_PEERS` | Comma-separated WebSocket peer URIs for P2P bootstrap |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side RLS bypass for DB updates) |

## Dev Workflow
- `npm run dev` → starts Vite on port 5000 (frontend only)
- Workflow "Start application" → `npx concurrently "npx vite" "npx tsx server/index.ts"` (both servers)
- Vite proxies `/api/*` to Express on port 3001
