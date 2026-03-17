-- Add per-type recording counters to user_task_progress for section-based task progression.
-- Section order: Words (0–999) → Phrases (1000–1999) → Sentences (2000+) → repeats.
-- Each section requires 1000 recordings of that type before the next section unlocks.

ALTER TABLE public.user_task_progress
  ADD COLUMN IF NOT EXISTS word_recordings_count     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS phrase_recordings_count   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sentence_recordings_count INTEGER NOT NULL DEFAULT 0;

-- Rebuild update_user_progress to:
--   1. Increment the correct per-type counter (word / phrase / sentence)
--   2. Lower the can_generate_next threshold from 2 recordings → 1 recording
CREATE OR REPLACE FUNCTION public.update_user_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  task_language_id UUID;
  task_type        TEXT;
  points_to_award  INTEGER;
BEGIN
  -- Fetch the task's language and type in one query
  SELECT language_id, type
    INTO task_language_id, task_type
    FROM public.tasks
   WHERE id = NEW.task_id;

  -- Calculate points based on difficulty
  SELECT CASE difficulty
           WHEN 'beginner'     THEN 10
           WHEN 'intermediate' THEN 20
           WHEN 'advanced'     THEN 30
           ELSE 10
         END
    INTO points_to_award
    FROM public.tasks
   WHERE id = NEW.task_id;

  -- Upsert progress row; one recording is now enough to unlock the next task
  INSERT INTO public.user_task_progress (
    user_id, language_id,
    recordings_count, last_recording_at, can_generate_next,
    word_recordings_count, phrase_recordings_count, sentence_recordings_count
  )
  VALUES (
    NEW.user_id, task_language_id,
    1, now(), true,
    CASE WHEN task_type = 'word'     THEN 1 ELSE 0 END,
    CASE WHEN task_type = 'phrase'   THEN 1 ELSE 0 END,
    CASE WHEN task_type = 'sentence' THEN 1 ELSE 0 END
  )
  ON CONFLICT (user_id, language_id) DO UPDATE SET
    recordings_count        = user_task_progress.recordings_count + 1,
    last_recording_at       = now(),
    can_generate_next       = true,
    updated_at              = now(),
    word_recordings_count   = user_task_progress.word_recordings_count +
                              CASE WHEN task_type = 'word'     THEN 1 ELSE 0 END,
    phrase_recordings_count = user_task_progress.phrase_recordings_count +
                              CASE WHEN task_type = 'phrase'   THEN 1 ELSE 0 END,
    sentence_recordings_count = user_task_progress.sentence_recordings_count +
                              CASE WHEN task_type = 'sentence' THEN 1 ELSE 0 END;

  -- Award points to profile
  UPDATE public.profiles
     SET total_recordings = total_recordings + 1,
         points           = points + points_to_award,
         updated_at       = now()
   WHERE id = NEW.user_id;

  RETURN NEW;
END;
$function$;
