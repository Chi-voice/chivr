-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  preferred_language_id UUID,
  total_recordings INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- Create languages table
CREATE TABLE public.languages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE, -- ISO language code
  is_popular BOOLEAN DEFAULT false,
  total_tasks INTEGER DEFAULT 0,
  total_recordings INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create tasks table for AI-generated prompts
CREATE TABLE public.tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  english_text TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('word', 'phrase', 'sentence')),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  language_id UUID NOT NULL REFERENCES public.languages(id) ON DELETE CASCADE,
  estimated_time INTEGER DEFAULT 2, -- in minutes
  created_by_ai BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create recordings table
CREATE TABLE public.recordings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  audio_url TEXT NOT NULL,
  notes TEXT,
  duration INTEGER, -- in seconds
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, task_id)
);

-- Create user_task_progress table to track 2-recording requirement
CREATE TABLE public.user_task_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  language_id UUID NOT NULL REFERENCES public.languages(id) ON DELETE CASCADE,
  recordings_count INTEGER DEFAULT 0,
  last_recording_at TIMESTAMP WITH TIME ZONE,
  can_generate_next BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, language_id)
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_task_progress ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for profiles
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Create RLS policies for languages (public read)
CREATE POLICY "Languages are publicly readable" ON public.languages
  FOR SELECT USING (true);

-- Create RLS policies for tasks (public read)
CREATE POLICY "Tasks are publicly readable" ON public.tasks
  FOR SELECT USING (true);

-- Create RLS policies for recordings
CREATE POLICY "Users can view their own recordings" ON public.recordings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own recordings" ON public.recordings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own recordings" ON public.recordings
  FOR UPDATE USING (auth.uid() = user_id);

-- Create RLS policies for user_task_progress
CREATE POLICY "Users can view their own progress" ON public.user_task_progress
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own progress" ON public.user_task_progress
  FOR ALL USING (auth.uid() = user_id);

-- Insert some popular languages
INSERT INTO public.languages (name, code, is_popular) VALUES
  ('Spanish', 'es', true),
  ('French', 'fr', true),
  ('Mandarin Chinese', 'zh', true),
  ('Arabic', 'ar', true),
  ('Hindi', 'hi', true),
  ('Portuguese', 'pt', true),
  ('Russian', 'ru', true),
  ('Japanese', 'ja', true),
  ('German', 'de', true),
  ('Korean', 'ko', true),
  ('Swahili', 'sw', false),
  ('Yoruba', 'yo', false),
  ('Quechua', 'qu', false),
  ('Cherokee', 'chr', false),
  ('Navajo', 'nv', false);

-- Create function to automatically create profile when user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'full_name');
  RETURN NEW;
END;
$$;

-- Create trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_task_progress_updated_at
  BEFORE UPDATE ON public.user_task_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to update recording counts and check if user can generate next task
CREATE OR REPLACE FUNCTION public.update_user_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  task_language_id UUID;
BEGIN
  -- Get the language_id from the task
  SELECT language_id INTO task_language_id
  FROM public.tasks
  WHERE id = NEW.task_id;
  
  -- Insert or update user_task_progress
  INSERT INTO public.user_task_progress (user_id, language_id, recordings_count, last_recording_at, can_generate_next)
  VALUES (NEW.user_id, task_language_id, 1, now(), false)
  ON CONFLICT (user_id, language_id)
  DO UPDATE SET
    recordings_count = user_task_progress.recordings_count + 1,
    last_recording_at = now(),
    can_generate_next = (user_task_progress.recordings_count + 1) >= 2,
    updated_at = now();
  
  -- Update user's total recordings
  UPDATE public.profiles
  SET total_recordings = total_recordings + 1,
      updated_at = now()
  WHERE id = NEW.user_id;
  
  RETURN NEW;
END;
$$;

-- Create trigger to update progress when recording is created
CREATE TRIGGER on_recording_created
  AFTER INSERT ON public.recordings
  FOR EACH ROW EXECUTE FUNCTION public.update_user_progress();