import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TaskType = 'word' | 'phrase' | 'sentence';

/**
 * Determine which section the user is currently in.
 * Sections unlock in order — Words → Phrases → Sentences — each requiring 1000
 * recordings before the next opens. Once all three hit 1000 the cycle restarts
 * at Words (generating fresh tasks; the avoidance list prevents repetition).
 */
function computeSection(wordCount: number, phraseCount: number, sentenceCount: number): TaskType {
  if (wordCount < 1000) return 'word';
  if (phraseCount < 1000) return 'phrase';
  if (sentenceCount < 1000) return 'sentence';
  return 'word'; // all complete — start a new cycle of words
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { language_id } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Auth: derive user_id from JWT, never trust request body ───────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: { user: callerUser } } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (!callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const user_id = callerUser.id;

    // ── Resolve language ───────────────────────────────────────────────────
    let languageDbId = language_id;

    let { data: langCheck } = await supabase
      .from('languages')
      .select('id, name, code')
      .eq('id', language_id)
      .maybeSingle();

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

    // ── Task count check ───────────────────────────────────────────────────
    const { count: taskCount } = await supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .eq('language_id', languageDbId);

    // ── Fetch all recorded task IDs for this user (used for both count healing and pending-task lookup) ──
    const { data: allRecordedRows } = await supabase
      .from('recordings')
      .select('task_id')
      .eq('user_id', user_id)
      .not('task_id', 'is', null);

    const allRecordedIds: string[] = (allRecordedRows ?? [])
      .map((r: { task_id: string | null }) => r.task_id)
      .filter((id): id is string => !!id);

    // ── Section progress ───────────────────────────────────────────────────
    const { data: progress } = await supabase
      .from('user_task_progress')
      .select('can_generate_next, recordings_count, word_recordings_count, phrase_recordings_count, sentence_recordings_count')
      .eq('user_id', user_id)
      .eq('language_id', languageDbId)
      .maybeSingle();

    let wordCount     = progress?.word_recordings_count     ?? 0;
    let phraseCount   = progress?.phrase_recordings_count   ?? 0;
    let sentenceCount = progress?.sentence_recordings_count ?? 0;

    // Self-heal: if total recordings exist but all per-type counters are zero,
    // the columns are stale (recorded before the section-progress migration ran).
    // Recompute accurate counts from actual recordings joined to tasks.
    const storedTotal = progress?.recordings_count ?? 0;
    const countersStale = storedTotal > 0 && wordCount === 0 && phraseCount === 0 && sentenceCount === 0;
    if (countersStale && allRecordedIds.length > 0) {
      const { data: taskTypeRows } = await supabase
        .from('tasks')
        .select('id, type')
        .eq('language_id', languageDbId)
        .in('id', allRecordedIds);

      for (const t of (taskTypeRows ?? [])) {
        if (t.type === 'word')     wordCount++;
        else if (t.type === 'phrase')   phraseCount++;
        else if (t.type === 'sentence') sentenceCount++;
      }

      // Persist the corrected counts and unblock the gate so the user isn't stuck
      await supabase
        .from('user_task_progress')
        .update({
          word_recordings_count:     wordCount,
          phrase_recordings_count:   phraseCount,
          sentence_recordings_count: sentenceCount,
          can_generate_next:         true,
          updated_at:                new Date().toISOString(),
        })
        .eq('user_id', user_id)
        .eq('language_id', languageDbId);

      console.log('[heal] Backfilled stale counters for user', user_id, '— word:', wordCount, 'phrase:', phraseCount, 'sentence:', sentenceCount);
    }

    const section_progress = { word: wordCount, phrase: phraseCount, sentence: sentenceCount };
    const currentSection   = computeSection(wordCount, phraseCount, sentenceCount);

    // Returns the oldest unrecorded task for this user+language in the current section.
    // Reuses the already-fetched allRecordedIds to avoid a second recordings query.
    const findOldestPendingTask = async () => {
      let query = supabase
        .from('tasks')
        .select('id, english_text, description, type, difficulty, language_id, estimated_time, created_by_ai, created_at')
        .eq('language_id', languageDbId)
        .eq('type', currentSection)
        .order('created_at', { ascending: true })
        .limit(1);

      if (allRecordedIds.length > 0) {
        query = query.not('id', 'in', `(${allRecordedIds.join(',')})`);
      }

      const { data } = await query.maybeSingle();
      return data ?? null;
    };

    // ── Proactive task seeding ─────────────────────────────────────────────
    // When fewer than SEED_THRESHOLD unrecorded tasks remain in the current section,
    // silently generate a fresh batch in the background so the pool never runs dry.
    const SEED_THRESHOLD = 5;
    const SEED_BATCH_SIZE = 8;

    const countUnrecordedInSection = async (): Promise<number> => {
      let countQuery = supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('language_id', languageDbId)
        .eq('type', currentSection);

      if (allRecordedIds.length > 0) {
        countQuery = countQuery.not('id', 'in', `(${allRecordedIds.join(',')})`);
      }

      const { count } = await countQuery;
      return count ?? 0;
    };

    const maybeSeedInBackground = (remaining: number) => {
      if (remaining >= SEED_THRESHOLD) return;
      const seedOpenAIKey = Deno.env.get('OPENAI_API_KEY');
      if (!seedOpenAIKey || !langCheck) return;
      console.log(`[seed] ${remaining} unrecorded ${currentSection} tasks remain — seeding batch of ${SEED_BATCH_SIZE} for ${langCheck.name}`);

      const seedWork = (async () => {
        const { data: latestTasks } = await supabase
          .from('tasks')
          .select('english_text')
          .eq('language_id', languageDbId)
          .eq('type', currentSection)
          .order('created_at', { ascending: false })
          .limit(300);

        const latestUsedTexts = new Set(
          (latestTasks ?? []).map(({ english_text }: { english_text: string | null }) => (english_text ?? '').trim().toLowerCase())
        );
        const seededTexts: string[] = [];
        const seedDifficulties = ['beginner', 'intermediate', 'advanced'];
        const langName = langCheck!.name;

        for (let i = 0; i < SEED_BATCH_SIZE; i++) {
          try {
            const diff = seedDifficulties[i % 3];
            const avoidListForSeed = [...Array.from(latestUsedTexts), ...seededTexts].slice(0, 200).join(', ');
            const seedPrompt = `Generate a ${diff} level English ${currentSection} for everyday conversation practice in ${langName}. It must sound natural and be commonly used in daily life. Keep it short and clear. Words: one token; Phrases: 2–8 words; Sentences: 4–14 words ending with punctuation. Avoid these already used items: ${avoidListForSeed}. Return only valid JSON: {"english_text": string, "description": string, "estimated_time": number}`;

            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${seedOpenAIKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                  { role: 'system', content: 'You are an expert in language learning. Return only valid JSON objects.' },
                  { role: 'user', content: seedPrompt },
                ],
                temperature: 0.9,
                max_tokens: 200,
                response_format: { type: 'json_object' },
              }),
            });

            if (!resp.ok) { console.warn(`[seed] OpenAI error on item ${i + 1}:`, resp.status); continue; }

            const respData = await resp.json();
            const seedContent = cleanJson(respData.choices?.[0]?.message?.content ?? '');
            const seedParsed = JSON.parse(seedContent);
            const seedText = (seedParsed?.english_text ?? '').trim();

            if (
              !seedText ||
              !isNatural(seedText, currentSection) ||
              latestUsedTexts.has(seedText.toLowerCase()) ||
              seededTexts.includes(seedText.toLowerCase())
            ) {
              console.warn(`[seed] Skipping invalid/duplicate: "${seedText}"`);
              continue;
            }

            const { error: insertErr } = await supabase.from('tasks').insert({
              english_text: seedText,
              description: seedParsed.description ?? `Translate into ${langName}.`,
              type: currentSection,
              difficulty: diff,
              language_id: languageDbId,
              estimated_time: Math.min(5, Math.max(1, Number(seedParsed.estimated_time) || 2)),
              created_by_ai: true,
              is_starter_task: false,
            });

            if (!insertErr) {
              latestUsedTexts.add(seedText.toLowerCase());
              seededTexts.push(seedText.toLowerCase());
              console.log(`[seed] Added "${seedText}" (${diff} ${currentSection})`);
            } else if (insertErr.code !== '23505') {
              console.error('[seed] Insert error:', insertErr);
            }
          } catch (seedErr) {
            console.error(`[seed] Error on item ${i + 1}:`, seedErr);
          }
        }

        console.log(`[seed] Done: ${seededTexts.length}/${SEED_BATCH_SIZE} ${currentSection} tasks seeded for ${langName}`);
      })();

      EdgeRuntime.waitUntil(seedWork);
    };

    // Gate: must record current task before generating a new one.
    // Exception: if all available tasks in the current section are already recorded,
    // fall through to generate a fresh task rather than blocking the user forever.
    const gateBlocking = !countersStale && taskCount && taskCount > 0 && progress && !progress.can_generate_next;
    if (gateBlocking) {
      const pending = await findOldestPendingTask();
      if (pending) {
        return new Response(JSON.stringify({ task: pending, section: currentSection, section_progress }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // No pending task found — user has recorded everything available in this section.
      // Reset the gate and fall through to generate a new task below.
      await supabase
        .from('user_task_progress')
        .update({ can_generate_next: true, updated_at: new Date().toISOString() })
        .eq('user_id', user_id)
        .eq('language_id', languageDbId);
      console.log('[gate-reset] No pending task in section', currentSection, '— resetting gate for user', user_id);
    }

    // One-task-at-a-time: return existing unrecorded task before generating another.
    const unrecorded = await findOldestPendingTask();
    if (unrecorded) {
      // Run progress update and pool-count check in parallel so we don't add latency.
      const [, remaining] = await Promise.all([
        supabase
          .from('user_task_progress')
          .update({ can_generate_next: false, updated_at: new Date().toISOString() })
          .eq('user_id', user_id)
          .eq('language_id', languageDbId),
        countUnrecordedInSection(),
      ]);
      // remaining includes the task being served; once recorded, pool shrinks by 1.
      maybeSeedInBackground(remaining - 1);
      return new Response(JSON.stringify({ task: unrecorded, section: currentSection, section_progress }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Resolve language name ──────────────────────────────────────────────
    let { data: language } = await supabase
      .from('languages')
      .select('id, name, code')
      .eq('id', languageDbId)
      .maybeSingle();

    if (!language) {
      const { data: codeData } = await supabase
        .from('languages')
        .select('id, name, code')
        .eq('code', language_id)
        .maybeSingle();

      language = codeData;
    }

    if (!language) {
      console.log('Language not found in database, attempting to load from Glottolog data');
      try {
        const csvResponse = await fetch('https://d6d1e450-66f8-4d07-a9a9-dff8436e7aad.lovableproject.com/glottolog-full.csv');
        if (csvResponse.ok) {
          const csvText = await csvResponse.text();
          const lines = csvText.split('\n');

          for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
            if (values[0] === language_id) {
              const languageName = values[1] || 'Unknown Language';
              const { data: newLang, error: createError } = await supabase
                .from('languages')
                .insert({ name: languageName, code: language_id, is_popular: false })
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

    // ── OpenAI setup ───────────────────────────────────────────────────────
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      return new Response(JSON.stringify({ error: 'OpenAI API key not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Task type is now determined by the user's current section, not random
    const randomType: TaskType = currentSection;
    const difficulties = ['beginner', 'intermediate', 'advanced'];
    const randomDifficulty = difficulties[Math.floor(Math.random() * difficulties.length)];

    // ── Deduplication helpers ──────────────────────────────────────────────
    const { data: recentTasks } = await supabase
      .from('tasks')
      .select('english_text')
      .eq('language_id', language.id)
      .order('created_at', { ascending: false })
      .limit(200);

    const usedTexts = new Set((recentTasks ?? []).map(({ english_text }) => (english_text ?? '').trim().toLowerCase()));
    const usedWords = (recentTasks ?? [])
      .map(({ english_text }) => (english_text ?? '').trim())
      .filter((txt) => txt && !txt.includes(' '))
      .map((txt) => txt.toLowerCase());

    // Send the full usedTexts list (capped at 150) so OpenAI always generates
    // something genuinely novel even when many tasks already exist for the language.
    const avoidList  = Array.from(usedTexts).slice(0, 150);
    const avoidWords = usedWords.slice(0, 150);

    const avoidance      = avoidList.length ? ` Avoid these already used items: ${avoidList.join(', ')}.` : '';
    const avoidanceWords = (randomType === 'word' && avoidWords.length) ? ` Do not use any of these words: ${avoidWords.join(', ')}.` : '';

    // Strip markdown code fences that some LLM responses include around JSON.
    const cleanJson = (raw: string): string => {
      const s = raw.trim();
      if (s.startsWith('```')) {
        return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      }
      return s;
    };

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

    const NATURAL_BAD_PATTERNS: RegExp[] = [
      /\bvisit(ing)? the food\b/i,
      /\brepair(ing)? the food\b/i,
      /\bfix(ing)? the food\b/i,
      /\bteach(ing)? the food\b/i,
      /\blearn(ing)? the food\b/i,
    ];
    const isNatural = (text: string, type: TaskType) => {
      const t = (text || '').trim();
      if (!t) return false;
      if (type === 'word') return !/\s/.test(t) && /^[A-Za-z][A-Za-z\-']{1,30}$/.test(t);
      if (type === 'phrase') {
        if (t.split(/\s+/).length < 2 || t.split(/\s+/).length > 8) return false;
        if (/[\{\}\[\]]/.test(t)) return false;
        for (const r of NATURAL_BAD_PATTERNS) if (r.test(t)) return false;
        return true;
      }
      if (t.split(/\s+/).length < 4 || t.length > 120) return false;
      if (!/[.?!]$/.test(t)) return false;
      if (!/\b(I|We|You|He|She|They|My|Your|Our)\b/i.test(t)) return false;
      for (const r of NATURAL_BAD_PATTERNS) if (r.test(t)) return false;
      return true;
    };

    // ── Fallback generator ─────────────────────────────────────────────────
    const makeFallbackCandidate = (type: TaskType) => {
      const words = [
        'water','family','friend','market','school','village','river','house','doctor','music','morning','evening','bread','money','phone','bus'
      ];
      const phrases = [
        'How are you?','Please wait a moment.','Can you help me?',"I don't understand.",'What time is it?',
        'See you tomorrow.','Where is the market?','I would like some water.',"I'm on my way.",'I need a doctor.',
        'Where can I buy food?','Thank you very much.'
      ];
      const places    = ['market','school','river','farm','village','clinic','bus station','store','house'];
      const times     = ['this morning','this afternoon','this evening','tomorrow','next week'];
      const sentences: ((pl: string, tm?: string) => string)[] = [
        (pl, tm) => `I am going to the ${pl} ${tm}.`,
        (pl) => `My house is near the ${pl}.`,
        (pl) => `We will meet at the ${pl} tomorrow.`,
        (pl) => `The road to the ${pl} is very long.`,
        (pl) => `She is working at the ${pl} today.`,
        (pl) => `He is walking to the ${pl} now.`,
        (pl) => `They are waiting at the ${pl}.`,
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
        const pl   = places[Math.floor(Math.random() * places.length)];
        const tm   = times[Math.floor(Math.random() * times.length)];
        const text = sentences[Math.floor(Math.random() * sentences.length)](pl, tm);
        candidate.text = text;
        candidate.description = `Translate this practical sentence into ${language.name}.`;
        candidate.estimated = 3;
      }
      return candidate;
    };

    const pickUniqueFallback = (type: TaskType, maxTries = 12) => {
      for (let i = 0; i < maxTries; i++) {
        const c = makeFallbackCandidate(type);
        if (!isTooSimilar(c.text) && isNatural(c.text, type)) return c;
      }
      // Last resort: type-safe hardcoded defaults — never cross type boundaries.
      if (type === 'word') {
        const safeWords = ['morning', 'river', 'bread', 'village', 'music', 'market', 'doctor', 'evening'];
        const w = safeWords.find(w => !usedTexts.has(w)) ?? 'morning';
        return { text: w, description: `Translate the word "${w}" into ${language.name}.`, estimated: 1 };
      }
      if (type === 'phrase') {
        return { text: 'Thank you very much.', description: `Translate this everyday expression into ${language.name}.`, estimated: 2 };
      }
      return { text: 'I would like some water.', description: `Translate this practical sentence into ${language.name}.`, estimated: 3 };
    };

    // ── AI prompt ──────────────────────────────────────────────────────────
    const prompt = `Generate a ${randomDifficulty} level English ${randomType} for everyday conversation practice in ${language.name}.
    
    Requirements:
    - It must sound natural and be commonly used in daily life (avoid odd verb-object pairs like "visit the food").
    - Prefer neutral, culturally respectful content for general contexts.
    - Keep it short and clear. Words: one token; Phrases: 2–8 words; Sentences: 4–14 words.
    - Output MUST be valid JSON only: {"english_text": string, "description": string, "estimated_time": number}
    - Good examples:\n      - Word: "water"\n      - Phrase: "Where is the market?"\n      - Sentence: "We will visit the market tomorrow."
    - Bad examples (do NOT produce):\n      - "We will visit the food tomorrow."\n      - "Repair the rice now."
    ${avoidance}${avoidanceWords}
    Return only the JSON object, without any extra text.`;

    console.log('Generating', randomType, 'task (section:', currentSection, ') for language:', language.name);

    // Helper: save a task and reset the progress gate.
    // saveTask returns:
    //   task object  — success (new or existing unrecorded task)
    //   'RECORDED'   — text already recorded by this user; caller should retry with different text
    //   null         — unexpected DB error
    const saveTask = async (
      taskData: { english_text: string; description: string; estimated_time: number },
      createdByAi: boolean
    ): Promise<Record<string, unknown> | 'RECORDED' | null> => {
      const normalizedText = taskData.english_text.trim().toLowerCase();

      // Check for ANY existing task with this text (recorded or not) so we never
      // attempt an INSERT that would violate the unique index on (language_id, type, lower(english_text)).
      const { data: anyExisting } = await supabase
        .from('tasks')
        .select('id, english_text, description, type, difficulty, language_id, estimated_time, created_by_ai, created_at')
        .eq('language_id', language.id)
        .eq('type', randomType)
        .ilike('english_text', normalizedText)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (anyExisting) {
        const alreadyRecorded = allRecordedIds.includes(anyExisting.id);
        if (alreadyRecorded) {
          // User has already done this task — tell the caller to try a different text.
          console.log('Dedup: text already recorded by user, signalling retry:', anyExisting.id, anyExisting.english_text);
          return 'RECORDED';
        }
        // Existing task the user hasn't recorded yet — hand it back directly.
        console.log('Dedup: returning existing unrecorded task:', anyExisting.id, anyExisting.english_text);
        await supabase
          .from('user_task_progress')
          .update({ can_generate_next: false, updated_at: new Date().toISOString() })
          .eq('user_id', user_id)
          .eq('language_id', language.id);
        return anyExisting as Record<string, unknown>;
      }

      const { data: newTask, error: taskError } = await supabase
        .from('tasks')
        .insert({
          english_text: taskData.english_text,
          description: taskData.description,
          type: randomType,
          difficulty: randomDifficulty,
          language_id: language.id,
          estimated_time: taskData.estimated_time || 2,
          created_by_ai: createdByAi,
          is_starter_task: !taskCount || taskCount === 0
        })
        .select()
        .single();

      if (taskError) {
        // Race-condition: another request inserted the same text between our check and INSERT.
        if (taskError.code === '23505') {
          console.log('Unique constraint race on insert — signalling retry');
          return 'RECORDED';
        }
        console.error('Database error:', taskError);
        return null;
      }

      // Reset gate — one recording required to unlock the next generate call
      await supabase
        .from('user_task_progress')
        .update({ can_generate_next: false, updated_at: new Date().toISOString() })
        .eq('user_id', user_id)
        .eq('language_id', language.id);

      return newTask as Record<string, unknown>;
    };

    // Wrapper: if saveTask signals the text is already recorded, pick fresh fallback
    // candidates and retry up to 5 times. If those all fail (user has recorded every
    // common fallback too), make one final direct OpenAI call with an exhaustive
    // avoidance list and high temperature to guarantee a novel task is generated.
    const saveTaskWithRetry = async (
      initial: { english_text: string; description: string; estimated_time: number },
      createdByAi: boolean
    ) => {
      let result = await saveTask(initial, createdByAi);
      if (result !== 'RECORDED') return result;

      for (let attempt = 0; attempt < 5; attempt++) {
        const alt = pickUniqueFallback(randomType);
        console.log(`saveTask retry ${attempt + 1}: trying "${alt.text}"`);
        result = await saveTask({ english_text: alt.text, description: alt.description, estimated_time: alt.estimated }, false);
        if (result !== 'RECORDED') return result;
      }

      // Last resort: all standard fallbacks exhausted. Make up to 3 direct OpenAI
      // calls with a full avoidance list and high temperature. Use json_object mode
      // to guarantee parseable output with no code fences.
      console.log('saveTaskWithRetry: standard fallbacks exhausted — attempting rescue OpenAI calls');
      const fullAvoidList = Array.from(usedTexts).slice(0, 200).join(', ');
      for (let rescueAttempt = 0; rescueAttempt < 3; rescueAttempt++) {
        try {
          const rescuePrompt = `Generate a completely original English ${randomType} for everyday language learning in ${language.name}. Be creative and use real vocabulary. MUST NOT match any of these: ${fullAvoidList}. Return JSON with keys english_text, description, estimated_time.`;
          const rescueResp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${openAIApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: 'You are a language learning expert. Output only valid JSON.' },
                { role: 'user', content: rescuePrompt },
              ],
              temperature: 1.0,
              max_tokens: 200,
              response_format: { type: 'json_object' },
            }),
          });
          if (!rescueResp.ok) { console.warn(`[rescue ${rescueAttempt + 1}] OpenAI error:`, rescueResp.status); continue; }
          const rescueData = await rescueResp.json();
          const rescueContent = cleanJson(rescueData.choices?.[0]?.message?.content ?? '');
          const rescueTask = JSON.parse(rescueContent);
          const rescueText = (rescueTask?.english_text ?? '').trim();
          if (!rescueText) { console.warn(`[rescue ${rescueAttempt + 1}] Empty text`); continue; }
          console.log(`[rescue ${rescueAttempt + 1}] Trying: "${rescueText}"`);
          result = await saveTask({ english_text: rescueText, description: rescueTask.description ?? `Translate into ${language.name}.`, estimated_time: Number(rescueTask.estimated_time) || 2 }, true);
          if (result !== 'RECORDED') return result; // null (DB error) or a valid task
        } catch (rescueErr) {
          console.error(`[rescue ${rescueAttempt + 1}] Error:`, rescueErr);
        }
      }

      console.error('saveTaskWithRetry: exhausted all retries including rescue calls');
      return null;
    };

    // ── Call OpenAI ────────────────────────────────────────────────────────
    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are an expert in language learning and indigenous language preservation. Return only valid JSON objects.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
    });

    if (!openAIResponse.ok) {
      console.error('OpenAI API error:', openAIResponse.status);
      const candidate = pickUniqueFallback(randomType);
      const newTask = await saveTaskWithRetry({ english_text: candidate.text, description: candidate.description, estimated_time: candidate.estimated }, false);
      if (!newTask) return new Response(JSON.stringify({ error: 'Failed to save task' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      console.log('Task generated via fallback (OpenAI error) successfully:', (newTask as Record<string,unknown>).id);
      return new Response(JSON.stringify({ task: newTask, fallback: true, section: currentSection, section_progress }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const openAIData = await openAIResponse.json();
    const generatedContent = cleanJson(openAIData.choices[0].message.content ?? '');
    console.log('Generated content:', generatedContent);

    let taskData: { english_text: string; description: string; estimated_time: number };
    try {
      taskData = JSON.parse(generatedContent);
    } catch (e) {
      console.error('Failed to parse OpenAI response:', e);
      const f = pickUniqueFallback(randomType);
      const newTask = await saveTaskWithRetry({ english_text: f.text, description: f.description, estimated_time: f.estimated }, false);
      if (!newTask) return new Response(JSON.stringify({ error: 'Failed to save task' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      console.log('Task generated via fallback (parse error) successfully:', (newTask as Record<string,unknown>).id);
      return new Response(JSON.stringify({ task: newTask, fallback: true, section: currentSection, section_progress }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Naturalness / uniqueness gate ──────────────────────────────────────
    let createdByAi = true;
    const aiEnglishText = (taskData?.english_text ?? '').trim();
    const aiDesc        = (taskData?.description ?? '').trim();
    const aiEst         = Number(taskData?.estimated_time ?? 2);

    // Only reject AI output that is absent or clearly unnatural.
    // We do NOT reject text that already exists in usedTexts — saveTask handles
    // that case correctly: if the task exists and is unrecorded it is returned
    // directly; if already recorded, saveTask signals 'RECORDED' and we retry.
    // Filtering on usedTexts here was causing us to discard valid unrecorded tasks.
    const invalidAi =
      !aiEnglishText ||
      !isNatural(aiEnglishText, randomType);

    if (invalidAi) {
      console.log('AI output rejected. Switching to curated fallback.', {
        missing: !aiEnglishText,
        unnatural: aiEnglishText ? !isNatural(aiEnglishText, randomType) : false,
      });
      createdByAi = false;
      const candidate = pickUniqueFallback(randomType);
      taskData = { english_text: candidate.text, description: candidate.description, estimated_time: candidate.estimated };
    } else {
      taskData.estimated_time = Math.min(5, Math.max(1, isFinite(aiEst) ? aiEst : 2));
      taskData.description    = aiDesc || `Translate this into ${language.name}.`;
    }

    const newTask = await saveTaskWithRetry(taskData, createdByAi);
    if (!newTask) {
      return new Response(JSON.stringify({ error: 'Failed to save task' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Task generated successfully:', (newTask as Record<string,unknown>).id, '| type:', randomType, '| section:', currentSection);

    // The pool was at 0 unrecorded tasks when we reached this code path (otherwise we'd
    // have returned the existing unrecorded task above). Seed a fresh batch in the
    // background so the next request can be served from the pool without another AI call.
    maybeSeedInBackground(0);

    return new Response(JSON.stringify({ task: newTask, section: currentSection, section_progress }), {
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
