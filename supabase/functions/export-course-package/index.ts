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
    console.log(`[export] Package ${packageId}, course ${cid}`);

    // ── Load build steps ──
    const { data: steps } = await sb
      .from("package_steps")
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

    console.log(`[export] curriculumId: ${curriculumId}`);

    // ── Load handbook ──
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

    // ── Questions summary ──
    let questionsSummary: Record<string, unknown> = { note: "no_summary" };
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
    }

    // ── Course snapshot ──
    let courseSnapshot: unknown = null;
    let moduleIds: string[] = [];
    if (cid) {
      try {
        const { data: course } = await sb.from("courses").select("id, title, status, description, estimated_duration, curriculum_id").eq("id", cid).maybeSingle();
        const { data: modules } = await sb.from("modules").select("id, title, sort_order").eq("course_id", cid).order("sort_order");
        moduleIds = (modules || []).map((m: Record<string, unknown>) => m.id as string);
        let lessonCount = 0;
        let placeholderCount = 0;
        if (moduleIds.length > 0) {
          const { count } = await sb.from("lessons").select("id", { count: "exact", head: true }).in("module_id", moduleIds);
          lessonCount = count ?? 0;
          const { count: phCount } = await sb.from("lessons").select("id", { count: "exact", head: true })
            .in("module_id", moduleIds)
            .is("content", null);
          placeholderCount = phCount ?? 0;
        }
        courseSnapshot = { course, modules, lessonsCount: lessonCount, placeholderLessons: placeholderCount };
      } catch (_e) { /* best-effort */ }
    }

    // ══════════════════════════════════════════════════════
    // ── CONTENT SAMPLES for Quality Audit ──
    // ══════════════════════════════════════════════════════

    // ── Sample Lessons: 2-3 per module ──
    const lessonSamples: unknown[] = [];
    if (cid && moduleIds.length > 0) {
      console.log(`[export] Collecting lesson samples from ${moduleIds.length} modules`);
      try {
        const { data: modules } = await sb.from("modules").select("id, title, sort_order").eq("course_id", cid).order("sort_order");
        for (const mod of (modules || []).slice(0, 12) as Record<string, unknown>[]) {
          const { data: lessons, error: lErr } = await sb
            .from("lessons")
            .select("id, title, content, minicheck_parsed, sort_order, qc_status")
            .eq("module_id", mod.id as string)
            .not("content", "is", null)
            .order("sort_order")
            .limit(3);
          if (lErr) {
            console.log(`[export] Lesson query error for module ${mod.id}: ${lErr.message}`);
            continue;
          }
          for (const l of (lessons || []) as Record<string, unknown>[]) {
            const contentStr = typeof l.content === "string" ? l.content : JSON.stringify(l.content);
            lessonSamples.push({
              module: mod.title,
              lesson_id: l.id,
              title: l.title,
              content_preview: contentStr.slice(0, 8000),
              content_length: contentStr.length,
              minicheck_parsed: l.minicheck_parsed,
              qc_status: l.qc_status,
            });
          }
        }
      } catch (e) {
        console.log(`[export] Lesson samples error: ${(e as Error).message}`);
      }
    }
    console.log(`[export] Collected ${lessonSamples.length} lesson samples`);

    // ── ALL approved Exam Questions (paginated, no limit) ──
    const questionSamples: unknown[] = [];
    if (curriculumId) {
      console.log(`[export] Collecting ALL approved exam questions for curriculum ${curriculumId}`);
      try {
        const pageSize = 500;
        let offset = 0;
        while (true) {
          const { data: batch, error: qErr } = await sb
            .from("exam_questions")
            .select("id, question_text, options, correct_answer, explanation, difficulty, cognitive_level, learning_field_id, qc_status")
            .eq("curriculum_id", curriculumId)
            .eq("qc_status", "approved")
            .range(offset, offset + pageSize - 1);
          if (qErr) {
            console.log(`[export] Question query error at offset ${offset}: ${qErr.message}`);
            break;
          }
          if (!batch || batch.length === 0) break;
          for (const q of batch as Record<string, unknown>[]) {
            questionSamples.push({
              id: q.id,
              question_text: q.question_text,
              options: q.options,
              correct_answer: q.correct_answer,
              explanation: q.explanation,
              difficulty: q.difficulty,
              cognitive_level: q.cognitive_level,
              learning_field_id: q.learning_field_id,
              qc_status: q.qc_status,
            });
          }
          if (batch.length < pageSize) break;
          offset += pageSize;
        }
      } catch (e) {
        console.log(`[export] Question export error: ${(e as Error).message}`);
      }
    }
    console.log(`[export] Collected ${questionSamples.length} approved questions`);

    // ── AI Tutor Samples ──
    const tutorSamples: unknown[] = [];
    try {
      const { data: tutorLogs, error: tErr } = await sb
        .from("ai_tutor_logs")
        .select("id, mode, session_type, prompt_length, response_length, tokens_used, was_blocked, block_reason, metadata, created_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (tErr) {
        console.log(`[export] Tutor logs error: ${tErr.message}`);
      } else {
        for (const t of (tutorLogs || []) as Record<string, unknown>[]) {
          tutorSamples.push(t);
        }
      }
    } catch (e) {
      console.log(`[export] Tutor samples error: ${(e as Error).message}`);
    }
    console.log(`[export] Collected ${tutorSamples.length} tutor samples`);

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

    // Content samples (critical for audit)
    zip.file("samples/lesson_samples.json", JSON.stringify(lessonSamples, null, 2));
    zip.file("samples/exam_questions_approved.json", JSON.stringify(questionSamples, null, 2));
    zip.file("samples/tutor_log_samples.json", JSON.stringify(tutorSamples, null, 2));

    // Export manifest with counts for quick verification
    const manifest = {
      exported_at: new Date().toISOString(),
      package_id: packageId,
      course_id: cid,
      curriculum_id: curriculumId,
      content_counts: {
        lesson_samples: lessonSamples.length,
        question_samples: questionSamples.length,
        tutor_log_samples: tutorSamples.length,
        handbook_length_chars: handbookMd.length,
        handbook_is_placeholder: handbookMd.length < 500,
      },
      questions_summary: questionsSummary,
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

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
          samples: {
            lessons: lessonSamples.length,
            questions: questionSamples.length,
            tutorLogs: tutorSamples.length,
          },
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
      manifest,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[export-course-package] Error:", message);
    return json({ error: message }, 500);
  }
});
