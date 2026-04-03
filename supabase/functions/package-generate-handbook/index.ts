import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover, logLLMCostEvent } from "../_shared/ai-client.ts";
import { shouldSoftStop, getTimeBudget } from "../_shared/time-budget.ts";
import { getModelChain } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { validateGeneratedSection, filterValidSections, verifyHandbookCoverage } from "../_shared/handbook-write-guard.ts";
import { loadFieldCompetencies, loadFieldTopicDepth, loadExamQuestionSample, buildElitePrompt, type CompetencyContext } from "../_shared/handbook-context.ts";
import { shouldUseBatch, BATCH_DEFAULT_MODEL } from "../_shared/batch/routing-config.ts";
import { buildBatchRequests, submitBatchViaFunction } from "../_shared/batch/enqueue-openai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function assertUuid(label: string, val: unknown) {
  if (typeof val !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
    throw new Error(`${label} must be a valid UUID, got: ${String(val)}`);
  }
}

async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done" || d1?.status === "skipped") return true;
  // Fallback: legacy table
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done" || d2?.status === "skipped";
}

// ── Handbook Constants (v15 — Lean Basis Pass) ────────────────
const MIN_WORD_TARGET = 600;      // v15: halved — depth comes in expand pass
const MAX_WORD_TARGET = 1500;     // v15: halved — basis = solid structure, not elite depth
const TARGET_CHAPTERS = 8;
// v10: BATCH_SIZE=1 — one section per invocation for reliability
const BATCH_SIZE = 1;
const MIN_SECTION_CHARS = 800;    // v15: lowered from 1800 — lean basis floor

// ── Section Generator ────────────────────────────────────────

async function generateSectionContent(
  sb: ReturnType<typeof createClient>,
  professionName: string,
  fieldCode: string,
  fieldTitle: string,
  fieldDescription: string,
  subtopics: string[],
  competencies: { name: string; bloom: string; misconceptions: string[] }[],
  sampleQuestions: string[],
  wordTarget: number,
  packageId: string | null,
  startMs: number,
  chain: Array<{ provider: string; model: string }>,
  expandChain?: Array<{ provider: string; model: string }>,
): Promise<{ content: string; provider: string; model: string }> {
  if (shouldSoftStop(startMs, "handbook")) {
    console.warn(`[generate-handbook] Soft-stop reached before LLM call for ${fieldCode}`);
    return { content: "", provider: "soft-stop", model: "none" };
  }

  // chain is passed as parameter now (v6: single-provider per invocation)
  const prompt = buildElitePrompt(professionName, fieldCode, fieldTitle, fieldDescription, subtopics, competencies, sampleQuestions, wordTarget);
  
  // v16: reduced max_tokens for lean basis — 2048-4096 range
  const maxTokens = Math.min(4096, Math.max(2048, Math.round(wordTarget * 3)));

  try {
    const budget = getTimeBudget("handbook");
    const remainingSoftMs = budget.softStopMs - (Date.now() - startMs);
    if (remainingSoftMs <= 10_000) {
      return { content: "", provider: "soft-stop", model: "none" };
    }

    // v17: Single provider per invocation — give it the full soft-stop budget (~45s)
    const perProviderMs = 45_000;
    
    const systemMsg = `IHK-Prüfungscoach, ${professionName}. Handbuch-Abschnitt, ${wordTarget} Wörter. Pflicht: Grundlagen, Formeln, Prüfungsfallen, Merkschemata. Markdown, keine Meta-Kommentare.`;
    
    const result = await callAIWithFailover(chain, {
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens,
      timeout_ms: perProviderMs,
    });

    try {
      await logLLMCostEvent(sb, {
        job_type: "generate_handbook",
        provider: result.provider,
        model: result.model,
        tokens_in: result.usage?.input_tokens || 0,
        tokens_out: result.usage?.output_tokens || 0,
        package_id: packageId,
        estimatedUsage: result.estimatedUsage,
      });
    } catch { /* non-blocking */ }

    let content = result.content || "";
    content = content.replace(/^```(?:markdown)?\n?/g, "").replace(/\n?```$/g, "").trim();
    if (content.startsWith("{") || content.startsWith('"')) {
      try {
        const parsed = JSON.parse(content);
        content = typeof parsed === "string" ? parsed : parsed.content || parsed.markdown || JSON.stringify(parsed);
      } catch { /* use as-is */ }
    }

    // v10: Expansion pass REMOVED — now handled by separate expand_handbook step
    // generate_handbook is basis-only (Flash-first, fast, robust)

    const hasRealContent = content.length >= MIN_SECTION_CHARS;
    if (content.length > 0 && !hasRealContent) {
      console.warn(`[generate-handbook] Below min for ${fieldCode}: ${content.length}/${MIN_SECTION_CHARS} chars`);
    }
    return { content, provider: result.provider, model: result.model };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error(`[generate-handbook] ALL PROVIDERS FAILED for ${fieldCode}: ${msg}`);
    try {
      await logLLMCostEvent(sb, {
        job_type: "generate_handbook",
        provider: "unknown",
        model: "unknown",
        tokens_in: 0,
        tokens_out: 0,
        package_id: packageId,
        status: "fail",
        error_message: msg.slice(0, 500),
      });
    } catch { /* non-blocking */ }
    return { content: "", provider: "none", model: "none" };
  }
}

