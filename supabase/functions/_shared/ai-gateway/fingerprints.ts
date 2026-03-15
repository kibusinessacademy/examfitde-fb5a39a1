/**
 * ai-gateway/fingerprints.ts — Request fingerprinting for idempotency and dedup.
 */

/**
 * Build a unique fingerprint for a generation request.
 * Used to prevent duplicate requests and for cache keying.
 */
export async function buildRequestFingerprint(parts: {
  jobType: string;
  sourceId?: string;
  targetArtifact: string;
  model?: string;
  promptSnippet?: string;
}): Promise<string> {
  const raw = [
    parts.jobType,
    parts.sourceId || "",
    parts.targetArtifact,
    parts.model || "",
    // Use first 200 chars of prompt for fingerprinting
    (parts.promptSnippet || "").slice(0, 200),
  ].join("|");

  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Check if a request with this fingerprint is already queued or processing.
 * Prevents duplicate enqueue.
 */
export async function checkDuplicateRequest(
  sb: any,
  fingerprint: string,
): Promise<{ isDuplicate: boolean; existingId?: string; existingStatus?: string }> {
  try {
    const { data } = await sb
      .from("ai_generation_requests")
      .select("id, status")
      .eq("request_fingerprint", fingerprint)
      .in("status", ["queued", "processing_sync", "batch_pending"])
      .maybeSingle();

    if (data) {
      return { isDuplicate: true, existingId: data.id, existingStatus: data.status };
    }
  } catch {
    // Best-effort dedup
  }

  return { isDuplicate: false };
}
