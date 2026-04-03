import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Normalize variant options to exam_questions format (array of {text, is_correct}) */
function normalizeOptions(
  opts: any[],
): { options: { text: string; is_correct: boolean }[]; correct_answer: number } | null {
  if (!Array.isArray(opts) || opts.length < 2) return null;

  const normalized = opts.map((o: any) => ({
    text: String(o.text ?? o.option ?? o),
    is_correct: !!o.is_correct,
  }));

  const correctIdx = normalized.findIndex((o) => o.is_correct);
  if (correctIdx < 0) return null;

  return { options: normalized, correct_answer: correctIdx };
}

/** Build a simple text fingerprint for duplicate detection */
function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]/g, "")
    .slice(0, 120);
}

/** Map cognitive_level strings to difficulty */
function cognitiveTodifficulty(level: string): string {
  switch (level) {
    case "remember":
    case "understand":
      return "easy";
    case "apply":
      return "medium";
    case "analyze":
    case "evaluate":
      return "hard";
    default:
      return "medium";
  }
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
    const {
      blueprintId,
      curriculumId,
      maxPerBlueprint = 15,
      minQualityScore = 80,
      dryRun = false,
    } = body;

    if (!blueprintId && !curriculumId) {
      return json(400, { error: "blueprintId or curriculumId required" });
    }

    // ── Step 1: Resolve blueprint IDs ──
    let blueprintIds: string[] = [];
    if (blueprintId) {
      blueprintIds = [blueprintId];
    } else {
      const { data: bps } = await sb
        .from("question_blueprints")
        .select("id")
        .eq("curriculum_id", curriculumId)
        .order("id", { ascending: true });
      blueprintIds = (bps ?? []).map((b: any) => b.id);
    }

    // ── Step 2: Pre-validate each blueprint via validate-blueprint-variants gates ──
    // We inline the gate logic here to avoid circular function calls
    const results: any[] = [];
    let totalPromoted = 0;
    let totalSkipped = 0;
    let totalDuplicate = 0;

    for (const bpId of blueprintIds) {
      // Fetch blueprint metadata
      const { data: bp, error: bpErr } = await sb
        .from("question_blueprints")
        .select("name, curriculum_id, learning_field_id, competency_id, question_type, cognitive_level, rubric, trap_definition")
        .eq("id", bpId)
        .single();

      if (!bp) {
        results.push({ blueprint_id: bpId, error: "blueprint_not_found", promoted: 0 });
        continue;
      }

      // Fetch eligible variants: status=review, quality_score >= threshold
      const { data: variants, error: vErr } = await sb
        .from("exam_question_variants")
        .select("*")
        .eq("blueprint_id", bpId)
        .eq("status", "review")
        .gte("quality_score", minQualityScore)
        .order("quality_score", { ascending: false })
        .limit(maxPerBlueprint);

      if (vErr || !variants || variants.length === 0) {
        results.push({
          blueprint_id: bpId,
          blueprint_name: bp.name,
          eligible: 0,
          promoted: 0,
          reason: "no_eligible_variants",
        });
        continue;
      }

      // ── Step 3: Check how many already promoted for this blueprint ──
      const { count: existingCount } = await sb
        .from("exam_questions")
        .select("id", { count: "exact", head: true })
        .eq("blueprint_id", bpId);

      const remaining = maxPerBlueprint - (existingCount ?? 0);
      if (remaining <= 0) {
        results.push({
          blueprint_id: bpId,
          blueprint_name: bp.name,
          eligible: variants.length,
          promoted: 0,
          existing: existingCount,
          reason: "cap_reached",
        });
        continue;
      }

      // ── Step 4: Duplicate guard - fetch existing fingerprints ──
      const { data: existingQs } = await sb
        .from("exam_questions")
        .select("question_text")
        .eq("blueprint_id", bpId);

      const existingFingerprints = new Set(
        (existingQs ?? []).map((q: any) => fingerprint(q.question_text)),
      );

      // ── Step 5: Map & insert ──
      const toInsert: any[] = [];
      let skippedCount = 0;
      let dupCount = 0;

      for (const v of variants.slice(0, remaining)) {
        // Hard flag check
        const flags: string[] = Array.isArray(v.quality_flags) ? v.quality_flags : [];
        const hardFlags = flags.filter((f: string) =>
          ["MISSING_TRAP", "TOO_FEW_DISTRACTORS", "TRANSFER_WITHOUT_NEW_CONTEXT"].includes(f)
        );
        if (hardFlags.length > 0) {
          skippedCount++;
          continue;
        }

        // Completeness check
        if (!v.curriculum_id || !v.question_text || v.question_text.length < 20) {
          skippedCount++;
          continue;
        }

        // Duplicate check
        const fp = fingerprint(v.question_text);
        if (existingFingerprints.has(fp)) {
          dupCount++;
          continue;
        }
        existingFingerprints.add(fp);

        // Normalize options
        const norm = normalizeOptions(v.options);
        if (!norm) {
          skippedCount++;
          continue;
        }

        const isTransfer = v.variant_type === "transfer_shift";
        const isTrap = !!v.trap_type || !!v.trap_applied;

        toInsert.push({
          curriculum_id: v.curriculum_id,
          learning_field_id: v.learning_field_id ?? bp.learning_field_id ?? null,
          competency_id: v.competency_id ?? bp.competency_id ?? null,
          blueprint_id: bpId,
          question_text: v.question_text,
          options: norm.options,
          correct_answer: norm.correct_answer,
          explanation: v.answer_text ?? null,
          difficulty: cognitiveTodifficulty(v.cognitive_level ?? bp.cognitive_level ?? "apply"),
          question_type: v.question_type ?? bp.question_type ?? "concept",
          cognitive_level: v.cognitive_level ?? bp.cognitive_level ?? "understand",
          status: "draft",
          qc_status: "tier1_passed",
          ai_generated: true,
          transfer_variant: isTransfer,
          is_trap: isTrap,
          trap_type: v.trap_type ?? null,
          trap_tags: v.trap_type ? [v.trap_type] : [],
          distractor_meta: v.distractor_meta ?? [],
          typical_errors: v.trap_applied ? [v.trap_applied] : [],
          rubric: bp.rubric ?? null,
          expected_answer_points: null,
          scenario_type: isTransfer ? "transfer" : v.variant_type,
          question_fingerprint: fp,
          variant_group: bpId,
        });
      }

      if (dryRun) {
        results.push({
          blueprint_id: bpId,
          blueprint_name: bp.name,
          eligible: variants.length,
          would_promote: toInsert.length,
          would_skip: skippedCount,
          would_duplicate: dupCount,
          existing: existingCount,
          dry_run: true,
        });
        totalPromoted += toInsert.length;
        totalSkipped += skippedCount;
        totalDuplicate += dupCount;
        continue;
      }

      if (toInsert.length === 0) {
        results.push({
          blueprint_id: bpId,
          blueprint_name: bp.name,
          eligible: variants.length,
          promoted: 0,
          skipped: skippedCount,
          duplicates: dupCount,
        });
        continue;
      }

      // Insert into exam_questions
      const { error: insErr } = await sb.from("exam_questions").insert(toInsert);
      if (insErr) {
        results.push({
          blueprint_id: bpId,
          blueprint_name: bp.name,
          error: insErr.message,
          promoted: 0,
        });
        continue;
      }

      // Mark promoted variants as 'approved' in exam_question_variants
      const promotedTexts = toInsert.map((r: any) => r.question_fingerprint);
      const promotedVariantIds = variants
        .filter((v: any) => promotedTexts.includes(fingerprint(v.question_text)))
        .map((v: any) => v.id);

      if (promotedVariantIds.length > 0) {
        await sb
          .from("exam_question_variants")
          .update({ status: "approved" })
          .in("id", promotedVariantIds);
      }

      totalPromoted += toInsert.length;
      totalSkipped += skippedCount;
      totalDuplicate += dupCount;

      results.push({
        blueprint_id: bpId,
        blueprint_name: bp.name,
        eligible: variants.length,
        promoted: toInsert.length,
        skipped: skippedCount,
        duplicates: dupCount,
        existing_before: existingCount,
      });
    }

    return json(200, {
      ok: true,
      dry_run: dryRun,
      summary: {
        blueprints_processed: results.length,
        total_promoted: totalPromoted,
        total_skipped: totalSkipped,
        total_duplicates: totalDuplicate,
      },
      results,
    });
  } catch (e) {
    console.error("promote-blueprint-variants error:", e);
    return json(500, { error: e instanceof Error ? e.message : "Unknown error" });
  }
});
