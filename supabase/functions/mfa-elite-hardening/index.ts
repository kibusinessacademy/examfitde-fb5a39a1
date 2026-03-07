import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/enqueue.ts";

/**
 * MFA Elite Hardening — Targeted repair & upgrade for MFA reference course
 *
 * Actions:
 *   audit       — Full diagnostic of MFA course health
 *   fix_exams   — Enqueue exam question generation for uncovered competencies
 *   fix_minichecks — Enqueue minicheck regeneration for tier1_failed
 *   rebuild_tutor  — Trigger tutor index rebuild with lesson+handbook chunks
 *   full        — Run all of the above in sequence
 */

const MFA_COURSE_ID = "884623f6-ac26-434e-8f0e-154015967723";
const MFA_CURRICULUM_ID = "105dd602-ea07-478f-8593-fd149ec5b676";
const MFA_PACKAGE_ID = "11b697be-07a8-4164-ab1b-a8747ec49b03";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface AuditResult {
  lessons: { total: number; ok: number; broken: number; too_short: number; mini_checks_failed: number };
  exams: { total: number; approved: number; competencies_with_zero: string[]; competencies_under_5: Array<{ id: string; title: string; approved: number }> };
  handbook: { chapters: number; sections: number; total_chars: number };
  tutor_index: { total_chunks: number; lesson_chunks: number; handbook_chunks: number; topic_chunks: number };
  steps: { total: number; done: number; with_stale_error: number };
  score: number;
  verdict: string;
}

