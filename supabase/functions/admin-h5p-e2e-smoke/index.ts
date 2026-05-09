// Edge Function: admin-h5p-e2e-smoke
// Runs an end-to-end verification chain after an H5P upload.
//
// Steps:
//   1. storage_object        — h5p-content/<content_id>/h5p.json exists (proxy for h5p_content row)
//   2. lesson_link           — lessons.h5p_content_id = content_id
//   3. update_lesson_outcome — upsert lesson_outcomes row (status=completed, score)
//   4. h5p_completed_event   — insert learning_events row (event_type=lesson_completed, payload.h5p=true)
//   5. exam_readiness        — call calculate_exam_readiness (if curriculum_id given)
//
// Auth: admin role required.

import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "h5p-content";

type StepStatus = "ok" | "fail" | "skipped";
interface StepResult {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
  data?: unknown;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u, error: uErr } = await userClient.auth.getUser();
  if (uErr || !u?.user) return json({ error: "unauthorized" }, 401);
  const { data: isAdmin } = await userClient.rpc("has_role", {
    _user_id: u.user.id,
    _role: "admin",
  });
  if (!isAdmin) return json({ error: "forbidden: admin required" }, 403);

  let body: {
    content_id?: string;
    lesson_id?: string;
    curriculum_id?: string;
    score?: number;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  const contentId = body.content_id?.trim();
  const lessonId = body.lesson_id?.trim();
  const curriculumId = body.curriculum_id?.trim() || null;
  const score = typeof body.score === "number" ? body.score : 85;

  if (!contentId || !lessonId) {
    return json({ error: "content_id and lesson_id required" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const steps: StepResult[] = [];
  const startedAt = new Date().toISOString();

  // 1) Storage object — proxy for h5p_content row (no separate table in this project)
  try {
    const path = `${contentId}/h5p.json`;
    const { data: signed, error: sErr } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, 60);
    if (sErr || !signed?.signedUrl) {
      steps.push({
        key: "storage_object",
        label: "Storage-Objekt (h5p.json)",
        status: "fail",
        detail: sErr?.message ?? "kein signed URL",
      });
    } else {
      steps.push({
        key: "storage_object",
        label: "Storage-Objekt (h5p.json)",
        status: "ok",
        detail: `bucket=${BUCKET} path=${path}`,
      });
    }
  } catch (e) {
    steps.push({
      key: "storage_object",
      label: "Storage-Objekt (h5p.json)",
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 2) Lesson link — set lessons.h5p_content_id = contentId (idempotent)
  let lessonRow:
    | { id: string; competency_id: string | null; module_id: string | null; h5p_content_id: string | null }
    | null = null;
  try {
    const { data: pre, error: preErr } = await admin
      .from("lessons")
      .select("id, competency_id, module_id, h5p_content_id")
      .eq("id", lessonId)
      .maybeSingle();
    if (preErr || !pre) {
      steps.push({
        key: "lesson_link",
        label: "Lesson-Verlinkung",
        status: "fail",
        detail: preErr?.message ?? "lesson nicht gefunden",
      });
    } else {
      if (pre.h5p_content_id !== contentId) {
        const { error: upErr } = await admin
          .from("lessons")
          .update({ h5p_content_id: contentId })
          .eq("id", lessonId);
        if (upErr) {
          steps.push({
            key: "lesson_link",
            label: "Lesson-Verlinkung",
            status: "fail",
            detail: upErr.message,
          });
        } else {
          lessonRow = { ...pre, h5p_content_id: contentId };
          steps.push({
            key: "lesson_link",
            label: "Lesson-Verlinkung",
            status: "ok",
            detail: "h5p_content_id gesetzt",
          });
        }
      } else {
        lessonRow = pre;
        steps.push({
          key: "lesson_link",
          label: "Lesson-Verlinkung",
          status: "ok",
          detail: "bereits verknüpft",
        });
      }
    }
  } catch (e) {
    steps.push({
      key: "lesson_link",
      label: "Lesson-Verlinkung",
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 3) update_lesson_outcome — upsert into lesson_outcomes
  try {
    if (!lessonRow) {
      steps.push({
        key: "update_lesson_outcome",
        label: "update_lesson_outcome",
        status: "skipped",
        detail: "Lesson-Link fehlgeschlagen",
      });
    } else {
      const nowIso = new Date().toISOString();
      const payload = {
        user_id: u.user.id,
        lesson_id: lessonId,
        competency_id: lessonRow.competency_id,
        status: "completed",
        score_percent: Math.round(score),
        attempts: 1,
        needs_review: false,
        completed_at: nowIso,
        last_attempt_at: nowIso,
      };
      const { error: outErr } = await admin
        .from("lesson_outcomes")
        .upsert(payload, { onConflict: "user_id,lesson_id" });
      if (outErr) {
        steps.push({
          key: "update_lesson_outcome",
          label: "update_lesson_outcome",
          status: "fail",
          detail: outErr.message,
        });
      } else {
        steps.push({
          key: "update_lesson_outcome",
          label: "update_lesson_outcome",
          status: "ok",
          detail: `score=${payload.score_percent}`,
        });
      }
    }
  } catch (e) {
    steps.push({
      key: "update_lesson_outcome",
      label: "update_lesson_outcome",
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 4) h5p_completed event — recorded as learning_events.lesson_completed with payload.h5p=true
  try {
    const { error: eErr } = await admin.from("learning_events").insert({
      user_id: u.user.id,
      event_type: "lesson_completed",
      lesson_id: lessonId,
      curriculum_id: curriculumId,
      competency_id: lessonRow?.competency_id ?? null,
      event_source: "admin_h5p_smoke",
      score: Math.round(score),
      payload: {
        h5p: true,
        h5p_completed: true,
        content_id: contentId,
        smoke: true,
      },
    });
    if (eErr) {
      steps.push({
        key: "h5p_completed_event",
        label: "h5p_completed Event",
        status: "fail",
        detail: eErr.message,
      });
    } else {
      steps.push({
        key: "h5p_completed_event",
        label: "h5p_completed Event",
        status: "ok",
        detail: "learning_events.lesson_completed (h5p=true)",
      });
    }
  } catch (e) {
    steps.push({
      key: "h5p_completed_event",
      label: "h5p_completed Event",
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  // 5) Exam-Readiness Snapshot
  try {
    if (!curriculumId) {
      steps.push({
        key: "exam_readiness",
        label: "Exam-Readiness Snapshot",
        status: "skipped",
        detail: "kein curriculum_id übergeben",
      });
    } else {
      const { data: r, error: rErr } = await admin.rpc(
        "calculate_exam_readiness",
        { p_user_id: u.user.id, p_curriculum_id: curriculumId },
      );
      if (rErr) {
        steps.push({
          key: "exam_readiness",
          label: "Exam-Readiness Snapshot",
          status: "fail",
          detail: rErr.message,
        });
      } else {
        steps.push({
          key: "exam_readiness",
          label: "Exam-Readiness Snapshot",
          status: "ok",
          detail: "calculate_exam_readiness ok",
          data: r,
        });
      }
    }
  } catch (e) {
    steps.push({
      key: "exam_readiness",
      label: "Exam-Readiness Snapshot",
      status: "fail",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const okCount = steps.filter((s) => s.status === "ok").length;
  const failCount = steps.filter((s) => s.status === "fail").length;
  const overall: "green" | "yellow" | "red" =
    failCount === 0 ? "green" : okCount > failCount ? "yellow" : "red";

  // Audit
  try {
    await admin.from("auto_heal_log").insert({
      action_type: "admin_h5p_e2e_smoke",
      target_type: "h5p_content",
      target_id: contentId,
      result_status: overall === "green" ? "success" : "failed",
      metadata: {
        actor: u.user.id,
        lesson_id: lessonId,
        curriculum_id: curriculumId,
        steps,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      },
    });
  } catch { /* ignore */ }

  return json({
    ok: failCount === 0,
    overall,
    summary: { ok: okCount, fail: failCount, total: steps.length },
    steps,
  });
});
