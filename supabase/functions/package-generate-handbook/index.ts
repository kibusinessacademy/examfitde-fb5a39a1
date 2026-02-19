import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";
import { loadOrGenerateGlossary, formatGlossaryForPrompt } from "../_shared/glossary-loader.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function assertUuid(name: string, v: unknown) {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!v || typeof v !== "string" || !re.test(v)) throw new Error(`INVALID_${name.toUpperCase()}`);
}
async function prereqDone(sb: ReturnType<typeof createClient>, packageId: string, stepKey: string) {
  const { data: d1 } = await sb
    .from("package_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  if (d1?.status === "done") return true;
  const { data: d2 } = await sb
    .from("course_package_build_steps").select("status")
    .eq("package_id", packageId).eq("step_key", stepKey).maybeSingle();
  return d2?.status === "done";
}

/**
 * Load curriculum_topics depth for a learning field to enrich handbook sections.
 */
async function loadFieldTopicDepth(
  sb: ReturnType<typeof createClient>,
  curriculumId: string,
  fieldTitle: string,
): Promise<string[]> {
  try {
    const { data: parentTopics } = await sb
      .from("curriculum_topics")
      .select("id, topic_name")
      .eq("certification_id", curriculumId)
      .is("parent_topic_id", null)
      .ilike("topic_name", `%${fieldTitle.slice(0, 30)}%`)
      .limit(3);

    let parentIds: string[] = [];
    if (parentTopics?.length) {
      parentIds = parentTopics.map((t: any) => t.id);
    } else {
      const { data: allParents } = await sb
        .from("curriculum_topics")
        .select("id, topic_name")
        .eq("certification_id", curriculumId)
        .is("parent_topic_id", null)
        .limit(50);
      if (!allParents?.length) return [];
      parentIds = allParents.map((p: any) => p.id);
    }

    const { data: subtopics } = await sb
      .from("curriculum_topics")
      .select("topic_name, difficulty_level")
      .in("parent_topic_id", parentIds)
      .limit(50);

    return subtopics?.map((s: any) => s.topic_name) || [];
  } catch {
    return [];
  }
}

/**
 * Generate real handbook section content via LLM.
 * wordTarget controls section length based on exam weighting.
 */
async function generateSectionContent(
  professionName: string,
  fieldCode: string,
  fieldTitle: string,
  fieldDescription: string,
  subtopics: string[],
  wordTarget: number,
  glossaryContext?: string,
): Promise<string> {
  const routed = getModel("handbook");
  const topicContext = subtopics.length > 0
    ? `\nKernthemen aus dem Rahmenplan:\n${subtopics.map(t => `- ${t}`).join("\n")}`
    : "";

  const minWords = Math.round(wordTarget * 0.8);
  const maxWords = Math.round(wordTarget * 1.2);

  const prompt = `Du bist ein IHK-Fachexperte für "${professionName}". 
Erstelle einen prüfungsrelevanten Handbuch-Abschnitt für "${fieldCode}: ${fieldTitle}".

${fieldDescription ? `Beschreibung: ${fieldDescription}` : ""}
${topicContext}

ANFORDERUNGEN:
1. Fachlich korrekt, prüfungsrelevant für IHK-Abschlussprüfung
2. Konkrete Definitionen, Formeln, Merksätze
3. Mindestens 2 praxisnahe Beispiele
4. Typische Prüfungsfallen
5. Markdown mit ## und ### Überschriften
6. Umfang: ${minWords}–${maxWords} Wörter
7. KEINE Platzhalter
${glossaryContext || ''}

Antworte NUR mit Markdown.`;

  try {
    const result = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        { role: "system", content: "Du schreibst prüfungsrelevante IHK-Handbuch-Inhalte. Antworte nur mit Markdown. Sei prägnant." },
        { role: "user", content: prompt },
      ],
      max_tokens: Math.min(1800, Math.round(wordTarget * 2.5)),
    });

    let content = result.content || "";
    if (content.startsWith("{") || content.startsWith('"')) {
      try {
        const parsed = JSON.parse(content);
        content = typeof parsed === "string" ? parsed : parsed.content || parsed.markdown || JSON.stringify(parsed);
      } catch { /* use as-is */ }
    }
    content = content.replace(/^```(?:markdown)?\n?/g, "").replace(/\n?```$/g, "").trim();

    if (content.length < 200) {
      console.warn(`[generate-handbook] Short content for ${fieldCode}: ${content.length} chars`);
    }
    return content;
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error(`[generate-handbook] LLM failed for ${fieldCode}: ${msg}`);
    return "";
  }
}

