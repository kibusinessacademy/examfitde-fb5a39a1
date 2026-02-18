import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import JSZip from "https://esm.sh/jszip@3.10.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function safeFilename(name: string) {
  return name
    .replace(/[^a-z0-9\-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .substring(0, 60);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let { packageId, courseId } = await req.json().catch(() => ({} as Record<string, unknown>));

  // If UI sends courseId: resolve latest package for that course
  if (!packageId && courseId) {
    const { data: latestPkg } = await sb
      .from("course_packages")
      .select("id")
      .eq("course_id", courseId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestPkg?.id) packageId = latestPkg.id;
  }

  if (!packageId) return json({ error: "packageId or courseId required" }, 400);

  try {
    // ── Load package ──
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select("*")
      .eq("id", packageId)
      .single();
    if (pkgErr || !pkg) return json({ error: pkgErr?.message || "Package not found" }, 404);

    const cid = courseId || (pkg as Record<string, unknown>).course_id;

    // ── Load build steps ──
    const { data: steps } = await sb
      .from("course_package_build_steps")
      .select("*")
      .eq("package_id", packageId)
      .order("sort_order");

    // ── Load approved plan ──
    const { data: plan } = await sb
      .from("course_package_plans")
      .select("*")
      .eq("package_id", packageId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const planJson = plan as Record<string, unknown> | null;
    let curriculumId = (planJson?.plan as Record<string, unknown>)?.curriculum_id as string | undefined;

    // Fallback: resolve curriculumId from course record
    if (!curriculumId && cid) {
      try {
        const { data: cRec } = await sb.from("courses").select("curriculum_id").eq("id", cid).maybeSingle();
        if (cRec?.curriculum_id) curriculumId = cRec.curriculum_id;
      } catch (_e) { /* best-effort */ }
    }

    // ── Load handbook (FIXED: use content_markdown, not content_md) ──
    let handbookMd = "# Handbuch\n\n_(nicht verfügbar)_\n";
    if (curriculumId) {
      try {
        const { data: chapters } = await sb
          .from("handbook_chapters")
          .select("id, title, sort_order")
          .eq("curriculum_id", curriculumId)
          .order("sort_order");

        if (chapters?.length) {
          const parts: string[] = ["# Handbuch\n"];
          for (const ch of chapters as Record<string, unknown>[]) {
            parts.push(`\n## ${ch.title}\n`);
            const { data: sections } = await sb
              .from("handbook_sections")
              .select("title, content_markdown, sort_order")
              .eq("chapter_id", ch.id as string)
              .order("sort_order");

            for (const s of (sections || []) as Record<string, unknown>[]) {
              parts.push(`\n### ${s.title}\n\n${s.content_markdown || "_(kein Inhalt)_"}\n`);
            }
          }
          handbookMd = parts.join("\n");
        }
      } catch (_e) { /* best-effort */ }
    }

    // ── Oral sessionset ──
    const { data: oralSet } = await sb
      .from("oral_exam_sessionsets")
      .select("*")
      .eq("package_id", packageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // ── Tutor index + policy ──
    const { data: tutorIndex } = await sb
      .from("ai_tutor_context_index")
      .select("*")
      .eq("package_id", packageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let tutorPolicy: unknown = null;
    if (curriculumId) {
      const { data } = await sb
        .from("ai_tutor_policies")
        .select("*")
        .eq("curriculum_id", curriculumId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      tutorPolicy = data;
    }

    // ── Questions summary with APPROVED vs TOTAL breakdown ──
    let questionsSummary: Record<string, unknown> = { note: "no_summary" };
    try {
      if (curriculumId) {
        const { count: totalCount } = await sb
          .from("exam_questions").select("id", { count: "exact", head: true })
          .eq("curriculum_id", curriculumId);
        const { count: approvedCount } = await sb
          .from("exam_questions").select("id", { count: "exact", head: true })
          .eq("curriculum_id", curriculumId).eq("qc_status", "approved");
        const { count: pendingCount } = await sb
          .from("exam_questions").select("id", { count: "exact", head: true })
          .eq("curriculum_id", curriculumId).eq("qc_status", "pending");
        questionsSummary = {
          total_exam_questions: totalCount ?? 0,
          approved_questions: approvedCount ?? 0,
          pending_questions: pendingCount ?? 0,
          curriculum_id: curriculumId,
          note: "approved = production-ready, pending = awaiting QC",
        };
      } else {
        questionsSummary = { total_exam_questions: 0, note: "no_curriculum_id_resolved" };
      }
    } catch (_e) { /* best-effort */ }

    // ── Course snapshot (lessons via modules join) ──
    let courseSnapshot: unknown = null;
    if (cid) {
      try {
        const { data: course } = await sb.from("courses").select("id, title, status, description, estimated_duration, curriculum_id").eq("id", cid).maybeSingle();
        const { data: modules } = await sb.from("modules").select("id, title, sort_order").eq("course_id", cid).order("sort_order");
        const moduleIds = (modules || []).map((m: Record<string, unknown>) => m.id as string);
        let lessonCount = 0;
        if (moduleIds.length > 0) {
          const { count } = await sb.from("lessons").select("id", { count: "exact", head: true }).in("module_id", moduleIds);
          lessonCount = count ?? 0;
        }
        courseSnapshot = { course, modules, lessonsCount: lessonCount };
      } catch (_e) { /* best-effort */ }
    }

    // ══════════════════════════════════════════════════════
    // ── NEW: Content Samples for Quality Audit ──
    // ══════════════════════════════════════════════════════

    // ── Sample Lessons: 2-3 per module (up to 36 total) ──
    let lessonSamples: unknown[] = [];
    if (cid) {
      try {
        const { data: modules } = await sb.from("modules").select("id, title, sort_order").eq("course_id", cid).order("sort_order");
        for (const mod of (modules || []).slice(0, 12) as Record<string, unknown>[]) {
          const { data: lessons } = await sb
            .from("lessons")
            .select("id, title, content, mini_checks, metadata, sort_order")
            .eq("module_id", mod.id as string)
            .order("sort_order")
            .limit(3);
          for (const l of (lessons || []) as Record<string, unknown>[]) {
            lessonSamples.push({
              module: mod.title,
              lesson_id: l.id,
              title: l.title,
              content: typeof l.content === "string" ? l.content.slice(0, 8000) : l.content,
              mini_checks: l.mini_checks,
              metadata: l.metadata,
            });
          }
        }
      } catch (_e) { /* best-effort */ }
    }

    // ── Sample Exam Questions: 50 random approved questions ──
    let questionSamples: unknown[] = [];
    if (curriculumId) {
      try {
        // Get 50 random approved questions across difficulty/type
        const { data: questions } = await sb
          .from("exam_questions")
          .select("id, question_text, options, correct_answer, explanation, difficulty, question_type, bloom_level, learning_field_id, qc_status, metadata")
          .eq("curriculum_id", curriculumId)
          .eq("qc_status", "approved")
          .limit(50);
        questionSamples = (questions || []).map((q: Record<string, unknown>) => ({
          id: q.id,
          question_text: q.question_text,
          options: q.options,
          correct_answer: q.correct_answer,
          explanation: q.explanation,
          difficulty: q.difficulty,
          question_type: q.question_type,
          bloom_level: q.bloom_level,
          learning_field_id: q.learning_field_id,
          qc_status: q.qc_status,
        }));
      } catch (_e) { /* best-effort */ }
    }

    // ── AI Tutor Samples: recent tutor logs with prompts ──
    let tutorSamples: unknown[] = [];
    try {
      const { data: tutorLogs } = await sb
        .from("ai_tutor_logs")
        .select("id, mode, session_type, prompt_length, response_length, tokens_used, was_blocked, block_reason, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      tutorSamples = tutorLogs || [];
    } catch (_e) { /* best-effort */ }

    // ── Build ZIP ──
    const zip = new JSZip();
    zip.file("package.json", JSON.stringify(pkg, null, 2));
    zip.file("plan.json", JSON.stringify(plan || {}, null, 2));
    zip.file("steps.json", JSON.stringify(steps || [], null, 2));
    zip.file("handbook.md", handbookMd);
    zip.file("oral_exam.json", JSON.stringify(oralSet || {}, null, 2));
    zip.file("tutor_index.json", JSON.stringify({ tutorIndex, tutorPolicy }, null, 2));
    zip.file("questions_summary.json", JSON.stringify(questionsSummary, null, 2));
    zip.file("course_snapshot.json", JSON.stringify(courseSnapshot || {}, null, 2));

    // NEW: Audit content samples
    zip.file("samples/lesson_samples.json", JSON.stringify(lessonSamples, null, 2));
    zip.file("samples/exam_question_samples.json", JSON.stringify(questionSamples, null, 2));
    zip.file("samples/tutor_log_samples.json", JSON.stringify(tutorSamples, null, 2));

    const bytes = await zip.generateAsync({ type: "uint8array" });

    // ── Upload to Storage ──
    const bucket = "exports";
    const pkgTitle = safeFilename(String((pkg as Record<string, unknown>).title || packageId));
    const dateStr = new Date().toISOString().split("T")[0];
    const path = `packages/${packageId}/${pkgTitle}-${dateStr}.zip`;

    const { error: uploadErr } = await sb.storage
      .from(bucket)
      .upload(path, bytes, { contentType: "application/zip", upsert: true });
    if (uploadErr) return json({ error: `Upload failed: ${uploadErr.message}` }, 500);

    // ── Signed URL (1h) ──
    const { data: signed, error: signErr } = await sb.storage
      .from(bucket)
      .createSignedUrl(path, 3600);
    if (signErr) return json({ error: signErr.message }, 500);

    // ── Persist output link ──
    await sb.from("course_package_outputs").upsert(
      {
        package_id: packageId,
        output_key: "export_zip",
        payload: {
          downloadUrl: signed.signedUrl,
          bucket,
          path,
          fileSize: bytes.length,
          created_at: new Date().toISOString(),
        },
      },
      { onConflict: "package_id,output_key" }
    );

    return json({
      ok: true,
      downloadUrl: signed.signedUrl,
      fileName: path,
      fileSize: bytes.length,
      samples: {
        lessons: lessonSamples.length,
        questions: questionSamples.length,
        tutorLogs: tutorSamples.length,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[export-course-package] Error:", message);
    return json({ error: message }, 500);
  }
});
