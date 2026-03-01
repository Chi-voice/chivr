-- Create public recordings bucket if it doesn't exist
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', true)
on conflict (id) do nothing;

-- Policies for the recordings bucket
-- Public read (so audio can be played by link)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public read access for recordings'
  ) THEN
    CREATE POLICY "Public read access for recordings"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'recordings');
  END IF;
END$$;

-- Authenticated users can upload under their own user folder (user_id/**)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can upload recordings to their folder'
  ) THEN
    CREATE POLICY "Users can upload recordings to their folder"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'recordings'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
  END IF;
END$$;

-- Authenticated users can update their own files
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can update their own recordings'
  ) THEN
    CREATE POLICY "Users can update their own recordings"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'recordings'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
  END IF;
END$$;

-- Authenticated users can delete their own files
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can delete their own recordings'
  ) THEN
    CREATE POLICY "Users can delete their own recordings"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'recordings'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
  END IF;
END$$;
