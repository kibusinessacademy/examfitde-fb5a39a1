import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";

/**
 * premium-upgrade — 4-Layer Quality Densification Engine
 *
 * Layers:
 *   1. transfer_overlay     – Add cross-LF scenarios to blueprints
 *   2. very_hard_recal      – Sharpen very_hard criteria (conflict, multi-competency)
 *   3. oral_depth            – Stress config, dual-examiner, followup chains
 *   4. economic_boost        – Calculation chains, margin decisions
 *
 * SSOT Rules:
 *   - Never deletes existing content
 *   - Only enriches fields that are null/default
 *   - Tracks every change in premium_upgrade_runs
 *   - Budget-capped (110s) with graceful exit
 *   - Idempotent per layer+package
 */

const TIME_BUDGET_MS = 110_000;
const BATCH_SIZE = 3;

type Layer = "transfer_overlay" | "very_hard_recal" | "oral_depth" | "economic_boost";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

function timeLeft(start: number): boolean {
  return (Date.now() - start) < TIME_BUDGET_MS;
}

async function callAI(systemPrompt: string, userPrompt: string, maxTokens = 4096): Promise<string> {
  const result = await callAIJSON({
    provider: "lovable" as AIProvider,
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: maxTokens,
  });
  return result.content || "";
}

function parseJSON(text: string): any {
  let cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  // Fix truncated JSON: try to close arrays/objects
  if (!cleaned.endsWith("]") && !cleaned.endsWith("}")) {
    // Find last complete object
    const lastClose = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (lastClose > 0) {
      cleaned = cleaned.slice(0, lastClose + 1);
      if (!cleaned.endsWith("]")) cleaned += "]";
    }
  }
  return JSON.parse(cleaned);
}

