import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * package-validate-lesson-minichecks  (V2 — approved-based logic)
 *
 * Quality gate for MiniCheck questions (read-only — NO status changes):
 * - Counts APPROVED questions (not drafts — auto-QC trigger handles promotion)
 * - Coverage check (Learning-Track: ≥90% lessons must have approved MiniChecks)
 * - Min items per lesson (≥3 approved)
 * - Trap coverage (approved without traps = blocker)
 * - Audit completeness (approved without audit metadata = warning)
 * - Drift check (curriculum_id mismatch via competency chain)
 * - Publish-gate integration
 *
 * Job-Runner signals:
 *   NO_MINICHECKS or coverage < 10%  → retry:true, backoff_seconds:300
 *   coverage ≥ 10% but gate fails    → permanent:true
 *   gate passes                       → ok:true
 */

const MIN_ITEMS_PER_LESSON = 3;
const PREREQ_COVERAGE_THRESHOLD = 0.10;

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), "content-type": "application/json" },
  });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

/** Paginated fetch with deterministic ordering to avoid missed rows */
async function fetchAllRows<T>(
  sb: ReturnType<typeof createClient>,
  table: string,
  select: string,
  filters: Array<{ op: string; col: string; val: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    let q = sb.from(table).select(select).order("id", { ascending: true }).range(from, from + pageSize - 1);
    for (const f of filters) {
      if (f.op === "eq") q = q.eq(f.col, f.val);
      else if (f.op === "in") q = q.in(f.col, f.val as string[]);
      else if (f.op === "not.is") q = q.not(f.col, "is", f.val);
      else if (f.op === "neq") q = q.neq(f.col, f.val);
    }
    const { data, error } = await q;
    if (error) throw new Error(`DB_ERROR: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

Deno.serve(async (req) => {
  const corsResp = handleCorsPreflightRequest(req);
  if (corsResp) return corsResp;

  const origin = req.headers.get("origin");
  if (req.method !== "POST") return json({ error: "Use POST" }, 405, origin);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400, origin);
  }

  const packageId = p.package_id as string;
  const curriculumId = p.curriculum_id as string;
  const courseId = p.course_id as string | undefined;

  try {
    const { data: pkgRow } = await sb
      .from("course_packages")
      .select("track, feature_flags, course_id")
      .eq("id", packageId)
      .single();

    const featureFlags = pkgRow?.feature_flags || {};
    const hasLearningCourse = featureFlags.has_learning_course ?? (pkgRow?.track === "AUSBILDUNG_VOLL");
    const effectiveCourseId = courseId || pkgRow?.course_id;
    const mode: "lesson" | "drill" = hasLearningCourse ? "lesson" : "drill";

    const issues: Array<{ severity: string; code: string; message: string }> = [];

    // ── V2: Count APPROVED questions (auto-QC trigger handles promotion) ──
    const { count: approvedCount } = await sb
      .from("minicheck_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .eq("mode", mode)
      .eq("status", "approved");

    const { count: totalCount } = await sb
      .from("minicheck_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .eq("mode", mode);

    if (!totalCount || totalCount === 0) {
      console.log(`[ValidateMini] ${packageId}: NO_MINICHECKS → retry`);
      return json({
        ok: false,
        retry: true,
        backoff_seconds: 300,
        error: "GATE_FAIL: NO_MINICHECKS",
        classification: "prereq_not_ready",
        reason_code: "NO_MINICHECKS",
        issues: [{ severity: "critical", code: "NO_MINICHECKS", message: `Keine MiniCheck-Fragen (${mode}) für Curriculum gefunden` }],
        total: 0,
        approved: 0,
      }, 200, origin);
    }

    // ── V2: Trap coverage among approved ──
    const { count: approvedWithoutTraps } = await sb
      .from("minicheck_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .eq("mode", mode)
      .eq("status", "approved")
      .or("trap_tags.is.null,trap_tags.eq.{}");

    if (approvedWithoutTraps && approvedWithoutTraps > 0) {
      issues.push({
        severity: "critical",
        code: "APPROVED_WITHOUT_TRAP",
        message: `${approvedWithoutTraps} approved MiniChecks haben keine Trap-Tags`,
      });
    }

    // ── V2: Audit completeness among approved ──
    const { count: approvedWithoutAudit } = await sb
      .from("minicheck_questions")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId)
      .eq("mode", mode)
      .eq("status", "approved")
      .is("approved_by", null);

    if (approvedWithoutAudit && approvedWithoutAudit > 0) {
      issues.push({
        severity: "warning",
        code: "APPROVED_WITHOUT_AUDIT",
        message: `${approvedWithoutAudit} approved MiniChecks ohne Audit-Metadaten (approved_by)`,
      });
    }

    // ── V2: Drift check ──
    const { count: driftCount } = await sb
      .from("v_minicheck_curriculum_drift" as any)
      .select("question_id", { count: "exact", head: true });

    if (driftCount && driftCount > 0) {
      issues.push({
        severity: "warning",
        code: "CURRICULUM_DRIFT",
        message: `${driftCount} MiniChecks mit curriculum_id-Drift (stored ≠ derived)`,
      });
    }

    // ── Remaining drafts (info only — auto-QC should have caught them) ──
    const draftCount = (totalCount || 0) - (approvedCount || 0);
    if (draftCount > 0) {
      issues.push({
        severity: "info",
        code: "REMAINING_DRAFTS",
        message: `${draftCount} MiniChecks noch im Draft-Status (Auto-QC hat sie nicht promoted)`,
      });
    }

    // ── Coverage check for lesson mode ──
    let coverage: number | null = null;

    if (mode === "lesson" && effectiveCourseId) {
      const { data: modules } = await sb
        .from("modules")
        .select("id")
        .eq("course_id", effectiveCourseId);
      const moduleIds = (modules || []).map((m: any) => m.id);

      let lessons: any[] = [];
      if (moduleIds.length > 0) {
        const { data: modLessons } = await sb
          .from("lessons")
          .select("id")
          .in("module_id", moduleIds)
          .not("content", "is", null)
          .neq("step", "mini_check");
        lessons = modLessons || [];
      }

      const totalLessons = lessons.length;
      if (totalLessons > 0) {
        const lessonIds = lessons.map((l: any) => l.id);

        // ── FIX: Use DISTINCT lesson_id query to avoid 1000-row limit ──
        // Instead of fetching all rows and deduplicating, fetch approved
        // MiniChecks grouped by lesson_id using paginated approach
        const allLessonRows: Array<{ lesson_id: string }> = [];
        for (let i = 0; i < lessonIds.length; i += 200) {
          const chunk = lessonIds.slice(i, i + 200);
          const rows = await fetchAllRows<{ lesson_id: string }>(
            sb,
            "minicheck_questions",
            "lesson_id",
            [
              { op: "in", col: "lesson_id", val: chunk },
              { op: "eq", col: "mode", val: "lesson" },
              { op: "eq", col: "status", val: "approved" },
            ],
          );
          allLessonRows.push(...rows);
        }

        const countByLesson = new Map<string, number>();
        for (const r of allLessonRows) {
          if (!r.lesson_id) continue;
          countByLesson.set(r.lesson_id, (countByLesson.get(r.lesson_id) || 0) + 1);
        }

        const coveredCount = countByLesson.size;
        coverage = coveredCount / totalLessons;

        if (coverage < 0.9) {
          issues.push({
            severity: "critical",
            code: "LOW_COVERAGE",
            message: `MiniCheck-Abdeckung: ${(coverage * 100).toFixed(0)}% der Lektionen (${coveredCount}/${totalLessons}) — mindestens 90% erforderlich`,
          });
        } else if (coverage < 0.97) {
          issues.push({
            severity: "warning",
            code: "PARTIAL_COVERAGE",
            message: `MiniCheck-Abdeckung: ${(coverage * 100).toFixed(0)}% der Lektionen (${coveredCount}/${totalLessons})`,
          });
        }

        // Min items per lesson (approved only)
        let tooFew = 0;
        for (const lid of lessonIds) {
          const c = countByLesson.get(lid) || 0;
          if (c < MIN_ITEMS_PER_LESSON) tooFew++;
        }
        if (tooFew > 0) {
          issues.push({
            severity: "critical",
            code: "MIN_ITEMS_PER_LESSON",
            message: `${tooFew} Lektionen haben <${MIN_ITEMS_PER_LESSON} approved MiniChecks`,
          });
        }
      }
    }

    // ── V2: Publish-gate check ──
    let publishGatePassed: boolean | null = null;
    try {
      const { data: pgResult } = await sb.rpc("fn_minicheck_publish_gate", {
        p_curriculum_id: curriculumId,
      });
      publishGatePassed = pgResult === true;
      if (!publishGatePassed) {
        issues.push({
          severity: "warning",
          code: "PUBLISH_GATE_FAIL",
          message: "MiniCheck Publish-Gate nicht bestanden (Kompetenz-/LF-/Trap-Abdeckung unzureichend)",
        });
      }
    } catch {
      // Function might not exist yet — non-critical
    }

    const hasCritical = issues.some((i) => i.severity === "critical");

    console.log(
      `[ValidateMini] ${packageId} ${mode}: approved=${approvedCount}, total=${totalCount}, ` +
        `coverage=${coverage !== null ? (coverage * 100).toFixed(0) + "%" : "n/a"}, ` +
        `publishGate=${publishGatePassed}, critical=${hasCritical}`,
    );

    // Gate passed
    if (!hasCritical) {
      return json(
        {
          ok: true,
          total: totalCount,
          approved: approvedCount || 0,
          draft: draftCount,
          coverage: coverage !== null ? Math.round(coverage * 100) : null,
          publish_gate: publishGatePassed,
          issues,
        },
        200,
        origin,
      );
    }

    // Gate failed — classify retry vs permanent
    const coveragePct = coverage !== null ? (coverage * 100).toFixed(0) : "?";

    if (coverage !== null && coverage < PREREQ_COVERAGE_THRESHOLD) {
      return json(
        {
          ok: false,
          retry: true,
          backoff_seconds: 300,
          error: `GATE_FAIL: LOW_COVERAGE ${coveragePct}% (prereqs not ready)`,
          classification: "prereq_not_ready",
          reason_code: "LOW_COVERAGE",
          coverage_state: coverage < 0.01 ? "none" : "bootstrap",
          total: totalCount,
          approved: approvedCount || 0,
          issues,
        },
        200,
        origin,
      );
    }

    return json(
      {
        ok: false,
        permanent: true,
        error: `GATE_FAIL: coverage=${coveragePct}%, critical_issues=${issues.filter((i) => i.severity === "critical").length}`,
        classification: "gate_fail",
        reason_code: issues.find((i) => i.severity === "critical")?.code || "UNKNOWN",
        coverage_state:
          coverage === null ? "none" : coverage < 0.5 ? "partial" : coverage < 0.9 ? "partial" : "ready",
        total: totalCount,
        approved: approvedCount || 0,
        issues,
      },
      200,
      origin,
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ValidateMini] FATAL: ${msg}`);
    return json(
      {
        ok: false,
        retry: true,
        transient: true,
        backoff_seconds: 120,
        error: `UNHANDLED_EXCEPTION: ${msg}`,
        classification: "transient_error",
      },
      200,
      origin,
    );
  }
});