Deno.serve(async (req) => {
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

  if (!(await prereqDone(sb, packageId, "build_ai_tutor_index"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: build_ai_tutor_index" }, 409);
  }

  let professionName = "Ausbildungsberuf";
  let glossaryContext = "";
  try {
    const prof = await resolveProfession(sb, { certificationId, curriculumId });
    professionName = prof.professionName;
    // SKIP glossary generation — it was causing 30-60s LLM timeouts that ate
    // into the section generation time budget, leading to job-runner aborts.
    // Glossary context is nice-to-have, not critical for handbook quality.
  } catch { /* fallback */ }

  // 1) Load learning fields
  const { data: fields, error: lfErr } = await sb
    .from("learning_fields")
    .select("id, code, title, description, sort_order")
    .eq("curriculum_id", curriculumId)
    .order("sort_order", { ascending: true });

  if (lfErr) throw new Error(`LF query: ${lfErr.message}`);
  if (!fields || fields.length === 0) throw new Error(`No learning_fields for curriculum ${curriculumId}`);

  // ═══ NEW: Load exam blueprint weights for proportional section lengths ═══
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

  // Calculate per-LF word targets based on exam weighting
  const BASE_WORDS = 400;
  const MAX_WORDS = 800;
  const totalWeight = Array.from(weightByLf.values()).reduce((s, v) => s + v, 0) || fields.length;
  
  const lfWordTargets = new Map<string, number>();
  for (const lf of fields) {
    const w = weightByLf.get(lf.id) || (100 / fields.length);
    const normalizedWeight = w / totalWeight;
    // Higher-weighted LFs get more words (400-800 range)
    const wordTarget = Math.round(BASE_WORDS + (MAX_WORDS - BASE_WORDS) * Math.min(1, normalizedWeight * fields.length));
    lfWordTargets.set(lf.id, Math.max(BASE_WORDS, Math.min(MAX_WORDS, wordTarget)));
  }

  // ═══ NEW: Load competencies per LF for handbook section linkage ═══
  const lfIds = fields.map((f: any) => f.id);
  const { data: allComps } = await sb
    .from("competencies")
    .select("id, learning_field_id")
    .in("learning_field_id", lfIds)
    .limit(500);

  // Map LF -> first competency (primary link for handbook section)
  const primaryCompByLf = new Map<string, string>();
  if (allComps?.length) {
    for (const comp of allComps) {
      const lfId = (comp as any).learning_field_id;
      if (!primaryCompByLf.has(lfId)) primaryCompByLf.set(lfId, comp.id);
    }
  }

  console.log(`[generate-handbook] Generating for ${professionName}: ${fields.length} LFs, weighted word targets (pkg ${packageId.slice(0, 8)})`);

  // 2) Delete existing handbook (idempotent rebuild)
  const { data: existingChapters } = await sb
    .from("handbook_chapters").select("id").eq("curriculum_id", curriculumId);

  if (existingChapters?.length) {
    const chapterIds = existingChapters.map((x: { id: string }) => x.id);
    try { await sb.from("handbook_sections").delete().in("chapter_id", chapterIds); } catch (_) { /* ignore */ }
    try { await sb.from("handbook_chapters").delete().eq("curriculum_id", curriculumId); } catch (_) { /* ignore */ }
  }

  // 3) Create chapters (target 5)
  const TARGET_CHAPTERS = 5;
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

  const { data: chapters, error: chErr } = await sb
    .from("handbook_chapters").insert(chaptersToCreate).select("id, sort_order");
  if (chErr) throw new Error(`Chapter insert: ${chErr.message}`);
  if (!chapters?.length) throw new Error("handbook_chapters: 0 rows inserted");

  const fieldToChapter: number[] = [];
  for (let ci = 0; ci < rawChunks.length; ci++) {
    for (let fi = 0; fi < rawChunks[ci].length; fi++) fieldToChapter.push(ci + 1);
  }

  // 4) Generate sections ONE AT A TIME to stay within job-runner 140s timeout
  // Each LLM call can take 30-60s; batch of 3 caused 180s+ timeouts
  const BATCH_SIZE = 1;
  const batchCursor = p.batch_cursor ?? 0;
  const sectionRows: Array<Record<string, unknown>> = [];
  let sectionOrder = batchCursor + 1;
  let llmSuccessCount = 0;
  let llmFailCount = 0;

  // If resuming, reload existing sections count
  if (batchCursor > 0) {
    const { data: existingSections } = await sb
      .from("handbook_sections")
      .select("id")
      .in("chapter_id", chapters.map((c: any) => c.id));
    sectionOrder = (existingSections?.length || 0) + 1;
  }

  const batchEnd = Math.min(batchCursor + BATCH_SIZE, fields.length);
  const batchFields = fields.slice(batchCursor, batchEnd);

  for (let i = 0; i < batchFields.length; i++) {
    const lf = batchFields[i] as any;
    const globalIdx = batchCursor + i;
    const chapterSortOrder = fieldToChapter[globalIdx] || 1;
    const chapter = chapters.find((c: any) => c.sort_order === chapterSortOrder);
    if (!chapter) continue;

    const subtopics = await loadFieldTopicDepth(sb, curriculumId, lf.title);
    const wordTarget = lfWordTargets.get(lf.id) || BASE_WORDS;

    const generatedContent = await generateSectionContent(
      professionName,
      lf.code,
      lf.title,
      lf.description || "",
      subtopics,
      wordTarget,
      glossaryContext,
    );

    const hasRealContent = generatedContent.length >= 200;
    if (hasRealContent) llmSuccessCount++;
    else llmFailCount++;

    const contentMarkdown = hasRealContent
      ? generatedContent
      : buildFallbackContent(lf, subtopics);

    sectionRows.push({
      chapter_id: chapter.id,
      section_key: `lf-${String(lf.code).toLowerCase().replace(/\s+/g, '-')}-${curriculumId.slice(0, 8)}`,
      title: `${lf.code}: ${lf.title}`,
      content_markdown: contentMarkdown,
      content_type: "text",
      sort_order: sectionOrder++,
      learning_field_id: lf.id,
      competency_id: primaryCompByLf.get(lf.id) || null,
      metadata: {
        depth_enriched: subtopics.length > 0,
        llm_generated: hasRealContent,
        word_target: wordTarget,
        exam_weight_pct: weightByLf.get(lf.id) || null,
      },
    });

    // No inter-field delay needed with batch_size=1
  }

  if (sectionRows.length > 0) {
    const { error: secErr } = await sb.from("handbook_sections").insert(sectionRows);
    if (secErr) throw new Error(`Section insert: ${secErr.message}`);
  }

  const isComplete = batchEnd >= fields.length;
  const progress = Math.round((batchEnd / fields.length) * 100);

  console.log(`[generate-handbook] Batch ${batchCursor}-${batchEnd}/${fields.length}: ${sectionRows.length} sections, ${llmSuccessCount} LLM, ${llmFailCount} fallback${isComplete ? ' — COMPLETE' : ''}`);

  if (!isComplete) {
    // Signal runner to re-invoke with next batch
    return json({
      ok: true,
      batch_complete: false,
      batch_cursor: batchEnd,
      progress,
      sections_this_batch: sectionRows.length,
    });
  }

  try { await sb.from("course_packages").update({ build_progress: 90 }).eq("id", packageId); } catch (_) { /* ignore */ }
  return json({
    ok: true,
    batch_complete: true,
    chapters: chapters.length,
    sections: sectionOrder - 1,
    llm_generated: llmSuccessCount,
    llm_fallback: llmFailCount,
  });
});

function buildFallbackContent(lf: any, subtopics: string[]): string {
  const parts: string[] = [
    `## ${lf.code}: ${lf.title}`,
    "",
    lf.description || `Dieses Lernfeld behandelt zentrale Aspekte von ${lf.title}.`,
    "",
  ];

  if (subtopics.length > 0) {
    parts.push("### Kernthemen aus dem Rahmenplan");
    for (const t of subtopics) parts.push(`- ${t}`);
    parts.push("");
  }

  parts.push(
    "### Prüfungsrelevanz",
    `Dieses Lernfeld ist ein fester Bestandteil der IHK-Abschlussprüfung. Die Inhalte werden regelmäßig in schriftlichen und mündlichen Prüfungsteilen abgefragt.`,
    "",
    "### Lernhinweise",
    "- Fachbegriffe und Definitionen sicher beherrschen",
    "- Zusammenhänge zwischen Theorie und Praxis herstellen",
    "- Typische Rechenaufgaben und Fallstudien üben",
  );

  return parts.join("\n");
}
