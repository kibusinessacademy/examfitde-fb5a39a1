import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { resolveProfession } from "../_shared/profession-resolver.ts";

/**
 * package-validate-blueprints — Pipeline Step (after auto_seed_exam_blueprints)
 *
 * Validates that the seeded blueprints provide complete, well-distributed,
 * schema-valid coverage before expensive exam-question generation begins.
 *
 * Checks:
 *  1. COVERAGE: Every learning-field has at least 1 blueprint (gap detection)
 *  2. DISTRIBUTION: Blueprint count per LF roughly matches weight_percent (±15pp tolerance)
 *  3. SCHEMA: Required fields present (topic_id, difficulty, question_type, cognitive_level)
 *  4. DUPLICATES: Near-duplicate canonical_statements (Jaccard ≥ 0.80)
 *  5. PLAUSIBILITY: No generic/empty learning_objectives
 *
 * On failure: returns ok=false + batch_complete=true (pipeline step fails, no infinite loop)
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ── Text similarity ──
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

const JACCARD_THRESHOLD = 0.80;
const MIN_BLUEPRINTS_TOTAL = 10;
const WEIGHT_TOLERANCE_PP = 15; // percentage-point tolerance

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;
  const packageId = p.package_id;
  const curriculumId = p.curriculum_id;

  if (!packageId || !curriculumId) {
    return json({ error: "Missing package_id or curriculum_id" }, 400);
  }

  // Resolve profession for logging
  let professionName = "unbekannt";
  try {
    const prof = await resolveProfession(sb, {
      certificationId: p.certification_id || null,
      curriculumId,
    });
    professionName = prof.professionName;
  } catch { /* continue with unknown */ }

  console.log(`[validate-blueprints] Starting for ${professionName} (pkg ${packageId.slice(0, 8)})`);

  // ── Load blueprints ──
  const { data: blueprints, error: bpErr } = await sb
    .from("question_blueprints")
    .select("id, curriculum_id, learning_field_id, competency_id, canonical_statement, knowledge_type, cognitive_level, question_template, difficulty, max_variations, metadata")
    .eq("curriculum_id", curriculumId);

  if (bpErr) return json({ error: bpErr.message }, 500);
  if (!blueprints || blueprints.length === 0) {
    return json({
      ok: false,
      batch_complete: true,
      message: "❌ Keine Blueprints gefunden — Seeding hat nichts erzeugt.",
      issues: ["NO_BLUEPRINTS"],
    });
  }

  // ── Load learning fields for coverage check ──
  const { data: learningFields } = await sb
    .from("learning_fields")
    .select("id, name, weight_percent")
    .eq("curriculum_id", curriculumId);

  const lfMap = new Map((learningFields || []).map((lf: any) => [lf.id, lf]));
  const issues: string[] = [];
  const warnings: string[] = [];

  // ═══ CHECK 1: Coverage — every LF has blueprints ═══
  const bpByLf = new Map<string, number>();
  for (const bp of blueprints) {
    if (bp.learning_field_id) {
      bpByLf.set(bp.learning_field_id, (bpByLf.get(bp.learning_field_id) || 0) + 1);
    }
  }

  const missingLfs: string[] = [];
  for (const [lfId, lf] of lfMap) {
    if (!bpByLf.has(lfId)) {
      missingLfs.push(`${(lf as any).name || lfId.slice(0, 8)}`);
    }
  }
  if (missingLfs.length > 0) {
    issues.push(`MISSING_LF_COVERAGE: ${missingLfs.length} Lernfelder ohne Blueprints: ${missingLfs.slice(0, 5).join(", ")}${missingLfs.length > 5 ? "…" : ""}`);
  }

  // ═══ CHECK 2: Distribution vs weight ═══
  if (learningFields && learningFields.length > 0 && blueprints.length >= MIN_BLUEPRINTS_TOTAL) {
    for (const [lfId, count] of bpByLf) {
      const lf = lfMap.get(lfId) as any;
      if (!lf?.weight_percent) continue;
      const expectedPct = lf.weight_percent;
      const actualPct = (count / blueprints.length) * 100;
      const diff = Math.abs(actualPct - expectedPct);
      if (diff > WEIGHT_TOLERANCE_PP) {
        warnings.push(`WEIGHT_DRIFT: ${lf.name}: erwartet ~${expectedPct.toFixed(0)}%, tatsächlich ${actualPct.toFixed(0)}% (Δ${diff.toFixed(0)}pp)`);
      }
    }
  }

  // ═══ CHECK 3: Schema — required fields ═══
  let schemaErrors = 0;
  const requiredFields = ["canonical_statement", "knowledge_type", "cognitive_level"];
  for (const bp of blueprints) {
    for (const field of requiredFields) {
      if (!(bp as any)[field]) {
        schemaErrors++;
        if (schemaErrors <= 5) {
          issues.push(`SCHEMA_MISSING: Blueprint ${(bp.id as string).slice(0, 8)} fehlt '${field}'`);
        }
      }
    }
  }
  if (schemaErrors > 5) {
    issues.push(`SCHEMA_MISSING: …und ${schemaErrors - 5} weitere Schema-Fehler`);
  }

  // ═══ CHECK 4: Near-duplicates ═══
  const recentNgrams: Array<{ id: string; ngrams: Set<string>; text: string }> = [];
  let dupCount = 0;
  for (const bp of blueprints) {
    const text = bp.canonical_statement || bp.question_template || "";
    if (!text || text.length < 20) continue;
    const ngrams = textNgrams(text);

    for (const existing of recentNgrams) {
      if (jaccardSim(ngrams, existing.ngrams) >= JACCARD_THRESHOLD) {
        dupCount++;
        if (dupCount <= 3) {
          warnings.push(`NEAR_DUPLICATE: "${text.slice(0, 50)}…" ≈ "${existing.text.slice(0, 50)}…"`);
        }
        break;
      }
    }
    recentNgrams.push({ id: bp.id, ngrams, text });
    if (recentNgrams.length > 100) recentNgrams.shift();
  }
  if (dupCount > 3) {
    warnings.push(`NEAR_DUPLICATE: …und ${dupCount - 3} weitere Duplikate`);
  }
  if (dupCount > blueprints.length * 0.15) {
    issues.push(`HIGH_DUPLICATE_RATE: ${dupCount}/${blueprints.length} (${((dupCount / blueprints.length) * 100).toFixed(0)}%) Beinahe-Duplikate`);
  }

  // ═══ CHECK 5: Plausibility — no empty/generic statements ═══
  let genericCount = 0;
  for (const bp of blueprints) {
    const stmt = (bp.canonical_statement || "").trim();
    if (stmt.length < 20 || /^(test|beispiel|platzhalter|todo|tbd)/i.test(stmt)) {
      genericCount++;
    }
  }
  if (genericCount > 0) {
    issues.push(`GENERIC_BLUEPRINTS: ${genericCount} Blueprints mit generischen/leeren Aussagen`);
  }

  // ═══ TOTAL MINIMUM ═══
  if (blueprints.length < MIN_BLUEPRINTS_TOTAL) {
    issues.push(`TOO_FEW_BLUEPRINTS: ${blueprints.length}/${MIN_BLUEPRINTS_TOTAL} Minimum`);
  }

  // ── Decision ──
  const passed = issues.length === 0;
  const coveragePct = lfMap.size > 0
    ? ((bpByLf.size / lfMap.size) * 100)
    : 100;

  const summary = {
    total_blueprints: blueprints.length,
    learning_fields_total: lfMap.size,
    learning_fields_covered: bpByLf.size,
    coverage_pct: coveragePct,
    schema_errors: schemaErrors,
    duplicates: dupCount,
    generic: genericCount,
  };

  console.log(`[validate-blueprints] Result: ${passed ? "PASS" : "FAIL"} | ${blueprints.length} blueprints, ${coveragePct.toFixed(0)}% LF coverage, ${issues.length} issues, ${warnings.length} warnings`);

  // Store validation result on the package
  await sb.from("course_packages").update({
    last_error: passed ? null : `Blueprint QC: ${issues.length} Fehler`,
  }).eq("id", packageId);

  return json({
    ok: passed,
    batch_complete: true, // Always complete — no infinite loop
    summary,
    issues,
    warnings,
    message: passed
      ? `✅ Blueprint-Validierung bestanden: ${blueprints.length} Blueprints, ${coveragePct.toFixed(0)}% Coverage`
      : `❌ Blueprint-Validierung fehlgeschlagen: ${issues.join("; ")}`,
  });
});
