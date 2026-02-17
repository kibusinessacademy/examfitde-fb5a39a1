import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";
import { getModel } from "../_shared/model-routing.ts";
import { resolveProfession } from "../_shared/profession-resolver.ts";

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
 */
async function generateSectionContent(
  professionName: string,
  fieldCode: string,
  fieldTitle: string,
  fieldDescription: string,
  subtopics: string[],
): Promise<string> {
  const routed = getModel("content_generation");
  const topicContext = subtopics.length > 0
    ? `\nKernthemen aus dem Rahmenplan:\n${subtopics.map(t => `- ${t}`).join("\n")}`
    : "";

  const prompt = `Du bist ein IHK-Fachexperte für den Ausbildungsberuf "${professionName}". 
Erstelle einen prüfungsrelevanten Handbuch-Abschnitt für das Lernfeld "${fieldCode}: ${fieldTitle}".

${fieldDescription ? `Lernfeldbeschreibung: ${fieldDescription}` : ""}
${topicContext}

ANFORDERUNGEN:
1. Fachlich korrekt und prüfungsrelevant für die IHK-Abschlussprüfung
2. Konkrete Definitionen, Formeln, Merksätze — keine allgemeinen Floskeln
3. Mindestens 3 praxisnahe Beispiele mit konkreten Zahlen/Szenarien
4. Typische Prüfungsfallen mit Erklärung, warum Prüflinge dort scheitern
5. Markdown-Format mit ## und ### Überschriften
6. Mindestens 400 Wörter, maximal 800 Wörter
7. KEINE Platzhalter wie "wird ergänzt" oder "TODO"

Antworte NUR mit dem Markdown-Inhalt, KEIN JSON-Wrapper.`;

  try {
    const result = await callAIJSON({
      provider: routed.provider,
      model: routed.model,
      messages: [
        { role: "system", content: "Du schreibst prüfungsrelevante IHK-Handbuch-Inhalte. Antworte nur mit Markdown." },
        { role: "user", content: prompt },
      ],
      max_tokens: 3000,
    });

    // callAIJSON returns parsed JSON, but we asked for raw markdown
    // The response might be wrapped in JSON or raw text
    let content = result.content || "";
    // Strip JSON wrapper if present
    if (content.startsWith("{") || content.startsWith('"')) {
      try {
        const parsed = JSON.parse(content);
        content = typeof parsed === "string" ? parsed : parsed.content || parsed.markdown || JSON.stringify(parsed);
      } catch { /* use as-is */ }
    }
    // Strip markdown code fences
    content = content.replace(/^```(?:markdown)?\n?/g, "").replace(/\n?```$/g, "").trim();

    if (content.length < 200) {
      console.warn(`[generate-handbook] Short content for ${fieldCode}: ${content.length} chars`);
    }
    return content;
  } catch (e) {
    console.error(`[generate-handbook] LLM failed for ${fieldCode}: ${(e as Error).message}`);
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

  // Runner SSOT prerequisite
  if (!(await prereqDone(sb, packageId, "build_ai_tutor_index"))) {
    return json({ ok: false, retry: true, error: "PREREQ_NOT_DONE: build_ai_tutor_index" }, 409);
  }

  // Resolve profession name for LLM context
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

  console.log(`[generate-handbook] Generating handbook for ${professionName}: ${fields.length} learning fields (pkg ${packageId.slice(0, 8)})`);

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

  // Map field index -> chapter sort_order
  const fieldToChapter: number[] = [];
  for (let ci = 0; ci < rawChunks.length; ci++) {
    for (let fi = 0; fi < rawChunks[ci].length; fi++) fieldToChapter.push(ci + 1);
  }

  // 4) Generate sections WITH REAL CONTENT via LLM
  const sectionRows: Array<Record<string, unknown>> = [];
  let sectionOrder = 1;
  let llmSuccessCount = 0;
  let llmFailCount = 0;

  for (let i = 0; i < fields.length; i++) {
    const lf = fields[i] as any;
    const chapterSortOrder = fieldToChapter[i] || 1;
    const chapter = chapters.find((c: any) => c.sort_order === chapterSortOrder);
    if (!chapter) continue;

    // Load subtopics for depth
    const subtopics = await loadFieldTopicDepth(sb, curriculumId, lf.title);

    // Generate real content via LLM
    const generatedContent = await generateSectionContent(
      professionName,
      lf.code,
      lf.title,
      lf.description || "",
      subtopics,
    );

    const hasRealContent = generatedContent.length >= 200;
    if (hasRealContent) {
      llmSuccessCount++;
    } else {
      llmFailCount++;
    }

    // Use generated content or fallback to enriched scaffold
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
      metadata: { depth_enriched: subtopics.length > 0, llm_generated: hasRealContent },
    });

    // Rate-limit protection: 3s between LLM calls
    if (i < fields.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  if (!sectionRows.length) throw new Error("handbook_sections: 0 sections prepared");
  const { error: secErr } = await sb.from("handbook_sections").insert(sectionRows);
  if (secErr) throw new Error(`Section insert: ${secErr.message}`);

  console.log(`[generate-handbook] Done: ${chapters.length} chapters, ${sectionRows.length} sections, ${llmSuccessCount} LLM-generated, ${llmFailCount} fallback`);

  try { await sb.from("course_packages").update({ build_progress: 90 }).eq("id", packageId); } catch (_) { /* ignore */ }
  return json({
    ok: true,
    batch_complete: true,
    chapters: chapters.length,
    sections: sectionRows.length,
    llm_generated: llmSuccessCount,
    llm_fallback: llmFailCount,
  });
});

/**
 * Fallback content when LLM fails — still structured but minimal.
 * At least provides subtopic depth without placeholders.
 */
function buildFallbackContent(lf: any, subtopics: string[]): string {
  const parts: string[] = [
    `## ${lf.code}: ${lf.title}`,
    "",
    lf.description || `Dieses Lernfeld behandelt zentrale Aspekte von ${lf.title}.`,
    "",
  ];

  if (subtopics.length > 0) {
    parts.push("### Kernthemen aus dem Rahmenplan");
    for (const t of subtopics) {
      parts.push(`- ${t}`);
    }
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
