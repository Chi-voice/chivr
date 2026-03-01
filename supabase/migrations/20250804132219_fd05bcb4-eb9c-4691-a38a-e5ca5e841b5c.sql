-- Add points system to profiles
ALTER TABLE public.profiles 
ADD COLUMN points INTEGER DEFAULT 0;

-- Add order/sequence to tasks for standardized progression
ALTER TABLE public.tasks 
ADD COLUMN sequence_order INTEGER,
ADD COLUMN is_starter_task BOOLEAN DEFAULT false;

-- Create comprehensive language list
INSERT INTO public.languages (name, code, is_popular) VALUES 
-- Popular languages first
('English', 'en', true),
('Spanish', 'es', true),
('French', 'fr', true),
('German', 'de', true),
('Italian', 'it', true),
('Portuguese', 'pt', true),
('Russian', 'ru', true),
('Chinese (Mandarin)', 'zh', true),
('Japanese', 'ja', true),
('Korean', 'ko', true),
('Arabic', 'ar', true),
('Hindi', 'hi', true),
-- Regional and indigenous languages
('Kazakh', 'kk', true),
('Kyrgyz', 'ky', false),
('Uzbek', 'uz', false),
('Tajik', 'tg', false),
('Turkmen', 'tk', false),
('Mongolian', 'mn', false),
('Tibetan', 'bo', false),
('Uyghur', 'ug', false),
('Chechen', 'ce', false),
('Tatar', 'tt', false),
('Bashkir', 'ba', false),
('Yakut (Sakha)', 'sah', false),
('Chuvash', 'cv', false),
('Mari', 'chm', false),
('Udmurt', 'udm', false),
('Komi', 'kv', false),
('Nenets', 'yrk', false),
('Even', 'eve', false),
('Evenk', 'evn', false),
('Manchu', 'mnc', false),
-- More world languages
('Swahili', 'sw', false),
('Zulu', 'zu', false),
('Xhosa', 'xh', false),
('Yoruba', 'yo', false),
('Igbo', 'ig', false),
('Hausa', 'ha', false),
('Amharic', 'am', false),
('Cherokee', 'chr', false),
('Navajo', 'nv', false),
('Hawaiian', 'haw', false),
('Maori', 'mi', false),
('Welsh', 'cy', false),
('Irish', 'ga', false),
('Scottish Gaelic', 'gd', false),
('Basque', 'eu', false),
('Catalan', 'ca', false),
('Dutch', 'nl', false),
('Swedish', 'sv', false),
('Norwegian', 'no', false),
('Danish', 'da', false),
('Finnish', 'fi', false),
('Estonian', 'et', false),
('Latvian', 'lv', false),
('Lithuanian', 'lt', false),
('Polish', 'pl', false),
('Czech', 'cs', false),
('Slovak', 'sk', false),
('Hungarian', 'hu', false),
('Romanian', 'ro', false),
('Bulgarian', 'bg', false),
('Croatian', 'hr', false),
('Serbian', 'sr', false),
('Bosnian', 'bs', false),
('Albanian', 'sq', false),
('Greek', 'el', false),
('Turkish', 'tr', false),
('Hebrew', 'he', false),
('Persian (Farsi)', 'fa', false),
('Urdu', 'ur', false),
('Bengali', 'bn', false),
('Tamil', 'ta', false),
('Telugu', 'te', false),
('Malayalam', 'ml', false),
('Kannada', 'kn', false),
('Gujarati', 'gu', false),
('Punjabi', 'pa', false),
('Marathi', 'mr', false),
('Thai', 'th', false),
('Vietnamese', 'vi', false),
('Indonesian', 'id', false),
('Malay', 'ms', false),
('Tagalog', 'tl', false),
('Burmese', 'my', false),
('Khmer', 'km', false),
('Lao', 'lo', false)
ON CONFLICT (code) DO NOTHING;