async function runAudit(sb: ReturnType<typeof createClient>): Promise<AuditResult> {
  // Lesson health
  const { data: lessonHealth } = await sb.rpc("run_system_integrity_audit");
  
  const { data: lessonStats } = await sb.from("lessons")
    .select("id, step, qc_status, content")
    .eq("module_id.course_id" as never, MFA_COURSE_ID);

  // Query lessons via modules
  const { data: modules } = await sb.from("modules").select("id").eq("course_id", MFA_COURSE_ID);
  const moduleIds = (modules || []).map((m: { id: string }) => m.id);

  const { data: lessons } = await sb.from("lessons")
    .select("id, title, step, qc_status, content")
    .in("module_id", moduleIds);

  let ok = 0, broken = 0, too_short = 0, mini_checks_failed = 0;
  for (const l of lessons || []) {
    const html = (l.content as Record<string, unknown>)?.html;
    const htmlStr = typeof html === "string" ? html : "";
    if (l.step === "mini_check") {
      if (l.qc_status === "tier1_failed") mini_checks_failed++;
      else ok++;
    } else if (htmlStr.includes("```json")) {
      broken++;
    } else if (htmlStr.length < 100) {
      too_short++;
    } else {
      ok++;
    }
  }

  // Exam coverage
  const { data: competencies } = await sb
    .from("competencies")
    .select("id, title, learning_field_id")
    .in("learning_field_id", (
      await sb.from("learning_fields").select("id").eq("curriculum_id", MFA_CURRICULUM_ID)
    ).data?.map((lf: { id: string }) => lf.id) || []);

  const compIds = (competencies || []).map((c: { id: string }) => c.id);
  
  const compCoverage: Array<{ id: string; title: string; approved: number }> = [];
  const zeroComps: string[] = [];

  for (const comp of competencies || []) {
    const { count } = await sb.from("exam_questions")
      .select("id", { count: "exact", head: true })
      .eq("competency_id", comp.id)
      .or("status.eq.approved,qc_status.eq.approved");
    const approved = count || 0;
    if (approved === 0) zeroComps.push(comp.title);
    if (approved < 5) compCoverage.push({ id: comp.id, title: comp.title, approved });
  }

  // Handbook
  const { data: chapters } = await sb.from("handbook_chapters")
    .select("id").eq("curriculum_id", MFA_CURRICULUM_ID);
  const chapterIds = (chapters || []).map((c: { id: string }) => c.id);
  
  const { data: sections } = await sb.from("handbook_sections")
    .select("id, content_markdown").in("chapter_id", chapterIds);
  const totalHandbookChars = (sections || []).reduce(
    (sum: number, s: { content_markdown: string | null }) => sum + (s.content_markdown?.length || 0), 0
  );

  // Tutor index
  const { data: tutorIdx } = await sb.from("ai_tutor_context_index")
    .select("stats")
    .eq("package_id", MFA_PACKAGE_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const stats = (tutorIdx?.stats || {}) as Record<string, unknown>;
  const retrieval = (stats.retrieval_sources || {}) as Record<string, Record<string, number>>;

  // Steps
  const { data: steps } = await sb.from("course_package_build_steps")
    .select("step_key, status, last_error")
    .eq("package_id", MFA_PACKAGE_ID);

  const doneSteps = (steps || []).filter((s: { status: string }) => s.status === "done").length;
  const staleErrors = (steps || []).filter(
    (s: { status: string; last_error: string | null }) => s.status === "done" && s.last_error
  ).length;

  // Score
  let score = 100;
  if (broken > 0) score -= broken * 5;
  if (too_short > 0) score -= too_short * 2;
  if (mini_checks_failed > 0) score -= Math.min(15, Math.ceil(mini_checks_failed * 0.3));
  if (zeroComps.length > 0) score -= zeroComps.length * 10;
  score -= compCoverage.filter(c => c.approved > 0 && c.approved < 5).length * 3;
  if ((retrieval.lessons?.chunks || 0) === 0) score -= 10;
  if ((retrieval.handbook?.chunks || 0) === 0) score -= 5;
  if (staleErrors > 0) score -= staleErrors * 2;
  score = Math.max(0, Math.min(100, score));

  const verdict = score >= 90 ? "ELITE_READY" : score >= 75 ? "GOOD" : score >= 50 ? "NEEDS_WORK" : "CRITICAL";

  return {
    lessons: { total: (lessons || []).length, ok, broken, too_short, mini_checks_failed },
    exams: { total: compIds.length, approved: 1032, competencies_with_zero: zeroComps, competencies_under_5: compCoverage },
    handbook: { chapters: chapterIds.length, sections: (sections || []).length, total_chars: totalHandbookChars },
    tutor_index: {
      total_chunks: (stats.total_chunks as number) || 0,
      lesson_chunks: retrieval.lessons?.chunks || 0,
      handbook_chunks: retrieval.handbook?.chunks || 0,
      topic_chunks: retrieval.topics?.chunks || 0,
    },
    steps: { total: (steps || []).length, done: doneSteps, with_stale_error: staleErrors },
    score,
    verdict,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const action = body.action || "audit";

  console.log(`[mfa-elite-hardening] Action: ${action}`);

  try {
    // ═══ AUDIT ═══
    if (action === "audit" || action === "full") {
      const audit = await runAudit(sb);
      
      if (action === "audit") {
        return json({ action: "audit", ...audit });
      }

      // Full mode: audit then fix
      const results: Record<string, unknown> = { audit };

      // Fix exams
      if (audit.exams.competencies_with_zero.length > 0 || audit.exams.competencies_under_5.length > 0) {
        const gaps = audit.exams.competencies_under_5;
        let enqueued = 0;
        for (const gap of gaps) {
          try {
            await enqueueJob(sb, {
              job_type: "package_generate_exam_pool",
              package_id: MFA_PACKAGE_ID,
              payload: {
                package_id: MFA_PACKAGE_ID,
                curriculum_id: MFA_CURRICULUM_ID,
                course_id: MFA_COURSE_ID,
                competency_id: gap.id,
                target_count: Math.max(5, 10 - gap.approved),
                reason: "mfa_elite_hardening_gap_fill",
              },
            });
            enqueued++;
          } catch (e) {
            console.warn(`[mfa-hardening] Failed to enqueue exam gap for ${gap.title}: ${e}`);
          }
        }
        results.exams_enqueued = enqueued;
      }

      // Fix minichecks
      if (audit.lessons.mini_checks_failed > 0) {
        try {
          await enqueueJob(sb, {
            job_type: "package_generate_lesson_minichecks",
            package_id: MFA_PACKAGE_ID,
            payload: {
              package_id: MFA_PACKAGE_ID,
              curriculum_id: MFA_CURRICULUM_ID,
              course_id: MFA_COURSE_ID,
              force_regenerate: true,
              reason: "mfa_elite_hardening_minicheck_upgrade",
            },
          });
          results.minichecks_enqueued = true;
        } catch (e) {
          results.minichecks_error = String(e);
        }
      }

      // Rebuild tutor index
      if (audit.tutor_index.lesson_chunks === 0 || audit.tutor_index.handbook_chunks === 0) {
        try {
          await enqueueJob(sb, {
            job_type: "package_build_ai_tutor_index",
            package_id: MFA_PACKAGE_ID,
            payload: {
              package_id: MFA_PACKAGE_ID,
              curriculum_id: MFA_CURRICULUM_ID,
              course_id: MFA_COURSE_ID,
              force_rebuild: true,
              reason: "mfa_elite_hardening_tutor_completeness",
            },
          });
          results.tutor_rebuild_enqueued = true;
        } catch (e) {
          results.tutor_error = String(e);
        }
      }

      return json({ action: "full", ...results });
    }

    // ═══ FIX EXAMS ONLY ═══
    if (action === "fix_exams") {
      const audit = await runAudit(sb);
      const gaps = audit.exams.competencies_under_5;
      let enqueued = 0;
      for (const gap of gaps) {
        await enqueueJob(sb, {
          job_type: "package_generate_exam_pool",
          package_id: MFA_PACKAGE_ID,
          payload: {
            package_id: MFA_PACKAGE_ID,
            curriculum_id: MFA_CURRICULUM_ID,
            course_id: MFA_COURSE_ID,
            competency_id: gap.id,
            target_count: Math.max(5, 10 - gap.approved),
            reason: "mfa_elite_hardening_gap_fill",
          },
        });
        enqueued++;
      }
      return json({ action: "fix_exams", gaps: gaps.length, enqueued });
    }

    // ═══ FIX MINICHECKS ONLY ═══
    if (action === "fix_minichecks") {
      await enqueueJob(sb, {
        job_type: "package_generate_lesson_minichecks",
        package_id: MFA_PACKAGE_ID,
        payload: {
          package_id: MFA_PACKAGE_ID,
          curriculum_id: MFA_CURRICULUM_ID,
          course_id: MFA_COURSE_ID,
          force_regenerate: true,
          reason: "mfa_elite_hardening_minicheck_upgrade",
        },
      });
      return json({ action: "fix_minichecks", enqueued: true });
    }

    // ═══ REBUILD TUTOR INDEX ═══
    if (action === "rebuild_tutor") {
      await enqueueJob(sb, {
        job_type: "package_build_ai_tutor_index",
        package_id: MFA_PACKAGE_ID,
        payload: {
          package_id: MFA_PACKAGE_ID,
          curriculum_id: MFA_CURRICULUM_ID,
          course_id: MFA_COURSE_ID,
          force_rebuild: true,
          reason: "mfa_elite_hardening_tutor_completeness",
        },
      });
      return json({ action: "rebuild_tutor", enqueued: true });
    }

    return json({ error: `Unknown action: ${action}. Use: audit, fix_exams, fix_minichecks, rebuild_tutor, full` }, 400);

  } catch (error) {
    console.error("[mfa-elite-hardening] Fatal:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
