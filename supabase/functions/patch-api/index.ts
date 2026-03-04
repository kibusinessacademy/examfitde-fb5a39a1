import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

type Action =
  | "create_proposal"
  | "validate_proposal"
  | "approve_proposal"
  | "reject_proposal"
  | "apply_proposal"
  | "rollback_revision"
  | "list_proposals"
  | "list_revisions";

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  const auth = await validateAuth(req, true);
  if (auth.error) return unauthorizedResponse(auth.error, origin ?? undefined);
  if (!auth.user) return unauthorizedResponse("Not authenticated", origin ?? undefined);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const action: Action = body.action;

    if (!action) {
      return new Response(JSON.stringify({ error: "action required" }), { status: 400, headers });
    }

    // ---- LIST ----
    if (action === "list_proposals") {
      const statusFilter = body.status;
      let query = admin.from("patch_proposals").select("*").order("created_at", { ascending: false }).limit(100);
      if (statusFilter) query = query.eq("status", statusFilter);
      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ proposals: data }), { headers });
    }

    if (action === "list_revisions") {
      const patchId = body.patchId;
      let query = admin.from("patch_revisions").select("*").order("applied_at", { ascending: false }).limit(50);
      if (patchId) query = query.eq("patch_id", patchId);
      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ revisions: data }), { headers });
    }

    // ---- CREATE PROPOSAL ----
    if (action === "create_proposal") {
      const { councilId, entityType, entityId, before, after, diffSummary, risk = "medium" } = body;
      if (!councilId || !entityType || !entityId || !before || !after) {
        return new Response(JSON.stringify({ error: "councilId, entityType, entityId, before, after required" }), { status: 400, headers });
      }

      const dedupe_key = ["patch", councilId, entityType, String(entityId)].join("|").slice(0, 180);

      const { data, error } = await admin
        .from("patch_proposals")
        .insert({
          council_id: councilId,
          entity_type: entityType,
          entity_id: entityId,
          patch_type: "replace",
          before,
          after,
          diff_summary: diffSummary ?? null,
          risk,
          dedupe_key,
          status: "draft",
        })
        .select("*")
        .single();

      if (error) throw error;
      return new Response(JSON.stringify({ success: true, proposal: data }), { headers });
    }

    // ---- VALIDATE via validate-content (Opus) ----
    if (action === "validate_proposal") {
      const { patchId, mode = "quick", context } = body;
      if (!patchId) {
        return new Response(JSON.stringify({ error: "patchId required" }), { status: 400, headers });
      }

      const { data: patch, error: pErr } = await admin
        .from("patch_proposals")
        .select("*")
        .eq("id", patchId)
        .single();
      if (pErr) throw pErr;

      const validateUrl = `${supabaseUrl}/functions/v1/validate-content`;
      const res = await fetch(validateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          mode,
          content: patch.after,
          context: context ?? {},
          entityType: patch.entity_type,
          entityId: patch.entity_id,
        }),
      });

      if (!res.ok) throw new Error(`validate-content failed: ${await res.text()}`);
      const validator_result = await res.json();

      const decision = validator_result?.decision;
      const nextStatus =
        decision === "approve" ? "validated" :
        decision === "revise" ? "needs_revision" :
        decision === "reject" ? "rejected" :
        "draft";

      await admin
        .from("patch_proposals")
        .update({ validator_result, validated_at: new Date().toISOString(), status: nextStatus })
        .eq("id", patchId);

      return new Response(JSON.stringify({ success: true, status: nextStatus, validator_result }), { headers });
    }

    // ---- APPROVE/REJECT ----
    if (action === "approve_proposal" || action === "reject_proposal") {
      const { patchId } = body;
      if (!patchId) return new Response(JSON.stringify({ error: "patchId required" }), { status: 400, headers });

      const status = action === "approve_proposal" ? "approved" : "rejected";
      await admin
        .from("patch_proposals")
        .update({ status, approved_by: auth.user.id, approved_at: new Date().toISOString() })
        .eq("id", patchId);

      return new Response(JSON.stringify({ success: true, status }), { headers });
    }

    // ---- APPLY ----
    if (action === "apply_proposal") {
      const { patchId } = body;
      if (!patchId) return new Response(JSON.stringify({ error: "patchId required" }), { status: 400, headers });

      const { data: patch, error: pErr } = await admin
        .from("patch_proposals")
        .select("*")
        .eq("id", patchId)
        .single();
      if (pErr) throw pErr;

      if (patch.status !== "approved") {
        return forbiddenResponse("Patch must be approved before apply.", origin ?? undefined);
      }

      try {
        await applyEntity(admin, patch.entity_type, patch.entity_id, patch.after);
      } catch (applyErr: unknown) {
        const msg = applyErr instanceof Error ? applyErr.message : String(applyErr);
        await admin.from("patch_proposals").update({ status: "failed", apply_error: msg }).eq("id", patchId);
        throw applyErr;
      }

      await admin.from("patch_revisions").insert({
        patch_id: patch.id,
        entity_type: patch.entity_type,
        entity_id: patch.entity_id,
        before: patch.before,
        after: patch.after,
        applied_by: auth.user.id,
      });

      await admin.from("patch_proposals").update({ status: "applied", applied_at: new Date().toISOString() }).eq("id", patchId);

      return new Response(JSON.stringify({ success: true, status: "applied" }), { headers });
    }

    // ---- ROLLBACK ----
    if (action === "rollback_revision") {
      const { revisionId } = body;
      if (!revisionId) return new Response(JSON.stringify({ error: "revisionId required" }), { status: 400, headers });

      const { data: rev, error: rErr } = await admin
        .from("patch_revisions")
        .select("*")
        .eq("id", revisionId)
        .single();
      if (rErr) throw rErr;

      await applyEntity(admin, rev.entity_type, rev.entity_id, rev.before);

      await admin.from("patch_revisions").insert({
        patch_id: rev.patch_id,
        entity_type: rev.entity_type,
        entity_id: rev.entity_id,
        before: rev.after,
        after: rev.before,
        applied_by: auth.user.id,
        rollback_of: rev.id,
      });

      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
  } catch (e) {
    console.error("[patch-api] error", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers });
  }
});

// Whitelist-based entity apply — only known safe fields per entity type
async function applyEntity(admin: ReturnType<typeof createClient>, entityType: string, entityId: string, after: Record<string, unknown>) {
  const SAFE_FIELDS: Record<string, string[]> = {
    lesson: ["title", "content", "h5p_content_id", "duration_minutes", "sort_order"],
    course: ["title", "description", "status", "thumbnail_url", "estimated_duration"],
    question: ["question_text", "options", "correct_answer", "explanation", "difficulty", "status"],
  };

  const tableName: Record<string, string> = {
    lesson: "lessons",
    course: "courses",
    question: "exam_questions",
  };

  const fields = SAFE_FIELDS[entityType];
  const table = tableName[entityType];
  if (!fields || !table) throw new Error(`Unsupported entityType: ${entityType}`);

  const patch: Record<string, unknown> = {};
  for (const k of fields) {
    if (after?.[k] !== undefined) patch[k] = after[k];
  }
  if (Object.keys(patch).length === 0) throw new Error("No patchable fields in after payload");

  const { error } = await admin.from(table).update(patch).eq("id", entityId);
  if (error) throw error;
}