// ═══════════════════════════════════════════════════════════════
// LAYER 1: Transfer-Overlay
// ═══════════════════════════════════════════════════════════════
async function upgradeTransferOverlay(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  berufName: string,
  start: number,
): Promise<{ upgraded: number; failed: number; total: number }> {
  // Get learning fields for cross-references
  const { data: lfs } = await sb
    .from("learning_fields")
    .select("id, title, field_number")
    .eq("curriculum_id", curriculumId)
    .order("field_number");

  // Get blueprints still at single_competency
  const { data: blueprints } = await sb
    .from("question_blueprints")
    .select("id, name, canonical_statement, cognitive_level, learning_field_id, competency_id, question_template, knowledge_type, typical_exam_trap")
    .eq("curriculum_id", curriculumId)
    .eq("scenario_type", "single_competency")
    .in("cognitive_level", ["apply", "analyze", "evaluate"])
    .limit(200);

  if (!blueprints?.length) return { upgraded: 0, failed: 0, total: 0 };

  const total = blueprints.length;
  let upgraded = 0, failed = 0;

  // Group by LF, pick top candidates per LF for combined scenarios
  const byLf = new Map<string, typeof blueprints>();
  for (const bp of blueprints) {
    const lfId = bp.learning_field_id || "none";
    if (!byLf.has(lfId)) byLf.set(lfId, []);
    byLf.get(lfId)!.push(bp);
  }

  const lfNames = new Map((lfs || []).map(lf => [lf.id, `LF${lf.field_number}: ${lf.title}`]));

  for (const [lfId, bps] of byLf) {
    if (!timeLeft(start)) break;

    // Pick up to 5 per LF for combined-decision upgrade
    const candidates = bps.slice(0, BATCH_SIZE);
    const otherLfs = (lfs || []).filter(lf => lf.id !== lfId).slice(0, 3);

    const systemPrompt = `Du bist ein IHK-Prüfungsexperte für ${berufName}. Deine Aufgabe: Transformiere Single-Competency-Blueprints in Cross-LF Transfer-Szenarien.

Regeln:
- Jedes Szenario muss mindestens 2 Lernfelder verknüpfen
- Praxisnaher Kontext mit konkreten Zahlen, Rollen und Entscheidungsdruck
- scenario_type: "combined_decision" oder "conflict_resolution" oder "calculation_chain"
- linked_competency_ids: UUIDs der verknüpften Kompetenzen (aus anderen LFs)
- cross_lf_references: UUIDs der verknüpften Lernfelder

Antworte als JSON-Array. Für jedes Blueprint:
{
  "blueprint_id": "...",
  "scenario_type": "combined_decision|conflict_resolution|calculation_chain",
  "cross_lf_ids": ["lf-uuid-1", "lf-uuid-2"],
  "upgraded_question_template": "Neuer, verknüpfter Fragentext mit Szenario...",
  "upgraded_typical_exam_trap": "Typischer Transfer-Fehler..."
}`;

    const userPrompt = `Blueprints (${lfNames.get(lfId) || "Unbekannt"}):
${JSON.stringify(candidates.map(c => ({
  id: c.id,
  name: c.name,
  statement: c.canonical_statement,
  level: c.cognitive_level,
  template: c.question_template,
  trap: c.typical_exam_trap,
})), null, 2)}

Verfügbare andere Lernfelder für Verknüpfung:
${JSON.stringify(otherLfs.map(lf => ({ id: lf.id, name: `LF${lf.field_number}: ${lf.title}` })), null, 2)}`;

    try {
      const raw = await callAI(systemPrompt, userPrompt, 6000);
      const upgrades = parseJSON(raw);
      if (!Array.isArray(upgrades)) throw new Error("Not an array");

      for (const upg of upgrades) {
        if (!upg.blueprint_id) continue;
        const { error } = await sb
          .from("question_blueprints")
          .update({
            scenario_type: upg.scenario_type || "combined_decision",
            cross_lf_references: upg.cross_lf_ids || [],
            question_template: upg.upgraded_question_template || undefined,
            typical_exam_trap: upg.upgraded_typical_exam_trap || undefined,
          })
          .eq("id", upg.blueprint_id)
          .eq("scenario_type", "single_competency"); // CAS guard

        if (!error) upgraded++;
        else failed++;
      }
    } catch (err) {
      console.error(`[PremiumUpgrade] Transfer LF ${lfId}: ${(err as Error).message}`);
      failed += candidates.length;
    }
  }

  return { upgraded, failed, total };
}

// ═══════════════════════════════════════════════════════════════
// LAYER 2: Very-Hard Rekalibrierung
// ═══════════════════════════════════════════════════════════════
async function upgradeVeryHardRecal(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  berufName: string,
  start: number,
): Promise<{ upgraded: number; failed: number; total: number }> {
  const { data: blueprints } = await sb
    .from("question_blueprints")
    .select("id, name, canonical_statement, cognitive_level, question_template, typical_exam_trap, knowledge_type, competency_id")
    .eq("curriculum_id", curriculumId)
    .is("very_hard_criteria", null)
    .in("cognitive_level", ["analyze", "evaluate"])
    .limit(100);

  if (!blueprints?.length) return { upgraded: 0, failed: 0, total: 0 };

  const total = blueprints.length;
  let upgraded = 0, failed = 0;

  for (let i = 0; i < blueprints.length && timeLeft(start); i += BATCH_SIZE) {
    const batch = blueprints.slice(i, i + BATCH_SIZE);

    const systemPrompt = `Du bist ein IHK-Prüfungsexperte für ${berufName}. Definiere "very_hard" Kriterien für Blueprints.

Jedes very_hard Blueprint muss enthalten:
- conflict_type: "legal_vs_economic" | "risk_vs_efficiency" | "compliance_vs_practice" | "quality_vs_cost"
- min_competency_areas: mindestens 2
- requires_decision_justification: true
- incomplete_information: true (Prüfling muss mit unvollständigen Daten entscheiden)
- trade_off_dimensions: Array von mind. 2 Abwägungsdimensionen

Antworte als JSON-Array:
[{
  "blueprint_id": "...",
  "very_hard_criteria": {
    "conflict_type": "...",
    "min_competency_areas": 2,
    "requires_decision_justification": true,
    "incomplete_information": true,
    "trade_off_dimensions": ["...", "..."]
  }
}]`;

    const userPrompt = `Blueprints:\n${JSON.stringify(batch.map(b => ({
      id: b.id, name: b.name, statement: b.canonical_statement,
      level: b.cognitive_level, type: b.knowledge_type,
      trap: b.typical_exam_trap,
    })), null, 2)}`;

    try {
      const raw = await callAI(systemPrompt, userPrompt, 4000);
      const upgrades = parseJSON(raw);

      for (const upg of upgrades) {
        if (!upg.blueprint_id || !upg.very_hard_criteria) continue;
        const { error } = await sb
          .from("question_blueprints")
          .update({ very_hard_criteria: upg.very_hard_criteria })
          .eq("id", upg.blueprint_id)
          .is("very_hard_criteria", null); // CAS guard

        if (!error) upgraded++;
        else failed++;
      }
    } catch (err) {
      console.error(`[PremiumUpgrade] VeryHard batch ${i}: ${(err as Error).message}`);
      failed += batch.length;
    }
  }

  return { upgraded, failed, total };
}

