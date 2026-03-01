-- Ensure unique constraint for ON CONFLICT in update_user_progress()
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'user_task_progress'
      AND constraint_type = 'UNIQUE'
      AND constraint_name = 'user_task_progress_user_language_key'
  ) THEN
    ALTER TABLE public.user_task_progress
    ADD CONSTRAINT user_task_progress_user_language_key UNIQUE (user_id, language_id);
  END IF;
END $$;

-- Create trigger to update user progress after each recording insert
DROP TRIGGER IF EXISTS trg_update_user_progress ON public.recordings;
CREATE TRIGGER trg_update_user_progress
AFTER INSERT ON public.recordings
FOR EACH ROW
EXECUTE FUNCTION public.update_user_progress();