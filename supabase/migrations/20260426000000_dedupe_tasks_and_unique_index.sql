-- Deduplicate tasks: for each (language_id, type, lower(english_text)) group,
-- keep only the oldest task (MIN created_at, then MIN id as tiebreak).
--
-- Steps:
--   1. Drop recordings where same user already has a recording on the canonical task.
--   1b. Drop recordings where same user has recordings on multiple duplicate tasks
--       (same canonical target), keeping only the one with the smallest id.
--   2. Reassign surviving recordings on duplicate tasks → canonical task id.
--   3. Delete non-canonical duplicate tasks (cascades any remaining FK rows).
--   4. Create a unique index to prevent future duplicates.
--   5. Recompute user_task_progress counts.

DO $$
DECLARE
  v_deleted_recordings  INT;
  v_deleted_recordings2 INT;
  v_reassigned          INT;
  v_deleted_tasks       INT;
BEGIN

  -- ------------------------------------------------------------------ --
  -- Build ranking snapshot once and reuse across all steps.            --
  -- rn = 1 → canonical (oldest created_at, then smallest id).          --
  -- rn > 1 → duplicate.                                                 --
  -- ------------------------------------------------------------------ --

  CREATE TEMP TABLE _task_rank AS
  SELECT
    id,
    language_id,
    type,
    lower(english_text) AS ltext,
    ROW_NUMBER() OVER (
      PARTITION BY language_id, type, lower(english_text)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.tasks;

  CREATE TEMP TABLE _canonical AS
  SELECT r.id AS canonical_id, r.language_id, r.type, r.ltext
  FROM   _task_rank r
  WHERE  r.rn = 1
    AND EXISTS (
      SELECT 1 FROM _task_rank d
      WHERE d.language_id = r.language_id
        AND d.type        = r.type
        AND d.ltext       = r.ltext
        AND d.rn          > 1
    );

  CREATE TEMP TABLE _duplicate_tasks AS
  SELECT d.id AS dup_id, c.canonical_id
  FROM   _task_rank d
  JOIN   _canonical c
         ON  c.language_id = d.language_id
         AND c.type        = d.type
         AND c.ltext       = d.ltext
  WHERE  d.rn > 1;

  -- ------------------------------------------------------------------ --
  -- Step 1: Remove recordings where the user already has a recording    --
  -- on the canonical task (delete the duplicate-task recording).        --
  -- ------------------------------------------------------------------ --
  DELETE FROM public.recordings r
  USING  _duplicate_tasks d
  WHERE  r.task_id = d.dup_id
    AND  EXISTS (
      SELECT 1 FROM public.recordings r2
      WHERE  r2.user_id  = r.user_id
        AND  r2.task_id  = d.canonical_id
    );

  GET DIAGNOSTICS v_deleted_recordings = ROW_COUNT;
  RAISE NOTICE 'Step 1: deleted % recordings (conflict with canonical)', v_deleted_recordings;

  -- ------------------------------------------------------------------ --
  -- Step 1b: For users who have recordings on MULTIPLE duplicate tasks  --
  -- that all map to the same canonical, keep only the earliest one     --
  -- (by created_at, then id text) and delete the rest.                 --
  -- ------------------------------------------------------------------ --
  DELETE FROM public.recordings r
  USING (
    SELECT rec.id AS rec_id
    FROM (
      SELECT
        rec2.id,
        ROW_NUMBER() OVER (
          PARTITION BY rec2.user_id, d.canonical_id
          ORDER BY rec2.created_at ASC, rec2.id::text ASC
        ) AS rn
      FROM   public.recordings rec2
      JOIN   _duplicate_tasks d ON d.dup_id = rec2.task_id
    ) AS rec
    WHERE rec.rn > 1
  ) AS extras
  WHERE r.id = extras.rec_id;

  GET DIAGNOSTICS v_deleted_recordings2 = ROW_COUNT;
  RAISE NOTICE 'Step 1b: deleted % extra dup recordings (multi-dup same user)', v_deleted_recordings2;

  -- ------------------------------------------------------------------ --
  -- Step 2: Reassign surviving recordings on duplicate tasks →          --
  -- canonical task id.                                                   --
  -- ------------------------------------------------------------------ --
  UPDATE public.recordings r
  SET    task_id = d.canonical_id
  FROM   _duplicate_tasks d
  WHERE  r.task_id = d.dup_id;

  GET DIAGNOSTICS v_reassigned = ROW_COUNT;
  RAISE NOTICE 'Step 2: reassigned % recordings to canonical tasks', v_reassigned;

  -- ------------------------------------------------------------------ --
  -- Step 3: Delete non-canonical duplicate tasks.                       --
  -- ON DELETE CASCADE handles any residual FK rows.                     --
  -- ------------------------------------------------------------------ --
  DELETE FROM public.tasks t
  USING  _duplicate_tasks d
  WHERE  t.id = d.dup_id;

  GET DIAGNOSTICS v_deleted_tasks = ROW_COUNT;
  RAISE NOTICE 'Step 3: deleted % duplicate tasks', v_deleted_tasks;

  -- Clean up temp tables
  DROP TABLE _task_rank;
  DROP TABLE _canonical;
  DROP TABLE _duplicate_tasks;

END;
$$;

-- ------------------------------------------------------------------ --
-- Step 4: Add unique index to prevent future duplicates.             --
-- ------------------------------------------------------------------ --
CREATE UNIQUE INDEX IF NOT EXISTS tasks_language_type_text_unique
  ON public.tasks (language_id, type, lower(english_text));

-- ------------------------------------------------------------------ --
-- Step 5: Recompute section progress counts for all users.           --
-- ------------------------------------------------------------------ --
UPDATE public.user_task_progress utp
SET
  word_recordings_count     = (
    SELECT COUNT(*)
    FROM   public.recordings r
    JOIN   public.tasks t ON t.id = r.task_id
    WHERE  r.user_id     = utp.user_id
      AND  t.language_id = utp.language_id
      AND  t.type        = 'word'
  ),
  phrase_recordings_count   = (
    SELECT COUNT(*)
    FROM   public.recordings r
    JOIN   public.tasks t ON t.id = r.task_id
    WHERE  r.user_id     = utp.user_id
      AND  t.language_id = utp.language_id
      AND  t.type        = 'phrase'
  ),
  sentence_recordings_count = (
    SELECT COUNT(*)
    FROM   public.recordings r
    JOIN   public.tasks t ON t.id = r.task_id
    WHERE  r.user_id     = utp.user_id
      AND  t.language_id = utp.language_id
      AND  t.type        = 'sentence'
  ),
  updated_at                = now();
