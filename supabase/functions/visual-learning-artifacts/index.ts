// VISUAL.LEARNING.OS — Cut 7: Admin Approval Workflow ServerFns
//
// Single edge function exposing admin-only CRUD/lifecycle actions and a
// learner-safe "list published for lesson" delivery endpoint.
//
// - Admin actions require has_role(uid, 'admin').
// - All writes go through this function (no client INSERT/UPDATE).
// - Status transitions validated via Pure FSM mirror (kept in sync with
//   src/lib/visual-learning-os/persistence-policy.ts).
// - Every transition writes an audit event.
// - Learner endpoint returns only published, projected artifacts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type PersistedStatus =
  | "draft"
  | "needs_review"
  | "approved"
  | "published"
  | "archived";

const ALLOWED: Record<PersistedStatus, PersistedStatus[]> = {
  draft: ["needs_review", "archived"],
  needs_review: ["draft", "approved", "archived"],
  approved: ["published", "archived"],
  published: ["archived"],
  archived: [],
};

function transitionAllowed(from: PersistedStatus, to: PersistedStatus) {
  return ALLOWED[from]?.includes(to) ?? false;
}

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return bad("POST required", 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: userRes } = await userClient.auth.getUser();
  const user = userRes?.user ?? null;

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return bad("invalid json");
  }
  const action: string = payload?.action ?? "";

  // ---- Learner-safe delivery (auth required, returns only published) ----
  if (action === "listPublishedForLesson") {
    if (!user) return bad("auth_required", 401);
    const { curriculum_id, competence_id, lesson_id } = payload;
    if (!curriculum_id || !competence_id) {
      return bad("curriculum_id and competence_id required");
    }
    let q = admin
      .from("visual_learning_artifacts")
      .select(
        "id, curriculum_id, competence_id, lesson_id, artifact_type, title, version, status, artifact_json, published_at",
      )
      .eq("status", "published")
      .eq("curriculum_id", curriculum_id)
      .eq("competence_id", competence_id);
    if (lesson_id) q = q.eq("lesson_id", lesson_id);
    const { data, error } = await q.order("published_at", { ascending: false });
    if (error) return bad(error.message, 500);

    // Project learner-safe (strip internal fields)
    const projected = (data ?? []).map((row: any) => {
      const a = row.artifact_json ?? {};
      return {
        id: row.id,
        curriculum_id: row.curriculum_id,
        competence_id: row.competence_id,
        lesson_id: row.lesson_id,
        artifact_type: row.artifact_type,
        title: row.title,
        version: row.version,
        status: "published",
        focus_question: a.focus_question,
        nodes: a.nodes ?? [],
        edges: a.edges ?? [],
        misconceptions: (a.misconceptions ?? []).map((m: any) => ({
          kind: m.kind,
          target_node_id: m.target_node_id,
          target_edge: m.target_edge,
          description: m.description,
        })),
        accessibility: a.accessibility,
        published_at: row.published_at,
      };
    });
    return ok({ artifacts: projected });
  }

  // ---- Admin-only actions ----
  if (!user) return bad("auth_required", 401);
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  if (!isAdmin) return bad("forbidden", 403);

  async function writeEvent(
    artifact_id: string,
    event_type: string,
    from_status: string | null,
    to_status: string | null,
    extra: Record<string, unknown> = {},
  ) {
    await admin.from("visual_learning_artifact_events").insert({
      artifact_id,
      event_type,
      from_status,
      to_status,
      actor_id: user!.id,
      event_json: extra,
    });
  }

  async function transition(id: string, to: PersistedStatus, extra: Record<string, unknown> = {}) {
    const { data: cur, error: e1 } = await admin
      .from("visual_learning_artifacts")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (e1 || !cur) return bad("not_found", 404);
    const from = cur.status as PersistedStatus;
    if (!transitionAllowed(from, to)) {
      return bad(`invalid_transition: ${from} → ${to}`, 422);
    }
    const patch: Record<string, unknown> = { status: to };
    const nowIso = new Date().toISOString();
    if (to === "approved") {
      patch.reviewed_by = user!.id;
      patch.reviewed_at = nowIso;
    } else if (to === "published") {
      patch.published_by = user!.id;
      patch.published_at = nowIso;
    } else if (to === "archived") {
      patch.archived_at = nowIso;
    }
    const { data: updated, error: e2 } = await admin
      .from("visual_learning_artifacts")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (e2) return bad(e2.message, 500);
    await writeEvent(id, `transition:${to}`, from, to, extra);
    return ok({ artifact: updated });
  }

  switch (action) {
    case "list": {
      const { status, curriculum_id, competence_id, lesson_id, blueprint_id, limit = 100 } = payload;
      let q = admin
        .from("visual_learning_artifacts")
        .select(
          "id, curriculum_id, competence_id, lesson_id, blueprint_id, artifact_type, status, version, title, created_at, updated_at, published_at",
        )
        .order("updated_at", { ascending: false })
        .limit(Math.min(Number(limit) || 100, 500));
      if (status) q = q.eq("status", status);
      if (curriculum_id) q = q.eq("curriculum_id", curriculum_id);
      if (competence_id) q = q.eq("competence_id", competence_id);
      if (lesson_id) q = q.eq("lesson_id", lesson_id);
      if (blueprint_id) q = q.eq("blueprint_id", blueprint_id);
      const { data, error } = await q;
      if (error) return bad(error.message, 500);
      return ok({ artifacts: data ?? [] });
    }
    case "get": {
      const { id } = payload;
      if (!id) return bad("id required");
      const { data, error } = await admin
        .from("visual_learning_artifacts")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) return bad(error.message, 500);
      if (!data) return bad("not_found", 404);
      const { data: events } = await admin
        .from("visual_learning_artifact_events")
        .select("*")
        .eq("artifact_id", id)
        .order("created_at", { ascending: false })
        .limit(200);
      return ok({ artifact: data, events: events ?? [] });
    }
    case "createDraft": {
      const { record } = payload; // PreparedPersistenceRecord from Pure helper
      if (!record?.curriculum_id || !record?.competence_id) {
        return bad("curriculum_id and competence_id required", 422);
      }
      if (!Array.isArray(record?.source_refs) || record.source_refs.length === 0) {
        return bad("source_refs required", 422);
      }
      const status: PersistedStatus = record.status === "needs_review" ? "needs_review" : "draft";
      const { data, error } = await admin
        .from("visual_learning_artifacts")
        .insert({
          curriculum_id: record.curriculum_id,
          competence_id: record.competence_id,
          lesson_id: record.lesson_id ?? null,
          blueprint_id: record.blueprint_id ?? null,
          artifact_type: record.artifact_type,
          pattern: record.pattern,
          status,
          version: record.version ?? 1,
          title: record.title,
          artifact_json: record.artifact_json,
          review_json: record.review_json ?? null,
          source_refs: record.source_refs,
          created_by: user.id,
        })
        .select("*")
        .single();
      if (error) return bad(error.message, 500);
      await writeEvent(data.id, "created", null, status, { is_ai_draft: !!payload.is_ai_draft });
      return ok({ artifact: data });
    }
    case "submitForReview":
      return transition(payload.id, "needs_review");
    case "approve": {
      const { id, review_json } = payload;
      if (!id) return bad("id required");
      if (!review_json || review_json.status !== "approved" || (review_json.blockers?.length ?? 0) > 0) {
        return bad("review_required_green", 422);
      }
      await admin.from("visual_learning_artifacts").update({ review_json }).eq("id", id);
      return transition(id, "approved");
    }
    case "publish":
      return transition(payload.id, "published");
    case "archive":
      return transition(payload.id, "archived");
    default:
      return bad(`unknown_action: ${action}`);
  }
});
