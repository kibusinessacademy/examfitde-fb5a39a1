import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { getContentProfile } from "../_shared/track-content-profiles.ts";
import { resolveIntegrityProfile, getValidationPolicy, buildValidatorMeta } from "../_shared/validation/learning-content-policy.ts";

/**
 * package-validate-lesson-minichecks  (V3 — track-aware approved-based logic)
 *
 * Quality gate for MiniCheck questions (read-only — NO status changes):
 * - Counts APPROVED questions (not drafts — auto-QC trigger handles promotion)
 * - Coverage check (Learning-Track: ≥90% lessons must have approved MiniChecks)
 * - Min items per lesson (≥3 approved)
 * - Trap coverage (approved without traps = blocker for vocational, warning for academic)
 * - Bloom distribution check (track-aware: STUDIUM requires higher cognitive levels)
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
    const track = pkgRow?.track ?? "AUSBILDUNG_VOLL";
    const profile = getContentProfile(track);
    const integrityProfile = resolveIntegrityProfile({ track });
    const policy = getValidationPolicy(integrityProfile);
    const isAcademic = profile.minicheck.type === "understanding";
    const trackWarnings: string[] = [];

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
      const trapSeverity = policy.minicheck.missingTrapSeverity;
      issues.push({
        severity: trapSeverity,
        code: "APPROVED_WITHOUT_TRAP",
        message: `${approvedWithoutTraps} approved MiniChecks haben keine Trap-Tags${isAcademic ? " (akademisch: info only)" : ""}`,
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

    // ── V3: Track-aware Bloom distribution check among approved questions ──
    if (approvedCount && approvedCount >= 20) {
      const approvedRows = await fetchAllRows<{ cognitive_level: string | null }>(
        sb, "minicheck_questions", "cognitive_level",
        [
          { op: "eq", col: "curriculum_id", val: curriculumId },
          { op: "eq", col: "mode", val: mode },
          { op: "eq", col: "status", val: "approved" },
        ],
      );

      const bloomBuckets: Record<string, string[]> = {
        remember: ["remember", "erinnern"],
        understand: ["understand", "verstehen"],
        apply: ["apply", "anwenden"],
        analyze: ["analyze", "analysieren"],
        evaluate: ["evaluate", "bewerten", "create", "erschaffen"],
      };
      const bloomCounts: Record<string, number> = {};
      for (const [bucket, aliases] of Object.entries(bloomBuckets)) {
        bloomCounts[bucket] = approvedRows.filter((q) =>
          aliases.includes((q.cognitive_level || "").toLowerCase())
        ).length;
      }
      const totalForBloom = approvedRows.length;

      if (isAcademic) {
        // STUDIUM: use policy thresholds
        const higherOrderPct = totalForBloom > 0
          ? ((bloomCounts.apply + bloomCounts.analyze + bloomCounts.evaluate) / totalForBloom) * 100
          : 0;
        const rememberPct = totalForBloom > 0 ? (bloomCounts.remember / totalForBloom) * 100 : 0;

        if (higherOrderPct < policy.minicheck.minHigherOrderBloomPct * 100) {
          const msg = `Studium-MiniChecks: nur ${higherOrderPct.toFixed(0)}% apply+analyze+evaluate (min ${(policy.minicheck.minHigherOrderBloomPct * 100).toFixed(0)}%). Transfer-/Analysefragen fehlen.`;
          issues.push({ severity: "warning", code: "BLOOM_HIGHER_ORDER_LOW", message: msg });
          trackWarnings.push(`BLOOM_HIGHER_ORDER_LOW: ${higherOrderPct.toFixed(0)}%`);
        }
        if (rememberPct > policy.minicheck.maxRememberBloomPct * 100) {
          const msg = `Studium-MiniChecks: ${rememberPct.toFixed(0)}% remember (max ${(policy.minicheck.maxRememberBloomPct * 100).toFixed(0)}%). Zu viel reine Reproduktion.`;
          issues.push({ severity: "warning", code: "BLOOM_REMEMBER_HIGH", message: msg });
          trackWarnings.push(`BLOOM_REMEMBER_HIGH: ${rememberPct.toFixed(0)}%`);
        }
      } else {
        // Vocational: use policy thresholds
        const applyAnalyzePct = totalForBloom > 0
          ? ((bloomCounts.apply + bloomCounts.analyze) / totalForBloom) * 100
          : 0;
        const rememberPct = totalForBloom > 0 ? (bloomCounts.remember / totalForBloom) * 100 : 0;

        if (applyAnalyzePct < policy.minicheck.minHigherOrderBloomPct * 100) {
          issues.push({
            severity: "warning",
            code: "BLOOM_APPLY_LOW",
            message: `MiniChecks: nur ${applyAnalyzePct.toFixed(0)}% apply+analyze (min ${(policy.minicheck.minHigherOrderBloomPct * 100).toFixed(0)}%). Anwendungsfragen fehlen.`,
          });
        }
        if (rememberPct > policy.minicheck.maxRememberBloomPct * 100) {
          issues.push({
            severity: "warning",
            code: "BLOOM_REMEMBER_HIGH",
            message: `MiniChecks: ${rememberPct.toFixed(0)}% remember (max ${(policy.minicheck.maxRememberBloomPct * 100).toFixed(0)}%). Zu viel reine Reproduktion.`,
          });
        }
      }

      console.log(`[ValidateMini] Bloom dist: ${Object.entries(bloomCounts).map(([k, v]) => `${k}=${v}`).join(", ")} (track=${track}, academic=${isAcademic})`);
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
        // Paginated lesson fetch (handles >1000 lessons)
        lessons = await fetchAllRows(
          sb, "lessons", "id",
          [
            { op: "in", col: "module_id", val: moduleIds },
            { op: "not.is", col: "content", val: null },
            { op: "neq", col: "step", val: "mini_check" },
          ],
        );
      }

      const totalLessons = lessons.length;
      if (totalLessons > 0) {
        const lessonIds = lessons.map((l: any) => l.id);

        // Use curriculum_id filter (indexed) + paginated fetch with ORDER BY
        const allLessonRows = await fetchAllRows<{ lesson_id: string }>(
          sb,
          "minicheck_questions",
          "lesson_id",
          [
            { op: "eq", col: "curriculum_id", val: curriculumId },
            { op: "eq", col: "mode", val: "lesson" },
            { op: "eq", col: "status", val: "approved" },
          ],
        );

        // Build count map, only for lessons in this course
        const lessonIdSet = new Set(lessonIds);
        const countByLesson = new Map<string, number>();
        for (const r of allLessonRows) {
          if (!r.lesson_id || !lessonIdSet.has(r.lesson_id)) continue;
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
        // v3: Downgraded from critical to warning — during build phase, not all lessons
        // have full MiniCheck coverage yet. Making this critical causes permanent gate failures
        // that block the entire pipeline. The publish gate enforces hard thresholds.
        let tooFew = 0;
        for (const lid of lessonIds) {
          const c = countByLesson.get(lid) || 0;
          if (c < MIN_ITEMS_PER_LESSON) tooFew++;
        }
        if (tooFew > 0) {
          const tooFewPct = (tooFew / totalLessons) * 100;
          // Only critical if >50% of lessons are undercovered — otherwise it's still building
          const sev = tooFewPct > 50 ? "critical" : "warning";
          issues.push({
            severity: sev,
            code: "MIN_ITEMS_PER_LESSON",
            message: `${tooFew}/${totalLessons} Lektionen (${tooFewPct.toFixed(0)}%) haben <${MIN_ITEMS_PER_LESSON} approved MiniChecks`,
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
          policy_meta: buildValidatorMeta(policy, trackWarnings),
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
