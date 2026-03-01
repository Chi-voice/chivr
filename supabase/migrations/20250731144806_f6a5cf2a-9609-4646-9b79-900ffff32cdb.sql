-- Fix function search path security issue
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';

-- Also set proper search path for the existing functions that may not have it
-- (the other functions already have it set correctly)