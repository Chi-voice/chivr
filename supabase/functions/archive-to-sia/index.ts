import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const S5_PORTAL_URL = Deno.env.get("S5_PORTAL_URL");
    if (!S5_PORTAL_URL) throw new Error("S5_PORTAL_URL is not configured");

    const S5_AUTH_TOKEN = Deno.env.get("S5_AUTH_TOKEN");
    if (!S5_AUTH_TOKEN) throw new Error("S5_AUTH_TOKEN is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { recording_id, audio_url, file_path } = await req.json();

    if (!recording_id || !audio_url || !file_path) {
      return new Response(
        JSON.stringify({ error: "Missing recording_id, audio_url, or file_path" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Archiving recording ${recording_id} to Sia via S5...`);

    // 1) Download the audio file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("recordings")
      .download(file_path);

    if (downloadError || !fileData) {
      console.error("Failed to download from storage:", downloadError);
      return new Response(
        JSON.stringify({ error: "Failed to download recording from storage", details: downloadError?.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2) Upload to S5 portal via its HTTP API (TUS or multipart)
    // The S5 portal exposes a standard upload endpoint
    // Ensure portal URL has a scheme
    let portalUrl = S5_PORTAL_URL.replace(/\/$/, "");
    if (!/^https?:\/\//i.test(portalUrl)) {
      portalUrl = `https://${portalUrl}`;
    }
    const uploadUrl = `${portalUrl}/s5/upload`;
    console.log(`Uploading to: ${uploadUrl}`);

    const formData = new FormData();
    formData.append("file", fileData, file_path.split("/").pop() || "recording.webm");

    const s5Response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${S5_AUTH_TOKEN}`,
      },
      body: formData,
    });

    if (!s5Response.ok) {
      const errorText = await s5Response.text();
      const respHeaders = Object.fromEntries(s5Response.headers.entries());
      console.error(`S5 upload failed [${s5Response.status}]:`, errorText, "headers:", JSON.stringify(respHeaders));
      return new Response(
        JSON.stringify({ error: "S5 upload failed", status: s5Response.status, details: errorText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const s5Result = await s5Response.json();
    const siaCid = s5Result.cid || s5Result.hash || s5Result.CID;

    if (!siaCid) {
      console.error("S5 response missing CID:", s5Result);
      return new Response(
        JSON.stringify({ error: "S5 response did not include a CID", response: s5Result }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Recording ${recording_id} archived to Sia with CID: ${siaCid}`);

    // 3) Update the recording row with the Sia CID
    const { error: updateError } = await supabase
      .from("recordings")
      .update({
        sia_cid: siaCid,
        sia_archived_at: new Date().toISOString(),
      })
      .eq("id", recording_id);

    if (updateError) {
      console.error("Failed to update recording with CID:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update recording", details: updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, cid: siaCid }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Archive to Sia error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
