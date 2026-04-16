import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { checkContamination } from "../_shared/contamination-guard.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { finalizeStepDone, finalizeStepFailed } from "../_shared/step-finalize.ts";

/**
 * package-validate-oral-exam — Pipeline Step (after generate_oral_exam)
 *
 * Structural quality gate for oral exam blueprints:
 *   - Min 10 blueprints per curriculum
 *   - Each blueprint: scenario ≥ 100 chars, ≥ 3 lead questions, ≥ 2 followups
 *   - Rubric present with ≥ 2 criteria
 *   - Lead questions reference competency content (not generic)
 *   - Contamination guard on scenario text
 *   - No duplicate scenarios (Jaccard ≥ 0.80)
 *
 * No LLM needed — oral exam blueprints are structural, not free-text content.
 */

const MIN_BLUEPRINTS = 10;
const MIN_SCENARIO_LENGTH = 100;
const MIN_LEAD_QUESTIONS = 3;
const MIN_FOLLOWUPS = 2;
const MIN_RUBRIC_CRITERIA = 2;
// Base threshold — dynamically adjusted for small curricula (few learning fields)
const JACCARD_THRESHOLD_BASE = 0.80;
const JACCARD_THRESHOLD_SMALL_CURRICULUM = 0.92; // ≤6 LFs → higher similarity tolerance

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textNgrams(text: string, n = 3): Set<string> {
  const norm = text.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const grams = new Set<string>();
  for (let i = 0; i <= norm.length - n; i++) grams.add(norm.slice(i, i + n));
  return grams;
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

interface BPResult {
  blueprintId: string;
  title: string;
  passed: boolean;
  issues: string[];
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;
  const certificationId = p.certification_id || null;

  if (!packageId || !curriculumId) return json({ error: "Missing package_id or curriculum_id" }, 400);

  // Resolve profession
  let professionName: string;
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }

  // Load blueprints
  const { data: blueprints, error: bpErr } = await sb
    .from("oral_exam_blueprints")
    .select("id, title, scenario, lead_questions, followups, rubric, competency_id, metadata")
    .eq("curriculum_id", curriculumId);

  if (bpErr) return json({ error: bpErr.message }, 500);
  if (!blueprints || blueprints.length === 0) {
    await finalizeStepFailed(sb, packageId, "validate_oral_exam", new Error("NO_BLUEPRINTS_TO_VALIDATE"));
    return json({ ok: false, batch_complete: true, error: "NO_BLUEPRINTS_TO_VALIDATE" }, 409);
  }

  console.log(`[validate-oral] Validating ${blueprints.length} blueprints for ${professionName} (pkg ${packageId.slice(0, 8)})`);

  // Dynamic Jaccard threshold: small curricula (≤6 LFs) produce naturally similar scenarios
  const { count: lfCount } = await sb
    .from("learning_fields")
    .select("id", { count: "exact", head: true })
    .eq("curriculum_id", curriculumId);
  const jaccardThreshold = (lfCount ?? 99) <= 6 ? JACCARD_THRESHOLD_SMALL_CURRICULUM : JACCARD_THRESHOLD_BASE;
  console.log(`[validate-oral] LF count=${lfCount}, jaccard threshold=${jaccardThreshold}`);

  // Count check
  if (blueprints.length < MIN_BLUEPRINTS) {
    await finalizeStepFailed(sb, packageId, "validate_oral_exam", new Error(`Nur ${blueprints.length}/${MIN_BLUEPRINTS} Blueprints`));
    return json({
      ok: false, batch_complete: true,
      message: `❌ Oral Exam QC: Nur ${blueprints.length}/${MIN_BLUEPRINTS} Blueprints vorhanden.`,
    });
  }

  // Validate each blueprint
  const results: BPResult[] = [];
  const scenarioNgrams = new Map<string, Set<string>>();

  for (const bp of blueprints) {
    const issues: string[] = [];

    // Scenario length
    if (!bp.scenario || bp.scenario.length < MIN_SCENARIO_LENGTH) {
      issues.push(`SCENARIO_TOO_SHORT: ${(bp.scenario || "").length}/${MIN_SCENARIO_LENGTH}`);
    }

    // Lead questions
    const leads = Array.isArray(bp.lead_questions) ? bp.lead_questions : [];
    if (leads.length < MIN_LEAD_QUESTIONS) {
      issues.push(`TOO_FEW_LEAD_QUESTIONS: ${leads.length}/${MIN_LEAD_QUESTIONS}`);
    }
    // Check for generic leads (too short or just template text)
    for (let i = 0; i < leads.length; i++) {
      if (typeof leads[i] === "string" && leads[i].length < 30) {
        issues.push(`LEAD_Q${i + 1}_TOO_SHORT`);
      }
    }

    // Followups
    const followups = Array.isArray(bp.followups) ? bp.followups : [];
    if (followups.length < MIN_FOLLOWUPS) {
      issues.push(`TOO_FEW_FOLLOWUPS: ${followups.length}/${MIN_FOLLOWUPS}`);
    }

    // Rubric
    const rubric = bp.rubric as any;
    if (!rubric || !rubric.criteria || !Array.isArray(rubric.criteria) || rubric.criteria.length < MIN_RUBRIC_CRITERIA) {
      issues.push(`RUBRIC_INCOMPLETE: ${rubric?.criteria?.length || 0}/${MIN_RUBRIC_CRITERIA} criteria`);
    }

    // Competency linkage
    if (!bp.competency_id) {
      issues.push("NO_COMPETENCY_LINKED");
    }

    // Duplicate scenario check
    if (bp.scenario) {
      const ng = textNgrams(bp.scenario);
      for (const [existingId, existingNg] of scenarioNgrams) {
        if (jaccardSim(ng, existingNg) >= jaccardThreshold) {
          issues.push(`DUPLICATE_SCENARIO: ${existingId.slice(0, 8)}`);
          break;
        }
      }
      scenarioNgrams.set(bp.id, ng);
    }

    // Contamination on scenario + lead questions
    const fullText = `${bp.scenario || ""} ${leads.join(" ")}`.slice(0, 5000);
    const contam = checkContamination(fullText, professionName);
    if (contam.isContaminated) {
      issues.push(`CONTAMINATION: ${contam.detectedIndustry} [${contam.matchedTerms.slice(0, 3).join(", ")}]`);
    }

    results.push({ blueprintId: bp.id, title: bp.title, passed: issues.length === 0, issues });
  }

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const passRate = (passed / results.length) * 100;

  console.log(`[validate-oral] ${passed}/${results.length} passed (${passRate.toFixed(1)}%)`);

  // Flag failed blueprints
  for (const fail of results.filter(r => !r.passed)) {
    await sb.from("oral_exam_blueprints").update({
      metadata: { ...(blueprints.find(b => b.id === fail.blueprintId)?.metadata as any || {}), qc_issues: fail.issues, qc_status: "failed", validated_at: new Date().toISOString() },
    }).eq("id", fail.blueprintId);
  }

  const overallPass = passRate >= 75;

  if (!overallPass) {
    // Deduplicate: only alert once per 30 min per package
    const since30 = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: existingAlert } = await sb
      .from("ops_alerts")
      .select("id")
      .eq("source", "validate-oral-exam")
      .gte("created_at", since30)
      .ilike("message", `%${packageId.slice(0, 8)}%`)
      .limit(1);

    if (!existingAlert || existingAlert.length === 0) {
      try {
        await sb.from("ops_alerts").insert({
          source: "validate-oral-exam",
          severity: "warning",
          message: `Oral Exam QC failed for pkg ${packageId.slice(0, 8)}: ${passed}/${results.length} passed`,
          payload: { packageId, pass_rate: passRate, failures: failed },
        });
      } catch (_e) { /* best-effort */ }
    }
  }

  // SSOT Finalization
  if (overallPass) {
    await finalizeStepDone(sb, packageId, "validate_oral_exam", { pass_rate: passRate, total: results.length, passed });
  } else {
    await finalizeStepFailed(sb, packageId, "validate_oral_exam", new Error(`Oral QC: ${passed}/${results.length} passed`), { pass_rate: passRate });
  }

  return json({
    ok: overallPass,
    batch_complete: true,
    total: results.length,
    passed,
    failed,
    pass_rate: passRate,
    failures: results.filter(r => !r.passed).slice(0, 15),
    message: overallPass
      ? `✅ Oral Exam QC bestanden: ${passed}/${results.length} (${passRate.toFixed(0)}%)`
      : `❌ Oral Exam QC fehlgeschlagen: ${passed}/${results.length} (${passRate.toFixed(0)}%)`,
  });
});
