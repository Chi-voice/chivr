import { Router, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { getS5Client } from "../services/s5Client.js";

const router = Router();

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

interface ArchiveBody {
  recording_id: string;
  audio_url: string;
  file_path: string;
  metadata: {
    task_id: string;
    language: string;
    language_code: string;
    english_text: string;
    task_type: string;
    difficulty: string;
    user_id: string;
    duration?: number;
    notes?: string;
    recorded_at: string;
  };
}

router.post("/archive", async (req: Request, res: Response) => {
  const { recording_id, audio_url, file_path, metadata } = req.body as ArchiveBody;

  if (!recording_id || !audio_url || !file_path || !metadata) {
    res.status(400).json({ error: "Missing required fields: recording_id, audio_url, file_path, metadata" });
    return;
  }

  try {
    const s5 = await getS5Client();

    // 1) Download audio from Supabase Storage (public URL)
    console.log(`[Archive] Downloading audio for recording ${recording_id}...`);
    const audioRes = await fetch(audio_url);
    if (!audioRes.ok) {
      throw new Error(`Failed to download audio: HTTP ${audioRes.status}`);
    }
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
    const ext = file_path.split(".").pop() || "webm";
    const mimeType = ext === "m4a" ? "audio/mp4"
      : ext === "ogg" ? "audio/ogg"
      : ext === "wav" ? "audio/wav"
      : "audio/webm";

    // 2) Upload audio to S5
    const audioS5Path = `recordings/${recording_id}/audio.${ext}`;
    console.log(`[Archive] Uploading audio to S5 at: ${audioS5Path}`);
    await s5.fs.put(audioS5Path, audioBuffer, { mimeType });
    const audioMeta = await s5.fs.getMetadata(audioS5Path);
    const audioCid: string = (audioMeta as any).hash ?? audioS5Path;

    // 3) Build and upload metadata JSON to S5
    const metadataPayload = {
      ...metadata,
      supabase_audio_url: audio_url,
      archived_at: new Date().toISOString(),
    };
    const metadataS5Path = `recordings/${recording_id}/metadata.json`;
    console.log(`[Archive] Uploading metadata to S5 at: ${metadataS5Path}`);
    await s5.fs.put(metadataS5Path, JSON.stringify(metadataPayload, null, 2), {
      mimeType: "application/json",
    });
    const metaMeta = await s5.fs.getMetadata(metadataS5Path);
    const metadataCid: string = (metaMeta as any).hash ?? metadataS5Path;

    console.log(`[Archive] Recording ${recording_id} archived. Audio CID: ${audioCid}, Metadata CID: ${metadataCid}`);

    // 4) Update the Supabase recordings row with both CIDs
    const supabase = getSupabaseAdmin();
    const { error: updateError } = await supabase
      .from("recordings")
      .update({
        sia_cid: audioCid,
        sia_metadata_cid: metadataCid,
        sia_archived_at: new Date().toISOString(),
      })
      .eq("id", recording_id);

    if (updateError) {
      console.error("[Archive] Failed to update recording with CIDs:", updateError);
      res.status(500).json({ error: "Archival succeeded but DB update failed", details: updateError.message });
      return;
    }

    res.json({ success: true, audio_cid: audioCid, metadata_cid: metadataCid });
  } catch (err: any) {
    console.error("[Archive] Error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
});

export default router;