// buildFallbackContent removed in v4 — write-guard prevents placeholder commits

// ── Main Handler ─────────────────────────────────────────────

Deno.serve(async (req) => {
  const startMs = Date.now();
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const p = body.payload || body;

  try {
    assertUuid("package_id", p?.package_id);
    assertUuid("curriculum_id", p?.curriculum_id);
  } catch (e: unknown) {
    return json({ error: (e as Error).message }, 400);
  }

  const packageId = p.package_id as string;
  const curriculumId = p.curriculum_id as string;
  const certificationId = p.certification_id || null;
  const forceRebuild = Boolean(p?.force_rebuild);

  // v18: Persistent provider rotation — read llm_attempt_index from step meta
  // so provider rotation survives across job boundaries (not just within one job)
  let attemptIndex = typeof p?.attempt_index === "number" ? p.attempt_index : 0;
  if (attemptIndex === 0) {
    try {
      const { data: stepRow } = await sb
        .from("package_steps")
        .select("meta")
        .eq("package_id", packageId)
        .eq("step_key", "generate_handbook")
        .maybeSingle();
      const storedIdx = (stepRow?.meta as any)?.llm_attempt_index;
      if (typeof storedIdx === "number" && storedIdx > 0) {
        attemptIndex = storedIdx;
        console.log(`[generate-handbook] Restored llm_attempt_index=${attemptIndex} from step meta`);
      }
    } catch { /* best-effort */ }
  }

  // v17: Single-provider-per-invocation strategy.
  // The 55s Edge Function wall-clock limit cannot fit 2×30s provider calls.
  // Instead, each job attempt uses ONE provider. On timeout/failure, the job
  // retries (via job_queue attempts) and rotates to the next provider.
  const fullChain = getModelChain("handbook");
  const providerIndex = attemptIndex % fullChain.length;
  const _handbookChain = [fullChain[providerIndex]];
  console.log(`[generate-handbook] v17: attempt=${attemptIndex} → provider ${providerIndex}/${fullChain.length}: ${fullChain[providerIndex].provider}/${fullChain[providerIndex].model}`);
  // Expand pass chain: heavyweight models only
  const _expandChain = fullChain.filter(c => !c.model.includes("flash"));
  if (_expandChain.length === 0) _expandChain.push(fullChain[fullChain.length - 1]);

  // ⚠️ Force rebuild: explicit admin action to hard-reset handbook for this curriculum.
  // Deletes all sections + chapters, then falls through to normal idempotent generation.
  if (forceRebuild) {
    console.log(`[generate-handbook] force_rebuild=true for curriculum=${curriculumId}`);

    const { data: existingChapters, error: chErr } = await sb
      .from("handbook_chapters")
      .select("id")
      .eq("curriculum_id", curriculumId);

    if (chErr) throw new Error(`handbook_chapters select: ${chErr.message}`);

    if (existingChapters?.length) {
      const chapterIds = existingChapters.map((x: any) => x.id);

      // Delete sections first (FK safety)
      const { error: secDelErr } = await sb
        .from("handbook_sections")
        .delete()
        .in("chapter_id", chapterIds);
      if (secDelErr) throw new Error(`handbook_sections delete: ${secDelErr.message}`);

      const { error: chDelErr } = await sb
        .from("handbook_chapters")
        .delete()
        .eq("curriculum_id", curriculumId);
      if (chDelErr) throw new Error(`handbook_chapters delete: ${chDelErr.message}`);

      console.log(`[generate-handbook] force_rebuild: deleted ${existingChapters.length} chapters + sections`);
    }
  }

  if (!(await prereqDone(sb, packageId, "validate_learning_content"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: validate_learning_content" }, 409);
  }

  let professionName = "Ausbildungsberuf";
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
  } catch { /* fallback */ }

  // 1) Load learning fields
  const { data: fields, error: lfErr } = await sb
    .from("learning_fields")
    .select("id, code, title, description, sort_order")
    .eq("curriculum_id", curriculumId)
    .order("sort_order", { ascending: true });

  if (lfErr) throw new Error(`LF query: ${lfErr.message}`);
  if (!fields || fields.length === 0) throw new Error(`No learning_fields for curriculum ${curriculumId}`);

  // Load exam blueprint weights for word target calibration
  const { data: blueprintWeights } = await sb
    .from("exam_blueprints")
    .select("learning_field_id, weight_pct")
    .eq("curriculum_id", curriculumId);

  const weightByLf = new Map<string, number>();
  if (blueprintWeights?.length) {
    for (const bw of blueprintWeights) {
      const lfId = (bw as any).learning_field_id;
      if (lfId) weightByLf.set(lfId, (bw as any).weight_pct || 0);
    }
  }

  const totalWeight = Array.from(weightByLf.values()).reduce((s, v) => s + v, 0) || fields.length;
  const lfWordTargets = new Map<string, number>();
  for (const lf of fields) {
    const w = weightByLf.get(lf.id) || (100 / fields.length);
    const normalizedWeight = w / totalWeight;
    const wordTarget = Math.round(MIN_WORD_TARGET + (MAX_WORD_TARGET - MIN_WORD_TARGET) * Math.min(1, normalizedWeight * fields.length));
    lfWordTargets.set(lf.id, Math.max(MIN_WORD_TARGET, Math.min(MAX_WORD_TARGET, wordTarget)));
  }

  console.log(`[generate-handbook] Elite v3 for ${professionName}: ${fields.length} LFs (pkg ${packageId.slice(0, 8)})`);

  // 2) Handle chapters — IDEMPOTENT: never delete existing sections.
  //    Check which learning fields already have sections and only generate missing ones.
  //    This fixes the infinite loop where batch_cursor=0 deleted all progress.
  let chapters: Array<{ id: string; sort_order: number }>;

  // Load existing chapters
  const { data: existingCh } = await sb
    .from("handbook_chapters")
    .select("id, sort_order")
    .eq("curriculum_id", curriculumId)
    .order("sort_order", { ascending: true });

  if (existingCh && existingCh.length >= TARGET_CHAPTERS) {
    // Chapters exist — reuse them
    chapters = existingCh;
  } else {
    // No chapters yet (or too few) — create them, but DON'T delete existing sections
    if (existingCh?.length) {
      // Chapters exist but fewer than target — reuse what we have
      chapters = existingCh;
    } else {
      // Create fresh chapters
      const chapterSize = Math.max(1, Math.floor(fields.length / TARGET_CHAPTERS)) || 1;
      const rawChunks: typeof fields[] = [];
      for (let i = 0; i < fields.length; i += chapterSize) rawChunks.push(fields.slice(i, i + chapterSize));
      while (rawChunks.length > TARGET_CHAPTERS && rawChunks.length > 1) {
        const last = rawChunks.pop()!;
        rawChunks[rawChunks.length - 1] = [...rawChunks[rawChunks.length - 1], ...last];
      }
      while (rawChunks.length < TARGET_CHAPTERS) rawChunks.push([]);

      const chaptersToCreate = rawChunks.map((chunk, idx) => {
        const chapterNum = idx + 1;
        const firstCode = chunk.length ? (chunk[0] as any).code : `X${chapterNum}`;
        const lastCode = chunk.length ? (chunk[chunk.length - 1] as any).code : `X${chapterNum}`;
        const titleSuffix = chunk.length ? `${firstCode}–${lastCode} Prüfungsrelevante Themen` : "Ergänzende Prüfungsthemen";
        return {
          curriculum_id: curriculumId,
          chapter_key: `handbuch-${curriculumId.slice(0, 8)}-kap${chapterNum}`,
          title: `Kapitel ${chapterNum}: ${titleSuffix}`,
          sort_order: chapterNum,
        };
      });

      const { data: newChapters, error: chErr } = await sb
        .from("handbook_chapters").insert(chaptersToCreate).select("id, sort_order");
      if (chErr) throw new Error(`Chapter insert: ${chErr.message}`);
      if (!newChapters?.length) throw new Error("handbook_chapters: 0 rows inserted");
      chapters = newChapters;
    }
  }

  // ── Load existing sections to determine which LFs still need generation ──
  const chapterIds = chapters.map((c: any) => c.id);
  const { data: existingSections } = await sb
    .from("handbook_sections")
    .select("id, learning_field_id, content_markdown, chapter_id, title, section_key")
    .in("chapter_id", chapterIds);

  // ── Revalidate existing sections with the SAME guard logic ──
  // Invalid existing sections are deleted so they get regenerated.
  const populatedLfIds = new Set<string>();
  const invalidSectionIds: string[] = [];
  const invalidReasons: Array<{ lfId: string; reason: string }> = [];

  for (const sec of (existingSections || [])) {
    const result = validateGeneratedSection({
      title: sec.title ?? (sec as any).section_key ?? "",
      content_markdown: sec.content_markdown as string,
    }, { phase: "basis" });

    if (result.ok && sec.learning_field_id) {
      populatedLfIds.add(sec.learning_field_id);
    } else if (sec.id) {
      invalidSectionIds.push(sec.id as string);
      invalidReasons.push({
        lfId: sec.learning_field_id || "unknown",
        reason: result.reason || "unknown",
      });
    }
  }

  // ── Purge invalid existing sections so they don't block regeneration ──
  if (invalidSectionIds.length > 0) {
    console.warn(`[generate-handbook] REVALIDATION: ${invalidSectionIds.length} existing sections INVALID — deleting for regen. Reasons: ${invalidReasons.map(r => `${r.lfId.slice(0,8)}:${r.reason}`).join("; ")}`);
    const { error: delErr } = await sb
      .from("handbook_sections")
      .delete()
      .in("id", invalidSectionIds);
    if (delErr) console.error(`[generate-handbook] Failed to delete invalid sections: ${delErr.message}`);
  }

  // Filter fields to only those that still need generation
  const fieldsNeedingGeneration = fields.filter((lf: any) => !populatedLfIds.has(lf.id));
  console.log(`[generate-handbook] ${populatedLfIds.size}/${fields.length} LFs valid. ${invalidSectionIds.length} purged. ${fieldsNeedingGeneration.length} remaining.`);

  // ── COVERAGE-FIRST COMPLETION CHECK ──
  // Handbook sections often cover multiple LFs per section (e.g., one section for LF01+LF02).
  // This means populatedLfIds may not contain all LF IDs even when coverage is complete.
  // Check actual chapter coverage BEFORE attempting further generation to prevent
  // the "never-done" loop where the generator finds LFs to generate but can't write
  // new sections because the chapters are already fully covered.
  const preGenCoverage = await verifyHandbookCoverage(sb, curriculumId);
  console.log(`[generate-handbook] Pre-gen coverage: ${preGenCoverage.coveredChapters}/${preGenCoverage.totalChapters} chapters (need ${preGenCoverage.minNeeded}), ${preGenCoverage.totalChars} chars → ${preGenCoverage.ok ? 'COMPLETE' : 'INCOMPLETE'}`);

  if (preGenCoverage.ok) {
    // Coverage is complete — all chapters have real content.
    // Even if some individual LF IDs aren't tracked (multi-LF sections), the handbook is done.
    console.log(`[generate-handbook] ✅ Coverage complete despite ${fieldsNeedingGeneration.length} unmapped LF IDs — marking batch_complete=true`);
    return json({
      ok: true,
      batch_complete: true,
      chapters: chapters.length,
      sections: existingSections?.length || 0,
      already_populated: populatedLfIds.size,
      unmapped_lf_ids: fieldsNeedingGeneration.length,
      coverage: preGenCoverage,
      version: "elite_v3",
    });
  }

  if (fieldsNeedingGeneration.length === 0) {
    // All LFs individually tracked but coverage check failed — unusual state
    console.warn(`[generate-handbook] All LFs populated but coverage failed — forcing re-evaluation`);
    return json({
      ok: true,
      batch_complete: false,
      coverage_check_failed: true,
      coverage: preGenCoverage,
      chapters: chapters.length,
      sections: existingSections?.length || 0,
      message: `Coverage verification failed at early exit: ${preGenCoverage.coveredChapters}/${preGenCoverage.totalChapters} chapters`,
    });
  }

  // Build field→chapter mapping (maps field index in ALL fields to chapter sort_order)
  const chapterSizeFull = Math.max(1, Math.floor(fields.length / TARGET_CHAPTERS)) || 1;
  const rawChunksFull: typeof fields[] = [];
  for (let i = 0; i < fields.length; i += chapterSizeFull) rawChunksFull.push(fields.slice(i, i + chapterSizeFull));
  while (rawChunksFull.length > TARGET_CHAPTERS && rawChunksFull.length > 1) {
    const last = rawChunksFull.pop()!;
    rawChunksFull[rawChunksFull.length - 1] = [...rawChunksFull[rawChunksFull.length - 1], ...last];
  }

  const fieldIdToChapterSort = new Map<string, number>();
  for (let ci = 0; ci < rawChunksFull.length; ci++) {
    for (const f of rawChunksFull[ci]) {
      fieldIdToChapterSort.set((f as any).id, ci + 1);
    }
  }

  // 3) Generate sections for MISSING LFs only (batch of BATCH_SIZE per invocation)
  const sectionRows: Array<Record<string, unknown>> = [];
  let sectionOrder = (existingSections?.length || 0) + 1;
  let llmSuccessCount = 0;
  let llmFailCount = 0;

  // ── BATCH ROUTING: Submit ALL remaining fields at once via batch API ──
  const forceSyncMode = p._force_sync === true || p.force_sync === true;
  if (fieldsNeedingGeneration.length > 0 && shouldUseBatch("package_generate_handbook", { forceSyncMode, itemCount: fieldsNeedingGeneration.length })) {
    const model = BATCH_DEFAULT_MODEL;
    const batchItems = [];

    for (let i = 0; i < fieldsNeedingGeneration.length; i++) {
      const lf = fieldsNeedingGeneration[i] as any;
      const chapterSortOrder = fieldIdToChapterSort.get(lf.id) || 1;
      const chapter = chapters.find((c: any) => c.sort_order === chapterSortOrder);
      if (!chapter) continue;

      const [subtopics, competencies, sampleQuestions] = await Promise.all([
        loadFieldTopicDepth(sb, curriculumId, lf.title),
        loadFieldCompetencies(sb, lf.id),
        loadExamQuestionSample(sb, curriculumId, lf.id),
      ]);

      const wordTarget = lfWordTargets.get(lf.id) || MIN_WORD_TARGET;
      const prompt = buildElitePrompt(professionName, lf.code, lf.title, lf.description || "", subtopics, competencies, sampleQuestions, wordTarget);
      const systemMsg = `IHK-Prüfungscoach, ${professionName}. Handbuch-Abschnitt, ${wordTarget} Wörter. Pflicht: Grundlagen, Formeln, Prüfungsfallen, Merkschemata. Markdown, keine Meta-Kommentare.`;

      const sectionKey = `lf-${String(lf.code).toLowerCase().replace(/\\s+/g, '-')}-${curriculumId.slice(0, 8)}`;
      const customId = `hb_${curriculumId.slice(0, 8)}_lf${lf.id.slice(0, 8)}_${i}_${Date.now()}`;

      batchItems.push({
        customId,
        sourceJobId: p.job_id || null,
        sourceRef: {
          curriculum_id: curriculumId,
          package_id: packageId,
          learning_field_id: lf.id,
          chapter_id: chapter.id,
          section_key: sectionKey,
          lf_code: lf.code,
          lf_title: lf.title,
          word_target: wordTarget,
          sort_order: sectionOrder + i,
        },
        jobType: "package_generate_handbook",
        model,
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        maxTokens: Math.min(4096, Math.max(2048, Math.round(wordTarget * 3))),
      });
    }

    if (batchItems.length > 0) {
      const requests = buildBatchRequests(batchItems);
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const submitResult = await submitBatchViaFunction(supabaseUrl, serviceRoleKey, {
        jobType: "package_generate_handbook",
        model,
        requests,
        metadata: {
          curriculum_id: curriculumId,
          package_id: packageId,
          field_count: String(batchItems.length),
        },
      });

      if (!submitResult.ok) {
        console.error(`[generate-handbook] BATCH_SUBMIT_FAILED: ${submitResult.error} — falling back to sync`);
        // Fall through to sync loop below
      } else {
        console.log(`[generate-handbook] BATCH_ENQUEUED: ${batchItems.length} fields → batch_id=${submitResult.batchId} model=${model}`);
        return json({
          ok: true,
          batch_mode: true,
          batch_id: submitResult.batchId,
          fields_submitted: batchItems.length,
          model,
          batch_complete: false,
        });
      }
    }
  }

  // Take at most BATCH_SIZE from the fields that still need generation
  const batchFields = fieldsNeedingGeneration.slice(0, BATCH_SIZE);

  for (let i = 0; i < batchFields.length; i++) {
    const lf = batchFields[i] as any;
    const chapterSortOrder = fieldIdToChapterSort.get(lf.id) || 1;
    const chapter = chapters.find((c: any) => c.sort_order === chapterSortOrder);
    if (!chapter) continue;

    // Load rich context for this LF
    const [subtopics, competencies, sampleQuestions] = await Promise.all([
      loadFieldTopicDepth(sb, curriculumId, lf.title),
      loadFieldCompetencies(sb, lf.id),
      loadExamQuestionSample(sb, curriculumId, lf.id),
    ]);

    const wordTarget = lfWordTargets.get(lf.id) || MIN_WORD_TARGET;

    const generated = await generateSectionContent(
      sb,
      professionName,
      lf.code,
      lf.title,
      lf.description || "",
      subtopics,
      competencies,
      sampleQuestions,
      wordTarget,
      packageId,
      startMs,
      _handbookChain,
      _expandChain,
    );

    const hasRealContent = generated.content.length >= MIN_SECTION_CHARS;
    if (hasRealContent) llmSuccessCount++;
    else llmFailCount++;

    // ── WRITE GUARD: Skip fallback content entirely ──
    // If the LLM didn't produce real content, do NOT write a placeholder.
    // The field stays "ungenerated" and will be retried on the next invocation.
    if (!hasRealContent) {
      console.warn(`[generate-handbook] WRITE_GUARD: Skipping ${lf.code} — LLM output too short (${generated.content.length}/${MIN_SECTION_CHARS} chars). Will retry next invocation.`);
      continue;
    }

    const candidateRow = {
      chapter_id: chapter.id,
      section_key: `lf-${String(lf.code).toLowerCase().replace(/\s+/g, '-')}-${curriculumId.slice(0, 8)}`,
      title: `${lf.code}: ${lf.title}`,
      content_markdown: generated.content,
      basis_content: generated.content,
      basis_generated_at: new Date().toISOString(),
      content_tier: "basis",
      expand_status: generated.content.length >= 800 ? "pending" : "not_ready",
      content_type: "text",
      sort_order: sectionOrder++,
      learning_field_id: lf.id,
      metadata: {
        depth_enriched: subtopics.length > 0,
        llm_generated: true,
        llm_provider: generated.provider,
        llm_model: generated.model,
        word_target: wordTarget,
        actual_chars: generated.content.length,
        exam_weight_pct: weightByLf.get(lf.id) || null,
        competency_count: competencies.length,
        version: "v10_basis_only",
      },
    };

    // ── PRE-WRITE VALIDATION (basis phase — relaxed structural markers) ──
    const validation = validateGeneratedSection({
      title: candidateRow.title as string,
      content_markdown: candidateRow.content_markdown as string,
    }, { phase: "basis" });

    if (!validation.ok) {
      console.warn(`[generate-handbook] REJECT_FORENSIC: section_key=${candidateRow.section_key} chapter_id=${chapter.id} raw_chars=${generated.content.length} guard=validateGeneratedSection reason="${validation.reason}" provider=${generated.provider} model=${generated.model}`);
      llmSuccessCount--;
      llmFailCount++;
      continue;
    }

    sectionRows.push(candidateRow);
  }

  // ── ATOMIC WRITE: Only validated sections reach the DB ──
  let actualWrittenCount = 0;
  if (sectionRows.length > 0) {
    // Double-check with filterValidSections (belt + suspenders)
    const { valid, rejected } = filterValidSections(sectionRows);

    if (rejected.length > 0) {
      console.warn(`[generate-handbook] filterValidSections caught ${rejected.length} additional rejects: ${rejected.map(r => r.reason).join("; ")}`);
    }

    if (valid.length > 0) {
      const { error: secErr } = await sb.from("handbook_sections").upsert(valid, {
        onConflict: "chapter_id,section_key",
        ignoreDuplicates: false,
      });
      if (secErr) throw new Error(`Section upsert: ${secErr.message}`);
      actualWrittenCount = valid.length;
      console.log(`[generate-handbook] Committed ${valid.length} validated sections to DB.`);
    }
  }

  // Check remaining after this batch — use ACTUAL written count, not pre-filter count
  const writtenCount = actualWrittenCount;
  const remainingAfterBatch = fieldsNeedingGeneration.length - batchFields.length + (batchFields.length - writtenCount);
  const totalPopulated = populatedLfIds.size + writtenCount;
  const isComplete = remainingAfterBatch <= 0;
  const progress = Math.round((totalPopulated / fields.length) * 100);

  console.log(`[generate-handbook] Batch: ${writtenCount} sections written (${llmFailCount} rejected), Total: ${totalPopulated}/${fields.length} (${progress}%)${isComplete ? ' — COMPLETE' : ''}`);

  // ── P1: Prevent completed-without-writes ──
  // If we attempted generation but wrote nothing, signal blocked_by_guard / provider_empty
  if (writtenCount === 0 && batchFields.length > 0) {
    const failReason = llmFailCount > 0 ? "blocked_by_guard" : "provider_empty";
    const nextAttemptIndex = attemptIndex + 1;
    console.warn(`[generate-handbook] ZERO_WRITE_BATCH: ${batchFields.length} attempted, 0 written. Reason: ${failReason}. Persisting llm_attempt_index=${nextAttemptIndex}`);

    // v18: Persist incremented attempt index to step meta for provider rotation
    try {
      const { data: curStep } = await sb.from("package_steps").select("meta")
        .eq("package_id", packageId).eq("step_key", "generate_handbook").maybeSingle();
      const curMeta = (curStep?.meta as Record<string, unknown>) || {};
      await sb.from("package_steps").update({
        meta: { ...curMeta, llm_attempt_index: nextAttemptIndex, last_fail_reason: failReason },
      }).eq("package_id", packageId).eq("step_key", "generate_handbook");
    } catch { /* best-effort */ }

    return json({
      ok: false,
      retry: true,
      batch_complete: false,
      zero_write: true,
      fail_reason: failReason,
      attempt_index: nextAttemptIndex,
      progress,
      sections_attempted: batchFields.length,
      sections_rejected: llmFailCount,
      remaining: remainingAfterBatch,
      message: `Zero-write batch: ${failReason}. ${llmFailCount} rejected, ${remainingAfterBatch} remaining.`,
    });
  }

  if (!isComplete) {
    return json({
      ok: true,
      batch_complete: false,
      progress,
      sections_this_batch: writtenCount,
      sections_rejected: llmFailCount,
      total_populated: totalPopulated,
      remaining: remainingAfterBatch,
    });
  }

  // ── POST-WRITE COVERAGE VERIFICATION ──
  // Before reporting batch_complete=true, verify actual DB state
  const coverage = await verifyHandbookCoverage(sb, curriculumId);
  console.log(`[generate-handbook] Post-write coverage: ${coverage.coveredChapters}/${coverage.totalChapters} chapters (need ${coverage.minNeeded}), ${coverage.totalChars} total chars → ${coverage.ok ? 'READY' : 'NOT READY'}`);

  if (!coverage.ok) {
    return json({
      ok: true,
      batch_complete: false,
      coverage_check_failed: true,
      coverage,
      progress,
      message: `Coverage verification failed: ${coverage.coveredChapters}/${coverage.totalChapters} chapters with content (need ${coverage.minNeeded})`,
    });
  }

  return json({
    ok: true,
    batch_complete: true,
    chapters: chapters.length,
    sections: totalPopulated,
    llm_generated: llmSuccessCount,
    llm_rejected: llmFailCount,
    coverage,
    version: "elite_v3_guarded",
  });
});
