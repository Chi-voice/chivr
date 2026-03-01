# Chi Voice — Language Preservation Platform

## Overview
Chi Voice is a web app that helps users contribute to indigenous and minority language preservation by recording themselves speaking AI-generated prompts (words, phrases, sentences). Recordings are stored in Supabase Storage.

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
- Edge Functions: Deno-based (generate-task, get-public-stats, upsert-language)

## Database Schema (Supabase)
- `profiles` — user profiles with display_name, points, total_recordings
- `languages` — language catalog with code, name, is_popular
- `tasks` — recording prompts (english_text, type, difficulty, sequence_order, is_starter_task)
- `recordings` — user audio recordings; includes `sia_cid`, `sia_archived_at`
- `user_task_progress` — per-user per-language progress tracking
- `referrals` — referral tracking with points_awarded

## Edge Functions (Supabase)
- `generate-task` — generates AI tasks via OpenAI GPT-4o-mini
- `get-public-stats` — returns global recording/language/contributor counts
- `upsert-language` — creates or resolves a language by code/name

## Key Files
- `src/integrations/supabase/client.ts` — Supabase client (hardcoded URL + anon key)
- `src/pages/Chat.tsx` — recording chat interface
- `public/glottolog-full.csv` — full Glottolog language database for search

## Dev Workflow
- Workflow "Start application" → `npx vite` — serves the frontend on port 5000

## Replit Migration Notes (from Lovable)
- Removed `lovable-tagger` dev dependency
- Updated `vite.config.ts`: port 5000, host `0.0.0.0`
- Supabase anon key is hardcoded in `src/integrations/supabase/client.ts` (safe — public anon key)
- The Replit PostgreSQL database (`DATABASE_URL`) is not used — all data lives in Supabase