-- Create starter tasks for all languages (these will be the same progression for everyone)
INSERT INTO public.tasks (english_text, description, type, difficulty, language_id, estimated_time, sequence_order, is_starter_task, created_by_ai) 
SELECT 
  CASE sequence_order
    WHEN 1 THEN 'Hello'
    WHEN 2 THEN 'Thank you'
    WHEN 3 THEN 'Please'
    WHEN 4 THEN 'Goodbye'
    WHEN 5 THEN 'Yes'
    WHEN 6 THEN 'No'
    WHEN 7 THEN 'Water'
    WHEN 8 THEN 'Food'
    WHEN 9 THEN 'Home'
    WHEN 10 THEN 'Family'
    WHEN 11 THEN 'How are you?'
    WHEN 12 THEN 'What is your name?'
    WHEN 13 THEN 'I am fine'
    WHEN 14 THEN 'Nice to meet you'
    WHEN 15 THEN 'See you later'
    WHEN 16 THEN 'My name is John'
    WHEN 17 THEN 'I live in the city'
    WHEN 18 THEN 'The weather is nice today'
    WHEN 19 THEN 'I would like some water please'
    WHEN 20 THEN 'Thank you very much for your help'
  END as english_text,
  CASE sequence_order
    WHEN 1 THEN 'A basic greeting used when meeting someone'
    WHEN 2 THEN 'Expression of gratitude'
    WHEN 3 THEN 'Polite way to make a request'
    WHEN 4 THEN 'Farewell expression'
    WHEN 5 THEN 'Affirmative response'
    WHEN 6 THEN 'Negative response'
    WHEN 7 THEN 'Essential liquid for life'
    WHEN 8 THEN 'What we eat for nourishment'
    WHEN 9 THEN 'Place where one lives'
    WHEN 10 THEN 'Group of related people'
    WHEN 11 THEN 'Asking about someone wellbeing'
    WHEN 12 THEN 'Asking for someone identity'
    WHEN 13 THEN 'Responding positively to wellbeing inquiry'
    WHEN 14 THEN 'Polite expression when meeting someone new'
    WHEN 15 THEN 'Casual farewell for future meeting'
    WHEN 16 THEN 'Introducing oneself by name'
    WHEN 17 THEN 'Stating one place of residence'
    WHEN 18 THEN 'Commenting on pleasant weather conditions'
    WHEN 19 THEN 'Politely requesting water'
    WHEN 20 THEN 'Expressing deep gratitude for assistance'
  END as description,
  CASE 
    WHEN sequence_order <= 10 THEN 'word'
    WHEN sequence_order <= 15 THEN 'phrase'
    ELSE 'sentence'
  END as type,
  CASE 
    WHEN sequence_order <= 10 THEN 'beginner'
    WHEN sequence_order <= 15 THEN 'intermediate'
    ELSE 'advanced'
  END as difficulty,
  l.id as language_id,
  CASE 
    WHEN sequence_order <= 10 THEN 1
    WHEN sequence_order <= 15 THEN 2
    ELSE 3
  END as estimated_time,
  sequence_order,
  true as is_starter_task,
  false as created_by_ai
FROM public.languages l
CROSS JOIN generate_series(1, 20) as sequence_order;

-- Update user progress tracking to include points
CREATE OR REPLACE FUNCTION public.update_user_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  task_language_id UUID;
  points_to_award INTEGER;
BEGIN
  -- Get the language_id from the task
  SELECT language_id INTO task_language_id
  FROM public.tasks
  WHERE id = NEW.task_id;
  
  -- Calculate points based on task difficulty
  SELECT 
    CASE 
      WHEN difficulty = 'beginner' THEN 10
      WHEN difficulty = 'intermediate' THEN 20
      WHEN difficulty = 'advanced' THEN 30
      ELSE 10
    END INTO points_to_award
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
  
  -- Update user total recordings and award points
  UPDATE public.profiles
  SET total_recordings = total_recordings + 1,
      points = points + points_to_award,
      updated_at = now()
  WHERE id = NEW.user_id;
  
  RETURN NEW;
END;
$function$;