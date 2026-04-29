-- Fix: duplicate trigger on recordings table caused all counters to be incremented twice.
--
-- Root cause: `on_recording_created` (created July 2025) was never dropped when
-- `trg_update_user_progress` was added in August 2025 to replace it. Both triggers
-- called `update_user_progress()` on every INSERT, doubling:
--   - profiles.total_recordings
--   - profiles.points
--   - user_task_progress.recordings_count
--
-- Fix:
--   1. Drop the original (superseded) trigger.
--   2. Backfill profiles.total_recordings from actual recordings table.
--   3. Backfill user_task_progress.recordings_count from actual recordings.

-- Step 1: Remove the duplicate trigger
DROP TRIGGER IF EXISTS on_recording_created ON public.recordings;

-- Step 2: Correct profiles.total_recordings to match actual recording count
UPDATE public.profiles p
SET total_recordings = (
  SELECT COUNT(*) FROM public.recordings r WHERE r.user_id = p.id
),
updated_at = now()
WHERE EXISTS (SELECT 1 FROM public.recordings r WHERE r.user_id = p.id);

-- Step 3: Correct user_task_progress.recordings_count per user+language
UPDATE public.user_task_progress utp
SET recordings_count = (
  SELECT COUNT(*)
  FROM public.recordings r
  JOIN public.tasks t ON t.id = r.task_id
  WHERE r.user_id = utp.user_id
    AND t.language_id = utp.language_id
),
updated_at = now();
