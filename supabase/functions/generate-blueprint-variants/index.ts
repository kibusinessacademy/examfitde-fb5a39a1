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
 * Deterministic variant type distribution using largest-remainder method.
 */
function pickVariantTypes(count: number, isStudium = false): VariantType[] {
  const ratios: Record<string, number[]> = {
    studium:    [0.13, 0.20, 0.20, 0.13, 0.34],
    vocational: [0.20, 0.20, 0.20, 0.13, 0.27],
  };
  const r = isStudium ? ratios.studium : ratios.vocational;
  const types: VariantType[] = [
    "parameter_shift", "context_shift", "trap_shift",
    "structure_shift", "transfer_shift",
  ];

  const raw = r.map(p => p * count);
  const floors = raw.map(Math.floor);
  let remaining = count - floors.reduce((a, b) => a + b, 0);
  const remainders = raw.map((v, i) => ({ i, r: v - floors[i] }));
  remainders.sort((a, b) => b.r - a.r);
  for (let j = 0; j < remaining; j++) floors[remainders[j].i]++;

  const out: VariantType[] = [];
  for (let i = 0; i < types.length; i++) {
    for (let j = 0; j < floors[i]; j++) out.push(types[i]);
  }
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

/**
 * Normalize payload: accept both camelCase and snake_case at boundary,
 * but ONLY emit snake_case internally (SSOT contract).
 */
function normalizePayload(body: Record<string, unknown>) {
  const p = (body.payload ?? body) as Record<string, unknown>;
  return {
    // SSOT snake_case only
    blueprint_id: (p.blueprint_id ?? p.blueprintId ?? null) as string | null,
    package_id: (p.package_id ?? p.packageId ?? null) as string | null,
    curriculum_id: (p.curriculum_id ?? p.curriculumId ?? null) as string | null,
    course_id: (p.course_id ?? p.courseId ?? null) as string | null,
    count: (p.count as number) ?? 5,
    subject_name: (p.subject_name ?? p.subjectName ?? null) as string | null,
    is_studium: (p.is_studium ?? p.isStudium ?? false) as boolean,
  };
}

function errorResponse(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: false, error, ...extra }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const fnTag = "[generate-blueprint-variants]";

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const p = normalizePayload(body);

    // ═══════════════════════════════════════════════════════════
    // MODE 1: Package-level fan-out (no blueprint_id → enqueue per-blueprint jobs)
    // ═══════════════════════════════════════════════════════════
    if (!p.blueprint_id && p.package_id) {
      console.log(`${fnTag} Package-level dispatch for ${p.package_id}`);

      const { data: pkg } = await sb
        .from("course_packages")
        .select("curriculum_id, course_id")
        .eq("id", p.package_id)
        .maybeSingle();

      if (!pkg?.curriculum_id) {
        return errorResponse(404, "PACKAGE_NOT_FOUND", { package_id: p.package_id });
      }

      // Resolve subject name + isStudium
      const { data: cur } = await sb
        .from("curricula")
        .select("track, program_type")
        .eq("id", pkg.curriculum_id)
        .maybeSingle();
      const isStudium = cur?.track === "STUDIUM" || cur?.program_type === "higher_education";

      const { data: course } = await sb
        .from("courses")
        .select("title")
        .eq("id", pkg.course_id)
        .maybeSingle();
      const subjectName = course?.title ?? "Prüfungsvorbereitung";

      // Find all approved blueprints
      const { data: blueprints, error: bpListErr } = await sb
        .from("question_blueprints")
        .select("id")
        .eq("curriculum_id", pkg.curriculum_id)
        .eq("status", "approved");

      if (bpListErr || !blueprints || blueprints.length === 0) {
        return errorResponse(409, "PREREQ_NOT_DONE", {
          message: "No approved blueprints found — validate_blueprints prerequisite likely incomplete",
          package_id: p.package_id,
          retry: true,
        });
      }

      // Pre-flight validation
      let eligibleIds: string[] = [];
      let blockedIds: string[] = [];
      const preflightDetails: Record<string, unknown> = {};

      // Try batch RPC first, fallback to per-blueprint
      const { data: preflightResults, error: preflightErr } = await sb.rpc(
        "fn_validate_blueprint_preflight_batch",
        { p_blueprint_ids: blueprints.map(b => b.id) }
      ).maybeSingle();

      if (preflightErr || !preflightResults) {
        console.log(`${fnTag} Using per-blueprint preflight validation`);
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
        eligibleIds = (preflightResults as any).eligible_ids || blueprints.map((b: any) => b.id);
        blockedIds = (preflightResults as any).blocked_ids || [];
      }

      if (blockedIds.length > 0) {
        console.warn(`${fnTag} ⚠️ PRE-FLIGHT BLOCKED ${blockedIds.length}/${blueprints.length} blueprints`);
      }

      if (eligibleIds.length === 0) {
        return errorResponse(409, "PREREQ_NOT_DONE", {
          message: "All blueprints failed pre-flight validation",
          package_id: p.package_id,
          retry: true,
          total_blueprints: blueprints.length,
          blocked: blockedIds.length,
          preflight_details: preflightDetails,
        });
      }

      const countPerBlueprint = Math.max(5, Math.floor(p.count / eligibleIds.length));

      // Duplicate guard: skip blueprints that already have pending/processing jobs
      const { data: existingJobs } = await sb
        .from("job_queue")
        .select("payload")
        .eq("job_type", "package_generate_blueprint_variants")
        .eq("package_id", p.package_id)
        .in("status", ["pending", "processing"]);

      const alreadyEnqueued = new Set<string>();
      for (const j of existingJobs ?? []) {
        // SSOT: read blueprint_id (snake_case), with legacy fallback
        const bpId = (j.payload as any)?.blueprint_id ?? (j.payload as any)?.blueprintId;
        if (bpId) alreadyEnqueued.add(bpId);
      }

      const newEligible = eligibleIds.filter(id => !alreadyEnqueued.has(id));

      if (newEligible.length === 0) {
        return new Response(JSON.stringify({
          ok: true,
          message: "All eligible blueprints already have pending jobs",
          package_id: p.package_id,
          already_enqueued: alreadyEnqueued.size,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Enqueue individual per-blueprint jobs — ONLY snake_case keys
      const jobRows = newEligible.map((bpId) => ({
        job_type: "package_generate_blueprint_variants",
        package_id: p.package_id,
        payload: {
          package_id: p.package_id,
          curriculum_id: pkg.curriculum_id,
          course_id: pkg.course_id,
          blueprint_id: bpId,          // SSOT: snake_case only
          count: countPerBlueprint,
          subject_name: subjectName,
          is_studium: isStudium,
        },
        status: "pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      let enqueueCount = 0;
      let enqueueSkipped = 0;
      for (const row of jobRows) {
        const { error: enqueueErr } = await sb.from("job_queue").insert(row);
        if (enqueueErr) {
          if (enqueueErr.message?.includes("duplicate key")) {
            enqueueSkipped++;
          } else {
            console.error(`${fnTag} Enqueue error:`, enqueueErr.message);
            return errorResponse(500, "ENQUEUE_FAILED", { detail: enqueueErr.message });
          }
        } else {
          enqueueCount++;
        }
      }

      console.log(`${fnTag} Enqueued ${enqueueCount}/${newEligible.length} for ${p.package_id} (${enqueueSkipped} dup, ${blockedIds.length} blocked)`);

      return new Response(JSON.stringify({
        ok: true,
        mode: "package_fanout_enqueue",
        package_id: p.package_id,
        total_blueprints: blueprints.length,
        blueprints_enqueued: enqueueCount,
        duplicates_skipped: enqueueSkipped,
        blueprints_blocked: blockedIds.length,
        count_per_blueprint: countPerBlueprint,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════
    // MODE 2: Single blueprint variant generation
    // ═══════════════════════════════════════════════════════════
    if (!p.blueprint_id) {
      return errorResponse(400, "MISSING_BLUEPRINT_ID", {
        message: "blueprint_id required (or package_id for batch mode)",
      });
    }

    const blueprintId = p.blueprint_id;

    const { data: bp, error: bpErr } = await sb
      .from("question_blueprints")
      .select("*")
      .eq("id", blueprintId)
      .single();

    if (bpErr || !bp) {
      return errorResponse(404, "BLUEPRINT_NOT_FOUND", {
        blueprint_id: blueprintId,
        detail: bpErr?.message ?? "not found",
      });
    }

    // Pre-flight for single blueprint
    const { data: preflight } = await sb.rpc("fn_validate_blueprint_preflight", { p_blueprint_id: blueprintId });
    if (preflight && !(preflight as any).eligible) {
      const blockers = (preflight as any).hard_blockers ?? [];
      console.warn(`${fnTag} Blueprint ${blueprintId} FAILED pre-flight: ${blockers.join(", ")}`);
      return errorResponse(422, "PREFLIGHT_FAILED", {
        blueprint_id: blueprintId,
        hard_blockers: blockers,
        soft_warnings: (preflight as any).soft_warnings ?? [],
      });
    }

    const blueprint = bp as Blueprint;
    const variantTypes = pickVariantTypes(p.count, p.is_studium);
    const subjectName = p.subject_name ?? "Prüfungsvorbereitung";
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      return errorResponse(500, "CONFIG_ERROR", { message: "LOVABLE_API_KEY not configured" });
    }

    // Log target distribution
    const dist: Record<string, number> = {};
    for (const t of variantTypes) dist[t] = (dist[t] ?? 0) + 1;
    console.log(`${fnTag} Blueprint ${blueprintId}: generating ${p.count} variants, dist=${JSON.stringify(dist)}`);

    const results: Array<{ variant_type: string; quality_score: number; status: string }> = [];
    const rows: any[] = [];
    const errors: Array<{ variant_type: string; error: string }> = [];

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
          const errText = await aiResp.text().catch(() => "unreadable");
          const errMsg = `AI_HTTP_${aiResp.status}: ${errText.slice(0, 200)}`;
          console.error(`${fnTag} ${errMsg}`);
          errors.push({ variant_type: variantType, error: errMsg });
          if (aiResp.status === 429 || aiResp.status === 402) break; // rate-limited, stop
          continue;
        }

        const aiData = await aiResp.json();
        const content = aiData.choices?.[0]?.message?.content ?? "";

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          const errMsg = `NO_JSON_IN_RESPONSE: ${content.slice(0, 100)}`;
          console.error(`${fnTag} ${errMsg}`);
          errors.push({ variant_type: variantType, error: errMsg });
          continue;
        }

        let variant: GeneratedVariant;
        try {
          variant = JSON.parse(jsonMatch[0]);
        } catch (parseErr) {
          const errMsg = `JSON_PARSE_FAILED: ${(parseErr as Error).message}`;
          errors.push({ variant_type: variantType, error: errMsg });
          continue;
        }

        if (!variant.question_text || variant.question_text.trim().length < 10) {
          errors.push({ variant_type: variantType, error: "EMPTY_QUESTION_TEXT" });
          continue;
        }

        const { score, flags } = scoreVariant(blueprint, variant, variantType);

        rows.push({
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
        });
        results.push({ variant_type: variantType, quality_score: score, status: score >= 80 ? "review" : "draft" });
      } catch (e) {
        const errMsg = `EXCEPTION: ${(e as Error).message}`;
        console.error(`${fnTag} ${errMsg}`);
        errors.push({ variant_type: variantType, error: errMsg });
        continue;
      }
    }

    // ═══ CRITICAL: fail-closed if ZERO variants generated ═══
    if (rows.length === 0) {
      const errSummary = errors.length > 0
        ? errors.map(e => `${e.variant_type}:${e.error}`).join("; ")
        : "No AI responses produced valid variants";
      console.error(`${fnTag} ❌ ZERO variants for blueprint ${blueprintId}: ${errSummary}`);
      return errorResponse(500, "ZERO_VARIANTS_GENERATED", {
        blueprint_id: blueprintId,
        blueprint_name: blueprint.name,
        requested: p.count,
        errors,
        message: errSummary,
      });
    }

    // Insert generated variants
    const { error: insertErr } = await sb.from("exam_question_variants").insert(rows);
    if (insertErr) {
      console.error(`${fnTag} INSERT FAILED for ${blueprintId}:`, insertErr.message);
      return errorResponse(500, "INSERT_FAILED", {
        blueprint_id: blueprintId,
        detail: insertErr.message,
      });
    }

    // Update inventory
    try {
      const reviewReadyCount = rows.filter((r: any) => r.status === "review").length;
      const { error: invErr } = await sb.rpc("fn_upsert_variant_inventory" as any, {
        p_blueprint_id: blueprintId,
        p_curriculum_id: blueprint.curriculum_id,
        p_package_id: p.package_id,
        p_target_count: 6,
        p_new_materialized: rows.length,
        p_new_approved: reviewReadyCount,
        p_last_error: null,
        p_fingerprint: null,
      });
      if (invErr) {
        console.error(`${fnTag} Inventory RPC error for ${blueprintId}:`, invErr.message);
      }
    } catch (invErr) {
      console.error(`${fnTag} Inventory exception:`, (invErr as Error).message);
    }

    // Compute actual distribution
    const actualDist: Record<string, number> = {};
    for (const r of results) actualDist[r.variant_type] = (actualDist[r.variant_type] ?? 0) + 1;

    console.log(`${fnTag} ✅ Blueprint ${blueprintId}: ${rows.length}/${p.count} variants saved (${errors.length} errors)`);

    return new Response(JSON.stringify({
      ok: true,
      blueprint_id: blueprintId,
      blueprint_name: blueprint.name,
      generated: rows.length,
      requested: p.count,
      errors_count: errors.length,
      errors: errors.length > 0 ? errors : undefined,
      target_distribution: dist,
      actual_distribution: actualDist,
      results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Unknown error";
    console.error(`${fnTag} FATAL:`, errMsg);
    return errorResponse(500, "FATAL_ERROR", { message: errMsg });
  }
});
