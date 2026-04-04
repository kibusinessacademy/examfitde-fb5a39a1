import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, getCorsHeaders } from "../_shared/cors.ts";

function json(status: number, body: unknown, origin?: string | null) {
  const headers = origin ? getCorsHeaders(origin) : getCorsHeaders("*");
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

type Finding = {
  code: string;
  severity: "info" | "warning" | "error" | "critical";
  detail: string;
  affected_ids?: string[];
  metric?: number;
  threshold?: number;
};

type GateClass = "pass" | "warning" | "targeted_regeneration_required" | "major_regeneration_required";

type MiniCheckRecord = {
  id: string;
  curriculum_id: string;
  competency_id: string | null;
  question_text: string | null;
  options: Array<{ text: string; is_correct: boolean }> | null;
  correct_answer: number | null;
  explanation: string | null;
  difficulty: string | null;
  trap_type: string | null;
  trap_tags: string[] | null;
  mode: string | null;
  status: string | null;
  source_blueprint_id: string | null;
  cognitive_level: string | null;
};

const PROFILE_EXPECTED_TRAPS: Record<string, string[]> = {
  IHK_AUFSTIEG: ["typical_error", "misconception"],
  MEISTER: ["typical_error", "misconception"],
  FINANCE: ["calculation_trap", "typical_error"],
  AEVO: ["typical_error", "misconception"],
  CERT_TECH: ["misconception", "typical_error"],
};

async function fetchAllRows(
  sb: ReturnType<typeof createClient>,
  table: string,
  filters: Record<string, unknown>,
  select: string,
) {
  const rows: unknown[] = [];
  let from = 0;
  const pageSize = 500;
  while (true) {
    let q = sb.from(table).select(select).order("id", { ascending: true }).range(from, from + pageSize - 1);
    for (const [k, v] of Object.entries(filters)) {
      q = q.eq(k, v);
    }
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function classify(findings: Finding[]): GateClass {
  const hasCritical = findings.some((f) => f.severity === "critical");
  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;

  if (hasCritical) return "major_regeneration_required";
  if (errorCount >= 3) return "targeted_regeneration_required";
  if (errorCount > 0 || warningCount > 3) return "warning";
  return "pass";
}

function validateMiniChecks(input: {
  certSlug: string;
  certId: string;
  curriculumId: string;
  validationProfile: string;
  questions: MiniCheckRecord[];
  competencyIds: string[];
}) {
  const findings: Finding[] = [];
  const { certSlug, certId, curriculumId, validationProfile, questions, competencyIds } = input;

  // --- Structural checks ---
  const emptyText = questions.filter((q) => !q.question_text || q.question_text.trim().length < 30);
  if (emptyText.length) {
    findings.push({
      code: "SHORT_QUESTION_TEXT",
      severity: "error",
      detail: `${emptyText.length} questions have question_text < 30 chars`,
      affected_ids: emptyText.map((q) => q.id),
    });
  }

  const shortExplanation = questions.filter((q) => !q.explanation || q.explanation.trim().length < 40);
  if (shortExplanation.length) {
    findings.push({
      code: "SHORT_EXPLANATION",
      severity: "warning",
      detail: `${shortExplanation.length} questions have explanation < 40 chars`,
      affected_ids: shortExplanation.map((q) => q.id),
    });
  }

  const missingCompetency = questions.filter((q) => !q.competency_id);
  if (missingCompetency.length) {
    findings.push({
      code: "MISSING_COMPETENCY_ID",
      severity: "error",
      detail: `${missingCompetency.length} questions missing competency_id`,
      affected_ids: missingCompetency.map((q) => q.id),
    });
  }

  const missingBlueprint = questions.filter((q) => !q.source_blueprint_id);
  if (missingBlueprint.length) {
    findings.push({
      code: "MISSING_SOURCE_BLUEPRINT",
      severity: "warning",
      detail: `${missingBlueprint.length} questions without source_blueprint_id`,
      affected_ids: missingBlueprint.map((q) => q.id),
    });
  }

  // --- Options & correctness ---
  const invalidOptions = questions.filter((q) => {
    if (!q.options || !Array.isArray(q.options)) return true;
    return q.options.length < 2;
  });
  if (invalidOptions.length) {
    findings.push({
      code: "INVALID_OPTIONS",
      severity: "error",
      detail: `${invalidOptions.length} questions have < 2 options`,
      affected_ids: invalidOptions.map((q) => q.id),
    });
  }

  const invalidPointer = questions.filter((q) => {
    if (!Array.isArray(q.options) || typeof q.correct_answer !== "number") return true;
    if (q.correct_answer < 0 || q.correct_answer >= q.options.length) return true;
    return q.options[q.correct_answer]?.is_correct !== true;
  });
  if (invalidPointer.length) {
    findings.push({
      code: "CORRECT_ANSWER_POINTER_INVALID",
      severity: "error",
      detail: `${invalidPointer.length} questions have mismatched correct_answer pointer`,
      affected_ids: invalidPointer.map((q) => q.id),
    });
  }

  // --- Coverage ---
  const coveredCompetencies = new Set(questions.map((q) => q.competency_id).filter(Boolean));
  const coveragePct = competencyIds.length > 0
    ? Math.round((coveredCompetencies.size / competencyIds.length) * 100)
    : 100;

  if (coveragePct < 80) {
    findings.push({
      code: "LOW_COMPETENCY_COVERAGE",
      severity: "error",
      detail: `Competency coverage ${coveragePct}% < 80% threshold`,
      metric: coveragePct,
      threshold: 80,
    });
  }

  // --- Trap coverage ---
  const withTrap = questions.filter((q) => q.trap_type || (q.trap_tags && q.trap_tags.length > 0));
  const trapPct = questions.length > 0 ? Math.round((withTrap.length / questions.length) * 100) : 0;
  if (trapPct < 70) {
    findings.push({
      code: "LOW_TRAP_COVERAGE",
      severity: "warning",
      detail: `Trap coverage ${trapPct}% < 70% threshold`,
      metric: trapPct,
      threshold: 70,
    });
  }

  // --- Difficulty distribution ---
  const byDiff: Record<string, number> = {};
  const byTrap: Record<string, number> = {};
  const byCog: Record<string, number> = {};
  const byStatus: Record<string, number> = {};

  for (const q of questions) {
    byDiff[q.difficulty ?? "unknown"] = (byDiff[q.difficulty ?? "unknown"] ?? 0) + 1;
    byTrap[q.trap_type ?? "none"] = (byTrap[q.trap_type ?? "none"] ?? 0) + 1;
    byCog[q.cognitive_level ?? "unknown"] = (byCog[q.cognitive_level ?? "unknown"] ?? 0) + 1;
    byStatus[q.status ?? "unknown"] = (byStatus[q.status ?? "unknown"] ?? 0) + 1;
  }

  // Check minimum difficulty variety
  const diffLevels = Object.keys(byDiff).filter((k) => k !== "unknown");
  if (diffLevels.length < 2 && questions.length >= 5) {
    findings.push({
      code: "NO_DIFFICULTY_MIX",
      severity: "warning",
      detail: `Only ${diffLevels.length} difficulty level(s) present`,
    });
  }

  // --- Duplicate detection ---
  const textSet = new Set<string>();
  const duplicates: string[] = [];
  for (const q of questions) {
    const norm = (q.question_text ?? "").trim().toLowerCase().slice(0, 100);
    if (textSet.has(norm)) duplicates.push(q.id);
    else textSet.add(norm);
  }
  if (duplicates.length) {
    findings.push({
      code: "DUPLICATE_QUESTIONS",
      severity: "warning",
      detail: `${duplicates.length} near-duplicate questions detected`,
      affected_ids: duplicates,
    });
  }

  const gate_class = classify(findings);

  return {
    certification_slug: certSlug,
    certification_id: certId,
    curriculum_id: curriculumId,
    validation_profile: validationProfile,
    total_questions: questions.length,
    gate_class,
    findings,
    coverage: {
      covered_competencies: coveredCompetencies.size,
      total_competencies: competencyIds.length,
      coverage_pct: coveragePct,
    },
    distribution: {
      by_difficulty: byDiff,
      by_trap_type: byTrap,
      by_cognitive_level: byCog,
      by_status: byStatus,
    },
    trap_coverage_pct: trapPct,
  };
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const certIds: string[] = body.certification_ids ?? [];
    const slugs: string[] = body.slugs ?? [];
    const mode: string = body.mode ?? "drill";

    if (!certIds.length && !slugs.length) {
      return json(400, { error: "certification_ids or slugs required" }, origin);
    }

    let certQuery = sb.from("certifications").select("id, slug, title, validation_profile");
    if (certIds.length) certQuery = certQuery.in("id", certIds);
    else certQuery = certQuery.in("slug", slugs);
    const { data: certs, error: certErr } = await certQuery;
    if (certErr) return json(500, { error: certErr.message }, origin);
    if (!certs?.length) return json(404, { error: "No certifications found" }, origin);

    const results: Array<Record<string, unknown>> = [];

    for (const cert of certs) {
      try {
        const { data: curriculum, error: curErr } = await sb
          .from("curricula")
          .select("id")
          .eq("certification_id", cert.id)
          .limit(1)
          .single();
        if (curErr || !curriculum) throw new Error(`No curriculum for ${cert.slug}`);

        // Fetch minicheck_questions for this curriculum
        const questions = (await fetchAllRows(
          sb,
          "minicheck_questions",
          { curriculum_id: curriculum.id, mode },
          "id, curriculum_id, competency_id, question_text, options, correct_answer, explanation, difficulty, trap_type, trap_tags, mode, status, source_blueprint_id, cognitive_level",
        )) as MiniCheckRecord[];

        // Fetch competencies for coverage check
        const competencies = (await fetchAllRows(
          sb,
          "competencies",
          { curriculum_id: curriculum.id },
          "id",
        )) as Array<{ id: string }>;

        const result = validateMiniChecks({
          certSlug: cert.slug,
          certId: cert.id,
          curriculumId: curriculum.id,
          validationProfile: (cert as any).validation_profile ?? "IHK_AUFSTIEG",
          questions,
          competencyIds: competencies.map((c) => c.id),
        });

        results.push(result);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : (typeof e === 'object' ? JSON.stringify(e) : String(e));
        results.push({
          certification_slug: cert.slug,
          ok: false,
          error: errMsg,
        });
      }
    }

    return json(200, { ok: true, results }, origin);
  } catch (e) {
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) }, origin);
  }
});
