import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

interface RequestBody {
  courseId: string;
  includeQuestions?: boolean;
  includeH5p?: boolean;
}

let _reqOrigin: string | null = null;

function jsonResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...getCorsHeaders(_reqOrigin), "Content-Type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  _reqOrigin = req.headers.get('origin');

  // ==================== AUTH CHECK ====================
  const auth = await validateAuth(req, true); // requireAdmin = true
  
  if (auth.error) {
    if (auth.error === 'Admin access required') {
      return forbiddenResponse(auth.error);
    }
    return unauthorizedResponse(auth.error);
  }
  // ====================================================

  try {
    if (req.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization")!;

    const body = (await req.json()) as RequestBody;
    const courseId = body.courseId?.trim();
    
    if (!courseId) {
      return jsonResponse(400, { error: "courseId is required" });
    }

    const includeQuestions = body.includeQuestions ?? false;
    const includeH5p = body.includeH5p ?? true;

    // User client (respects RLS)
    const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    console.log(`[User: ${auth.user?.id}] Generating evidence pack for course: ${courseId}`);

    // Generate pack via existing export_course_pack RPC
    const { data: pack, error: packErr } = await sbUser.rpc("export_course_pack", {
      p_course_id: courseId,
      p_include_questions: includeQuestions,
      p_include_h5p: includeH5p,
    });

    if (packErr) {
      return jsonResponse(500, { error: packErr.message });
    }
    if (!pack) {
      return jsonResponse(500, { error: "export_course_pack returned null" });
    }

    const exportVersion = (pack as any).export_version ?? "1.0";
    const packText = JSON.stringify(pack);
    const fingerprint = await sha256Hex(packText);

    // Storage-first configuration
    const bucket = "evidence-packs";
    const ts = new Date().toISOString().replace(/:/g, "-");
    const storagePath = `courses/${courseId}/${ts}__${fingerprint.substring(0, 16)}.json`;

    // Service client for storage operations
    const sbService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Upload to storage (upsert=false for immutability)
    const uploadRes = await sbService.storage
      .from(bucket)
      .upload(storagePath, new Blob([packText], { type: "application/json" }), {
        upsert: false,
        contentType: "application/json",
      });

    // Handle "already exists" gracefully (idempotent)
    if (uploadRes.error && !uploadRes.error.message?.toLowerCase().includes("already exists")) {
      return jsonResponse(500, { error: `Storage upload failed: ${uploadRes.error.message}` });
    }

    // Register in database via RPC
    const { data: row, error: regErr } = await sbUser.rpc("register_course_evidence_pack", {
      p_course_id: courseId,
      p_fingerprint_sha256: fingerprint,
      p_export_version: exportVersion,
      p_storage_bucket: bucket,
      p_storage_path: storagePath,
      p_size_bytes: packText.length,
    });

    if (regErr) {
      return jsonResponse(500, { error: `Registration failed: ${regErr.message}` });
    }

    // Generate signed URL (24 hours validity)
    const { data: signed, error: signedErr } = await sbService.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 60 * 24);

    if (signedErr) {
      return jsonResponse(500, { error: `Signed URL failed: ${signedErr.message}` });
    }

    return jsonResponse(200, {
      ok: true,
      pack_id: (row as any)?.id,
      fingerprint_sha256: fingerprint,
      export_version: exportVersion,
      bucket,
      path: storagePath,
      size_bytes: packText.length,
      signed_url: signed?.signedUrl,
    });
  } catch (e) {
    console.error("generate-evidence-pack error:", e);
    return jsonResponse(500, { error: String((e as Error)?.message ?? e) });
  }
});