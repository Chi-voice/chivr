import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { language_id, user_id, force } = await req.json();

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // First, we need to resolve the language to get the correct database ID
    let languageDbId = language_id;
    
    // Try to find language by UUID first
    let { data: langCheck } = await supabase
      .from('languages')
      .select('id, name, code')
      .eq('id', language_id)
      .maybeSingle();

    // If not found by UUID, try to find by code (Glottolog ID)
    if (!langCheck) {
      const { data: codeData } = await supabase
        .from('languages')
        .select('id, name, code')
        .eq('code', language_id)
        .maybeSingle();
      
      if (codeData) {
        langCheck = codeData;
        languageDbId = codeData.id;
      }
    }

    // Check if user should work on starter tasks first
    const { data: starterTasks } = await supabase
      .from('tasks')
      .select(`
        id, 
        sequence_order,
        recordings!recordings_task_id_fkey(id, user_id)
      `)
      .eq('language_id', languageDbId)
      .eq('is_starter_task', true)
      .order('sequence_order');

    // Find the next uncompleted starter task
    const nextStarterTask = starterTasks?.find(task => 
      !task.recordings?.some((r: any) => r.user_id === user_id)
    );

    if (nextStarterTask) {
      return new Response(JSON.stringify({ 
        error: 'Please complete the starter tasks first',
        nextStarterTask: nextStarterTask.id,
        message: 'You should complete the standardized starter tasks before generating new ones'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if there are any existing tasks for this language
    const { count: taskCount } = await supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('language_id', languageDbId);

    // If no tasks exist, create a starter task
    if (!taskCount || taskCount === 0) {
      console.log('No tasks found for language, creating starter task');
      // Continue to task generation without checking progress
    } else {
      // Check if user can generate next task (has completed 2 recordings) unless forced
      if (!force) {
        const { data: progress } = await supabase
          .from('user_task_progress')
          .select('can_generate_next, recordings_count')
          .eq('user_id', user_id)
          .eq('language_id', languageDbId)
          .single();

        if (progress && !progress.can_generate_next) {
          return new Response(JSON.stringify({ 
            error: 'You need to complete 2 recordings before generating next task',
            recordings_needed: 2 - (progress?.recordings_count || 0)
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        console.log('Force-generating next task for user', user_id, 'language', languageDbId);
      }
    }

    // Get language name - try multiple approaches
    let { data: language } = await supabase
      .from('languages')
      .select('id, name, code')
      .eq('id', languageDbId)
      .maybeSingle();

    // If not found by UUID, try to find by code (Glottolog ID)
    if (!language) {
      const { data: codeData } = await supabase
        .from('languages')
        .select('id, name, code')
        .eq('code', language_id)
        .maybeSingle();
      
      language = codeData;
    }

    // If still not found, this might be a Glottolog ID - create the language
    if (!language) {
      console.log('Language not found in database, attempting to load from Glottolog data');
      
      // For edge functions, we need to fetch and parse Glottolog data manually
      try {
        const csvResponse = await fetch('https://d6d1e450-66f8-4d07-a9a9-dff8436e7aad.lovableproject.com/glottolog-full.csv');
        if (csvResponse.ok) {
          const csvText = await csvResponse.text();
          const lines = csvText.split('\n');
          const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
          
          for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
            if (values[0] === language_id) { // Assuming first column is ID
              const languageName = values[1] || 'Unknown Language'; // Assuming second column is name
              
              // Create the language in database
              const { data: newLang, error: createError } = await supabase
                .from('languages')
                .insert({
                  name: languageName,
                  code: language_id,
                  is_popular: false
                })
                .select('id, name, code')
                .single();
              
              if (!createError) {
                language = newLang;
                console.log('Created new language:', languageName);
                break;
              }
            }
          }
        }
      } catch (e) {
        console.error('Error loading Glottolog data:', e);
      }
    }

    if (!language) {
      return new Response(JSON.stringify({ error: 'Language not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Generate AI prompt using OpenAI
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      return new Response(JSON.stringify({ error: 'OpenAI API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Bias towards phrases and sentences for everyday usage
    const taskTypesPool = ['phrase','sentence','sentence','phrase','word'];
    const difficulties = ['beginner', 'intermediate', 'advanced'];
    const randomType = taskTypesPool[Math.floor(Math.random() * taskTypesPool.length)];
    const randomDifficulty = difficulties[Math.floor(Math.random() * difficulties.length)];

    // Fetch recent tasks to avoid repetition
    const { data: recentTasks } = await supabase
      .from('tasks')
      .select('english_text')
      .eq('language_id', language.id)
      .order('created_at', { ascending: false })
      .limit(200);

    const usedTexts = new Set((recentTasks ?? []).map((t: any) => (t.english_text ?? '').trim().toLowerCase()));
    const usedWords = (recentTasks ?? [])
      .map((t: any) => (t.english_text ?? '').trim())
      .filter((txt: string) => txt && !txt.includes(' '))
      .map((txt: string) => txt.toLowerCase());

    const avoidList = Array.from(usedTexts).slice(0, 20);
    const avoidWords = usedWords.slice(0, 20);

    const avoidance = avoidList.length ? ` Avoid these already used items: ${avoidList.join(', ')}.` : '';
    const avoidanceWords = (randomType === 'word' && avoidWords.length) ? ` Do not use any of these words: ${avoidWords.join(', ')}.` : '';

    // Helpers to detect near-duplicates and generate diversified fallbacks
    const tokenize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    const jaccard = (a: string, b: string) => {
      const A = new Set(tokenize(a));
      const B = new Set(tokenize(b));
      const inter = [...A].filter(x => B.has(x)).length;
      const uni = new Set([...A, ...B]).size;
      return uni ? inter / uni : 0;
    };
    const isTooSimilar = (candidate: string) => {
      const cand = candidate.trim().toLowerCase();
      if (usedTexts.has(cand)) return true;
      for (const t of usedTexts) {
        if (jaccard(candidate, t) >= 0.8) return true;
      }
      return false;
    };

    // Quality heuristics and curated fallback generation
    const NATURAL_BAD_PATTERNS: RegExp[] = [
      /\bvisit(ing)? the food\b/i,
      /\brepair(ing)? the food\b/i,
      /\bfix(ing)? the food\b/i,
      /\bteach(ing)? the food\b/i,
      /\blearn(ing)? the food\b/i,
    ];
    const isNatural = (text: string, type: 'word' | 'phrase' | 'sentence') => {
      const t = (text || '').trim();
      if (!t) return false;
      if (type === 'word') return !/\s/.test(t) && /^[A-Za-z][A-Za-z\-']{1,30}$/.test(t);
      if (type === 'phrase') {
        if (t.split(/\s+/).length < 2 || t.split(/\s+/).length > 8) return false;
        if (/[\{\}\[\]]/.test(t)) return false;
        for (const r of NATURAL_BAD_PATTERNS) if (r.test(t)) return false;
        return true;
      }
      // sentence
      if (t.split(/\s+/).length < 4 || t.length > 120) return false;
      if (!/[.?!]$/.test(t)) return false;
      if (!/\b(I|We|You|He|She|They|My|Your|Our)\b/i.test(t)) return false;
      for (const r of NATURAL_BAD_PATTERNS) if (r.test(t)) return false;
      return true;
    };

    const makeFallbackCandidate = (type: 'word' | 'phrase' | 'sentence') => {
      const words = [
        'water','family','friend','market','school','village','river','house','doctor','music','morning','evening','bread','money','phone','bus'
      ];
      const phrases = [
        'How are you?',
        'Please wait a moment.',
        'Can you help me?',
        "I don't understand.",
        'What time is it?',
        'See you tomorrow.',
        'Where is the market?',
        'I would like some water.',
        "I'm on my way.",
        'I need a doctor.',
        'Where can I buy food?',
        'Thank you very much.'
      ];
      const places = ['market','school','river','farm','village','clinic','bus station','store','house'];
      const times = ['this morning','this afternoon','this evening','tomorrow','next week'];
      const sentences = [
        (pl: string, tm: string) => `I am going to the ${pl} ${tm}.`,
        (pl: string) => `My house is near the ${pl}.`,
        (pl: string) => `We will meet at the ${pl} tomorrow.`,
        (pl: string) => `The road to the ${pl} is very long.`,
        (pl: string) => `She is working at the ${pl} today.`,
        (pl: string) => `He is walking to the ${pl} now.`,
        (pl: string) => `They are waiting at the ${pl}.`,
      ];

      let candidate = { text: '', description: '', estimated: 2 } as { text: string; description: string; estimated: number };

      if (type === 'word') {
        const filtered = words.filter(w => !usedWords.includes(w));
        const pool = filtered.length ? filtered : words;
        candidate.text = pool[Math.floor(Math.random() * pool.length)];
        candidate.description = `Translate the word "${candidate.text}" into ${language.name}.`;
        candidate.estimated = 1;
      } else if (type === 'phrase') {
        const pool = phrases.filter(p => !isTooSimilar(p));
        candidate.text = (pool.length ? pool : phrases)[Math.floor(Math.random() * (pool.length ? pool.length : phrases.length))];
        candidate.description = `Translate this everyday expression into ${language.name}.`;
        candidate.estimated = 2;
      } else {
        const pl = places[Math.floor(Math.random() * places.length)];
        const tm = times[Math.floor(Math.random() * times.length)];
        const text = sentences[Math.floor(Math.random() * sentences.length)](pl, tm as any);
        candidate.text = text;
        candidate.description = `Translate this practical sentence into ${language.name}.`;
        candidate.estimated = 3;
      }
      return candidate;
    };

    const pickUniqueFallback = (type: 'word' | 'phrase' | 'sentence', maxTries = 12) => {
      for (let i = 0; i < maxTries; i++) {
        const c = makeFallbackCandidate(type);
        if (!isTooSimilar(c.text) && isNatural(c.text, type)) return c;
      }
      const final = makeFallbackCandidate('phrase');
      return isNatural(final.text, 'phrase') ? final : { text: 'Thank you very much.', description: `Translate this everyday expression into ${language.name}.`, estimated: 2 };
    };

    const prompt = `Generate a ${randomDifficulty} level English ${randomType} for everyday conversation practice in ${language.name}.
    
    Requirements:
    - It must sound natural and be commonly used in daily life (avoid odd verb-object pairs like "visit the food").
    - Prefer neutral, culturally respectful content for general contexts.
    - Keep it short and clear. Words: one token; Phrases: 2–8 words; Sentences: 4–14 words.
    - Output MUST be valid JSON only: {"english_text": string, "description": string, "estimated_time": number}
    - Good examples:\n      - Word: "water"\n      - Phrase: "Where is the market?"\n      - Sentence: "We will visit the market tomorrow."
    - Bad examples (do NOT produce):\n      - "We will visit the food tomorrow."\n      - "Repair the rice now."
    ${avoidance}${avoidanceWords}
    Return only the JSON object, without any extra text.`

    console.log('Generating task with OpenAI for language:', language.name);

    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert in language learning and indigenous language preservation. Return only valid JSON objects.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.4,
        max_tokens: 200,
      }),
    });

    if (!openAIResponse.ok) {
      console.error('OpenAI API error:', openAIResponse.status);

      // Diversified fallback: generator with deduping against recent tasks
      const candidate = pickUniqueFallback(randomType as 'word' | 'phrase' | 'sentence');

      const { data: newTask, error: taskError } = await supabase
        .from('tasks')
        .insert({
          english_text: candidate.text,
          description: candidate.description,
          type: randomType,
          difficulty: randomDifficulty,
          language_id: language.id,
          estimated_time: candidate.estimated,
          created_by_ai: false,
          is_starter_task: !taskCount || taskCount === 0
        })
        .select()
        .single();

      if (taskError) {
        console.error('Database error (fallback):', taskError);
        return new Response(JSON.stringify({ error: 'Failed to save task' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await supabase
        .from('user_task_progress')
        .update({
          recordings_count: 0,
          can_generate_next: false,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user_id)
        .eq('language_id', language.id);

      console.log('Task generated via fallback successfully:', newTask.id);

      return new Response(JSON.stringify({ task: newTask, fallback: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const openAIData = await openAIResponse.json();
    const generatedContent = openAIData.choices[0].message.content;
    
    console.log('Generated content:', generatedContent);

    let taskData;
    try {
      taskData = JSON.parse(generatedContent);
    } catch (e) {
      console.error('Failed to parse OpenAI response:', e);

      // Fallback: generate a diversified candidate with deduping
      const f = pickUniqueFallback(randomType as 'word' | 'phrase' | 'sentence');

      const { data: newTask, error: taskError } = await supabase
        .from('tasks')
        .insert({
          english_text: f.text,
          description: f.description,
          type: randomType,
          difficulty: randomDifficulty,
          language_id: language.id,
          estimated_time: f.estimated,
          created_by_ai: false,
          is_starter_task: !taskCount || taskCount === 0
        })
        .select()
        .single();

      if (taskError) {
        console.error('Database error (fallback-parse):', taskError);
        return new Response(JSON.stringify({ error: 'Failed to save task' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await supabase
        .from('user_task_progress')
        .update({
          recordings_count: 0,
          can_generate_next: false,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user_id)
        .eq('language_id', language.id);

      console.log('Task generated via fallback (parse) successfully:', newTask.id);

      return new Response(JSON.stringify({ task: newTask, fallback: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Ensure uniqueness and naturalness; if AI output is missing/duplicate/unnatural, use curated fallback
    let createdByAi = true;
    let aiEnglishText = (taskData?.english_text ?? '').trim();
    const aiDesc = (taskData?.description ?? '').trim();
    const aiEst = Number(taskData?.estimated_time ?? 2);

    const invalidAi =
      !aiEnglishText ||
      usedTexts.has(aiEnglishText.toLowerCase()) ||
      !isNatural(aiEnglishText, randomType as 'word' | 'phrase' | 'sentence');

    if (invalidAi) {
      console.log('AI output rejected. Switching to curated fallback.', {
        missing: !aiEnglishText,
        duplicate: aiEnglishText ? usedTexts.has(aiEnglishText.toLowerCase()) : false,
        unnatural: aiEnglishText ? !isNatural(aiEnglishText, randomType as 'word' | 'phrase' | 'sentence') : false,
      });
      createdByAi = false;
      const candidate = pickUniqueFallback(randomType as 'word' | 'phrase' | 'sentence');
      taskData = {
        english_text: candidate.text,
        description: candidate.description,
        estimated_time: candidate.estimated
      };
    } else {
      // Normalize estimated_time and description
      taskData.estimated_time = Math.min(5, Math.max(1, isFinite(aiEst) ? aiEst : 2));
      taskData.description = aiDesc || `Translate this into ${language.name}.`;
    }

    aiEnglishText = (taskData?.english_text ?? '').trim();

    const { data: newTask, error: taskError } = await supabase
      .from('tasks')
      .insert({
        english_text: taskData.english_text,
        description: taskData.description,
        type: randomType,
        difficulty: randomDifficulty,
        language_id: language.id, // Use the actual database language ID
        estimated_time: taskData.estimated_time || 2,
        created_by_ai: createdByAi
      })
      .select()
      .single();

    if (taskError) {
      console.error('Database error:', taskError);
      return new Response(JSON.stringify({ error: 'Failed to save task' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Reset user's progress so they need 2 more recordings for next task
    await supabase
      .from('user_task_progress')
      .update({ 
        recordings_count: 0, 
        can_generate_next: false,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user_id)
      .eq('language_id', language.id); // Use the actual database language ID

    console.log('Task generated successfully:', newTask.id);

    return new Response(JSON.stringify({ task: newTask }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});