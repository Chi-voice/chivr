-- Fix: Top user accidentally recorded in Erie (erie1238) instead of Erei (erei1238).
-- Erie was created 2026-04-24 and was used exclusively by this one user.
-- No other users had any data in Erie.
--
-- Steps:
--   1. Move all Erie tasks to Erei (recordings point to task IDs, so they follow automatically).
--   2. Recompute the user's Erei progress row from actual recordings.
--   3. Delete the now-empty Erie progress row.
--   4. Delete the now-empty Erie language entry.

-- Identifiers (for reference)
-- Erie language id  : b5dbd831-5f8a-47f2-ab61-2c22f0c9f961  (erie1238)
-- Erei language id  : afcf6fb2-5f60-4d2b-a5cc-36e5f2d56bf5  (erei1238)
-- Affected user id  : 7663ca86-9873-46df-b8f2-6cf39526ac23

-- Step 1: Re-point all Erie tasks to Erei
UPDATE public.tasks
SET language_id = 'afcf6fb2-5f60-4d2b-a5cc-36e5f2d56bf5'
WHERE language_id = 'b5dbd831-5f8a-47f2-ab61-2c22f0c9f961';

-- Step 2: Recompute Erei progress for the user from actual recordings
UPDATE public.user_task_progress utp
SET
  recordings_count          = (SELECT COUNT(*) FROM public.recordings r JOIN public.tasks t ON t.id = r.task_id WHERE r.user_id = '7663ca86-9873-46df-b8f2-6cf39526ac23' AND t.language_id = 'afcf6fb2-5f60-4d2b-a5cc-36e5f2d56bf5'),
  word_recordings_count     = (SELECT COUNT(*) FROM public.recordings r JOIN public.tasks t ON t.id = r.task_id WHERE r.user_id = '7663ca86-9873-46df-b8f2-6cf39526ac23' AND t.language_id = 'afcf6fb2-5f60-4d2b-a5cc-36e5f2d56bf5' AND t.type = 'word'),
  phrase_recordings_count   = (SELECT COUNT(*) FROM public.recordings r JOIN public.tasks t ON t.id = r.task_id WHERE r.user_id = '7663ca86-9873-46df-b8f2-6cf39526ac23' AND t.language_id = 'afcf6fb2-5f60-4d2b-a5cc-36e5f2d56bf5' AND t.type = 'phrase'),
  sentence_recordings_count = (SELECT COUNT(*) FROM public.recordings r JOIN public.tasks t ON t.id = r.task_id WHERE r.user_id = '7663ca86-9873-46df-b8f2-6cf39526ac23' AND t.language_id = 'afcf6fb2-5f60-4d2b-a5cc-36e5f2d56bf5' AND t.type = 'sentence'),
  can_generate_next         = true,
  updated_at                = now()
WHERE user_id    = '7663ca86-9873-46df-b8f2-6cf39526ac23'
  AND language_id = 'afcf6fb2-5f60-4d2b-a5cc-36e5f2d56bf5';

-- Step 3: Remove the stale Erie progress row for this user
DELETE FROM public.user_task_progress
WHERE user_id    = '7663ca86-9873-46df-b8f2-6cf39526ac23'
  AND language_id = 'b5dbd831-5f8a-47f2-ab61-2c22f0c9f961';

-- Step 4: Remove the now-empty Erie language
DELETE FROM public.languages
WHERE id = 'b5dbd831-5f8a-47f2-ab61-2c22f0c9f961';
