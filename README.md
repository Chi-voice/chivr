# Chi Voice

A community-driven language preservation platform where people record themselves speaking AI-generated prompts — words, phrases, and sentences — in any of 7,000+ languages from around the world. Every recording is saved to Supabase Storage and automatically archived to decentralised Sia storage via the S5 protocol, ensuring long-term access independent of any single provider.

---

## What it does

- **Language selection** — search across the full Glottolog database of 7,000+ languages, from global majors to endangered indigenous tongues
- **AI-generated prompts** — GPT-4o-mini creates contextually appropriate words, phrases, and sentences tailored to each language and difficulty level
- **In-browser recording** — record directly in the browser with no app install required; recordings are played back before submission
- **Decentralised archival** — every recording is content-addressed and archived to your own S5/Sia portal alongside structured metadata JSON, with CIDs written back to the database
- **Points & progress** — earn points per recording; track contributions per language
- **Referrals** — shareable referral links that award points on signup
- **Multilingual UI** — interface available in English, Spanish, French, Arabic, Russian, and Chinese
- **Dark mode** — full light/dark theme support

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, TypeScript |
| UI | shadcn/ui, Tailwind CSS, Radix UI |
| Routing | react-router-dom v7 |
| Data fetching | TanStack Query v5 |
| i18n | react-i18next |
| Auth | Supabase Auth (email/password + Google OAuth) |
| Database | Supabase PostgreSQL (with RLS) |
| Storage | Supabase Storage |
| AI tasks | OpenAI GPT-4o-mini via Supabase Edge Function |
| Archival | S5/Sia (`@julesl23/s5js`), Express.js on Node.js |
| PWA | Web App Manifest + Service Worker |

---

## Architecture

Browser (React + Vite, port 5000)
│
├── /api/* ──► Express server (port 3001, tsx)
│ └── POST /api/archive
│ ├── Downloads audio from Supabase Storage
│ ├── uploadBlob(audio) ──► S5 portal (HTTP)
│ ├── uploadBlob(metadata JSON) ──► S5 portal
│ └── Updates recordings row (sia_cid, sia_metadata_cid)
│
└── Supabase
├── Auth
├── PostgreSQL (recordings, languages, tasks, profiles, referrals)
├── Storage (recordings bucket)
└── Edge Functions (generate-task, get-public-stats, upsert-language)


### Recording flow

1. User selects a language → `generate-task` edge function creates a prompt via GPT-4o-mini
2. User records audio in the browser → uploaded to Supabase Storage
3. Recording row inserted in the database
4. `archiveToS5()` called fire-and-forget (non-blocking — no UX impact)
5. Express server uploads audio + metadata to the S5 portal; CIDs written back to the row

---

## Database schema

| Table | Purpose |
|-------|---------|
| `profiles` | User display name, avatar, points, total recordings |
| `languages` | Language catalog (name, ISO/Glottolog code, popularity flag) |
| `tasks` | AI-generated prompts (text, type, difficulty, sequence order) |
| `recordings` | User recordings with Supabase Storage URL and S5 archival CIDs |
| `user_task_progress` | Per-user per-language completion tracking |
| `referrals` | Referral links and points awarded on signup |

Key columns on `recordings`:

```sql
sia_cid           TEXT   -- S5 CID of the audio blob
sia_metadata_cid  TEXT   -- S5 CID of the metadata JSON blob
sia_archived_at   TIMESTAMPTZ

Supabase Edge Functions
Function	Description
generate-task	Creates a word/phrase/sentence prompt via GPT-4o-mini for a given language
get-public-stats	Returns live counts of recordings, languages, and contributors
upsert-language	Creates or resolves a language by Glottolog code + name

#### Project Structure
├── src/
│   ├── pages/
│   │   ├── Index.tsx          # Home — language search + live stats
│   │   ├── Chat.tsx           # Recording interface
│   │   ├── Chats.tsx          # Recording history
│   │   ├── Profile.tsx        # User profile + points
│   │   └── Auth.tsx           # Sign in / sign up
│   ├── components/            # Shared UI components
│   ├── i18n/locales/          # en, es, fr, ar, ru, zh translations
│   ├── integrations/supabase/ # Supabase client + generated types
│   └── lib/s5Archive.ts       # Frontend helper for archival
│
├── server/
│   ├── index.ts               # Express API server (port 3001)
│   ├── routes/archive.ts      # POST /api/archive
│   └── services/
│       ├── s5Client.ts        # Lazy S5 singleton (BIP39 identity + portal auth)
│       └── nodeKvStore.ts     # FileKvStore + MemoryKvStore for Node.js
│
├── supabase/
│   ├── functions/             # Deno edge functions
│   └── migrations/            # PostgreSQL migrations
│
└── public/
    └── glottolog-full.csv     # Full Glottolog language database (~7,000 entries)

#### Getting started
Prerequisites
Node.js 20+
A Supabase project
An OpenAI API key (set as a Supabase secret named OPENAI_API_KEY)
An S5-compatible portal (e.g. self-hosted S5 node) for archival
A standard 12-word BIP39 seed phrase for your S5 identity
Environment variables
Create a .env file at the project root:

# Supabase (server-side — keep secret)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# S5 / Sia archival
S5_SEED_PHRASE=your twelve word bip39 seed phrase here
S5_PORTAL_URL=https://your-s5-portal.example.com
S5_INITIAL_PEERS=wss://z2D...@peer.example.com/s5/p2p

The Supabase anon key and URL are also hardcoded in src/integrations/supabase/client.ts for the frontend — this is intentional and safe (anon key is public by design).

Database setup
Apply all migrations in supabase/migrations/ to your Supabase project via the SQL editor or Supabase CLI:

supabase db push
The S5 archival columns are added by:

20260223164119_… — adds sia_cid, sia_archived_at
20260301000000_add_sia_metadata_cid.sql — adds sia_metadata_cid
Running locally
npm install
# Start both the Vite frontend (port 5000) and Express server (port 3001)
npx concurrently "npx vite" "npx tsx server/index.ts"
Vite proxies all /api/* requests to the Express server automatically.

S5 / Sia archival — how it works
The S5 integration uses the @julesl23/s5js SDK running on the Express server (Node.js). Browser-based WebRTC and IndexedDB APIs are not available server-side, so the integration uses custom KV store adapters:

FileKvStore — persists identity and auth tokens to .s5data/ so portal registration only runs once
MemoryKvStore — volatile in-memory store for P2P blob/registry data
BIP39 identity — the SDK normally requires a 15-word Skynet-format phrase. buildIdentityFromBip39() derives a valid S5UserIdentity directly from standard 12-word BIP39 entropy using the same internal deriveHashInt key-derivation chain.

Upload strategy — uploadBlob() is used directly instead of the SDK's fs.put() filesystem layer. This sends files straight to the portal over HTTP without needing P2P directory resolution. cachedOnlyMode = true is kept on permanently to prevent registry lookups from blocking on existing network data.

Contributing
Contributions are welcome — especially recordings of underrepresented languages. Please open an issue before starting significant work.

Licence
MIT

