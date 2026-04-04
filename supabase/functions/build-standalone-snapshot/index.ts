/**
 * build-standalone-snapshot
 *
 * Reads SSOT data for a course package and serializes a frozen
 * standalone snapshot JSON to Supabase Storage.
 *
 * Payload: { package_id, course_id, curriculum_id, version_tag }
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SCHEMA_VERSION = "1.0.0";
const BUCKET = "standalone-bundles";

// ── Eligibility ──

const ALWAYS_ELIGIBLE_STATUSES = ["approved", "active", "published", "review"];

/**
 * A lesson is standalone-eligible if:
 * 1. It has a whitelisted status (approved/active/published/review), OR
 * 2. It has renderable content regardless of status (draft with real content).
 *
 * Lessons without any renderable content are never eligible.
 */
function isStandaloneEligible(lesson: any): boolean {
  if (!hasRenderableContent(lesson.content)) return false;
  if (ALWAYS_ELIGIBLE_STATUSES.includes(lesson.status)) return true;
  // Draft lessons with real content are eligible
  return true;
}

function hasRenderableContent(content: any): boolean {
  if (!content) return false;
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) return content.length > 0;
  if (typeof content === "object") {
    if (content.blocks && Array.isArray(content.blocks)) return content.blocks.length > 0;
    return Object.keys(content).length > 0;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { package_id, course_id, curriculum_id, version_tag } = body;

    if (!package_id || !course_id || !version_tag) {
      return json({ error: "Missing required fields: package_id, course_id, version_tag" }, 400);
    }

    console.log(`[snapshot] Building snapshot for package=${package_id} version=${version_tag}`);

    // Mark artifact as processing
    const { data: artifactRow } = await sb
      .from("standalone_artifact_versions")
      .upsert({
        package_id,
        course_id,
        curriculum_id: curriculum_id || null,
        artifact_kind: "snapshot",
        version_tag,
        build_status: "processing",
        source_step: "build_standalone_snapshot",
      }, { onConflict: "package_id,artifact_kind,version_tag" })
      .select("id")
      .single();

    const artifactId = artifactRow?.id;

    // ── 1. Load course metadata ──
    const { data: course } = await sb
      .from("courses")
      .select("id, title, description, curriculum_id, estimated_duration, status")
      .eq("id", course_id)
      .single();

    if (!course) {
      await markFailed(sb, artifactId, "Course not found");
      return json({ error: "Course not found" }, 404);
    }

    // ── 2. Load package metadata ──
    const { data: pkg } = await sb
      .from("course_packages")
      .select("id, title, track, certification_type, version")
      .eq("id", package_id)
      .single();

    // ── 3. Load modules ──
    const { data: modules } = await sb
      .from("modules")
      .select("id, title, description, sort_order, learning_field_id, learning_field_code")
      .eq("course_id", course_id)
      .order("sort_order");

    // ── 4. Load ALL lessons (eligibility filter applied in-memory) ──
    const moduleIds = (modules || []).map((m: any) => m.id);
    let allLessons: any[] = [];
    if (moduleIds.length > 0) {
      const { data } = await sb
        .from("lessons")
        .select("id, module_id, title, step, content, sort_order, duration_minutes, status, exam_block, weight_tag")
        .in("module_id", moduleIds)
        .order("sort_order");
      allLessons = data || [];
    }

    // Apply eligibility filter
    const lessons = allLessons.filter(isStandaloneEligible);
    const skippedLessons = allLessons.filter((l) => !isStandaloneEligible(l));

    console.log(`[snapshot] Lessons: ${allLessons.length} total, ${lessons.length} eligible, ${skippedLessons.length} skipped`);

    // ── FAIL-CLOSED: modules exist but zero exportable lessons ──
    if ((modules || []).length > 0 && lessons.length === 0) {
      const reason = `Snapshot contains zero exportable lessons despite ${(modules || []).length} modules (${allLessons.length} total lessons, none eligible). ` +
        `Statuses found: ${[...new Set(allLessons.map((l: any) => l.status))].join(", ") || "none"}`;
      console.error(`[snapshot] FAIL-CLOSED: ${reason}`);
      await markFailed(sb, artifactId, reason);
      return json({ error: reason }, 422);
    }

    // ── FAIL-CLOSED: lessons with no renderable content ──
    const emptyContentLessons = lessons.filter((l) => !hasRenderableContent(l.content));
    if (emptyContentLessons.length > 0 && emptyContentLessons.length === lessons.length) {
      const reason = `All ${lessons.length} eligible lessons have no renderable content`;
      console.error(`[snapshot] FAIL-CLOSED: ${reason}`);
      await markFailed(sb, artifactId, reason);
      return json({ error: reason }, 422);
    }

    // ── 5. Load minichecks ──
    const lessonIds = lessons.map((l: any) => l.id);
    let minichecks: any[] = [];
    if (lessonIds.length > 0) {
      const { data } = await sb
        .from("minicheck_questions")
        .select("id, lesson_id, question_text, options, correct_answer, explanation, difficulty, sort_order, cognitive_level")
        .in("lesson_id", lessonIds)
        .in("status", ["approved", "active"])
        .order("sort_order");
      minichecks = data || [];
    }

    // ── 6. Load handbook ──
    let handbookSections: any[] = [];
    if (curriculum_id) {
      const { data: chapters } = await sb
        .from("handbook_chapters")
        .select("id, chapter_key, title, sort_order")
        .eq("curriculum_id", curriculum_id)
        .order("sort_order");

      if (chapters && chapters.length > 0) {
        const chapterIds = chapters.map((c: any) => c.id);
        const { data: sections } = await sb
          .from("handbook_sections")
          .select("id, chapter_id, section_key, title, content_markdown, content_type, sort_order, expanded_content, content_tier")
          .in("chapter_id", chapterIds)
          .order("sort_order");

        handbookSections = (chapters || []).map((ch: any) => ({
          id: ch.id,
          key: ch.chapter_key,
          title: ch.title,
          sort_order: ch.sort_order,
          sections: (sections || [])
            .filter((s: any) => s.chapter_id === ch.id)
            .map((s: any) => ({
              id: s.id,
              key: s.section_key,
              title: s.title,
              content: s.expanded_content || s.content_markdown || "",
              content_type: s.content_type,
              sort_order: s.sort_order,
            })),
        }));
      }
    }

    // ── Collect warnings ──
    const warnings: string[] = [];
    if (handbookSections.length === 0 && curriculum_id) {
      warnings.push("handbook_empty");
    }
    if (minichecks.length === 0) {
      warnings.push("no_minichecks");
    }
    if (emptyContentLessons.length > 0) {
      warnings.push(`${emptyContentLessons.length}_lessons_without_content`);
    }
    if (skippedLessons.length > 0) {
      warnings.push(`${skippedLessons.length}_lessons_skipped_ineligible`);
    }

    // ── 7. Build snapshot ──
    const snapshot = {
      meta: {
        schema_version: SCHEMA_VERSION,
        artifact_type: "standalone_snapshot",
        version_tag,
        generated_at: new Date().toISOString(),
        course_id,
        package_id,
        curriculum_id: curriculum_id || null,
        course_title: course.title,
        track: pkg?.track || null,
        offline_mode: true,
        player_version: "1.0.0",
        eligibility_rule: "approved_or_renderable_content_v1",
      },
      course: {
        title: course.title,
        description: course.description,
        language: "de",
        estimated_duration_minutes: course.estimated_duration || null,
        modules: (modules || []).map((m: any) => ({
          id: m.id,
          title: m.title,
          description: m.description,
          sort_order: m.sort_order,
          learning_field_code: m.learning_field_code,
        })),
      },
      lessons: lessons.map((l: any) => ({
        id: l.id,
        module_id: l.module_id,
        title: l.title,
        lesson_type: l.step || "standard",
        sort_order: l.sort_order,
        duration_minutes: l.duration_minutes,
        exam_block: l.exam_block,
        content_blocks: parseContentBlocks(l.content),
      })),
      minichecks: groupMinichecksByLesson(minichecks),
      handbook: {
        chapters: handbookSections,
      },
      assets: [], // Assets will be resolved by build-standalone-bundle
      settings: {
        progress_storage: "localStorage",
        allow_offline: true,
        allow_results_export: true,
        allow_exam_mode: false,
      },
    };

    // ── 8. Upload to storage ──
    const storagePath = `snapshots/${package_id}/${version_tag}/snapshot.json`;
    const snapshotJson = JSON.stringify(snapshot, null, 2);
    const snapshotBytes = new TextEncoder().encode(snapshotJson);

    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, snapshotBytes, {
        contentType: "application/json",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[snapshot] Upload error:", uploadErr);
      await markFailed(sb, artifactId, `Storage upload failed: ${uploadErr.message}`);
      return json({ error: "Storage upload failed", detail: uploadErr.message }, 500);
    }

    // ── 9. Compute checksum ──
    const hashBuffer = await crypto.subtle.digest("SHA-256", snapshotBytes);
    const checksum = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // ── 10. Update artifact record ──
    const metadata = {
      module_count: (modules || []).length,
      lesson_count: lessons.length,
      lesson_total: allLessons.length,
      lesson_skipped: skippedLessons.length,
      minicheck_count: minichecks.length,
      handbook_chapter_count: handbookSections.length,
      lessons_without_content: emptyContentLessons.length,
      warnings,
      eligibility_rule: "approved_or_renderable_content_v1",
      status_distribution: allLessons.reduce((acc: Record<string, number>, l: any) => {
        acc[l.status] = (acc[l.status] || 0) + 1;
        return acc;
      }, {}),
    };

    await sb
      .from("standalone_artifact_versions")
      .update({
        build_status: "completed",
        storage_bucket: BUCKET,
        storage_path: storagePath,
        mime_type: "application/json",
        checksum_sha256: checksum,
        size_bytes: snapshotBytes.length,
        metadata,
      })
      .eq("id", artifactId);

    if (warnings.length > 0) {
      console.warn(`[snapshot] ⚠️ Warnings: ${warnings.join(", ")}`);
    }
    console.log(`[snapshot] ✅ Snapshot completed: ${storagePath} (${snapshotBytes.length} bytes, ${lessons.length}/${allLessons.length} lessons, sha256=${checksum.slice(0, 12)}...)`);

    return json({
      ok: true,
      artifact_id: artifactId,
      storage_path: storagePath,
      checksum,
      size_bytes: snapshotBytes.length,
      stats: {
        modules: (modules || []).length,
        lessons: lessons.length,
        lessons_total: allLessons.length,
        lessons_skipped: skippedLessons.length,
        minichecks: minichecks.length,
        handbook_chapters: handbookSections.length,
      },
      warnings,
    });
  } catch (err: any) {
    console.error("[snapshot] Error:", err);
    return json({ error: err.message }, 500);
  }
});

