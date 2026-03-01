# Chi Voice — Language Preservation Platform

## Overview
Chi Voice is a web app that helps users contribute to indigenous and minority language preservation by recording themselves speaking AI-generated prompts (words, phrases, sentences). Recordings are stored in Supabase Storage and optionally archived to Sia decentralized storage.

## Architecture

**Frontend**: React 18 + Vite 5 + TypeScript, served on port 5000
- Routing: `react-router-dom` v7
- UI: shadcn/ui components + Tailwind CSS
- i18n: `react-i18next` (en, es, fr, ar, ru, zh)
- State/data: `@tanstack/react-query` v5
- Theme: `next-themes` (light/dark)

**Backend**: Supabase (fully managed)
- Auth: Supabase Auth (email/password + Google OAuth)
- Database: Supabase PostgreSQL (with RLS)
- Storage: Supabase Storage (`recordings` bucket, public read)
- Edge Functions: Deno-based serverless functions

**No local Express server** — this is a frontend-only Vite app that communicates directly with Supabase.

## Database Schema (Supabase)
- `profiles` — user profiles with display_name, points, total_recordings
- `languages` — language catalog with code, name, is_popular
- `tasks` — recording prompts (english_text, type, difficulty, sequence_order, is_starter_task)
- `recordings` — user audio recordings linked to tasks; includes sia_cid for decentralized archival
- `user_task_progress` — per-user per-language progress tracking
- `referrals` — referral tracking with points_awarded

## Edge Functions (Supabase)
- `generate-task` — generates AI tasks via OpenAI GPT-4o-mini
- `get-public-stats` — returns global recording/language/contributor counts
- `upsert-language` — creates or resolves a language by code/name
- `archive-to-sia` — archives recordings to Sia decentralized storage via S5

## Key Files
- `src/integrations/supabase/client.ts` — Supabase client (hardcoded URL + anon key)
- `src/pages/Index.tsx` — landing page with language list
- `src/pages/Auth.tsx` — authentication (email + Google)
- `src/pages/Chat.tsx` — recording chat interface per language
- `src/pages/Chats.tsx` — list of active language chats
- `src/pages/Profile.tsx` — user profile + stats + referral link
- `src/components/AudioRecorder.tsx` — browser MediaRecorder-based audio capture
- `src/components/RecordingModal.tsx` — modal for recording + submitting
- `public/glottolog-full.csv` — full Glottolog language database for search
- `src/data/glottolog-subset.json` — smaller subset of Glottolog for faster loading

## Dev Workflow
- `npm run dev` — starts Vite dev server on port 5000
- Workflow: "Start application" runs `npm run dev`

## Replit Migration Notes (from Lovable)
- Removed `lovable-tagger` dev dependency
- Updated `vite.config.ts`: port changed to 5000, host set to `0.0.0.0`, removed lovable-tagger plugin
- Supabase credentials are hardcoded in `src/integrations/supabase/client.ts` (anon key, public URL — safe to expose)
- The Replit PostgreSQL database (via `DATABASE_URL`) is not used — all data lives in Supabase
