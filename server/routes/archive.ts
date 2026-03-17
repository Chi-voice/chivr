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
    const { apiWithIdentity } = await getS5Client();

    // 1) Download audio from Supabase Storage using the admin client
    // (avoids 400/403 errors when the bucket is not public)
    console.log(`[Archive] Downloading audio for recording ${recording_id} (path: ${file_path})...`);
    const supabaseAdmin = getSupabaseAdmin();
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from("recordings")
      .download(file_path);
    if (downloadError || !fileData) {
      throw new Error(`Failed to download audio from storage: ${downloadError?.message ?? "no data"}`);
    }
    const audioBuffer = await fileData.arrayBuffer();
    const ext = (file_path.split(".").pop() || "webm").toLowerCase();
    const mimeType =
      ext === "m4a" ? "audio/mp4" :
      ext === "ogg" ? "audio/ogg" :
      ext === "wav" ? "audio/wav" :
      "audio/webm";

    // 2) Upload audio blob directly to S5 portal
    console.log(`[Archive] Uploading audio blob to S5 (${audioBuffer.byteLength} bytes, ${mimeType})...`);
    const audioBlobForUpload = new Blob([audioBuffer], { type: mimeType });
    const audioCidObj = await (apiWithIdentity as any).uploadBlob(audioBlobForUpload);
    const audioCid = audioCidObj?.toString?.() ?? audioCidObj?.hash?.toString?.() ?? JSON.stringify(audioCidObj);
    console.log(`[Archive] Audio CID: ${audioCid}`);

    // 3) Build and upload metadata JSON blob to S5
    const metadataPayload = {
      recording_id,
      ...metadata,
      s5_audio_cid: audioCid,
      supabase_audio_url: audio_url,
      archived_at: new Date().toISOString(),
    };
    const metadataJson = JSON.stringify(metadataPayload, null, 2);
    console.log(`[Archive] Uploading metadata blob to S5...`);
    const metadataBlobForUpload = new Blob([metadataJson], { type: "application/json" });
    const metadataCidObj = await (apiWithIdentity as any).uploadBlob(metadataBlobForUpload);
    const metadataCid = metadataCidObj?.toString?.() ?? metadataCidObj?.hash?.toString?.() ?? JSON.stringify(metadataCidObj);
    console.log(`[Archive] Metadata CID: ${metadataCid}`);

    // 4) Update the Supabase recordings row with both CIDs
    const supabase  = getSupabaseAdmin();
    const archivedAt = new Date().toISOString();

    // Try full update first (three columns)
    let { error: updateError } = await supabase
      .from("recordings")
      .update({ sia_cid: audioCid, sia_metadata_cid: metadataCid, sia_archived_at: archivedAt })
      .eq("id", recording_id);

    // If sia_metadata_cid column is missing (migration not yet applied), fall back
    if (updateError?.message?.includes("sia_metadata_cid")) {
      console.warn("[Archive] sia_metadata_cid column not found — updating with two columns only");
      ({ error: updateError } = await supabase
        .from("recordings")
        .update({ sia_cid: audioCid, sia_archived_at: archivedAt })
        .eq("id", recording_id));
    }

    if (updateError) {
      console.error("[Archive] Failed to update recording with CIDs:", updateError);
      res.status(500).json({
        error: "Archival succeeded but DB update failed",
        details: updateError.message,
      });
      return;
    }

    console.log(`[Archive] Recording ${recording_id} fully archived.`);
    res.json({ success: true, audio_cid: audioCid, metadata_cid: metadataCid });
  } catch (err: any) {
    console.error("[Archive] Error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
});

export default router;