// ── Helpers ──

async function markFailed(sb: any, artifactId: string | undefined, reason: string) {
  if (!artifactId) return;
  await sb
    .from("standalone_artifact_versions")
    .update({
      build_status: "failed",
      metadata: { error: reason, failed_at: new Date().toISOString() },
    })
    .eq("id", artifactId);
}

function parseContentBlocks(content: any): any[] {
  if (!content) return [];
  if (typeof content === "string") {
    return [{ type: "rich_text", html: content }];
  }
  if (Array.isArray(content)) return content;
  if (typeof content === "object" && content.blocks) return content.blocks;
  return [{ type: "rich_text", html: JSON.stringify(content) }];
}

function groupMinichecksByLesson(minichecks: any[]): any[] {
  const grouped: Record<string, any> = {};
  for (const mc of minichecks) {
    if (!grouped[mc.lesson_id]) {
      grouped[mc.lesson_id] = {
        lesson_id: mc.lesson_id,
        questions: [],
      };
    }
    grouped[mc.lesson_id].questions.push({
      id: mc.id,
      type: "single_choice",
      prompt: mc.question_text,
      options: mc.options,
      correct_answer: mc.correct_answer,
      explanation: mc.explanation,
      difficulty: mc.difficulty,
      cognitive_level: mc.cognitive_level,
    });
  }
  return Object.values(grouped);
}
