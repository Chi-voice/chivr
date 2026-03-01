export interface S5ArchiveParams {
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

export interface S5ArchiveResult {
  success: boolean;
  audio_cid?: string;
  metadata_cid?: string;
  error?: string;
}

export async function archiveToS5(params: S5ArchiveParams): Promise<S5ArchiveResult> {
  try {
    const res = await fetch("/api/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn("[S5Archive] Server returned", res.status, body);
      return { success: false, error: body?.error || `HTTP ${res.status}` };
    }

    return await res.json();
  } catch (err: any) {
    console.warn("[S5Archive] Failed to reach archive endpoint:", err?.message);
    return { success: false, error: err?.message || "Network error" };
  }
}
