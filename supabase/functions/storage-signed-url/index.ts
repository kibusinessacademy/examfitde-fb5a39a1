import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { validateAuth, unauthorizedResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

interface RequestBody {
  bucket: string;
  path: string;
  curriculumId?: string;
  expiresIn?: number;
}

const ALLOWED_BUCKETS = new Set(["h5p-content", "course-media"]);

let _reqOrigin: string | null = null;

function jsonResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(_reqOrigin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  _reqOrigin = req.headers.get("origin");

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  // Auth check (any authenticated user)
  const auth = await validateAuth(req, false);
  if (auth.error) {
    return unauthorizedResponse(auth.error);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = (await req.json()) as RequestBody;
    const { bucket, path, curriculumId, expiresIn = 120 } = body;

    if (!bucket || !path) {
      return jsonResponse(400, { error: "bucket and path are required" });
    }

    if (!ALLOWED_BUCKETS.has(bucket)) {
      return jsonResponse(403, { error: "Bucket not allowed" });
    }

    // Clamp expiry: 30s–600s (videos may need longer)
    const clampedExpiry = Math.max(30, Math.min(600, expiresIn));

    // Path validation: if curriculumId is provided, the path must start with it
    // This prevents cross-curriculum access (user entitled to course A reading course B files)
    if (curriculumId && !path.startsWith(`${curriculumId}/`)) {
      return jsonResponse(403, { error: "Path does not match curriculum scope" });
    }

    // Service client for entitlement check + signed URL generation
    const sbService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const userId = auth.user!.id;

    // Entitlement check via RPC
    const { data: entitled, error: entErr } = await sbService.rpc(
      "has_storage_entitlement",
      {
        p_user_id: userId,
        p_curriculum_id: curriculumId ?? null,
      }
    );

    if (entErr) {
      console.error("Entitlement check failed:", entErr.message);
      return jsonResponse(500, { error: "Entitlement check failed" });
    }

    if (!entitled) {
      // Also allow admins
      const { data: isAdmin } = await sbService.rpc("has_role", {
        p_user_id: userId,
        p_role: "admin",
      });

      if (!isAdmin) {
        return jsonResponse(403, { error: "Not entitled to access this content" });
      }
    }

    // Generate signed URL
    const { data: signed, error: signedErr } = await sbService.storage
      .from(bucket)
      .createSignedUrl(path, clampedExpiry);

    if (signedErr) {
      console.error("Signed URL generation failed:", signedErr.message);
      return jsonResponse(500, { error: "Failed to generate signed URL" });
    }

    return jsonResponse(200, {
      signedUrl: signed.signedUrl,
      expiresIn: clampedExpiry,
    });
  } catch (e) {
    console.error("storage-signed-url error:", e);
    return jsonResponse(500, { error: String((e as Error)?.message ?? e) });
  }
});
