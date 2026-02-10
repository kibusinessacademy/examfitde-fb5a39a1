import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateAuth, unauthorizedResponse, forbiddenResponse } from "../_shared/auth.ts";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import JSZip from "https://esm.sh/jszip@3.10.1";

/**
 * Export Course Package – generates JSON + XLSX + TSX as ZIP
 * Admin-only. Stores result in Storage bucket "exports".
 * 
 * POST body: { courseId: string } or { jobId: string }
 * If jobId is provided, processes that queued job.
 * If courseId is provided, creates job + processes inline.
 */

interface LessonData {
  id: string;
  title: string;
  step: string;
  sort_order: number;
  objectives: string[];
  html: string;
  weight_tag: string | null;
  exam_block: string | null;
  minicheck_questions: any[];
  module_title: string;
  module_sort_order: number;
}

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;

  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  const auth = await validateAuth(req, true);
  if (auth.error) {
    return auth.error === "Admin access required"
      ? forbiddenResponse(auth.error, origin ?? undefined)
      : unauthorizedResponse(auth.error, origin ?? undefined);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { courseId, jobId } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Resolve job or create one
    let exportJobId = jobId;
    let targetCourseId = courseId;

    if (jobId) {
      const { data: job } = await sb.from("export_jobs").select("*").eq("id", jobId).single();
      if (!job) return new Response(JSON.stringify({ error: "Job not found" }), { status: 404, headers });
      targetCourseId = job.course_id;
    } else if (courseId) {
      const { data: job, error } = await sb
        .from("export_jobs")
        .insert({ created_by: auth.user!.id, course_id: courseId, status: "running" })
        .select("id")
        .single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      exportJobId = job.id;
    } else {
      return new Response(JSON.stringify({ error: "courseId or jobId required" }), { status: 400, headers });
    }

    // Mark job running
    await sb.from("export_jobs").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", exportJobId);

    try {
      // 1) Fetch course
      const { data: course, error: courseErr } = await sb
        .from("courses")
        .select("*, curricula(title, version)")
        .eq("id", targetCourseId)
        .single();
      if (courseErr || !course) throw new Error(`Course not found: ${courseErr?.message}`);

      // 2) Fetch modules
      const { data: modules } = await sb
        .from("modules")
        .select("*")
        .eq("course_id", targetCourseId)
        .order("sort_order");

      // 3) Fetch lessons with module info
      const { data: lessons } = await sb
        .from("lessons")
        .select("*, modules!inner(title, sort_order)")
        .eq("modules.course_id", targetCourseId)
        .order("sort_order");

      // 4) Fetch minicheck questions for all lessons
      const lessonIds = (lessons || []).map((l: any) => l.id);
      let miniChecks: any[] = [];
      if (lessonIds.length > 0) {
        const { data } = await sb
          .from("minicheck_questions")
          .select("*")
          .in("lesson_id", lessonIds);
        miniChecks = data || [];
      }

      // 5) Fetch latest quality audit
      const { data: latestAudit } = await sb
        .from("course_quality_audits")
        .select("*")
        .eq("course_id", targetCourseId)
        .order("audited_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Build structured data
      const structuredLessons: LessonData[] = (lessons || []).map((l: any) => {
        const c = l.content || {};
        const html = typeof c.html === "string" ? c.html : "";
        const objectives = Array.isArray(c.objectives) ? c.objectives : [];
        const exam_block = typeof c.exam_block === "string" ? c.exam_block : null;
        const weight_tag = typeof c.weight_tag === "string" ? c.weight_tag : null;

        return {
          id: l.id,
          title: l.title,
          step: l.step,
          sort_order: l.sort_order,
          objectives,
          html,
          weight_tag,
          exam_block,
          minicheck_questions: miniChecks.filter((q: any) => q.lesson_id === l.id),
          module_title: l.modules?.title || "Unknown",
          module_sort_order: l.modules?.sort_order || 0,
        };
      });

      const exportPayload = {
        exportedAt: new Date().toISOString(),
        exportVersion: "1.0.0",
        course: {
          id: course.id,
          title: course.title,
          description: course.description,
          status: course.status,
          curriculum: course.curricula?.title || null,
          curriculumVersion: course.curricula?.version || null,
          estimatedDuration: course.estimated_duration,
        },
        modules: (modules || []).map((m: any) => ({
          id: m.id,
          title: m.title,
          sort_order: m.sort_order,
          learning_field_code: m.learning_field_code || null,
        })),
        lessons: structuredLessons,
        qualityAudit: latestAudit
          ? {
              score: latestAudit.overall_score,
              grade: latestAudit.overall_grade,
              auditedAt: latestAudit.audited_at,
              dimensions: latestAudit.dimensions,
              criticalIssues: latestAudit.critical_issues,
              recommendations: latestAudit.recommendations,
            }
          : null,
        stats: {
          totalModules: (modules || []).length,
          totalLessons: structuredLessons.length,
          totalMiniChecks: miniChecks.length,
          lessonsWithExamBlock: structuredLessons.filter((l) => l.exam_block).length,
          lessonsWithWeightTag: structuredLessons.filter((l) => l.weight_tag).length,
        },
      };

      // ========== Generate files ==========
      const zip = new JSZip();

      // 1) JSON snapshot
      zip.file("course.json", JSON.stringify(exportPayload, null, 2));

      // 2) XLSX as CSV (lightweight, universally openable)
      const csvRows = [
        ["Module", "Sort", "Lesson", "Step", "Title", "Word Count", "Has Exam Block", "Has Weight Tag", "MiniCheck Count", "Objectives"].join("\t"),
      ];
      for (const l of structuredLessons) {
        const wordCount = l.html.replace(/<[^>]*>/g, "").split(/\s+/).filter(Boolean).length;
        csvRows.push(
          [
            l.module_title,
            l.module_sort_order,
            l.sort_order,
            l.step,
            l.title,
            wordCount,
            l.exam_block ? "✓" : "",
            l.weight_tag || "",
            l.minicheck_questions.length,
            (l.objectives || []).join("; "),
          ].join("\t")
        );
      }
      zip.file("course-matrix.tsv", csvRows.join("\n"));

      // 3) TSX export component
      const tsxContent = `// Auto-generated Course Export – ${course.title}
// Generated: ${new Date().toISOString()}
// DO NOT EDIT – this file is for review/QC purposes only

export const courseExport = ${JSON.stringify(exportPayload, null, 2)} as const;

export type CourseExport = typeof courseExport;

// Usage: import { courseExport } from './course-export';
`;
      zip.file("course-export.tsx", tsxContent);

      // 4) Quality report JSON (if available)
      if (latestAudit) {
        zip.file("quality-report.json", JSON.stringify(latestAudit, null, 2));
      }

      // 5) Human-readable Markdown review doc
      let md = `# Kurs-Export: ${course.title}\n\n`;
      md += `**Exportiert:** ${new Date().toISOString()}\n`;
      md += `**Curriculum:** ${course.curricula?.title || "–"}\n`;
      md += `**Status:** ${course.status}\n`;
      if (latestAudit) {
        md += `**Qualitäts-Score:** ${latestAudit.overall_score}/100 (${latestAudit.overall_grade})\n`;
      }
      md += `\n## Statistiken\n\n`;
      md += `| Metrik | Wert |\n|---|---|\n`;
      md += `| Module | ${exportPayload.stats.totalModules} |\n`;
      md += `| Lektionen | ${exportPayload.stats.totalLessons} |\n`;
      md += `| MiniChecks | ${exportPayload.stats.totalMiniChecks} |\n`;
      md += `| Mit Prüfungsblock | ${exportPayload.stats.lessonsWithExamBlock} |\n`;
      md += `| Mit Gewichtung | ${exportPayload.stats.lessonsWithWeightTag} |\n`;
      md += `\n---\n\n`;

      // Group by module
      const byModule = new Map<string, LessonData[]>();
      for (const l of structuredLessons) {
        const key = `${l.module_sort_order}. ${l.module_title}`;
        if (!byModule.has(key)) byModule.set(key, []);
        byModule.get(key)!.push(l);
      }

      for (const [modName, modLessons] of byModule) {
        md += `## ${modName}\n\n`;
        for (const l of modLessons.sort((a, b) => a.sort_order - b.sort_order)) {
          md += `### ${l.sort_order}. ${l.title} (${l.step})\n\n`;
          if (l.objectives.length > 0) {
            md += `**Lernziele:**\n${l.objectives.map((o) => `- ${o}`).join("\n")}\n\n`;
          }
          if (l.weight_tag) md += `**Gewichtung:** ${l.weight_tag}\n\n`;
          // Strip HTML for markdown
          const text = l.html.replace(/<[^>]*>/g, "").trim();
          if (text) md += `${text.substring(0, 2000)}${text.length > 2000 ? "\n\n_[gekürzt]_" : ""}\n\n`;
          if (l.exam_block) md += `**IHK-Prüfungsblock:** ${l.exam_block}\n\n`;
          if (l.minicheck_questions.length > 0) {
            md += `**MiniCheck (${l.minicheck_questions.length} Fragen):**\n`;
            for (const q of l.minicheck_questions) {
              md += `- ${q.question_text || q.question || "–"}\n`;
            }
            md += "\n";
          }
          md += "---\n\n";
        }
      }
      zip.file("course-review.md", md);

      // Generate ZIP
      const zipBlob = await zip.generateAsync({ type: "uint8array" });
      const slug = course.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 40);
      const dateStr = new Date().toISOString().split("T")[0];
      const storagePath = `course-${slug}-${dateStr}-${exportJobId.substring(0, 8)}.zip`;

      // Upload to storage
      const { error: uploadErr } = await sb.storage
        .from("exports")
        .upload(storagePath, zipBlob, { contentType: "application/zip", upsert: true });
      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      // Update job as done
      await sb.from("export_jobs").update({
        status: "done",
        output_path: storagePath,
        file_size_bytes: zipBlob.length,
        updated_at: new Date().toISOString(),
      }).eq("id", exportJobId);

      // Generate signed URL (valid 1 hour)
      const { data: signedData } = await sb.storage
        .from("exports")
        .createSignedUrl(storagePath, 3600);

      return new Response(
        JSON.stringify({
          ok: true,
          jobId: exportJobId,
          status: "done",
          downloadUrl: signedData?.signedUrl || null,
          fileName: storagePath,
          fileSize: zipBlob.length,
        }),
        { headers }
      );
    } catch (processingError) {
      // Mark job failed
      await sb.from("export_jobs").update({
        status: "failed",
        error: processingError instanceof Error ? processingError.message : "Unknown error",
        updated_at: new Date().toISOString(),
      }).eq("id", exportJobId);

      throw processingError;
    }
  } catch (error) {
    console.error("[export-course-package] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Export failed" }),
      { status: 500, headers }
    );
  }
});
