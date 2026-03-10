import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import type { AIProvider } from "../_shared/ai-client.ts";

/**
 * premium-upgrade — 4-Layer Quality Densification Engine (v3 hardened)
 *
 * Layers:
 *   1. transfer_overlay     – Cross-LF scenarios
 *   2. very_hard_recal      – Conflict/multi-competency criteria
 *   3. oral_depth            – Stress config, dual-examiner, followup chains (SSOT in blueprint)
 *   4. economic_boost        – Calculation chains, margin decisions
 *
 * v3 fixes: partial status, stale recovery, CORS methods, batchId guards,
 *           validLfIds hoisted, json() with headers, finalizeRun safe wrapper
 */

const TIME_BUDGET_MS = 90_000;
const SAFE_BUFFER_MS = 5_000;
const BATCH_SIZE = 3;
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 min

type SB = SupabaseClient;
type Layer = "transfer_overlay" | "very_hard_recal" | "oral_depth" | "economic_boost";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-examfit-job-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });
}

function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}

function timeLeft(start: number): boolean {
  return (Date.now() - start) < (TIME_BUDGET_MS - SAFE_BUFFER_MS);
}

function nowIso(): string {
  return new Date().toISOString();
}

async function callAI(systemPrompt: string, userPrompt: string, maxTokens = 4096): Promise<string> {
  const result = await callAIJSON({
    provider: "openai" as AIProvider,
    model: "gpt-5.2",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: maxTokens,
  });
  return result.content || "";
}

/** Tolerant JSON extraction — markdown fences, leading text, truncated output, trailing commas */
function parseJSON(text: string): unknown {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const arrFirst = cleaned.indexOf("[");
  const arrLast = cleaned.lastIndexOf("]");
  const objFirst = cleaned.indexOf("{");
  const objLast = cleaned.lastIndexOf("}");

  let slice: string;
  if (arrFirst !== -1 && arrLast > arrFirst) {
    slice = cleaned.slice(arrFirst, arrLast + 1);
  } else if (objFirst !== -1 && objLast > objFirst) {
    slice = cleaned.slice(objFirst, objLast + 1);
  } else {
    slice = cleaned;
  }

  try {
    return JSON.parse(slice);
  } catch {
    const fixed = slice.replace(/,\s*([\]}])/g, "$1");
    return JSON.parse(fixed);
  }
}

