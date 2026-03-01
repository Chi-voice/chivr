-- Add Sia archival tracking columns to recordings
ALTER TABLE public.recordings
ADD COLUMN sia_cid TEXT,
ADD COLUMN sia_archived_at TIMESTAMP WITH TIME ZONE;