import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { code, name } = await req.json();

    if (!code || !name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: code and name" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase environment not configured");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Try to find by code first
    const { data: existingByCode, error: findByCodeError } = await supabase
      .from("languages")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (findByCodeError) throw findByCodeError;

    if (existingByCode) {
      return new Response(
        JSON.stringify({ language: existingByCode }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Then try to find by name (handle unique constraint on name)
    const { data: existingByName, error: findByNameError } = await supabase
      .from("languages")
      .select("*")
      .eq("name", name)
      .maybeSingle();

    if (findByNameError) throw findByNameError;

    if (existingByName) {
      // If found by name, ensure code is set/updated
      if (!existingByName.code || existingByName.code !== code) {
        const { data: updated, error: updateError } = await supabase
          .from("languages")
          .update({ code })
          .eq("id", existingByName.id)
          .select("*")
          .single();
        if (updateError) throw updateError;
        return new Response(
          JSON.stringify({ language: updated }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ language: existingByName }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Neither code nor name exists: insert new
    const { data: inserted, error: insertError } = await supabase
      .from("languages")
      .insert({ code, name, is_popular: false })
      .select("*")
      .single();


    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({ language: inserted }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in upsert-language:", error);
    return new Response(
      JSON.stringify({ error: error.message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
