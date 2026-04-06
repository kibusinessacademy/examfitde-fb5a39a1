import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type VariantType =
  | "parameter_shift"
  | "context_shift"
  | "trap_shift"
  | "structure_shift"
  | "transfer_shift";

interface Blueprint {
  id: string;
  curriculum_id: string;
  learning_field_id: string | null;
  competency_id: string | null;
  name: string;
  canonical_statement: string;
  knowledge_type: string;
  cognitive_level: string;
  question_template: string;
  rubric: Record<string, number> | null;
  trap_definition: Record<string, unknown> | null;
  typical_errors: Array<{ error: string; frequency?: string }> | null;
}

interface GeneratedVariant {
  question_text: string;
  answer_text?: string;
  options?: Array<{ text: string; is_correct: boolean; source_error?: string }>;
  correct_answer?: unknown;
  trap_type?: string | null;
  trap_applied?: Record<string, unknown> | null;
  distractor_meta?: Array<{ option_text: string; derived_from?: string }> | null;
  variables?: Record<string, unknown> | null;
  scenario_context?: Record<string, unknown> | null;
}

/**
 * Deterministic variant type distribution.
 * Studium (higher_education) gets more transfer_shift.
 * Ratios are enforced, not random.
 */
function pickVariantTypes(count: number, isStudium = false): VariantType[] {
  // Target ratios: [parameter, context, trap, structure, transfer]
  const ratios: Record<string, number[]> = {
    studium:    [0.13, 0.20, 0.20, 0.13, 0.34],
    vocational: [0.20, 0.20, 0.20, 0.13, 0.27],
  };
  const r = isStudium ? ratios.studium : ratios.vocational;
  const types: VariantType[] = [
    "parameter_shift", "context_shift", "trap_shift",
    "structure_shift", "transfer_shift",
  ];

  // Allocate deterministically with largest-remainder method
  const raw = r.map(p => p * count);
  const floors = raw.map(Math.floor);
  let remaining = count - floors.reduce((a, b) => a + b, 0);
  const remainders = raw.map((v, i) => ({ i, r: v - floors[i] }));
  remainders.sort((a, b) => b.r - a.r);
  for (let j = 0; j < remaining; j++) floors[remainders[j].i]++;

  // Build list and shuffle
  const out: VariantType[] = [];
  for (let i = 0; i < types.length; i++) {
    for (let j = 0; j < floors[i]; j++) out.push(types[i]);
  }
  // Fisher-Yates shuffle
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildVariantPrompt(bp: Blueprint, variantType: VariantType, subjectName: string): string {
  return `
Erzeuge genau 1 neue Prüfungsvarianten-Frage aus diesem Blueprint.

FACH: ${subjectName}
BLUEPRINT: ${bp.name}
KERNLOGIK: ${bp.canonical_statement}
QUESTION_TYPE: ${bp.knowledge_type}
COGNITIVE_LEVEL: ${bp.cognitive_level}

TRAP-DEFINITION:
${JSON.stringify(bp.trap_definition ?? {}, null, 2)}

TYPICAL_ERRORS:
${JSON.stringify(bp.typical_errors ?? [], null, 2)}

RUBRIC:
${JSON.stringify(bp.rubric ?? {}, null, 2)}

VARIANTENTYP: ${variantType}

REGELN:
- Teste dieselbe Kompetenz wie der Blueprint.
- Halte das cognitive_level exakt konstant.
- Verändere NICHT nur Zahlen, sondern den Denkweg passend zum Variantentyp.
- Nutze eine plausible Klausur- oder Fallsituation.
- Wenn Antwortoptionen erzeugt werden, müssen die falschen Optionen aus typischen Fehlern abgeleitet sein.
- Keine Duplikate des Blueprint-Textes.
- Für higher_education: akademischer Stil, keine IHK-Begriffe.

VARIANTENTYP-LOGIK:
- parameter_shift: gleiche Struktur, andere Werte
- context_shift: gleiche Logik, anderer Anwendungskontext
- trap_shift: gleiche Kompetenz, andere typische Falle
- structure_shift: gleiche Logik, aber indirekter oder umgestellter Informationsaufbau
- transfer_shift: neue Situation, Wissen muss übertragen werden

Gib NUR valides JSON zurück:
{
  "question_text": "...",
  "answer_text": "...",
  "options": [{"text":"...","is_correct":true,"source_error":"..."}],
  "correct_answer": "...",
  "trap_type": "...",
  "trap_applied": {},
  "distractor_meta": [{"option_text":"...","derived_from":"..."}],
  "variables": {},
  "scenario_context": {}
}`.trim();
}

function scoreVariant(bp: Blueprint, variant: GeneratedVariant, variantType: VariantType): { score: number; flags: string[] } {
  const flags: string[] = [];

  if (!variant.trap_type && !variant.trap_applied) flags.push("MISSING_TRAP");

  if (variant.options && variant.options.length >= 4) {
    const wrong = variant.options.filter(o => !o.is_correct);
    if (wrong.length < 3) flags.push("TOO_FEW_DISTRACTORS");
    if (wrong.filter(o => !o.source_error).length > 1) flags.push("DISTRACTOR_WITHOUT_ERROR_MODEL");
  }

  if (variantType === "transfer_shift" && !variant.scenario_context) {
    flags.push("TRANSFER_WITHOUT_NEW_CONTEXT");
  }

  if ((variant.question_text?.length ?? 0) < 30) flags.push("QUESTION_TOO_SHORT");

  const score = Math.max(0, 100 - flags.length * 20);
  return { score, flags };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const p = body.payload || body;

    // ── Boundary normalization: accept both camelCase and snake_case ──
    let blueprintId = p.blueprintId ?? p.blueprint_id ?? null;
    const count = p.count ?? 20;
    let subjectName = p.subjectName ?? p.subject_name ?? "Wirtschaftsinformatik";
    let isStudium = p.isStudium ?? p.is_studium ?? true;

    // Package-level dispatch: if no blueprintId but package_id given,
    // look up all validated blueprints and process them sequentially
    const packageId = p.package_id ?? p.packageId ?? null;

    if (!blueprintId && packageId) {
      console.log(`[generate-blueprint-variants] Package-level dispatch → enqueue-only for ${packageId}`);

      // Resolve curriculum for blueprint lookup
      const { data: pkg } = await sb
        .from("course_packages")
        .select("curriculum_id, course_id")
        .eq("id", packageId)
        .maybeSingle();

      if (!pkg?.curriculum_id) {
        return new Response(JSON.stringify({ error: "Package or curriculum not found", package_id: packageId }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Resolve subject name + isStudium
      const { data: cur } = await sb
        .from("curricula")
        .select("track, program_type")
        .eq("id", pkg.curriculum_id)
        .maybeSingle();
      if (cur) {
        isStudium = cur.track === "STUDIUM" || cur.program_type === "higher_education";
      }
      const { data: course } = await sb
        .from("courses")
        .select("title")
        .eq("id", pkg.course_id)
        .maybeSingle();
      const resolvedSubject = course?.title ?? subjectName;

      // Find all approved blueprints
      const { data: blueprints, error: bpListErr } = await sb
        .from("question_blueprints")
        .select("id")
        .eq("curriculum_id", pkg.curriculum_id)
        .eq("status", "approved");

      if (bpListErr || !blueprints || blueprints.length === 0) {
        return new Response(JSON.stringify({
          error: "No approved blueprints found for package",
          package_id: packageId,
        }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── PRE-FLIGHT VALIDATION: Only fan-out eligible blueprints ──
      const { data: preflightResults, error: preflightErr } = await sb.rpc(
        "fn_validate_blueprint_preflight_batch",
        { p_blueprint_ids: blueprints.map(b => b.id) }
      ).maybeSingle();

      // Fallback: validate per-blueprint if batch RPC not available
      let eligibleIds: string[] = [];
      let blockedIds: string[] = [];
      const preflightDetails: Record<string, unknown> = {};

      if (preflightErr || !preflightResults) {
        // Per-blueprint validation via individual RPC calls
        console.log(`[generate-blueprint-variants] Using per-blueprint preflight validation`);
        for (const bp of blueprints) {
          const { data: result } = await sb.rpc("fn_validate_blueprint_preflight", { p_blueprint_id: bp.id });
          if (result && (result as any).eligible) {
            eligibleIds.push(bp.id);
          } else {
            blockedIds.push(bp.id);
            preflightDetails[bp.id] = result;
          }
        }
      } else {
        // Batch result
        eligibleIds = (preflightResults as any).eligible_ids || blueprints.map((b: any) => b.id);
        blockedIds = (preflightResults as any).blocked_ids || [];
        console.log(`[generate-blueprint-variants] Batch preflight: ${eligibleIds.length} eligible, ${blockedIds.length} blocked`);
      }

      if (blockedIds.length > 0) {
        console.warn(`[generate-blueprint-variants] ⚠️ PRE-FLIGHT BLOCKED ${blockedIds.length}/${blueprints.length} blueprints`);
      }

      if (eligibleIds.length === 0) {
        return new Response(JSON.stringify({
          ok: false,
          error: "All blueprints failed pre-flight validation",
          package_id: packageId,
          total_blueprints: blueprints.length,
          blocked: blockedIds.length,
          preflight_details: preflightDetails,
        }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const countPerBlueprint = Math.max(5, Math.floor(count / eligibleIds.length));

      // Enqueue individual per-blueprint jobs only for eligible blueprints
      const jobRows = eligibleIds.map((bpId) => ({
        job_type: "package_generate_blueprint_variants",
        payload: {
          package_id: packageId,
          curriculum_id: pkg.curriculum_id,
          course_id: pkg.course_id,
          blueprintId: bpId,
          count: countPerBlueprint,
          subjectName: resolvedSubject,
          isStudium,
        },
        status: "pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error: enqueueErr } = await sb.from("job_queue").insert(jobRows);

      if (enqueueErr) {
        console.error(`[generate-blueprint-variants] Enqueue error:`, enqueueErr);
        return new Response(JSON.stringify({ error: "Failed to enqueue blueprint jobs", detail: enqueueErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`[generate-blueprint-variants] Enqueued ${eligibleIds.length}/${blueprints.length} eligible per-blueprint jobs for ${packageId} (${blockedIds.length} blocked by pre-flight)`);

      return new Response(JSON.stringify({
        ok: true,
        mode: "package_fanout_enqueue",
        package_id: packageId,
        total_blueprints: blueprints.length,
        blueprints_enqueued: eligibleIds.length,
        blueprints_blocked: blockedIds.length,
        count_per_blueprint: countPerBlueprint,
        blocked_details: blockedIds.length > 0 ? preflightDetails : undefined,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!blueprintId) {
      return new Response(JSON.stringify({ error: "blueprintId required (or package_id for batch mode)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: bp, error: bpErr } = await sb
      .from("question_blueprints")
      .select("*")
      .eq("id", blueprintId)
      .single();

    if (bpErr || !bp) {
      return new Response(JSON.stringify({ error: "Blueprint not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PRE-FLIGHT VALIDATION for single blueprint ──
    const { data: preflight } = await sb.rpc("fn_validate_blueprint_preflight", { p_blueprint_id: blueprintId });
    if (preflight && !(preflight as any).eligible) {
      console.warn(`[generate-blueprint-variants] ⚠️ Blueprint ${blueprintId} failed pre-flight:`, preflight);
      return new Response(JSON.stringify({
        ok: false,
        error: "Blueprint failed pre-flight validation",
        blueprint_id: blueprintId,
        preflight,
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const blueprint = bp as Blueprint;
    const variantTypes = pickVariantTypes(count, isStudium);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log target distribution for observability
    const dist: Record<string, number> = {};
    for (const t of variantTypes) dist[t] = (dist[t] ?? 0) + 1;
    console.log("Target distribution:", JSON.stringify(dist));

    const results: Array<{ variant_type: string; quality_score: number; status: string }> = [];
    const rows: unknown[] = [];

    for (const variantType of variantTypes) {
      const prompt = buildVariantPrompt(blueprint, variantType, subjectName);

      try {
        const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "Du bist ein Prüfungsfragen-Generator für akademische Klausuren. Antworte ausschließlich mit validem JSON." },
              { role: "user", content: prompt },
            ],
          }),
        });

        if (!aiResp.ok) {
          const errText = await aiResp.text();
          console.error(`AI error for variant ${variantType}:`, aiResp.status, errText);
          if (aiResp.status === 429 || aiResp.status === 402) break;
          continue;
        }

        const aiData = await aiResp.json();
        const content = aiData.choices?.[0]?.message?.content ?? "";

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error("No JSON in AI response for", variantType);
          continue;
        }

        const variant: GeneratedVariant = JSON.parse(jsonMatch[0]);
        const { score, flags } = scoreVariant(blueprint, variant, variantType);

        const row = {
          blueprint_id: blueprint.id,
          curriculum_id: blueprint.curriculum_id,
          learning_field_id: blueprint.learning_field_id,
          competency_id: blueprint.competency_id,
          variant_type: variantType,
          question_type: blueprint.knowledge_type,
          cognitive_level: blueprint.cognitive_level,
          title: blueprint.name,
          question_text: variant.question_text,
          answer_text: variant.answer_text ?? null,
          options: variant.options ?? null,
          correct_answer: variant.correct_answer ?? null,
          trap_type: variant.trap_type ?? (blueprint.trap_definition as any)?.trap_type ?? null,
          trap_applied: variant.trap_applied ?? null,
          distractor_meta: variant.distractor_meta ?? null,
          variables: variant.variables ?? null,
          scenario_context: variant.scenario_context ?? null,
          quality_score: score,
          quality_flags: flags,
          status: score >= 80 ? "review" : "draft",
        };

        rows.push(row);
        results.push({ variant_type: variantType, quality_score: score, status: row.status });
      } catch (e) {
        console.error(`Error generating ${variantType}:`, e);
        continue;
      }
    }

    if (rows.length > 0) {
      const { error: insertErr } = await sb.from("exam_question_variants").insert(rows);
      if (insertErr) {
        console.error("Insert error:", insertErr);
        return new Response(JSON.stringify({ error: "Failed to save variants", detail: insertErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ── Update blueprint_variant_inventory ──
      try {
        const approvedCount = rows.filter(r => r.status === "review").length;
        await sb.rpc("fn_upsert_variant_inventory" as any, {
          p_blueprint_id: blueprintId,
          p_curriculum_id: blueprint.curriculum_id,
          p_new_materialized: rows.length,
          p_new_approved: approvedCount,
        });
      } catch (invErr) {
        console.warn("[generate-blueprint-variants] Inventory update failed (non-fatal):", invErr);
      }
    }

    // Compute actual distribution
    const actualDist: Record<string, number> = {};
    for (const r of results) actualDist[r.variant_type] = (actualDist[r.variant_type] ?? 0) + 1;

    return new Response(JSON.stringify({
      ok: true,
      blueprint_id: blueprintId,
      blueprint_name: blueprint.name,
      generated: rows.length,
      requested: count,
      target_distribution: dist,
      actual_distribution: actualDist,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("generate-blueprint-variants error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
