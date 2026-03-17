import { Router, Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

const router = Router();
const FREE_QUOTA = 1000;

interface ApiKeyRow {
  id: string;
  user_id: string;
  key: string;
  tier: string;
  monthly_usage: number;
  usage_reset_at: string;
  created_at: string;
}

interface RecordingRow {
  id: string;
  sia_cid: string | null;
  notes: string | null;
  created_at: string;
  tasks: {
    english_text: string;
    type: string;
    languages: {
      name: string;
      code: string;
    };
  } | null;
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function resetUsageIfNeeded(supabase: ReturnType<typeof getSupabaseAdmin>, keyRow: ApiKeyRow): Promise<ApiKeyRow> {
  const now = new Date();
  if (new Date(keyRow.usage_reset_at) > now) return keyRow;

  const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const { data, error } = await supabase
    .from("api_keys")
    .update({ monthly_usage: 0, usage_reset_at: nextReset.toISOString() })
    .eq("id", keyRow.id)
    .select()
    .single();

  if (error || !data) return { ...keyRow, monthly_usage: 0, usage_reset_at: nextReset.toISOString() };
  return data as ApiKeyRow;
}

async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"] as string | undefined;
  if (!apiKey) {
    res.status(401).json({ error: "Missing X-API-Key header. Generate a key at POST /api/v1/keys." });
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key", apiKey)
    .maybeSingle();

  if (error || !data) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  let keyRow = data as ApiKeyRow;
  keyRow = await resetUsageIfNeeded(supabase, keyRow);

  if (keyRow.tier === "free" && keyRow.monthly_usage >= FREE_QUOTA) {
    res.status(429).json({
      error: "Monthly quota exceeded",
      quota: FREE_QUOTA,
      usage: keyRow.monthly_usage,
      reset_at: keyRow.usage_reset_at,
    });
    return;
  }

  const { error: updateError } = await supabase
    .from("api_keys")
    .update({ monthly_usage: keyRow.monthly_usage + 1 })
    .eq("id", keyRow.id);

  if (updateError) {
    console.error("[PublicAPI] Failed to increment usage counter:", updateError.message);
  }

  next();
}

router.get("/recordings", requireApiKey, async (req: Request, res: Response) => {
  const { language, language_code, type, date_from, date_to } = req.query;
  const limit = Math.min(parseInt((req.query.limit as string) || "20", 10), 100);
  const offset = parseInt((req.query.offset as string) || "0", 10);

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("recordings")
    .select(`
      id,
      sia_cid,
      notes,
      created_at,
      tasks!inner(
        english_text,
        type,
        languages!inner(
          name,
          code
        )
      )
    `)
    .not("sia_cid", "is", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (type) {
    query = query.eq("tasks.type", type as string);
  }
  if (language_code) {
    query = query.eq("tasks.languages.code", language_code as string);
  }
  if (language) {
    query = query.ilike("tasks.languages.name", `%${language as string}%`);
  }
  if (date_from) {
    query = query.gte("created_at", date_from as string);
  }
  if (date_to) {
    query = query.lte("created_at", date_to as string);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[PublicAPI] recordings query error:", error.message);
    res.status(500).json({ error: error.message });
    return;
  }

  const rows = (data || []) as RecordingRow[];
  const results = rows.map((r) => ({
    language: r.tasks?.languages?.name ?? null,
    language_code: r.tasks?.languages?.code ?? null,
    prompt: r.tasks?.english_text ?? null,
    type: r.tasks?.type ?? null,
    cid: r.sia_cid ? `sia://${r.sia_cid}` : null,
    recording_text: r.notes ?? null,
    created_at: r.created_at,
  }));

  res.json({ data: results, limit, offset, count: results.length });
});

async function getUserFromToken(authHeader: string | undefined, res: Response): Promise<{ id: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return null;
  }
  const token = authHeader.slice(7);
  const supabase = getSupabaseAdmin();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return null;
  }
  return user;
}

router.post("/keys", async (req: Request, res: Response) => {
  const user = await getUserFromToken(req.headers.authorization, res);
  if (!user) return;

  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from("api_keys")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    const keyRow = await resetUsageIfNeeded(supabase, existing as ApiKeyRow);
    res.json({
      key: keyRow.key,
      tier: keyRow.tier,
      monthly_usage: keyRow.monthly_usage,
      quota: keyRow.tier === "free" ? FREE_QUOTA : null,
      usage_reset_at: keyRow.usage_reset_at,
    });
    return;
  }

  const key = randomBytes(16).toString("hex");
  const nextReset = new Date();
  nextReset.setMonth(nextReset.getMonth() + 1);
  nextReset.setDate(1);
  nextReset.setHours(0, 0, 0, 0);

  const { data: newKey, error: insertError } = await supabase
    .from("api_keys")
    .insert({
      user_id: user.id,
      key,
      tier: "free",
      monthly_usage: 0,
      usage_reset_at: nextReset.toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    res.status(500).json({ error: insertError.message });
    return;
  }

  const keyRow = newKey as ApiKeyRow;
  res.status(201).json({
    key: keyRow.key,
    tier: keyRow.tier,
    monthly_usage: 0,
    quota: FREE_QUOTA,
    usage_reset_at: keyRow.usage_reset_at,
  });
});

router.get("/keys/me", async (req: Request, res: Response) => {
  const user = await getUserFromToken(req.headers.authorization, res);
  if (!user) return;

  const supabase = getSupabaseAdmin();

  const { data } = await supabase
    .from("api_keys")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) {
    res.status(404).json({ error: "No API key found. POST /api/v1/keys to generate one." });
    return;
  }

  const keyRow = await resetUsageIfNeeded(supabase, data as ApiKeyRow);

  res.json({
    key: keyRow.key,
    tier: keyRow.tier,
    monthly_usage: keyRow.monthly_usage,
    quota: keyRow.tier === "free" ? FREE_QUOTA : null,
    usage_reset_at: keyRow.usage_reset_at,
  });
});

export default router;