/** Safe finalize — never throws */
async function finalizeRun(
  sb: SB,
  runId: string,
  status: "done" | "partial" | "failed",
  progress: Record<string, unknown>,
  errorMsg: string | null,
) {
  try {
    await sb.from("premium_upgrade_runs").update({
      status,
      finished_at: nowIso(),
      progress,
      error: errorMsg,
    }).eq("id", runId);
  } catch (e) {
    console.error(`[PremiumUpgrade] finalizeRun failed: ${(e as Error).message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// LAYER 1: Transfer-Overlay
// ═══════════════════════════════════════════════════════════════
async function upgradeTransferOverlay(
  sb: SB, curriculumId: string, berufName: string, runId: string, start: number,
): Promise<{ upgraded: number; failed: number; total: number }> {
  const { data: lfs } = await sb
    .from("learning_fields")
    .select("id, title, field_number")
    .eq("curriculum_id", curriculumId)
    .order("field_number");

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

  // Hoist: build once, not per upgrade item
  const validLfIds = new Set((lfs || []).map(lf => lf.id));

  const byLf = new Map<string, typeof blueprints>();
  for (const bp of blueprints) {
    const lfId = bp.learning_field_id || "none";
    if (!byLf.has(lfId)) byLf.set(lfId, []);
    byLf.get(lfId)!.push(bp);
  }

  const lfNames = new Map((lfs || []).map(lf => [lf.id, `LF${lf.field_number}: ${lf.title}`]));

  for (const [lfId, bps] of byLf) {
    if (!timeLeft(start)) break;

    const candidates = bps.slice(0, BATCH_SIZE);
    const batchIds = new Set(candidates.map(c => c.id));
    const otherLfs = (lfs || []).filter(lf => lf.id !== lfId).slice(0, 3);

    const systemPrompt = `Du bist ein IHK-Prüfungsexperte für ${berufName}. Transformiere Single-Competency-Blueprints in Cross-LF Transfer-Szenarien.

Regeln:
- Jedes Szenario muss mindestens 2 Lernfelder verknüpfen
- Praxisnaher Kontext mit konkreten Zahlen, Rollen und Entscheidungsdruck
- scenario_type: "combined_decision" oder "conflict_resolution" oder "calculation_chain"
- cross_lf_ids: NUR die exakten UUIDs aus der Liste unten!

Antworte NUR als JSON-Array:
[{"blueprint_id": "exakte-uuid", "scenario_type": "combined_decision", "cross_lf_ids": ["uuid"], "upgraded_question_template": "...", "upgraded_typical_exam_trap": "..."}]`;

    const userPrompt = `Blueprints (${lfNames.get(lfId) || "Unbekannt"}):
${JSON.stringify(candidates.map(c => ({
  id: c.id, name: c.name, statement: c.canonical_statement,
  level: c.cognitive_level, template: c.question_template, trap: c.typical_exam_trap,
})), null, 2)}

Verfügbare Lernfelder für Verknüpfung:
${JSON.stringify(otherLfs.map(lf => ({ id: lf.id, name: `LF${lf.field_number}: ${lf.title}` })), null, 2)}`;

    try {
      const raw = await callAI(systemPrompt, userPrompt, 6000);
      const upgrades = parseJSON(raw) as Array<Record<string, unknown>>;
      if (!Array.isArray(upgrades)) throw new Error("Not an array");

      for (const upg of upgrades) {
        if (!upg.blueprint_id || !batchIds.has(upg.blueprint_id as string)) continue;

        const crossLfIds = (Array.isArray(upg.cross_lf_ids) ? upg.cross_lf_ids : [])
          .filter((id: unknown) => typeof id === "string" && validLfIds.has(id as string));

        const { error } = await sb
          .from("question_blueprints")
          .update({
            scenario_type: upg.scenario_type || "combined_decision",
            cross_lf_references: crossLfIds.length > 0 ? crossLfIds : undefined,
            question_template: upg.upgraded_question_template || undefined,
            typical_exam_trap: upg.upgraded_typical_exam_trap || undefined,
            last_premium_upgrade_run_id: runId,
            premium_upgraded_at: nowIso(),
          })
          .eq("id", upg.blueprint_id)
          .eq("scenario_type", "single_competency"); // CAS guard

        if (!error) upgraded++;
        else { console.error(`[PremiumUpgrade] Transfer update: ${error.message}`); failed++; }
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
  sb: SB, curriculumId: string, berufName: string, runId: string, start: number,
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
    const batchIds = new Set(batch.map(b => b.id));

    const systemPrompt = `Du bist ein IHK-Prüfungsexperte für ${berufName}. Definiere "very_hard" Kriterien.

Jedes very_hard Blueprint muss enthalten:
- conflict_type: "legal_vs_economic" | "risk_vs_efficiency" | "compliance_vs_practice" | "quality_vs_cost"
- min_competency_areas: mindestens 2
- requires_decision_justification: true
- incomplete_information: true
- trade_off_dimensions: Array von mind. 2 Abwägungsdimensionen

Antworte NUR als JSON-Array:
[{"blueprint_id": "...", "very_hard_criteria": {...}}]`;

    const userPrompt = `Blueprints:\n${JSON.stringify(batch.map(b => ({
      id: b.id, name: b.name, statement: b.canonical_statement,
      level: b.cognitive_level, type: b.knowledge_type, trap: b.typical_exam_trap,
    })), null, 2)}`;

    try {
      const raw = await callAI(systemPrompt, userPrompt, 4000);
      const upgrades = parseJSON(raw) as Array<Record<string, unknown>>;
      if (!Array.isArray(upgrades)) throw new Error("Not an array");

      for (const upg of upgrades) {
        if (!upg.blueprint_id || !upg.very_hard_criteria || !batchIds.has(upg.blueprint_id as string)) continue;
        const { error } = await sb
          .from("question_blueprints")
          .update({
            very_hard_criteria: upg.very_hard_criteria,
            last_premium_upgrade_run_id: runId,
            premium_upgraded_at: nowIso(),
          })
          .eq("id", upg.blueprint_id)
          .is("very_hard_criteria", null); // CAS guard

        if (!error) upgraded++;
        else { console.error(`[PremiumUpgrade] VeryHard update: ${error.message}`); failed++; }
      }
    } catch (err) {
      console.error(`[PremiumUpgrade] VeryHard batch ${i}: ${(err as Error).message}`);
      failed += batch.length;
    }
  }

  return { upgraded, failed, total };
}

// ═══════════════════════════════════════════════════════════════
// LAYER 3: Oral-Trainer Depth (SSOT: followup_chains in Blueprint)
// ═══════════════════════════════════════════════════════════════
async function upgradeOralDepth(
  sb: SB, curriculumId: string, berufName: string, runId: string, start: number,
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
    const batchIds = new Set(batch.map(b => b.id));

    const systemPrompt = `Du bist ein IHK-Prüfungsexperte für ${berufName}. Erweitere Oral-Exam-Blueprints. KOMPAKT.

Für jeden Blueprint generiere:
1. stress_config: {level: 1-5, time_pressure: bool, ambiguous_question: bool, pushback_intensity: "mild"|"moderate"|"strong"}
2. dual_examiner_roles: {examiner_a: {role: "Fachprüfer", focus_area: "kurz"}, examiner_b: {role: "Betriebspraxis-Prüfer", focus_area: "kurz"}}
3. scoring_weights: {fachlichkeit: 0.3, struktur: 0.25, begriffssicherheit: 0.25, praxisbezug: 0.2}
4. followup_chains: GENAU 4 Nachfragen, je max 25 Wörter:
   [{trigger: "wenn_oberflächlich", question: "...", expected_depth: "Begründung", scoring_dimension: "fachlichkeit"}]

Antworte NUR als JSON-Array. blueprint_id MUSS exakt die übergebene ID sein.`;

    const userPrompt = `Blueprints:\n${JSON.stringify(batch.map(b => ({
      id: b.id, title: b.title, scenario: (b.scenario || "").slice(0, 200),
    })), null, 2)}`;

    try {
      const raw = await callAI(systemPrompt, userPrompt, 6000);
      const upgrades = parseJSON(raw) as Array<Record<string, unknown>>;
      if (!Array.isArray(upgrades)) throw new Error("Not an array");

      for (const upg of upgrades) {
        if (!upg.blueprint_id || !batchIds.has(upg.blueprint_id as string)) continue;

        // SSOT: followup_chains in blueprint
        const { error } = await sb
          .from("oral_exam_blueprints")
          .update({
            stress_config: upg.stress_config,
            dual_examiner_roles: upg.dual_examiner_roles,
            scoring_weights: upg.scoring_weights,
            followup_depth: 4,
            followup_chains: upg.followup_chains || null,
            last_premium_upgrade_run_id: runId,
            premium_upgraded_at: nowIso(),
          })
          .eq("id", upg.blueprint_id)
          .is("stress_config", null); // CAS guard

        if (!error) upgraded++;
        else { console.error(`[PremiumUpgrade] OralDepth update: ${error.message}`); failed++; }

        // Cascade to templates (only where followup_chains is null)
        if (upg.followup_chains) {
          await sb
            .from("oral_exam_session_templates")
            .update({
              stress_level: (upg.stress_config as Record<string, unknown>)?.level || 3,
              examiner_mode: upg.dual_examiner_roles ? "dual_cooperative" : "single",
              followup_chains: upg.followup_chains,
              scoring_rubric_detailed: upg.scoring_weights,
            })
            .eq("blueprint_id", upg.blueprint_id)
            .is("followup_chains", null);
        }
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
  sb: SB, curriculumId: string, berufName: string, runId: string, start: number,
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
    const batchIds = new Set(batch.map(b => b.id));

    const systemPrompt = `Du bist ein IHK-Prüfungsexperte für ${berufName} (Wirtschaftlichkeit). Erweitere Blueprints.

Für jeden Blueprint bestimme:
1. economic_scenario_type: "calculation_chain" | "margin_decision" | "contribution_margin" | "assortment_strategy" | "cost_comparison"
2. upgraded_question_template mit:
   - Mehrstufiger Kalkulationskette (mind. 2 Rechenschritte)
   - Konkreten Zahlen (EK, VK, Spannen, Mengen)
   - Entscheidungsdruck
   - Berufsspezifischem Kontext passend zu ${berufName}

Antworte NUR als JSON-Array:
[{"blueprint_id": "...", "economic_scenario_type": "...", "upgraded_question_template": "..."}]`;

    const userPrompt = `Blueprints:\n${JSON.stringify(batch.map(b => ({
      id: b.id, name: b.name, statement: b.canonical_statement,
      level: b.cognitive_level, template: b.question_template,
    })), null, 2)}`;

    try {
      const raw = await callAI(systemPrompt, userPrompt, 5000);
      const upgrades = parseJSON(raw) as Array<Record<string, unknown>>;
      if (!Array.isArray(upgrades)) throw new Error("Not an array");

      for (const upg of upgrades) {
        if (!upg.blueprint_id || !batchIds.has(upg.blueprint_id as string)) continue;
        const updateData: Record<string, unknown> = {
          economic_scenario_type: upg.economic_scenario_type,
          last_premium_upgrade_run_id: runId,
          premium_upgraded_at: nowIso(),
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
        else { console.error(`[PremiumUpgrade] Economic update: ${error.message}`); failed++; }
      }
    } catch (err) {
      console.error(`[PremiumUpgrade] Economic batch ${i}: ${(err as Error).message}`);
      failed += batch.length;
    }
  }

  return { upgraded, failed, total };
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER (v3: partial status, stale recovery, safe finalize)
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const start = Date.now();

  try {
    const body = await req.json().catch(() => null);
    if (!body) return json({ ok: false, error: "INVALID_JSON" }, 400);

    const { package_id, layer, curriculum_id } = body as {
      package_id: string;
      layer: Layer;
      curriculum_id: string;
    };

    assertUuid("package_id", package_id);
    assertUuid("curriculum_id", curriculum_id);

    if (!["transfer_overlay", "very_hard_recal", "oral_depth", "economic_boost"].includes(layer)) {
      return json({ ok: false, error: "INVALID_LAYER" }, 400);
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Beruf name (best-effort)
    const { data: pkg, error: pkgErr } = await sb
      .from("course_packages")
      .select("course_id, courses(title, curriculum_id, curricula(berufe(bezeichnung_kurz)))")
      .eq("id", package_id)
      .maybeSingle();

    if (pkgErr) console.error(`[PremiumUpgrade] package lookup: ${pkgErr.message}`);

    const berufName =
      (pkg as Record<string, unknown> & { courses?: { curricula?: { berufe?: { bezeichnung_kurz?: string } }; title?: string } })
        ?.courses?.curricula?.berufe?.bezeichnung_kurz ||
      (pkg as Record<string, unknown> & { courses?: { title?: string } })?.courses?.title ||
      "Ausbildungsberuf";

    // Idempotent run: done→skip, stale running→recover, else create/continue
    const { data: existing, error: exErr } = await sb
      .from("premium_upgrade_runs")
      .select("id, status, started_at")
      .eq("package_id", package_id)
      .eq("layer", layer)
      .order("created_at", { ascending: false })
      .maybeSingle();

    if (exErr) console.error(`[PremiumUpgrade] run lookup: ${exErr.message}`);

    if (existing?.status === "done") {
      return json({ ok: true, already_done: true });
    }

    const isStale = existing?.status === "running" && existing?.started_at &&
      (Date.now() - new Date(existing.started_at).getTime()) > STALE_THRESHOLD_MS;

    let runId: string;
    if (existing?.id) {
      runId = existing.id;
      await sb.from("premium_upgrade_runs").update({
        status: "running",
        started_at: nowIso(),
        error: null,
      }).eq("id", runId);
      if (isStale) console.log(`[PremiumUpgrade] Recovering stale run ${runId.slice(0, 8)} layer=${layer}`);
    } else {
      const { data: newRun, error: insErr } = await sb
        .from("premium_upgrade_runs")
        .insert({ package_id, curriculum_id, layer, status: "running", started_at: nowIso() })
        .select("id")
        .single();

      if (insErr || !newRun?.id) {
        return json({ ok: false, error: "RUN_CREATE_FAILED", detail: insErr?.message }, 500);
      }
      runId = newRun.id;
    }

    console.log(`[PremiumUpgrade] Starting layer=${layer} pkg=${package_id.slice(0, 8)} beruf=${berufName}`);

    // Dispatch
    let result: { upgraded: number; failed: number; total: number };
    switch (layer) {
      case "transfer_overlay":
        result = await upgradeTransferOverlay(sb, curriculum_id, berufName, runId, start);
        break;
      case "very_hard_recal":
        result = await upgradeVeryHardRecal(sb, curriculum_id, berufName, runId, start);
        break;
      case "oral_depth":
        result = await upgradeOralDepth(sb, curriculum_id, berufName, runId, start);
        break;
      case "economic_boost":
        result = await upgradeEconomicBoost(sb, curriculum_id, berufName, runId, start);
        break;
    }

    // Determine completion: partial if timed out with remaining work
    const timedOut = !timeLeft(start) && (result.total ?? 0) > (result.upgraded + result.failed);
    const status: "done" | "partial" | "failed" =
      result.upgraded === 0 && result.failed > 0 ? "failed" :
      timedOut ? "partial" : "done";

    const metrics = {
      layer,
      upgraded: result.upgraded,
      failed: result.failed,
      total_candidates: result.total,
      timed_out: timedOut,
      elapsed_ms: Date.now() - start,
    };

    await finalizeRun(sb, runId, status, metrics, result.failed > 0 ? `${result.failed} items failed` : null);

    // Audit log (fire-and-forget)
    sb.from("auto_heal_log").insert({
      action_type: `premium_upgrade_${layer}`,
      trigger_source: "premium-upgrade",
      target_type: "course_package",
      target_id: package_id,
      result_status: status,
      result_detail: `Layer ${layer}: ${result.upgraded}/${result.total} upgraded, ${result.failed} failed${timedOut ? " (timed out)" : ""}`,
      metadata: { layer, run_id: runId, ...metrics },
    }).then(() => {}, () => {});

    console.log(`[PremiumUpgrade] ✅ ${layer} ${status} in ${metrics.elapsed_ms}ms — ${result.upgraded}/${result.total}`);

    return json({ ok: true, run_id: runId, status, ...metrics });
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    console.error(`[PremiumUpgrade] FATAL: ${msg}`);
    return json({ ok: false, error: "INTERNAL_ERROR", detail: msg }, 500);
  }
});
