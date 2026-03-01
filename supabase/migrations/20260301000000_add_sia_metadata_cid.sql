ALTER TABLE public.recordings
ADD COLUMN IF NOT EXISTS sia_metadata_cid TEXT;