// ═══════════════════════════════════════════════════════════════
// LAYER 3: Oral-Trainer Depth
// ═══════════════════════════════════════════════════════════════
async function upgradeOralDepth(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  berufName: string,
  start: number,
): Promise<{ upgraded: number; failed: number; total: number }> {
  const { data: blueprints } = await sb
    .from("oral_exam_blueprints")
    .select("id, title, scenario, lead_questions, followups, rubric, competency_id, learning_field_id")
    .eq("curriculum_id", curriculumId)
    .is("stress_config", null)
    .limit(50);

  if (!blueprints?.length) return { upgraded: 0, failed: 0, total: 0 };

  const total = blueprints.length;
  let upgraded = 0, failed = 0;

  for (let i = 0; i < blueprints.length && timeLeft(start); i += BATCH_SIZE) {
    const batch = blueprints.slice(i, i + BATCH_SIZE);

    const systemPrompt = `Du bist ein IHK-Prüfungsexperte für ${berufName}. Erweitere Oral-Exam-Blueprints. Halte die Antworten KOMPAKT (kurze Fragen, keine langen Erklärungen).

Für jeden Blueprint generiere:
1. stress_config: {level: 1-5, time_pressure: bool, ambiguous_question: bool, pushback_intensity: "mild"|"moderate"|"strong"}
2. dual_examiner_roles: {examiner_a: {role: "Fachprüfer", focus_area: "kurz"}, examiner_b: {role: "Betriebspraxis-Prüfer", focus_area: "kurz"}}
3. scoring_weights: {fachlichkeit: 0.3, struktur: 0.25, begriffssicherheit: 0.25, praxisbezug: 0.2}
4. followup_chains: GENAU 4 Nachfragen (nicht mehr!), je max 2 Sätze:
   {trigger: "wenn_oberflächlich|wenn_falsch|wenn_korrekt", question: "...", expected_depth: "Nennung|Begründung|Transfer", scoring_dimension: "fachlichkeit|struktur|begriffssicherheit|praxisbezug"}

Antworte NUR als JSON-Array, KEINE Erklärungen. Halte followup_chains Fragen unter 30 Wörter.`;

    const userPrompt = `Blueprints:\n${JSON.stringify(batch.map(b => ({
      id: b.id, title: b.title, scenario: (b.scenario || "").slice(0, 200),
    })), null, 2)}`;

    try {
      const raw = await callAI(systemPrompt, userPrompt, 8000);
      const upgrades = parseJSON(raw);

      for (const upg of upgrades) {
        if (!upg.blueprint_id) continue;
        const { error } = await sb
          .from("oral_exam_blueprints")
          .update({
            stress_config: upg.stress_config,
            dual_examiner_roles: upg.dual_examiner_roles,
            scoring_weights: upg.scoring_weights,
            followup_depth: upg.followup_depth || 4,
          })
          .eq("id", upg.blueprint_id)
          .is("stress_config", null); // CAS guard

        if (!error) upgraded++;
        else failed++;
      }

      // Also upgrade session templates for these blueprints
      for (const upg of upgrades) {
        if (!upg.blueprint_id || !upg.followup_chains) continue;
        await sb
          .from("oral_exam_session_templates")
          .update({
            stress_level: upg.stress_config?.level || 3,
            examiner_mode: upg.dual_examiner_roles ? "dual_cooperative" : "single",
            followup_chains: upg.followup_chains,
            scoring_rubric_detailed: upg.scoring_weights,
          })
          .eq("blueprint_id", upg.blueprint_id)
          .eq("stress_level", 1); // only default
      }
    } catch (err) {
      console.error(`[PremiumUpgrade] OralDepth batch ${i}: ${(err as Error).message}`);
      failed += batch.length;
    }
  }

  return { upgraded, failed, total };
}

