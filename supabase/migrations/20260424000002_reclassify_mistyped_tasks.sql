-- Fix: tasks saved with type='word' that actually contain phrases or sentences.
--
-- Root cause: pickUniqueFallback() in the generate-task edge function always fell
-- back to makeFallbackCandidate('phrase') when it exhausted valid word candidates,
-- but saveTask() still used randomType ('word') for the DB insert. This caused
-- phrases and sentences to be stored with type='word'.
--
-- The same bug applied to sentence tasks: when the sentence fallback pool was
-- exhausted, it fell back to phrases which were then saved as type='sentence'.
--
-- Fix applied to generate-task edge function (2026-04-24): pickUniqueFallback now
-- uses type-safe hardcoded defaults and never crosses type boundaries.
--
-- This migration corrects existing misclassified rows.

-- word tasks that are actually phrases (multi-word but ≤ 3 words)
UPDATE public.tasks
SET type = 'phrase'
WHERE type = 'word'
  AND english_text LIKE '% %'
  AND array_length(string_to_array(trim(english_text), ' '), 1) <= 3;

-- word tasks that are actually sentences (≥ 4 words)
UPDATE public.tasks
SET type = 'sentence'
WHERE type = 'word'
  AND english_text LIKE '% %'
  AND array_length(string_to_array(trim(english_text), ' '), 1) >= 4;

-- sentence tasks that are too short to be sentences (≤ 3 words → phrase)
UPDATE public.tasks
SET type = 'phrase'
WHERE type = 'sentence'
  AND array_length(string_to_array(trim(english_text), ' '), 1) <= 3;

-- Recompute section progress for all affected users (word/phrase/sentence counts changed)
UPDATE public.user_task_progress utp
SET
  word_recordings_count     = (SELECT COUNT(*) FROM public.recordings r JOIN public.tasks t ON t.id = r.task_id WHERE r.user_id = utp.user_id AND t.language_id = utp.language_id AND t.type = 'word'),
  phrase_recordings_count   = (SELECT COUNT(*) FROM public.recordings r JOIN public.tasks t ON t.id = r.task_id WHERE r.user_id = utp.user_id AND t.language_id = utp.language_id AND t.type = 'phrase'),
  sentence_recordings_count = (SELECT COUNT(*) FROM public.recordings r JOIN public.tasks t ON t.id = r.task_id WHERE r.user_id = utp.user_id AND t.language_id = utp.language_id AND t.type = 'sentence'),
  updated_at                = now();