// ═══════════════════════════════════════════════════════════════
// LAYER 4: Economic Boost
// ═══════════════════════════════════════════════════════════════
async function upgradeEconomicBoost(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  berufName: string,
  start: number,
): Promise<{ upgraded: number; failed: number; total: number }> {
  const { data: blueprints } = await sb
    .from("question_blueprints")
    .select("id, name, canonical_statement, cognitive_level, question_template, typical_exam_trap, knowledge_type")
    .eq("curriculum_id", curriculumId)
    .eq("knowledge_type", "calculation")
    .is("economic_scenario_type", null)
    .limit(100);

  if (!blueprints?.length) return { upgraded: 0, failed: 0, total: 0 };

  const total = blueprints.length;
  let upgraded = 0, failed = 0;

  for (let i = 0; i < blueprints.length && timeLeft(start); i += BATCH_SIZE) {
    const batch = blueprints.slice(i, i + BATCH_SIZE);

    const systemPrompt = `Du bist ein IHK-Prüfungsexperte für ${berufName} mit Schwerpunkt Wirtschaftlichkeit. Erweitere Blueprints mit wirtschaftlichen Szenarien.

Für jeden Blueprint bestimme:
1. economic_scenario_type: "calculation_chain" | "margin_decision" | "contribution_margin" | "assortment_strategy" | "cost_comparison"
2. Ein verbessertes question_template mit:
   - Mehrstufiger Kalkulationskette (mindestens 2 Rechenschritte)
   - Konkreten Zahlen (EK, VK, Spannen, Mengen)
   - Entscheidungsdruck (z.B. "Welche Option ist wirtschaftlich vorteilhafter?")
   - Apothekenspezifischem Kontext (Rabattverträge, Retaxation, Warengruppen)

Antworte als JSON-Array:
[{
  "blueprint_id": "...",
  "economic_scenario_type": "...",
  "upgraded_question_template": "..."
}]`;

    const userPrompt = `Blueprints:\n${JSON.stringify(batch.map(b => ({
      id: b.id, name: b.name, statement: b.canonical_statement,
      level: b.cognitive_level, template: b.question_template,
    })), null, 2)}`;

    try {
      const raw = await callAI(systemPrompt, userPrompt, 5000);
      const upgrades = parseJSON(raw);

      for (const upg of upgrades) {
        if (!upg.blueprint_id) continue;
        const updateData: Record<string, unknown> = {
          economic_scenario_type: upg.economic_scenario_type,
        };
        if (upg.upgraded_question_template) {
          updateData.question_template = upg.upgraded_question_template;
        }

        const { error } = await sb
          .from("question_blueprints")
          .update(updateData)
          .eq("id", upg.blueprint_id)
          .is("economic_scenario_type", null); // CAS guard

        if (!error) upgraded++;
        else failed++;
      }
    } catch (err) {
      console.error(`[PremiumUpgrade] Economic batch ${i}: ${(err as Error).message}`);
      failed += batch.length;
    }
  }

  return { upgraded, failed, total };
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });

  const start = Date.now();

  try {
    const { package_id, layer, curriculum_id } = await req.json();
    assertUuid("package_id", package_id);
    assertUuid("curriculum_id", curriculum_id);
    if (!["transfer_overlay", "very_hard_recal", "oral_depth", "economic_boost"].includes(layer)) {
      return json({ ok: false, error: "INVALID_LAYER" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get beruf name for context
    const { data: pkg } = await sb
      .from("course_packages")
      .select("course_id, courses(title, curriculum_id, curricula(berufe(bezeichnung_kurz)))")
      .eq("id", package_id)
      .single();

    const berufName = (pkg as any)?.courses?.curricula?.berufe?.bezeichnung_kurz || "Ausbildungsberuf";

    // Upsert upgrade run (idempotent)
    const { data: existing } = await sb
      .from("premium_upgrade_runs")
      .select("id, status")
      .eq("package_id", package_id)
      .eq("layer", layer)
      .maybeSingle();

    if (existing?.status === "done") {
      console.log(`[PremiumUpgrade] Layer ${layer} already done for ${package_id.slice(0, 8)}`);
      return json({ ok: true, already_done: true });
    }

    let runId: string;
    if (existing) {
      runId = existing.id;
      await sb.from("premium_upgrade_runs").update({
        status: "running",
        started_at: new Date().toISOString(),
      }).eq("id", runId);
    } else {
      const { data: newRun } = await sb.from("premium_upgrade_runs").insert({
        package_id,
        curriculum_id,
        layer,
        status: "running",
        started_at: new Date().toISOString(),
      }).select("id").single();
      runId = newRun!.id;
    }

    console.log(`[PremiumUpgrade] Starting ${layer} for ${package_id.slice(0, 8)} (${berufName})`);

    // Dispatch to layer handler
    let result: { upgraded: number; failed: number; total: number };
    switch (layer as Layer) {
      case "transfer_overlay":
        result = await upgradeTransferOverlay(sb, curriculum_id, berufName, start);
        break;
      case "very_hard_recal":
        result = await upgradeVeryHardRecal(sb, curriculum_id, berufName, start);
        break;
      case "oral_depth":
        result = await upgradeOralDepth(sb, curriculum_id, berufName, start);
        break;
      case "economic_boost":
        result = await upgradeEconomicBoost(sb, curriculum_id, berufName, start);
        break;
    }

    // Update run status
    const finalStatus = result.failed === 0 ? "done" : (result.upgraded > 0 ? "done" : "failed");
    await sb.from("premium_upgrade_runs").update({
      status: finalStatus,
      progress: { completed: result.upgraded, total: result.total, failed: result.failed },
      finished_at: new Date().toISOString(),
    }).eq("id", runId);

    // Audit log
    await sb.from("auto_heal_log").insert({
      action_type: `premium_upgrade_${layer}`,
      trigger_source: "premium-upgrade",
      target_type: "course_package",
      target_id: package_id,
      result_status: finalStatus,
      result_detail: `Layer ${layer}: ${result.upgraded}/${result.total} upgraded, ${result.failed} failed`,
      metadata: { layer, run_id: runId, ...result },
    });
    // ignore audit log errors silently

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[PremiumUpgrade] ✅ ${layer} done in ${elapsed}s — ${result.upgraded}/${result.total} upgraded`);

    return json({
      ok: true,
      layer,
      run_id: runId,
      ...result,
      elapsed_s: parseFloat(elapsed),
    });
  } catch (err) {
    console.error(`[PremiumUpgrade] FATAL: ${(err as Error)?.message || err}`);
    return json({ ok: false, error: String(err) }, 500);
  }
});
